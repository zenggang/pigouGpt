import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const conversations = readFileSync(new URL("../src/lib/conversations.ts", import.meta.url), "utf8");

assert.match(conversations, /STALE_RUNNING_MESSAGE_MS/);
assert.match(conversations, /normalizeStoredMessageStatus/);
assert.match(conversations, /row\.image_job_id/);
assert.match(conversations, /row\.content\.trim\(\)/);
