import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { normalizeMessageSnapshot } = await import(
  new URL("../ecs-db-api/message-snapshot-queue.mjs", import.meta.url)
);

const validSnapshot = {
  id: "f53ecce5-6a77-41c9-8951-b6927ce5f980",
  userId: 1,
  conversationId: "88fe9f4c-7903-4aed-9291-77aa1855ace3",
  content: "连接正常",
  thinking: null,
  usage: { inputTokens: 10, outputTokens: 2 },
  status: "done",
  error: null,
  responseId: "resp_123",
};

assert.deepEqual(normalizeMessageSnapshot(validSnapshot), validSnapshot);
assert.equal(normalizeMessageSnapshot({ ...validSnapshot, status: "streaming" }), null);
assert.equal(normalizeMessageSnapshot({ ...validSnapshot, userId: 0 }), null);
assert.equal(normalizeMessageSnapshot({ ...validSnapshot, content: 42 }), null);

const routeSource = readFileSync(
  new URL("../src/app/api/chat/route.ts", import.meta.url),
  "utf8",
);
assert.match(routeSource, /import \{ after \} from "next\/server"/);
assert.match(routeSource, /after\(async \(\) =>/);
assert.doesNotMatch(routeSource, /await saveAssistantSnapshot\("running"\);/);
assert.doesNotMatch(
  routeSource,
  /await saveAssistantMessage\(buildAssistantSnapshot\("running"\)\)/,
);

const queueSource = readFileSync(
  new URL("../ecs-db-api/message-snapshot-queue.mjs", import.meta.url),
  "utf8",
);
assert.match(queueSource, /xAdd\(/);
assert.match(queueSource, /xGroupCreate\(/);
assert.match(queueSource, /xReadGroup\(/);
assert.match(queueSource, /xAutoClaim\(/);
assert.match(queueSource, /xAck\(/);

console.log("Message snapshot queue verification passed.");
