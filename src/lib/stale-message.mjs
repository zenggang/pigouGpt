export const STALE_RUNNING_MESSAGE_MS = 5 * 60 * 1000;

const INTERRUPTED_MESSAGE = "上次请求已中断，可重新生成。";

export function recoverStaleTextMessage(message, nowMs = Date.now()) {
  if (
    message.role !== "assistant" ||
    message.status !== "running" ||
    message.imageJobId ||
    typeof message.createdAt !== "string"
  ) {
    return message;
  }

  const createdTime = new Date(message.createdAt).getTime();
  if (!Number.isFinite(createdTime) || nowMs - createdTime < STALE_RUNNING_MESSAGE_MS) {
    return message;
  }

  // 普通文本流被平台或网络中断后不能继续执行；保留已生成正文，但必须明确标记失败并隐藏内部规划文本。
  return {
    ...message,
    content: message.content.trim() || INTERRUPTED_MESSAGE,
    thinking: null,
    status: "error",
    error: message.error || INTERRUPTED_MESSAGE,
  };
}
