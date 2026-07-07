import {
  extractImages,
  extractReasoningSummary,
  extractText,
  extractUsage,
  normalizeUpstreamError,
} from "./response-parser";
import {
  MAX_IMAGE_ATTACHMENTS,
  buildMessageContent,
  normalizeClientImageAttachments,
  summarizeImageAttachments,
} from "./image-attachments";
import type {
  ChatMode,
  ChatRequest,
  ClientMessage,
  NormalizedEvent,
  PigouModel,
  ReasoningEffort,
  UpstreamResponse,
} from "./types";

const APP_INSTRUCTIONS =
  "请默认用简体中文回答。所有可展示内容都必须使用简体中文，包括 thinking、reasoning summary、思考过程、检索过程、工具调用摘要和最终回答。对于需要推理、比较、排查或方案设计的问题，必须先输出“思考过程：”并用中文完整说明可展示的解题思路、检索核验过程、关键依据和取舍，再输出“回答：”给出结论或步骤；不要输出隐藏内部推理全文。";
// Pigou AI Console 是 Web 问答工具，开放世界问题优先联网核验，纯写作/代码/上下文追问才跳过搜索。
const AUTO_SEARCH_INSTRUCTIONS =
  "你可以使用联网搜索工具。对于开放世界事实、资料查询、推荐对比、价格、政策、新闻、版本、地点、人物机构、产品服务、教程资料或可能随时间变化的问题，默认先搜索核验再回答，并在回答末尾用“来源：”列出 1-3 个真实 URL。只有纯写作润色、代码改写、数学计算、基于当前会话上下文的追问、闲聊或用户明确要求不要联网时，才不调用搜索。";
const SEARCH_INSTRUCTIONS =
  "本轮已启用联网搜索。请优先依据搜索结果回答；涉及事实、价格、新闻、版本、政策或时间敏感信息时，回答末尾用“来源：”列出 1-3 个真实 URL。";

const MODEL_ALLOWLIST: PigouModel[] = ["gpt-5.5", "gpt-5.4"];

type RuntimeConfig = {
  baseUrl: string;
  apiKey: string;
};

export function validateChatRequest(payload: unknown): ChatRequest {
  if (!payload || typeof payload !== "object") {
    throw new Error("请求体格式不正确。");
  }

  const input = payload as Partial<ChatRequest>;

  if (!input.model || !MODEL_ALLOWLIST.includes(input.model)) {
    throw new Error("当前仅支持 gpt-5.5 和 gpt-5.4。");
  }

  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    throw new Error("消息不能为空。");
  }

  const messages = input.messages
    .filter((message): message is ClientMessage => {
      return (
        !!message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string"
      );
    })
    .map((message) => ({
      ...message,
      content: message.content.trim(),
      attachments: normalizeClientImageAttachments(message.attachments),
    }))
    .filter((message) => message.content.length > 0 || (message.attachments?.length ?? 0) > 0);

  if (messages.length === 0) {
    throw new Error("请输入问题后再发送。");
  }

  const imageAttachmentCount = messages.reduce(
    (total, message) => total + (message.attachments?.length ?? 0),
    0,
  );
  if (imageAttachmentCount > MAX_IMAGE_ATTACHMENTS) {
    throw new Error(`单次最多上传 ${MAX_IMAGE_ATTACHMENTS} 张图片。`);
  }

  return {
    conversationId:
      typeof input.conversationId === "string" && input.conversationId.trim()
        ? input.conversationId.trim()
        : undefined,
    model: input.model,
    conversationStrategy: "full_history",
    messages,
    mode: inferModeFromLatestUserMessage(messages),
    options: {
      showThinking: input.options?.showThinking !== false,
      reasoningEffort: normalizeReasoningEffort(input.options?.reasoningEffort),
    },
  };
}

