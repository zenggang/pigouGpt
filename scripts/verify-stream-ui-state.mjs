import assert from "node:assert/strict";

const { mergeStreamingTextDelta } = await import(
  new URL("../src/lib/streaming-message.mjs", import.meta.url)
);

assert.deepEqual(
  mergeStreamingTextDelta(
    {
      content: "",
      rawContent: undefined,
      thinking: "思考中...",
    },
    "连接正常",
  ),
  {
    rawContent: "连接正常",
    content: "连接正常",
    thinking: null,
  },
  "first visible text must clear the synthetic thinking placeholder",
);

assert.deepEqual(
  mergeStreamingTextDelta(
    {
      content: "已有",
      rawContent: "已有",
      thinking: "已核验上下文",
    },
    "正文",
  ),
  {
    rawContent: "已有正文",
    content: "已有正文",
    thinking: "已核验上下文",
  },
  "real visible thinking must be preserved",
);

console.log("Stream UI state verification passed.");
