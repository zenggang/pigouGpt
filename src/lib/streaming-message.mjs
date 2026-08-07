const THINKING_PLACEHOLDER = "思考中...";

export function mergeStreamingTextDelta(message, delta, extractStreamingThinking) {
  const rawContent = `${message.rawContent ?? message.content}${delta}`;
  const extracted = extractStreamingThinking?.(rawContent);

  if (!extracted) {
    return {
      rawContent,
      content: rawContent,
      ...(message.thinking === THINKING_PLACEHOLDER
        ? { thinking: null }
        : message.thinking != null
          ? { thinking: message.thinking }
          : {}),
    };
  }

  return {
    rawContent,
    content: extracted.content,
    thinking:
      extracted.thinking ||
      (message.thinking === THINKING_PLACEHOLDER ? null : message.thinking),
  };
}
