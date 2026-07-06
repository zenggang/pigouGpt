export const DEFAULT_CONVERSATION_TITLE = "新的会话";

const MAX_TITLE_CHARS = 24;

const LEADING_PHRASES = [
  "麻烦帮我查询一下",
  "麻烦帮我查询下",
  "麻烦帮我查一下",
  "麻烦帮我查下",
  "帮我查询一下",
  "帮我查询下",
  "帮我查一下",
  "帮我查下",
  "请帮我查询一下",
  "请帮我查询下",
  "请帮我查一下",
  "请帮我查下",
  "麻烦帮我",
  "请帮我",
  "请问一下",
  "请问",
  "帮我",
  "麻烦",
  "请",
  "我要",
  "我想",
  "需要",
];

export function summarizeConversationTitle(content: string) {
  const normalized = normalizeTitleText(content);
  if (!normalized) {
    return DEFAULT_CONVERSATION_TITLE;
  }

  const withoutToolCommand = normalized.replace(
    /^\/(?:image|img|draw|search|web|browse)\b\s*/i,
    "",
  );
  const withoutTaskPrefix = stripTaskPrefix(withoutToolCommand);
  const firstClause = pickFirstClause(withoutTaskPrefix);
  const cleaned = firstClause
    .replace(/获批了/g, "获批")
    .replace(/适应症的/g, "适应症")
    .replace(/简单的/g, "")
    .replace(/(?:有哪些|有什么|是什么|怎么做|怎么解决|怎么处理|可以吗|能否|吗|么|呢|呀)+$/g, "")
    .replace(/[，。！？!?；;：:、,\s]+$/g, "")
    .trim();

  return limitTitle(cleaned || withoutTaskPrefix || withoutToolCommand || normalized);
}

function normalizeTitleText(content: string) {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .find((line) => line.trim().length > 0)
    ?.replace(/\s+/g, " ")
    .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, "$1$2")
    .trim() ?? "";
}

function stripTaskPrefix(value: string) {
  let title = value.trim();

  for (const phrase of LEADING_PHRASES) {
    if (title.startsWith(phrase)) {
      title = title.slice(phrase.length).trim();
      break;
    }
  }

  return title
    .replace(/^(?:查询一下|查询下|查一下|查下|搜索一下|搜一下|搜索|查找一下|查找)\s*/i, "")
    .replace(
      /^(?:生成|画|绘制|画出|创建|制作|设计|出)(?:一张|一幅|一副|一个|个|张|幅|副)?\s*/i,
      "",
    )
    .trim();
}

function pickFirstClause(value: string) {
  const sentence = value.split(/[。！？!?；;\n]/)[0]?.trim() || value.trim();
  if (Array.from(sentence).length <= MAX_TITLE_CHARS) {
    return sentence;
  }

  const commaClause = sentence.split(/[，,]/)[0]?.trim();
  return commaClause && Array.from(commaClause).length >= 6 ? commaClause : sentence;
}

function limitTitle(value: string) {
  const chars = Array.from(value.trim());
  if (chars.length <= MAX_TITLE_CHARS) {
    return value.trim() || DEFAULT_CONVERSATION_TITLE;
  }

  return chars.slice(0, MAX_TITLE_CHARS).join("");
}