export function getRuntimeConfig(): RuntimeConfig {
  const baseUrl = process.env.SUB2API_BASE_URL?.replace(/\/+$/, "");
  const apiKey = process.env.SUB2API_KEY;

  if (!baseUrl) {
    throw new Error("服务端未配置 SUB2API_BASE_URL。");
  }
  if (!apiKey) {
    throw new Error("服务端未配置 SUB2API_KEY。");
  }

  return { baseUrl, apiKey };
}

export async function* streamChatResponse(
  request: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<NormalizedEvent> {
  const config = getRuntimeConfig();
  const upstreamBody = buildUpstreamBody(request, true);
  const imageSummary = summarizeRequestImages(request.messages);

  const startedAt = Date.now();
  const response = await fetch(`${config.baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(upstreamBody),
    signal,
  });

  if (!response.ok || !response.body) {
    const body = await safeJson(response);
    console.error("sub2api upstream error", {
      model: request.model,
      mode: request.mode,
      stream: true,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      requestId: response.headers.get("x-request-id"),
      imageCount: imageSummary.count,
      imageMimeTypes: imageSummary.mimeTypes,
      imageApproxBytes: imageSummary.approxBytes,
      error: safeErrorForLog(body),
    });
    yield { type: "error", message: normalizeUpstreamError(response.status, body) };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let emittedText = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const event = parseSseBlock(block);
      if (event) {
        for await (const normalized of normalizeSseEvent(event.event, event.data, {
          emitCompletedText: !emittedText,
        })) {
          if (normalized.type === "text_delta" && normalized.delta) {
            emittedText = true;
          }
          yield normalized;
        }
      }

      boundary = buffer.indexOf("\n\n");
    }
  }

  if (buffer.trim()) {
    const event = parseSseBlock(buffer);
    if (event) {
      for await (const normalized of normalizeSseEvent(event.event, event.data, {
        emitCompletedText: !emittedText,
      })) {
        if (normalized.type === "text_delta" && normalized.delta) {
          emittedText = true;
        }
        yield normalized;
      }
    }
  }

  console.info("sub2api stream completed", {
    model: request.model,
    mode: request.mode,
    stream: true,
    status: response.status,
    latencyMs: Date.now() - startedAt,
    requestId: response.headers.get("x-request-id"),
    imageCount: imageSummary.count,
    imageMimeTypes: imageSummary.mimeTypes,
    imageApproxBytes: imageSummary.approxBytes,
  });
}

export async function* completeImageResponse(
  request: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<NormalizedEvent> {
  const config = getRuntimeConfig();
  const upstreamBody = buildUpstreamBody(request, false);
  const startedAt = Date.now();

  const response = await fetch(`${config.baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(upstreamBody),
    signal,
  });

  const body = await safeJson(response);

  if (!response.ok) {
    console.error("sub2api upstream error", {
      model: request.model,
      mode: request.mode,
      stream: false,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      requestId: response.headers.get("x-request-id"),
      error: safeErrorForLog(body),
    });
    yield { type: "error", message: normalizeUpstreamError(response.status, body) };
    return;
  }

  const upstream = body as UpstreamResponse;
  const images = extractImages(upstream);

  const text = extractText(upstream);
  if (text && images.length === 0) {
    yield { type: "text_delta", delta: text };
  }

  for (const image of images) {
    yield { type: "image", ...image };
  }

  if (!text && images.length === 0) {
    yield {
      type: "error",
      message: "图片生成完成，但上游没有返回可展示的图片。",
    };
    return;
  }

  yield {
    type: "response_meta",
    responseId: upstream.id,
    usage: extractUsage(upstream),
  };

  console.info("sub2api image completed", {
    model: request.model,
    mode: request.mode,
    stream: false,
    status: response.status,
    latencyMs: Date.now() - startedAt,
    requestId: response.headers.get("x-request-id"),
    imageCount: images.length,
  });
}

function buildUpstreamBody(request: ChatRequest, stream: boolean) {
  const lastUserText =
    [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";

  const base = {
    model: request.model,
    instructions:
      request.mode === "search"
        ? `${APP_INSTRUCTIONS}\n${SEARCH_INSTRUCTIONS}`
        : `${APP_INSTRUCTIONS}\n${AUTO_SEARCH_INSTRUCTIONS}`,
    input:
      request.mode === "image"
        ? stripToolCommand(lastUserText)
        : buildConversationInput(request.messages),
    reasoning: request.options?.showThinking
      ? {
          effort: request.options.reasoningEffort ?? "medium",
          summary: "auto",
        }
      : undefined,
    store: false,
  };

  if (request.mode === "image") {
    return {
      ...base,
      stream: false,
      tools: [{ type: "image_generation", action: "generate", quality: "low" }],
    };
  }

  if (request.mode === "search") {
    return {
      ...base,
      stream,
      tools: [{ type: "web_search", search_context_size: "low" }],
    };
  }

  return {
    ...base,
    stream,
    tools: [{ type: "web_search", search_context_size: "low" }],
  };
}

function buildConversationInput(messages: ClientMessage[]) {
  const latestUserIndex = messages.findLastIndex((message) => message.role === "user");
  return messages.map((message, index) => ({
    role: message.role,
    content: buildMessageContent(
      index === latestUserIndex ? stripToolCommand(message.content) : message.content,
      message.role === "user" ? message.attachments : undefined,
    ),
  }));
}

function summarizeRequestImages(messages: ClientMessage[]) {
  return summarizeImageAttachments(
    messages.flatMap((message) => (message.role === "user" ? message.attachments ?? [] : [])),
  );
}

function stripToolCommand(text: string) {
  return text.replace(/^\/(?:image|img|draw|search|web|browse)\b\s*/i, "").trim() || text;
}

function inferModeFromLatestUserMessage(messages: ClientMessage[]): ChatMode {
  const latestUserText =
    [...messages].reverse().find((message) => message.role === "user")?.content.trim() ?? "";
  const latestUserAttachments =
    [...messages].reverse().find((message) => message.role === "user")?.attachments ?? [];

  if (!latestUserText) {
    return "chat";
  }
  if (latestUserAttachments.length > 0) {
    // 带图请求必须走 vision 输入链路，不能被“生成图片/画图”等措辞误判到异步生图任务。
    return "chat";
  }

  const normalized = latestUserText.toLowerCase();
  if (/^\/(?:image|img|draw)\b/.test(normalized)) {
    return "image";
  }

  if (isImageCapabilityQuestion(latestUserText)) {
    return "chat";
  }

  // 生图入口由服务端统一识别，避免前端暴露单独模式开关导致会话语义割裂。
  if (hasExplicitImageIntent(latestUserText)) {
    return "image";
  }
  if (hasSearchIntent(latestUserText)) {
    return "search";
  }

  return "chat";
}

function isImageCapabilityQuestion(text: string) {
  return /(?:你|ai|模型|pigou)?.{0,8}(?:能|可以|会|支持).{0,8}(?:画图|画画|绘图|生图|生成图片|生成图像)[吗么呀？?]*$/i.test(
    text.trim(),
  );
}

function hasExplicitImageIntent(text: string) {
  const lowerText = text.toLowerCase();
  const imageWords =
    "(?:图|图片|图像|插画|画|画作|绘画|油画|水彩|素描|海报|头像|图标|logo|壁纸|封面|照片|画面|表情包)";
  const commandWords = "(?:生成|画|绘制|画出|创建|制作|设计|出)";
  const politePrefix = "(?:请|帮我|给我|为我|麻烦|我要|想要|需要)?";
  const quantifier = "(?:一张|一幅|一副|一个|个|张|幅|副)?";
  const asksForTextDiagram = /(?:mermaid|svg|html|css|ascii|代码|流程图|时序图|架构图)/i.test(
    lowerText,
  );
  const explicitlyBitmapImage = /(?:图片|图像|插画|画作|绘画|油画|水彩|素描|海报|头像|图标|logo|壁纸|封面|照片|画面|表情包)/i.test(
    lowerText,
  );

  if (asksForTextDiagram && !explicitlyBitmapImage) {
    return false;
  }

  const explicitChineseImage = new RegExp(
    `${politePrefix}\\s*${commandWords}\\s*${quantifier}.{0,48}${imageWords}`,
    "i",
  );
  if (explicitChineseImage.test(text)) {
    return true;
  }

  if (
    !asksForTextDiagram &&
    /(?:^|\s)(?:请|帮我|给我|为我|麻烦)?\s*(?:画|绘制|画出)\s*(?:一只|一个|一位|一辆|一朵|一座|一幅|一副|一张|一艘|一条|一片|一架|一栋|一间)/.test(
      text,
    )
  ) {
    return true;
  }

  return /\b(?:generate|create|draw|make|design)\b.{0,60}\b(?:image|picture|illustration|poster|logo|icon|wallpaper|cover|photo)\b/i.test(
    text,
  );
}

function hasSearchIntent(text: string) {
  const normalized = text.toLowerCase().trim();
  if (/^\/(?:search|web|browse)\b/.test(normalized)) {
    return true;
  }

  return /(?:联网|网络搜索|网页搜索|搜索一下|搜一下|查一下|查找|网上|来源|引用|最新|今天|今日|现在|实时|新闻|公告|发布|版本|价格|股价|汇率|天气|赛程|比分|政策|法规)/i.test(
    text,
  );
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 300) };
  }
}

