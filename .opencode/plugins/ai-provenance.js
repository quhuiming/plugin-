// src/config.ts
import path from "node:path";
var TRUE_VALUES = /* @__PURE__ */ new Set(["1", "true", "yes", "on"]);
var FALSE_VALUES = /* @__PURE__ */ new Set(["0", "false", "no", "off"]);
function booleanEnv(value, fallback) {
  if (value === void 0) return fallback;
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return fallback;
}
function positiveInteger(value, fallback) {
  if (value === void 0) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function loadConfig(worktree, env = process.env) {
  const configuredDirectory = env.OPENCODE_PROVENANCE_DIR?.trim() || ".opencode-metrics";
  const outputDirectory = path.isAbsolute(configuredDirectory) ? configuredDirectory : path.resolve(worktree, configuredDirectory);
  return {
    enabled: booleanEnv(env.OPENCODE_PROVENANCE_ENABLED, true),
    outputDirectory,
    eventFileName: env.OPENCODE_PROVENANCE_FILE?.trim() || "events.jsonl",
    hashSalt: env.OPENCODE_PROVENANCE_HASH_SALT || "",
    maxUntrackedHashBytes: positiveInteger(env.OPENCODE_PROVENANCE_MAX_UNTRACKED_BYTES, 2e6),
    maxSourceFileBytes: positiveInteger(env.OPENCODE_PROVENANCE_MAX_SOURCE_BYTES, 2e6),
    debug: booleanEnv(env.OPENCODE_PROVENANCE_DEBUG, false)
  };
}

// src/git.ts
import { spawn } from "node:child_process";
import { createHash as createHash2 } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path3 from "node:path";

// src/redact.ts
import { createHash } from "node:crypto";
import path2 from "node:path";
function sha256(value, salt = "") {
  return createHash("sha256").update(salt).update(value).digest("hex");
}
function byteLength(value) {
  if (typeof value !== "string") return 0;
  return Buffer.byteLength(value, "utf8");
}
function safeRelativePath(value, worktree) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) return null;
  const absolute = path2.isAbsolute(value) ? path2.normalize(value) : path2.resolve(worktree, value);
  const relative = path2.relative(worktree, absolute);
  if (relative === "" || relative.startsWith("..") || path2.isAbsolute(relative)) return null;
  return relative.split(path2.sep).join("/");
}
function patchPaths(patchText, worktree) {
  const paths = [];
  const marker = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm;
  for (const match of patchText.matchAll(marker)) {
    const relative = safeRelativePath(match[1], worktree);
    if (relative) paths.push(relative);
  }
  return paths;
}
function patchLineEstimate(patchText) {
  let added = 0;
  let deleted = 0;
  for (const line of patchText.split(/\r?\n/)) {
    if (line.startsWith("***")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) deleted += 1;
  }
  return { added, deleted };
}
function commandName(command) {
  if (typeof command !== "string") return void 0;
  const trimmed = command.trim();
  if (trimmed === "") return void 0;
  const first = trimmed.split(/\s+/, 1)[0];
  if (!first || first.includes("=") || !/^[A-Za-z0-9_./:-]+$/.test(first)) return void 0;
  return path2.basename(first);
}
function sanitizeToolInput(tool, args, worktree, salt = "") {
  const record = typeof args === "object" && args !== null ? args : {};
  const argumentKeys = Object.keys(record).sort();
  const paths = /* @__PURE__ */ new Set();
  for (const key of ["filePath", "path", "file", "targetPath"]) {
    const relative = safeRelativePath(record[key], worktree);
    if (relative) paths.add(relative);
  }
  const payloads = [];
  for (const key of ["content", "oldString", "newString", "patchText", "command"]) {
    if (typeof record[key] === "string") payloads.push(record[key]);
  }
  const combined = payloads.join("\0");
  const result = {
    argumentKeys,
    paths: [...paths].sort(),
    payloadBytes: payloads.reduce((total, value) => total + byteLength(value), 0)
  };
  if (combined.length > 0) result.payloadHash = sha256(combined, salt);
  if (tool === "apply_patch" && typeof record.patchText === "string") {
    for (const item of patchPaths(record.patchText, worktree)) paths.add(item);
    result.paths = [...paths].sort();
    const estimate = patchLineEstimate(record.patchText);
    result.estimatedAdded = estimate.added;
    result.estimatedDeleted = estimate.deleted;
  }
  if (tool === "bash") {
    const name = commandName(record.command);
    if (name) result.commandName = name;
  }
  return result;
}

