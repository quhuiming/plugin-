#!/usr/bin/env node

// src/commit-report.ts
import path3 from "node:path";
import { pathToFileURL } from "node:url";

// src/commit-attribution.ts
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

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
  addToPath(path4, added, removed, oldPosInc, options) {
    const last = path4.lastComponent;
    if (last && !options.oneChangePerToken && last.added === added && last.removed === removed) {
      return {
        oldPos: path4.oldPos + oldPosInc,
        lastComponent: { count: last.count + 1, added, removed, previousComponent: last.previousComponent }
      };
    } else {
      return {
        oldPos: path4.oldPos + oldPosInc,
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

// src/commit-attribution.ts
function runGit(repository, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: repository,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? -1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}
async function gitText(repository, args) {
  const result = await runGit(repository, args);
  if (result.code !== 0) {
    throw new Error(`git ${args[0] ?? "command"} failed: ${result.stderr.toString("utf8").trim()}`);
  }
  return result.stdout.toString("utf8").trim();
}
async function resolveCommit(repository, revision) {
  return gitText(repository, ["rev-parse", "--verify", `${revision}^{commit}`]);
}
async function isAncestor(repository, ancestor, descendant) {
  const result = await runGit(repository, ["merge-base", "--is-ancestor", ancestor, descendant]);
  if (result.code === 0) return true;
  if (result.code === 1) return false;
  throw new Error(`git ancestry check failed: ${result.stderr.toString("utf8").trim()}`);
}
function parseNameStatusZ(buffer) {
  const tokens = buffer.toString("utf8").split("\0");
  const changes = [];
  let index = 0;
  while (index < tokens.length) {
    const status = tokens[index++];
    if (!status) continue;
    if (status.startsWith("R") || status.startsWith("C")) {
      const beforePath = tokens[index++] || null;
      const afterPath = tokens[index++] || null;
      changes.push({ status, beforePath, afterPath });
    } else {
      const filePath = tokens[index++] || null;
      changes.push({
        status,
        beforePath: status.startsWith("A") ? null : filePath,
        afterPath: status.startsWith("D") ? null : filePath
      });
    }
  }
  return changes;
}
async function changedJavaFiles(repository, base, head) {
  const result = await runGit(repository, [
    "diff",
    "--name-status",
    "-z",
    "--find-renames",
    base,
    head,
    "--",
    "*.java"
  ]);
  if (result.code !== 0) throw new Error(`git diff failed: ${result.stderr.toString("utf8").trim()}`);
  return parseNameStatusZ(result.stdout);
}
async function fileAtRevision(repository, revision, filePath) {
  if (!filePath) return "";
  const result = await runGit(repository, ["show", `${revision}:${filePath}`]);
  if (result.code !== 0) return "";
  return result.stdout.toString("utf8");
}
function increment(pool, fingerprint) {
  pool.set(fingerprint, (pool.get(fingerprint) ?? 0) + 1);
}
function consume(pool, fingerprint) {
  const count = pool?.get(fingerprint) ?? 0;
  if (count <= 0 || !pool) return false;
  if (count === 1) pool.delete(fingerprint);
  else pool.set(fingerprint, count - 1);
  return true;
}
function categoryForPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  return /(^|\/)(src\/test|test|tests)(\/|$)/u.test(normalized) ? "test" : "production";
}
function counts(effectiveAdded, aiExact) {
  return {
    effectiveAdded,
    aiExact,
    nonAiOrUnknown: effectiveAdded - aiExact,
    aiExactPercent: effectiveAdded === 0 ? 0 : Number((aiExact / effectiveAdded * 100).toFixed(2))
  };
}
function sumReports(files) {
  return counts(
    files.reduce((total, file) => total + file.effectiveAdded, 0),
    files.reduce((total, file) => total + file.aiExact, 0)
  );
}
function readEvents(content) {
  const events = [];
  let malformedLines = 0;
  for (const line of content.split(/\r?\n/u)) {
    if (line.trim() === "") continue;
    try {
      const event = JSON.parse(line);
      if (event.schemaVersion !== 1 && event.schemaVersion !== 2 || typeof event.kind !== "string") {
        malformedLines += 1;
      } else {
        events.push(event);
      }
    } catch {
      malformedLines += 1;
    }
  }
  return { events, malformedLines };
}
async function analyzeCommitRange(options) {
  const repository = path.resolve(options.repository);
  const [base, head, eventContent] = await Promise.all([
    resolveCommit(repository, options.base),
    resolveCommit(repository, options.head),
    readFile(options.eventPath, "utf8")
  ]);
  if (!await isAncestor(repository, base, head)) {
    throw new Error("Selected base is not an ancestor of head");
  }
  const parsed = readEvents(eventContent);
  const requestedKeyId = hmacKeyId(options.key);
  const pathPools = /* @__PURE__ */ new Map();
  const globalPool = /* @__PURE__ */ new Map();
  const rangeCache = /* @__PURE__ */ new Map();
  let candidateEvents = 0;
  let matchedEvents = 0;
  let unknownOperations = 0;
  let mismatchedKeys = 0;
  const commitInRange = async (commit) => {
    if (!commit) return false;
    const cached = rangeCache.get(commit);
    if (cached !== void 0) return cached;
    const inRange = await isAncestor(repository, base, commit).catch(() => false) && await isAncestor(repository, commit, head).catch(() => false);
    rangeCache.set(commit, inRange);
    return inRange;
  };
  for (const event of parsed.events) {
    if (event.kind !== "tool.after") continue;
    const recordedBase = event.provenance?.baseHead ?? event.snapshot?.head;
    if (!await commitInRange(recordedBase)) continue;
    candidateEvents += 1;
    if (!event.provenance || event.provenance.files.length === 0) {
      unknownOperations += 1;
      continue;
    }
    if (event.provenance.keyId !== requestedKeyId) {
      mismatchedKeys += 1;
      continue;
    }
    matchedEvents += 1;
    for (const file of event.provenance.files) {
      const normalizedPath = file.path.replaceAll("\\", "/");
      const pathPool = pathPools.get(normalizedPath) ?? /* @__PURE__ */ new Map();
      const eventCounts = /* @__PURE__ */ new Map();
      for (const fingerprint of file.fingerprints) {
        increment(eventCounts, fingerprint);
      }
      for (const [fingerprint, count] of eventCounts) {
        pathPool.set(fingerprint, Math.max(pathPool.get(fingerprint) ?? 0, count));
      }
      pathPools.set(normalizedPath, pathPool);
    }
  }
  if (mismatchedKeys > 0) {
    throw new Error(`HMAC key does not match ${mismatchedKeys} candidate attribution event(s)`);
  }
  for (const pathPool of pathPools.values()) {
    for (const [fingerprint, count] of pathPool) {
      globalPool.set(fingerprint, (globalPool.get(fingerprint) ?? 0) + count);
    }
  }
  const pendingFiles = [];
  for (const change of await changedJavaFiles(repository, base, head)) {
    if (!change.afterPath) continue;
    const [beforeContent, afterContent] = await Promise.all([
      fileAtRevision(repository, base, change.beforePath),
      fileAtRevision(repository, head, change.afterPath)
    ]);
    const hashes = fingerprintLines(addedEffectiveLines(beforeContent, afterContent), options.key);
    pendingFiles.push({
      path: change.afterPath.replaceAll("\\", "/"),
      category: categoryForPath(change.afterPath),
      hashes,
      matched: hashes.map(() => false)
    });
  }
  for (const file of pendingFiles) {
    const pathPool = pathPools.get(file.path);
    for (let index = 0; index < file.hashes.length; index += 1) {
      const fingerprint = file.hashes[index] ?? "";
      if (consume(pathPool, fingerprint)) {
        file.matched[index] = true;
        consume(globalPool, fingerprint);
      }
    }
  }
  for (const file of pendingFiles) {
    for (let index = 0; index < file.hashes.length; index += 1) {
      if (file.matched[index]) continue;
      if (consume(globalPool, file.hashes[index] ?? "")) file.matched[index] = true;
    }
  }
  const files = pendingFiles.map((file) => ({
    path: file.path,
    category: file.category,
    ...counts(file.hashes.length, file.matched.filter(Boolean).length)
  }));
  const productionFiles = files.filter((file) => file.category === "production");
  const testFiles = files.filter((file) => file.category === "test");
  return {
    reportVersion: 1,
    base,
    head,
    keyId: requestedKeyId,
    total: sumReports(files),
    production: sumReports(productionFiles),
    test: sumReports(testFiles),
    files,
    telemetry: {
      validEvents: parsed.events.length,
      malformedLines: parsed.malformedLines,
      candidateEvents,
      matchedEvents,
      unknownOperations
    }
  };
}

// src/key.ts
import { chmod, mkdir, readFile as readFile2, writeFile } from "node:fs/promises";
import path2 from "node:path";
import { randomBytes } from "node:crypto";
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
  const keyPath = path2.join(outputDirectory, "attribution.key");
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

// src/commit-report.ts
function option(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) {
    if (fallback !== void 0) return fallback;
    throw new Error(`Missing required option ${name}`);
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
  return value;
}
function usage() {
  return [
    "Usage: ai-provenance-commit-report --events <events.jsonl> [options]",
    "",
    "Options:",
    "  --repository <path>  Git repository (default: current directory)",
    "  --base <revision>    Base commit (default: HEAD^)",
    "  --head <revision>    Head commit (default: HEAD)",
    "  --key-file <path>    HMAC key file (default: beside events.jsonl)",
    "  --json               Print JSON"
  ].join("\n");
}
function formatHumanReport(report) {
  const lines = [
    "OpenCode commit AI attribution report",
    `Range: ${report.base.slice(0, 12)}..${report.head.slice(0, 12)}`,
    `Effective Java additions: ${report.total.effectiveAdded}`,
    `AI exact-content: ${report.total.aiExact} (${report.total.aiExactPercent.toFixed(2)}%)`,
    `Non-AI or unknown: ${report.total.nonAiOrUnknown} (${(100 - report.total.aiExactPercent).toFixed(2)}%)`,
    `Production: ${report.production.aiExact}/${report.production.effectiveAdded} AI exact`,
    `Tests: ${report.test.aiExact}/${report.test.effectiveAdded} AI exact`,
    `Telemetry: ${report.telemetry.matchedEvents}/${report.telemetry.candidateEvents} candidate events matched`
  ];
  if (report.telemetry.unknownOperations > 0) {
    lines.push(`Warning: ${report.telemetry.unknownOperations} mutation operation(s) had no line attribution`);
  }
  if (report.telemetry.malformedLines > 0) {
    lines.push(`Warning: ${report.telemetry.malformedLines} malformed telemetry line(s)`);
  }
  for (const file of report.files.filter((item) => item.effectiveAdded > 0)) {
    lines.push(`  ${file.path}: ${file.aiExact}/${file.effectiveAdded} (${file.aiExactPercent.toFixed(2)}%)`);
  }
  return lines.join("\n");
}
async function runCommitReport(args, env = process.env) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    return 0;
  }
  try {
    const repository = path3.resolve(option(args, "--repository", "."));
    const eventPath = path3.resolve(option(args, "--events"));
    const keyFileIndex = args.indexOf("--key-file");
    const resolvedKey = env.OPENCODE_PROVENANCE_HMAC_KEY !== void 0 ? await resolveHmacKey(path3.dirname(eventPath), env) : await readHmacKeyFile(
      path3.resolve(
        keyFileIndex >= 0 ? option(args, "--key-file") : path3.join(path3.dirname(eventPath), "attribution.key")
      )
    );
    const report = await analyzeCommitRange({
      repository,
      eventPath,
      base: option(args, "--base", "HEAD^"),
      head: option(args, "--head", "HEAD"),
      key: resolvedKey.key
    });
    console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : formatHumanReport(report));
    return report.telemetry.malformedLines > 0 ? 1 : 0;
  } catch (error) {
    console.error(`Commit attribution failed: ${error.message}`);
    return 2;
  }
}
var invokedPath = process.argv[1] ? pathToFileURL(path3.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  process.exitCode = await runCommitReport(process.argv.slice(2));
}
export {
  formatHumanReport,
  runCommitReport
};
