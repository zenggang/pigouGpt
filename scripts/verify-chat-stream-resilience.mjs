import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const upstreamRuntimeUrl = new URL("../src/lib/upstream-runtime.mjs", import.meta.url);
const staleMessageUrl = new URL("../src/lib/stale-message.mjs", import.meta.url);

assert.ok(existsSync(upstreamRuntimeUrl), "upstream runtime helper should exist");
assert.ok(existsSync(staleMessageUrl), "stale message helper should exist");

const { UpstreamTimeoutError, sanitizeUpstreamErrorMessage, withTimeout } = await import(
  upstreamRuntimeUrl
);
const { STALE_RUNNING_MESSAGE_MS, recoverStaleTextMessage } = await import(staleMessageUrl);

let timeoutCallbackCount = 0;
await assert.rejects(
  withTimeout(
    new Promise(() => {}),
    5,
    "upstream stalled",
    () => {
      timeoutCallbackCount += 1;
    },
  ),
  (error) => error instanceof UpstreamTimeoutError && error.message === "upstream stalled",
);
assert.equal(timeoutCallbackCount, 1);

assert.equal(
  await withTimeout(Promise.resolve("ok"), 50, "should not time out"),
  "ok",
);
assert.equal(sanitizeUpstreamErrorMessage("<html><h1>502 Bad Gateway</h1></html>"), "");
assert.equal(sanitizeUpstreamErrorMessage("temporary backend failure"), "temporary backend failure");

const staleMessage = recoverStaleTextMessage(
  {
    role: "assistant",
    status: "running",
    content: "",
    thinking: "**Planning private work**",
    error: null,
    imageJobId: null,
    createdAt: new Date(1_000).toISOString(),
  },
  1_000 + STALE_RUNNING_MESSAGE_MS + 1,
);
assert.deepEqual(staleMessage, {
  role: "assistant",
  status: "error",
  content: "上次请求已中断，可重新生成。",
  thinking: null,
  error: "上次请求已中断，可重新生成。",
  imageJobId: null,
  createdAt: new Date(1_000).toISOString(),
});

const freshMessage = {
  role: "assistant",
  status: "running",
  content: "部分正文",
  thinking: "思考中...",
  error: null,
  imageJobId: null,
  createdAt: new Date(2_000).toISOString(),
};
assert.equal(
  recoverStaleTextMessage(freshMessage, 2_000 + STALE_RUNNING_MESSAGE_MS - 1),
  freshMessage,
);

const imageJobMessage = {
  ...freshMessage,
  imageJobId: "image-job-1",
  createdAt: new Date(1_000).toISOString(),
};
assert.equal(
  recoverStaleTextMessage(imageJobMessage, 1_000 + STALE_RUNNING_MESSAGE_MS + 1),
  imageJobMessage,
);

const sub2apiSource = readFileSync(
  new URL("../src/lib/sub2api.ts", import.meta.url),
  "utf8",
);
assert.match(sub2apiSource, /CONNECT_TIMEOUT_MS/);
assert.match(sub2apiSource, /STREAM_IDLE_TIMEOUT_MS/);
assert.match(sub2apiSource, /raw reasoning summaries are not user-facing/i);
assert.doesNotMatch(sub2apiSource, /yield \{ type: "thinking_delta", delta: reasoningSummary \}/);

const consoleSource = readFileSync(
  new URL("../src/components/ConsoleApp.tsx", import.meta.url),
  "utf8",
);
assert.match(consoleSource, /terminalEvent/);
assert.match(consoleSource, /连接意外中断，请重新生成。/);

console.log("Chat stream resilience verification passed.");
