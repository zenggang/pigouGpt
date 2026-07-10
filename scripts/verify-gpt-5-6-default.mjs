import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readSource(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const typesSource = readSource("src/lib/types.ts");
const sub2apiSource = readSource("src/lib/sub2api.ts");
const conversationsSource = readSource("src/lib/conversations.ts");
const consoleSource = readSource("src/components/ConsoleApp.tsx");
const workerSource = readSource("ecs-db-api/server.mjs");
const schemaSource = readSource("database/schema.sql");
const readmeSource = readSource("README.md");

assert.match(typesSource, /"gpt-5\.6-sol", "gpt-5\.5", "gpt-5\.4"/);
assert.match(typesSource, /DEFAULT_PIGOU_MODEL[^\n]*"gpt-5\.6-sol"/);

assert.match(consoleSource, /pigou-ai-console-settings-v2/);
assert.match(consoleSource, /pigou-ai-console-settings-v1/);
assert.match(consoleSource, /"gpt-5\.6-sol": "GPT-5\.6"/);
assert.match(consoleSource, /useState<Model>\(DEFAULT_PIGOU_MODEL\)/);
assert.match(consoleSource, /model:\s*DEFAULT_PIGOU_MODEL/);
assert.match(consoleSource, /localStorage\.getItem\(LEGACY_SETTINGS_KEY\)/);
assert.match(consoleSource, /localStorage\.setItem\(SETTINGS_KEY, JSON\.stringify\(migrated\)\)/);
assert.match(consoleSource, /localStorage\.removeItem\(LEGACY_SETTINGS_KEY\)/);
assert.match(consoleSource, /PIGOU_MODELS\.includes\(record\.model as Model\)/);

assert.match(sub2apiSource, /PIGOU_MODELS\.includes\(input\.model\)/);
assert.match(sub2apiSource, /当前支持 GPT-5\.6、GPT-5\.5 和 GPT-5\.4/);

assert.match(conversationsSource, /insert into conversations \(id, user_id, title, model\)/);
assert.match(conversationsSource, /\[id, userId, "新的会话", DEFAULT_PIGOU_MODEL\]/);
assert.match(conversationsSource, /model:\s*DEFAULT_PIGOU_MODEL/);

assert.match(
  workerSource,
  /\["gpt-5\.6-sol", "gpt-5\.5", "gpt-5\.4"\]\.includes\(model\)/,
);
assert.match(schemaSource, /model varchar\(32\) not null default 'gpt-5\.6-sol'/);
assert.match(readmeSource, /GPT-5\.6/);

console.log("GPT-5.6 default verification passed.");