// src/git.ts
var EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
function runGit(worktree, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: worktree,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), code: code ?? -1 });
    });
  });
}
async function gitText(worktree, args) {
  const result = await runGit(worktree, args);
  if (result.code !== 0) return null;
  return result.stdout.toString("utf8").trim() || null;
}
function normalizedRelative(value) {
  return value.replaceAll("\\", "/");
}
function parseCount(value) {
  if (value === "-") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
function parseNumstatZ(buffer) {
  const tokens = (typeof buffer === "string" ? buffer : buffer.toString("utf8")).split("\0");
  const files = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    const firstTab = token.indexOf("	");
    const secondTab = firstTab < 0 ? -1 : token.indexOf("	", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) continue;
    const addedValue = token.slice(0, firstTab);
    const deletedValue = token.slice(firstTab + 1, secondTab);
    let filePath = token.slice(secondTab + 1);
    if (filePath === "") {
      index += 2;
      filePath = tokens[index] || tokens[index - 1] || "";
    }
    if (filePath === "") continue;
    const added = parseCount(addedValue);
    const deleted = parseCount(deletedValue);
    files.push({
      path: normalizedRelative(filePath),
      added,
      deleted,
      binary: added === null || deleted === null,
      untracked: false
    });
  }
  return files;
}
function isInsideOutputDirectory(relativePath, outputRelative) {
  if (!outputRelative) return false;
  return relativePath === outputRelative || relativePath.startsWith(`${outputRelative}/`);
}
async function untrackedFiles(worktree, outputRelative, maxHashBytes) {
  const result = await runGit(worktree, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."]);
  if (result.code !== 0) return [];
  const paths = result.stdout.toString("utf8").split("\0").filter(Boolean);
  const files = [];
  for (const item of paths) {
    const normalized = normalizedRelative(item);
    if (isInsideOutputDirectory(normalized, outputRelative)) continue;
    const absolute = path3.resolve(worktree, item);
    try {
      const metadata = await stat(absolute);
      if (!metadata.isFile()) continue;
      const file = {
        path: normalized,
        added: null,
        deleted: 0,
        binary: false,
        untracked: true,
        size: metadata.size
      };
      if (metadata.size <= maxHashBytes) {
        file.contentHash = createHash2("sha256").update(await readFile(absolute)).digest("hex");
      }
      files.push(file);
    } catch {
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}
function outputPathspec(worktree, outputDirectory) {
  const relative = normalizedRelative(path3.relative(worktree, outputDirectory));
  if (relative === "" || relative.startsWith("../") || path3.isAbsolute(relative)) return null;
  return relative;
}
async function captureGitSnapshot(worktree, config) {
  const head = await gitText(worktree, ["rev-parse", "--verify", "HEAD"]);
  const branch = await gitText(worktree, ["branch", "--show-current"]);
  const base = head ?? EMPTY_TREE;
  const outputRelative = outputPathspec(worktree, config.outputDirectory);
  const pathspecs = ["."];
  if (outputRelative) pathspecs.push(`:(exclude)${outputRelative}/**`);
  const [patchResult, numstatResult, untracked] = await Promise.all([
    runGit(worktree, ["diff", "--binary", "--full-index", "--no-ext-diff", base, "--", ...pathspecs]),
    runGit(worktree, ["diff", "--numstat", "-z", "--no-ext-diff", base, "--", ...pathspecs]),
    untrackedFiles(worktree, outputRelative, config.maxUntrackedHashBytes)
  ]);
  if (patchResult.code !== 0 || numstatResult.code !== 0) {
    const reason = patchResult.code !== 0 ? patchResult.stderr : numstatResult.stderr;
    throw new Error(`git snapshot failed: ${reason.toString("utf8").trim()}`);
  }
  const tracked = parseNumstatZ(numstatResult.stdout);
  const files = [...tracked, ...untracked].sort((left, right) => left.path.localeCompare(right.path));
  const manifest = JSON.stringify(
    untracked.map(({ path: filePath, contentHash, size }) => ({ path: filePath, contentHash, size }))
  );
  const patchHash = createHash2("sha256").update(patchResult.stdout).update("\0").update(manifest).digest("hex");
  return {
    capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
    head,
    branch,
    dirty: files.length > 0,
    patchHash,
    totalAdded: tracked.reduce((total, file) => total + (file.added ?? 0), 0),
    totalDeleted: tracked.reduce((total, file) => total + (file.deleted ?? 0), 0),
    files
  };
}
async function isGitWorktree(worktree) {
  return await gitText(worktree, ["rev-parse", "--is-inside-work-tree"]) === "true";
}
async function repositoryId(worktree, salt = "") {
  const remote = await gitText(worktree, ["config", "--get", "remote.origin.url"]);
  const root = await gitText(worktree, ["rev-parse", "--show-toplevel"]);
  return sha256(remote ?? root ?? worktree, salt);
}

// src/key.ts
import { chmod, mkdir, readFile as readFile2, writeFile } from "node:fs/promises";
import path4 from "node:path";
import { randomBytes } from "node:crypto";

// src/java-lines.ts
import { createHmac } from "node:crypto";

// node_modules/diff/libesm/diff/base.js
var Diff = class {
  diff(oldStr, newStr, options = {}) {
    let callback;
    if (typeof options === "function") {
      callback = options;
      options = {};
    } else if ("callback" in options) {
      callback = options.callback;
    }
    const oldString = this.castInput(oldStr, options);
    const newString = this.castInput(newStr, options);
    const oldTokens = this.removeEmpty(this.tokenize(oldString, options));
    const newTokens = this.removeEmpty(this.tokenize(newString, options));
    return this.diffWithOptionsObj(oldTokens, newTokens, options, callback);
  }
  diffWithOptionsObj(oldTokens, newTokens, options, callback) {
    var _a;
    const done = (value) => {
      value = this.postProcess(value, options);
      if (callback) {
        setTimeout(function() {
          callback(value);
        }, 0);
        return void 0;
      } else {
        return value;
      }
    };
    const newLen = newTokens.length, oldLen = oldTokens.length;
    let editLength = 1;
    let maxEditLength = newLen + oldLen;
    if (options.maxEditLength != null) {
      maxEditLength = Math.min(maxEditLength, options.maxEditLength);
    }
    const maxExecutionTime = (_a = options.timeout) !== null && _a !== void 0 ? _a : Infinity;
    const abortAfterTimestamp = Date.now() + maxExecutionTime;
    const bestPath = [{ oldPos: -1, lastComponent: void 0 }];
    let newPos = this.extractCommon(bestPath[0], newTokens, oldTokens, 0, options);
    if (bestPath[0].oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
      return done(this.buildValues(bestPath[0].lastComponent, newTokens, oldTokens));
    }
    let minDiagonalToConsider = -Infinity, maxDiagonalToConsider = Infinity;
    const execEditLength = () => {
      for (let diagonalPath = Math.max(minDiagonalToConsider, -editLength); diagonalPath <= Math.min(maxDiagonalToConsider, editLength); diagonalPath += 2) {
        let basePath;
        const removePath = bestPath[diagonalPath - 1], addPath = bestPath[diagonalPath + 1];
        if (removePath) {
          bestPath[diagonalPath - 1] = void 0;
        }
        let canAdd = false;
        if (addPath) {
          const addPathNewPos = addPath.oldPos - diagonalPath;
          canAdd = addPath && 0 <= addPathNewPos && addPathNewPos < newLen;
        }
        const canRemove = removePath && removePath.oldPos + 1 < oldLen;
        if (!canAdd && !canRemove) {
          bestPath[diagonalPath] = void 0;
          continue;
        }
        if (!canRemove || canAdd && removePath.oldPos < addPath.oldPos) {
          basePath = this.addToPath(addPath, true, false, 0, options);
        } else {
          basePath = this.addToPath(removePath, false, true, 1, options);
        }
        newPos = this.extractCommon(basePath, newTokens, oldTokens, diagonalPath, options);
        if (basePath.oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
          return done(this.buildValues(basePath.lastComponent, newTokens, oldTokens)) || true;
        } else {
          bestPath[diagonalPath] = basePath;
          if (basePath.oldPos + 1 >= oldLen) {
            maxDiagonalToConsider = Math.min(maxDiagonalToConsider, diagonalPath - 1);
          }
          if (newPos + 1 >= newLen) {
            minDiagonalToConsider = Math.max(minDiagonalToConsider, diagonalPath + 1);
          }
        }
      }
      editLength++;
    };
    if (callback) {
      (function exec() {
        setTimeout(function() {
          if (editLength > maxEditLength || Date.now() > abortAfterTimestamp) {
            return callback(void 0);
          }
          if (!execEditLength()) {
            exec();
          }
        }, 0);
      })();
    } else {
      while (editLength <= maxEditLength && Date.now() <= abortAfterTimestamp) {
        const ret = execEditLength();
        if (ret) {
          return ret;
        }
      }
    }
  }
  addToPath(path7, added, removed, oldPosInc, options) {
    const last = path7.lastComponent;
    if (last && !options.oneChangePerToken && last.added === added && last.removed === removed) {
      return {
        oldPos: path7.oldPos + oldPosInc,
        lastComponent: { count: last.count + 1, added, removed, previousComponent: last.previousComponent }
      };
    } else {
      return {
        oldPos: path7.oldPos + oldPosInc,
        lastComponent: { count: 1, added, removed, previousComponent: last }
      };
    }
  }
  extractCommon(basePath, newTokens, oldTokens, diagonalPath, options) {
    const newLen = newTokens.length, oldLen = oldTokens.length;
    let oldPos = basePath.oldPos, newPos = oldPos - diagonalPath, commonCount = 0;
    while (newPos + 1 < newLen && oldPos + 1 < oldLen && this.equals(oldTokens[oldPos + 1], newTokens[newPos + 1], options)) {
      newPos++;
      oldPos++;
      commonCount++;
      if (options.oneChangePerToken) {
        basePath.lastComponent = { count: 1, previousComponent: basePath.lastComponent, added: false, removed: false };
      }
    }
    if (commonCount && !options.oneChangePerToken) {
      basePath.lastComponent = { count: commonCount, previousComponent: basePath.lastComponent, added: false, removed: false };
    }
    basePath.oldPos = oldPos;
    return newPos;
  }
  equals(left, right, options) {
    if (options.comparator) {
      return options.comparator(left, right);
    } else {
      return left === right || !!options.ignoreCase && left.toLowerCase() === right.toLowerCase();
    }
  }
  removeEmpty(array) {
    const ret = [];
    for (let i = 0; i < array.length; i++) {
      if (array[i]) {
        ret.push(array[i]);
      }
    }
    return ret;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  castInput(value, options) {
    return value;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tokenize(value, options) {
    return Array.from(value);
  }
  join(chars) {
    return chars.join("");
  }
  postProcess(changeObjects, options) {
    return changeObjects;
  }
  get useLongestToken() {
    return false;
  }
  buildValues(lastComponent, newTokens, oldTokens) {
    const components = [];
    let nextComponent;
    while (lastComponent) {
      components.push(lastComponent);
      nextComponent = lastComponent.previousComponent;
      delete lastComponent.previousComponent;
      lastComponent = nextComponent;
    }
    components.reverse();
    const componentLen = components.length;
    let componentPos = 0, newPos = 0, oldPos = 0;
    for (; componentPos < componentLen; componentPos++) {
      const component = components[componentPos];
      if (!component.removed) {
        if (!component.added && this.useLongestToken) {
          let value = newTokens.slice(newPos, newPos + component.count);
          value = value.map(function(value2, i) {
            const oldValue = oldTokens[oldPos + i];
            return oldValue.length > value2.length ? oldValue : value2;
          });
          component.value = this.join(value);
        } else {
          component.value = this.join(newTokens.slice(newPos, newPos + component.count));
        }
        newPos += component.count;
        if (!component.added) {
          oldPos += component.count;
        }
      } else {
        component.value = this.join(oldTokens.slice(oldPos, oldPos + component.count));
        oldPos += component.count;
      }
    }
    return components;
  }
};

// node_modules/diff/libesm/diff/line.js
var LineDiff = class extends Diff {
  constructor() {
    super(...arguments);
    this.tokenize = tokenize;
  }
  equals(left, right, options) {
    if (options.ignoreWhitespace) {
      if (!options.newlineIsToken || !left.includes("\n")) {
        left = left.trim();
      }
      if (!options.newlineIsToken || !right.includes("\n")) {
        right = right.trim();
      }
    } else if (options.ignoreNewlineAtEof && !options.newlineIsToken) {
      if (left.endsWith("\n")) {
        left = left.slice(0, -1);
      }
      if (right.endsWith("\n")) {
        right = right.slice(0, -1);
      }
    }
    return super.equals(left, right, options);
  }
};
var lineDiff = new LineDiff();
function diffLines(oldStr, newStr, options) {
  return lineDiff.diff(oldStr, newStr, options);
}
function tokenize(value, options) {
  if (options.stripTrailingCr) {
    value = value.replace(/\r\n/g, "\n");
  }
  const retLines = [], linesAndNewlines = value.split(/(\n|\r\n)/);
  if (!linesAndNewlines[linesAndNewlines.length - 1]) {
    linesAndNewlines.pop();
  }
  for (let i = 0; i < linesAndNewlines.length; i++) {
    const line = linesAndNewlines[i];
    if (i % 2 && !options.newlineIsToken) {
      retLines[retLines.length - 1] += line;
    } else {
      retLines.push(line);
    }
  }
  return retLines;
}

// src/java-lines.ts
var IDENTIFIER_START = /[\p{L}\p{Nl}_$]/u;
var IDENTIFIER_PART = /[\p{L}\p{Nl}\p{N}\p{Mn}\p{Mc}\p{Pc}_$]/u;
var STRUCTURAL_ONLY = /* @__PURE__ */ new Set(["{", "}", "(", ")", ";", ","]);
function consumeQuoted(line, start, quote) {
  let index = start + 1;
  let escaped = false;
  while (index < line.length) {
    const char = line[index] ?? "";
    index += 1;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === quote) break;
  }
  return { token: line.slice(start, index), next: index };
}
function tokenizeJavaLine(line, state) {
  const tokens = [];
  let index = 0;
  while (index < line.length) {
    if (state.inBlockComment) {
      const end = line.indexOf("*/", index);
      if (end < 0) return tokens;
      state.inBlockComment = false;
      index = end + 2;
      continue;
    }
    const char = line[index] ?? "";
    const next = line[index + 1] ?? "";
    if (char === "/" && next === "/") break;
    if (char === "/" && next === "*") {
      state.inBlockComment = true;
      index += 2;
      continue;
    }
    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const quoted = consumeQuoted(line, index, char);
      tokens.push(quoted.token);
      index = quoted.next;
      continue;
    }
    if (IDENTIFIER_START.test(char)) {
      let end = index + 1;
      while (end < line.length && IDENTIFIER_PART.test(line[end] ?? "")) end += 1;
      tokens.push(line.slice(index, end));
      index = end;
      continue;
    }
    if (/[0-9]/u.test(char)) {
      let end = index + 1;
      while (end < line.length) {
        const numberChar = line[end] ?? "";
        if (/[0-9A-Fa-f_xXbBpP.]/u.test(numberChar)) {
          end += 1;
          continue;
        }
        const previous = line[end - 1] ?? "";
        if ((numberChar === "+" || numberChar === "-") && /[eEpP]/u.test(previous)) {
          end += 1;
          continue;
        }
        break;
      }
      tokens.push(line.slice(index, end));
      index = end;
      continue;
    }
    tokens.push(char);
    index += 1;
  }
  return tokens;
}
function isEffective(tokens) {
  if (tokens.length === 0) return false;
  if (tokens[0] === "package" || tokens[0] === "import") return false;
  return !tokens.every((token) => STRUCTURAL_ONLY.has(token));
}
function effectiveJavaLines(source) {
  const state = { inBlockComment: false };
  const lines = source.split(/\r\n|\n|\r/);
  const result = [];
  for (let index = 0; index < lines.length; index += 1) {
    const tokens = tokenizeJavaLine(lines[index] ?? "", state);
    if (!isEffective(tokens)) continue;
    result.push({ lineNumber: index + 1, normalized: tokens.join("") });
  }
  return result;
}
function physicalLines(value) {
  if (value === "") return [];
  const lines = value.split(/\r\n|\n|\r/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}
function addedEffectiveLines(before, after) {
  const addedLineNumbers = /* @__PURE__ */ new Set();
  let afterLine = 1;
  for (const part of diffLines(before, after)) {
    const count = physicalLines(part.value).length;
    if (part.added) {
      for (let offset = 0; offset < count; offset += 1) addedLineNumbers.add(afterLine + offset);
      afterLine += count;
    } else if (!part.removed) {
      afterLine += count;
    }
  }
  return effectiveJavaLines(after).filter((line) => addedLineNumbers.has(line.lineNumber));
}
function fingerprintNormalizedLine(normalized, key) {
  return createHmac("sha256", key).update("opencode-provenance/java-line-v1\0").update(normalized).digest("hex");
}
function fingerprintLines(lines, key) {
  return lines.map((line) => fingerprintNormalizedLine(line.normalized, key));
}
function hmacKeyId(key) {
  return createHmac("sha256", key).update("opencode-provenance/key-id/v1").digest("hex").slice(0, 16);
}

// src/key.ts
function validateKey(key) {
  if (key.byteLength < 32) {
    throw new Error("OPENCODE_PROVENANCE_HMAC_KEY must be at least 32 bytes");
  }
  return key;
}
async function readHmacKeyFile(keyPath) {
  const value = (await readFile2(keyPath, "utf8")).trim();
  if (!value.startsWith("v1:")) throw new Error("Unsupported attribution key format");
  const key = validateKey(Buffer.from(value.slice(3), "base64"));
  return { key, keyId: hmacKeyId(key), source: "file", keyPath };
}
async function resolveHmacKey(outputDirectory, env = process.env) {
  const environmentValue = env.OPENCODE_PROVENANCE_HMAC_KEY;
  if (environmentValue !== void 0) {
    const key2 = validateKey(Buffer.from(environmentValue, "utf8"));
    return { key: key2, keyId: hmacKeyId(key2), source: "environment" };
  }
  await mkdir(outputDirectory, { recursive: true, mode: 448 });
  const keyPath = path4.join(outputDirectory, "attribution.key");
  let key;
  try {
    key = (await readHmacKeyFile(keyPath)).key;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const generated = randomBytes(32);
    try {
      await writeFile(keyPath, `v1:${generated.toString("base64")}
`, {
        encoding: "utf8",
        mode: 384,
        flag: "wx"
      });
      key = generated;
    } catch (writeError) {
      if (writeError.code !== "EEXIST") throw writeError;
      key = (await readHmacKeyFile(keyPath)).key;
    }
  }
  await chmod(keyPath, 384);
  return { key, keyId: hmacKeyId(key), source: "file", keyPath };
}

// src/source-capture.ts
import { lstat, readFile as readFile3 } from "node:fs/promises";
import path5 from "node:path";
function normalizedRelative2(candidate, worktree) {
  if (candidate.length === 0 || candidate.includes("\0")) return null;
  const absolute = path5.isAbsolute(candidate) ? path5.normalize(candidate) : path5.resolve(worktree, candidate);
  const relative = path5.relative(worktree, absolute);
  if (relative === "" || relative.startsWith("..") || path5.isAbsolute(relative)) return null;
  return relative.split(path5.sep).join("/");
}
async function readCandidate(worktree, relative, maxBytes) {
  const absolute = path5.resolve(worktree, relative);
  try {
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) return { reason: "symlink" };
    if (!metadata.isFile()) return { reason: "read_failed" };
    if (metadata.size > maxBytes) return { reason: "oversized" };
    return { content: await readFile3(absolute, "utf8") };
  } catch (error) {
    if (error.code === "ENOENT") return { content: "" };
    return { reason: "read_failed" };
  }
}
async function captureSourceFiles(worktree, paths, maxBytes) {
  const files = /* @__PURE__ */ new Map();
  const skipped = [];
  for (const candidate of new Set(paths)) {
    const relative = normalizedRelative2(candidate, worktree);
    if (!relative) {
      skipped.push({ path: "<outside>", reason: "outside_worktree" });
      continue;
    }
    if (path5.extname(relative).toLowerCase() !== ".java") {
      skipped.push({ path: relative, reason: "unsupported_extension" });
      continue;
    }
    const result = await readCandidate(worktree, relative, maxBytes);
    if (result.content !== void 0) files.set(relative, result.content);
    else skipped.push({ path: relative, reason: result.reason ?? "read_failed" });
  }
  return { files, skipped };
}
async function finalizeSourceAttribution(before, worktree, key, baseHead, maxBytes) {
  const files = [];
  const skipped = [...before.skipped];
  for (const [relative, beforeContent] of before.files) {
    const after = await readCandidate(worktree, relative, maxBytes);
    if (after.content === void 0) {
      skipped.push({ path: relative, reason: after.reason ?? "read_failed" });
      continue;
    }
    const added = addedEffectiveLines(beforeContent, after.content);
    if (added.length === 0) continue;
    files.push({
      path: relative,
      addedEffectiveLines: added.length,
      fingerprints: fingerprintLines(added, key)
    });
  }
  return {
    algorithm: "hmac-sha256/java-line-v1",
    keyId: hmacKeyId(key),
    baseHead,
    files,
    skipped
  };
}

// src/store.ts
import { randomUUID } from "node:crypto";
import { appendFile, mkdir as mkdir2, readFile as readFile4 } from "node:fs/promises";
import path6 from "node:path";

// src/types.ts
var SCHEMA_VERSION = 2;

// src/store.ts
var EventStore = class {
  eventPath;
  sequence = 0;
  queue = Promise.resolve();
  constructor(outputDirectory, eventFileName) {
    this.eventPath = path6.join(outputDirectory, eventFileName);
  }
  async initialize() {
    await mkdir2(path6.dirname(this.eventPath), { recursive: true, mode: 448 });
    try {
      const existing = await readFile4(this.eventPath, "utf8");
      for (const line of existing.split(/\r?\n/)) {
        if (line.trim() === "") continue;
        try {
          const parsed = JSON.parse(line);
          if (typeof parsed.sequence === "number" && parsed.sequence > this.sequence) {
            this.sequence = parsed.sequence;
          }
        } catch {
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  append(input) {
    const event = {
      ...input,
      schemaVersion: SCHEMA_VERSION,
      eventId: randomUUID(),
      sequence: ++this.sequence,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    const line = `${JSON.stringify(event)}
`;
    const operation = this.queue.then(() => appendFile(this.eventPath, line, { encoding: "utf8", mode: 384 }));
    this.queue = operation.catch(() => void 0);
    return operation;
  }
  async flush() {
    await this.queue;
  }
};

// src/index.ts
var MUTATING_TOOLS = /* @__PURE__ */ new Set(["edit", "write", "apply_patch", "bash"]);
var SAFE_SESSION_EVENTS = /* @__PURE__ */ new Set([
  "session.created",
  "session.updated",
  "session.idle",
  "session.compacted",
  "session.error",
  "session.deleted"
]);
function eventSessionId(event) {
  const properties = typeof event.properties === "object" && event.properties !== null ? event.properties : {};
  if (typeof properties.sessionID === "string") return properties.sessionID;
  const info = typeof properties.info === "object" && properties.info !== null ? properties.info : {};
  return typeof info.id === "string" ? info.id : void 0;
}
var AiProvenancePlugin = async ({ client, worktree, directory }) => {
  const root = worktree || directory;
  const config = loadConfig(root);
  if (!config.enabled || !await isGitWorktree(root)) return {};
  const store = new EventStore(config.outputDirectory, config.eventFileName);
  await store.initialize();
  const repoId = await repositoryId(root, config.hashSalt);
  let hmac;
  try {
    hmac = await resolveHmacKey(config.outputDirectory);
  } catch {
    await store.append({ kind: "collector.error", repositoryId: repoId, errorCode: "hmac_key_unavailable" });
  }
  const pending = /* @__PURE__ */ new Map();
  const messages = /* @__PURE__ */ new Map();
  const models = /* @__PURE__ */ new Map();
  const diagnostic = async (errorCode, sessionId) => {
    try {
      await store.append({ kind: "collector.error", repositoryId: repoId, errorCode, ...sessionId ? { sessionId } : {} });
      if (config.debug) {
        await client.app.log({
          body: {
            service: "ai-provenance",
            level: "warn",
            message: errorCode
          }
        });
      }
    } catch {
    }
  };
  await store.append({ kind: "collector.started", repositoryId: repoId });
  return {
    "chat.message": async (input) => {
      if (input.messageID) messages.set(input.sessionID, input.messageID);
      if (input.model) {
        models.set(input.sessionID, {
          providerId: input.model.providerID,
          modelId: input.model.modelID
        });
      }
    },
    "tool.execute.before": async (input, output) => {
      if (!MUTATING_TOOLS.has(input.tool)) return;
      try {
        const sanitized = sanitizeToolInput(input.tool, output.args, root, config.hashSalt);
        const snapshot = await captureGitSnapshot(root, config);
        const sources = await captureSourceFiles(root, sanitized.paths, config.maxSourceFileBytes);
        const messageId = messages.get(input.sessionID);
        const model = models.get(input.sessionID);
        pending.set(input.callID, {
          input: sanitized,
          snapshot,
          sources,
          ...messageId ? { messageId } : {}
        });
        await store.append({
          kind: "tool.before",
          repositoryId: repoId,
          sessionId: input.sessionID,
          ...messageId ? { messageId } : {},
          ...model ? { model } : {},
          operationId: input.callID,
          tool: input.tool,
          phase: "before",
          input: sanitized,
          snapshot
        });
      } catch {
        await diagnostic("tool_before_capture_failed", input.sessionID);
      }
    },
    "tool.execute.after": async (input) => {
      if (!MUTATING_TOOLS.has(input.tool)) return;
      try {
        const before = pending.get(input.callID);
        const sanitized = before?.input ?? sanitizeToolInput(input.tool, input.args, root, config.hashSalt);
        const snapshot = await captureGitSnapshot(root, config);
        const provenance = hmac && before ? await finalizeSourceAttribution(
          before.sources,
          root,
          hmac.key,
          before.snapshot.head,
          config.maxSourceFileBytes
        ) : void 0;
        const messageId = before?.messageId ?? messages.get(input.sessionID);
        const model = models.get(input.sessionID);
        await store.append({
          kind: "tool.after",
          repositoryId: repoId,
          sessionId: input.sessionID,
          ...messageId ? { messageId } : {},
          ...model ? { model } : {},
          operationId: input.callID,
          tool: input.tool,
          phase: "after",
          input: sanitized,
          snapshot,
          ...provenance ? { provenance } : {}
        });
      } catch {
        await diagnostic("tool_after_capture_failed", input.sessionID);
      } finally {
        pending.delete(input.callID);
      }
    },
    event: async ({ event }) => {
      if (!SAFE_SESSION_EVENTS.has(event.type)) return;
      const sessionId = eventSessionId(event);
      try {
        const model = sessionId ? models.get(sessionId) : void 0;
        await store.append({
          kind: "session.event",
          repositoryId: repoId,
          sessionEventType: event.type,
          ...sessionId ? { sessionId } : {},
          ...model ? { model } : {}
        });
      } catch {
        await diagnostic("session_event_write_failed", sessionId);
      }
    },
    dispose: async () => {
      await store.flush();
    }
  };
};
var index_default = AiProvenancePlugin;
export {
  AiProvenancePlugin,
  index_default as default
};
//# sourceMappingURL=ai-provenance-plugin.js.map
