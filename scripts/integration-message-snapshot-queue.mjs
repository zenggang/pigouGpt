import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

import {
  consumeMessageSnapshots,
  enqueueMessageSnapshot,
  ensureMessageSnapshotGroup,
} from "../ecs-db-api/message-snapshot-queue.mjs";

const requireFromEcs = createRequire(new URL("../ecs-db-api/package.json", import.meta.url));
const { createClient } = requireFromEcs("redis");
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:16379";
const stream = `pigou:test:message-snapshots:${randomUUID()}`;
const group = `pigou-test-${randomUUID()}`;
const producer = createClient({ url: redisUrl });
const consumer = producer.duplicate();
const abortController = new AbortController();
const databaseCalls = [];

for (const client of [producer, consumer]) {
  client.on("error", () => {});
  await client.connect();
}

const pool = {
  async getConnection() {
    return {
      async beginTransaction() {
        databaseCalls.push("begin");
      },
      async execute(sql) {
        databaseCalls.push(sql.includes("insert into messages") ? "message" : "conversation");
      },
      async commit() {
        databaseCalls.push("commit");
      },
      async rollback() {
        databaseCalls.push("rollback");
      },
      release() {
        databaseCalls.push("release");
      },
    };
  },
};

await ensureMessageSnapshotGroup(producer, stream, group);
let consumerError;
const consumePromise = consumeMessageSnapshots({
  redis: consumer,
  pool,
  stream,
  group,
  consumer: "integration-consumer",
  signal: abortController.signal,
  logger: { info() {}, error() {} },
}).catch((error) => {
  consumerError = error;
});

await enqueueMessageSnapshot(
  producer,
  {
    id: randomUUID(),
    userId: 1,
    conversationId: randomUUID(),
    content: "queue integration",
    thinking: null,
    usage: null,
    status: "done",
    error: null,
    responseId: "resp_integration",
  },
  stream,
);

await waitFor(() => databaseCalls.includes("commit") || consumerError, 5_000);
if (consumerError) {
  throw consumerError;
}
assert.deepEqual(databaseCalls.slice(0, 5), [
  "begin",
  "message",
  "conversation",
  "commit",
  "release",
]);
assert.equal((await producer.xPending(stream, group)).pending, 0);

abortController.abort();
consumer.destroy();
await consumePromise;
await producer.del(stream);
await producer.close();

console.log("Message snapshot Redis integration passed.");

async function waitFor(predicate, timeoutMs) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for Redis snapshot consumer");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
