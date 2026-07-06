export function extractVisibleThinkingFromContent(content: string): {
  thinking: string | null;
  content: string;
} {
  const normalized = content.trimStart();
  const marker = normalized.match(/^(?:#+\s*)?(?:思路摘要|思考过程|分析过程)[:：]?\s*/);
  if (!marker) {
    return { thinking: null, content };
  }

  const rest = normalized.slice(marker[0].length);
  const split = rest.search(/\n\s*(?:#+\s*)?(?:回答|结论|步骤|正文|具体回答|最终回答)[:：]\s*/);
  if (split !== -1) {
    const thinking = rest.slice(0, split).trim();
    const answer = rest
      .slice(split)
      .replace(/^\n\s*(?:#+\s*)?(?:回答|结论|步骤|正文|具体回答|最终回答)[:：]\s*/, "");
    return {
      thinking: thinking || null,
      content: answer.trim() || content.trim(),
    };
  }

  const sections = splitSummaryBlock(rest);
  return {
    thinking: sections.thinking,
    content: sections.content || content.trim(),
  };
}

function splitSummaryBlock(rest: string) {
  const lines = rest.split("\n");
  const thinkingLines: string[] = [];
  const contentLines: string[] = [];
  let inContent = false;
  let sawSummaryLine = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!inContent && !trimmed && sawSummaryLine) {
      inContent = true;
      continue;
    }

    if (!inContent && isSummaryLine(trimmed)) {
      thinkingLines.push(line);
      sawSummaryLine = true;
      continue;
    }

    if (!inContent && !sawSummaryLine && trimmed) {
      thinkingLines.push(line);
      sawSummaryLine = true;
      continue;
    }

    inContent = true;
    contentLines.push(line);
  }

  return {
    thinking: thinkingLines.join("\n").trim() || null,
    content: contentLines.join("\n").trim(),
  };
}

function isSummaryLine(value: string) {
  return /^(?:[-*•]|\d+[.)、]|[（(]?\d+[）)]).+/.test(value);
}
