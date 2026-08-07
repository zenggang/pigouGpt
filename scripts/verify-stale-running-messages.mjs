import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STALE_RUNNING_MESSAGE_MS,
  recoverStaleTextMessage,
} from "../src/lib/stale-message.mjs";

const conversations = readFileSync(new URL("../src/lib/conversations.ts", import.meta.url), "utf8");

assert.match(conversations, /recoverStaleTextMessage\(message\)/);

const createdAt = new Date(10_000).toISOString();
const stale = recoverStaleTextMessage(
  {
    role: "assistant",
    status: "running",
    content: "部分正文",
    thinking: "internal planning",
    error: null,
    imageJobId: null,
    createdAt,
  },
  10_000 + STALE_RUNNING_MESSAGE_MS + 1,
);

assert.equal(stale.status, "error");
assert.equal(stale.content, "部分正文");
assert.equal(stale.thinking, null);
assert.equal(stale.error, "上次请求已中断，可重新生成。");
