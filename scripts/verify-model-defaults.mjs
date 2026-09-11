import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(resolve(root, path), "utf8");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const cache = new Map();
function load(path, extra = "") {
  if (cache.has(path)) return cache.get(path);
  const exports = {};
  cache.set(path, exports);
  const nativeRequire = createRequire(path);
  const require = (name) => {
    const local = resolve(dirname(path), `${name}.ts`);
    return name.startsWith(".") && existsSync(local) ? load(local) : nativeRequire(name);
  };
  new Function("require", "exports", compile(readFileSync(path, "utf8") + extra))(require, exports);
  return exports;
}
const types = load(resolve(root, "src/lib/types.ts"));
const upstream = load(resolve(root, "src/lib/sub2api.ts"), "\nexport { buildUpstreamBody };\n");
assert.equal(types.DEFAULT_PIGOU_MODEL, "gpt-6-astra");
assert.equal(types.DEFAULT_REASONING_EFFORT, "high");

for (const model of ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4"]) {
  for (const content of ["你好", "搜索一下最新消息", "生成一张小猫图片"]) {
    for (const effort of [undefined, "low", "medium", "high", "invalid"]) {
      const request = upstream.validateChatRequest({
        model, messages: [{ id: "user-1", role: "user", content }],
        options: { reasoningEffort: effort },
      });
      const body = upstream.buildUpstreamBody(request, true);
      assert.equal(body.model, model);
      assert.equal(body.reasoning.effort, ["low", "medium", "high"].includes(effort) ? effort : "high");
      assert.equal(body.tools[0].type, request.mode === "image" ? "image_generation" : "web_search");
    }
  }
}
assert.throws(() => upstream.validateChatRequest({ model: "unknown", messages: [] }), /当前支持 GPT-6/);

function declarations(path, names) {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
  return source.statements.filter((node) =>
    ts.isFunctionDeclaration(node) && names.includes(node.name?.text) ||
    ts.isVariableStatement(node) && node.declarationList.declarations.some((entry) => names.includes(entry.name.getText(source)))
  ).map((node) => node.getText(source)).join("\n");
}
const settingsSource = declarations("src/components/ConsoleApp.tsx", ["SETTINGS_KEY", "readStoredSettings", "isReasoningEffort"]);
const readSettings = new Function("window", ...Object.keys(types), compile(settingsSource) + "\nreturn readStoredSettings();");
const defaults = { model: "gpt-6-astra", reasoningEffort: "high" };
for (const previous of [null, "v1", "v2"]) {
  const stored = new Map(previous ? [[`pigou-ai-console-settings-${previous}`, JSON.stringify({ model: "gpt-5.5", reasoningEffort: "low" })]] : []);
  const window = { localStorage: {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: (key) => stored.delete(key),
  } };
  assert.deepEqual(readSettings(window, ...Object.values(types)), defaults);
  stored.set("pigou-ai-console-settings-v3", JSON.stringify({ model: "gpt-5.5", reasoningEffort: "low" }));
  assert.deepEqual(readSettings(window, ...Object.values(types)), { model: "gpt-5.5", reasoningEffort: "low" });
  stored.set("pigou-ai-console-settings-v3", "invalid json");
  assert.deepEqual(readSettings(window, ...Object.values(types)), defaults);
}
assert.deepEqual(readSettings(undefined, ...Object.values(types)), defaults);

const workerSource = declarations("ecs-db-api/server.mjs", ["normalizeImageJobPayload", "isValidId"]);
const normalizeImageJob = new Function(workerSource + "\nreturn normalizeImageJobPayload;")();
const job = { id: randomUUID(), userId: 1, conversationId: randomUUID(), assistantMessageId: randomUUID(), prompt: "生成一张图", model: "gpt-6-astra" };
assert.equal(normalizeImageJob(job).reasoningEffort, "high");
assert.equal(normalizeImageJob({ ...job, reasoningEffort: "low" }).reasoningEffort, "low");
assert.equal(normalizeImageJob({ ...job, model: "unknown" }), null);
assert.match(read("src/lib/conversations.ts"), /\[id, userId, "新的会话", DEFAULT_PIGOU_MODEL\]/);
assert.match(read("src/app/api/chat/route.ts"), /reasoningEffort: chatRequest.options\?\.reasoningEffort \?\? DEFAULT_REASONING_EFFORT/);
console.log("Model defaults verified: GPT-6/high, 60 upstream payloads, settings migration, manual choices, image worker.");