function parseSseBlock(block: string): { event: string; data: string } | null {
  let event = "message";
  const data: string[] = [];

  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).trimStart());
    }
  }

  if (data.length === 0) {
    return null;
  }

  return { event, data: data.join("\n") };
}

async function* normalizeSseEvent(
  event: string,
  dataText: string,
  options: { emitCompletedText?: boolean } = {},
): AsyncGenerator<NormalizedEvent> {
  if (dataText === "[DONE]") {
    yield { type: "done" };
    return;
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(dataText) as Record<string, unknown>;
  } catch {
    return;
  }

  if (event === "response.output_text.delta" && typeof data.delta === "string") {
    yield { type: "text_delta", delta: data.delta };
    return;
  }

  if (
    event === "response.reasoning_summary_text.delta" &&
    typeof data.delta === "string"
  ) {
    yield { type: "thinking_delta", delta: data.delta };
    return;
  }

  if (event === "response.reasoning_summary_part.added") {
    const part = data.part;
    if (typeof part === "object" && part !== null) {
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string" && text.trim()) {
        yield { type: "thinking_delta", delta: `${text.trim()}\n` };
      }
    }
    return;
  }

  if (event === "response.failed") {
    yield {
      type: "error",
      message: normalizeUpstreamError(500, data),
    };
    return;
  }

  if (event === "response.completed") {
    const upstream = data.response ? (data.response as UpstreamResponse) : (data as UpstreamResponse);
    const reasoningSummary = extractReasoningSummary(upstream);
    if (reasoningSummary) {
      yield { type: "thinking_delta", delta: reasoningSummary };
    }
    const text = extractText(upstream);
    if (options.emitCompletedText && text) {
      yield { type: "text_delta", delta: text };
    }
    for (const image of extractImages(upstream)) {
      yield { type: "image", ...image };
    }
    yield {
      type: "response_meta",
      responseId: upstream.id,
      usage: extractUsage(upstream),
    };
    yield { type: "done" };
  }
}

function safeErrorForLog(body: unknown) {
  if (!body || typeof body !== "object") {
    return undefined;
  }

  const record = body as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "object" && error !== null) {
    const errorRecord = error as Record<string, unknown>;
    return {
      type: errorRecord.type,
      code: errorRecord.code,
      message:
        typeof errorRecord.message === "string"
          ? errorRecord.message.slice(0, 300)
          : undefined,
    };
  }

  return {
    message: typeof record.message === "string" ? record.message.slice(0, 300) : undefined,
  };
}
