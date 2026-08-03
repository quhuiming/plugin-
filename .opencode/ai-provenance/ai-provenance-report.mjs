#!/usr/bin/env node

// src/report.ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// src/summary.ts
function summarizeJsonl(content) {
  const events = [];
  let malformedLines = 0;
  for (const line of content.split(/\r?\n/)) {
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
  const sessions = /* @__PURE__ */ new Set();
  const pairs = /* @__PURE__ */ new Map();
  const tools = {};
  const models = {};
  let collectorErrors = 0;
  let estimatedAdded = 0;
  let estimatedDeleted = 0;
  let latestAfter;
  for (const event of events) {
    if (event.sessionId) sessions.add(event.sessionId);
    if (event.kind === "collector.error") collectorErrors += 1;
    if (event.model) {
      const key = `${event.model.providerId}/${event.model.modelId}`;
      models[key] = (models[key] ?? 0) + 1;
    }
    if ((event.kind === "tool.before" || event.kind === "tool.after") && event.operationId) {
      const pair = pairs.get(event.operationId) ?? {};
      if (event.kind === "tool.before") {
        pair.before = event;
        const tool = event.tool ?? "unknown";
        tools[tool] = (tools[tool] ?? 0) + 1;
        estimatedAdded += event.input?.estimatedAdded ?? 0;
        estimatedDeleted += event.input?.estimatedDeleted ?? 0;
      } else {
        pair.after = event;
        if (!latestAfter || event.sequence > latestAfter.sequence) latestAfter = event;
      }
      pairs.set(event.operationId, pair);
    }
  }
  const pairValues = [...pairs.values()];
  const matched = pairValues.filter((pair) => pair.before && pair.after);
  const changed = matched.filter(
    (pair) => pair.before?.snapshot?.patchHash !== pair.after?.snapshot?.patchHash
  ).length;
  const finalSnapshot = latestAfter?.snapshot;
  return {
    validEvents: events.length,
    malformedLines,
    collectorErrors,
    sessions: sessions.size,
    operations: {
      before: pairValues.filter((pair) => pair.before).length,
      after: pairValues.filter((pair) => pair.after).length,
      matched: matched.length,
      unmatched: pairValues.length - matched.length,
      changed
    },
    estimates: { added: estimatedAdded, deleted: estimatedDeleted },
    tools,
    models,
    finalWorkingTree: finalSnapshot ? {
      added: finalSnapshot.totalAdded,
      deleted: finalSnapshot.totalDeleted,
      files: finalSnapshot.files.length,
      patchHash: finalSnapshot.patchHash
    } : null
  };
}

// src/report.ts
function usage() {
  return "Usage: ai-provenance-report [events.jsonl] [--json]";
}
async function runReport(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    return 0;
  }
  const json = args.includes("--json");
  const fileArgument = args.find((item) => !item.startsWith("-")) ?? ".opencode-metrics/events.jsonl";
  const eventPath = path.resolve(fileArgument);
  let content;
  try {
    content = await readFile(eventPath, "utf8");
  } catch (error) {
    console.error(`Cannot read ${eventPath}: ${error.message}`);
    return 2;
  }
  const summary = summarizeJsonl(content);
  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return summary.malformedLines > 0 ? 1 : 0;
  }
  console.log("OpenCode AI provenance collector report");
  console.log(`Events: ${summary.validEvents} valid, ${summary.malformedLines} malformed`);
  console.log(`Sessions: ${summary.sessions}`);
  console.log(
    `Operations: ${summary.operations.matched} matched, ${summary.operations.changed} changed, ${summary.operations.unmatched} unmatched`
  );
  console.log(
    `Apply-patch estimate: +${summary.estimates.added} -${summary.estimates.deleted} (not final accepted LOC)`
  );
  if (summary.finalWorkingTree) {
    console.log(
      `Latest cumulative Git diff: +${summary.finalWorkingTree.added} -${summary.finalWorkingTree.deleted}, ${summary.finalWorkingTree.files} files`
    );
  }
  if (summary.collectorErrors > 0) console.log(`Collector errors: ${summary.collectorErrors}`);
  return summary.malformedLines > 0 ? 1 : 0;
}
var invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  process.exitCode = await runReport(process.argv.slice(2));
}
export {
  runReport
};
