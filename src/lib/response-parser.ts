import type { GeneratedImage, UpstreamResponse, UsageSummary } from "./types";

export function extractText(response: UpstreamResponse): string {
  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  const chunks: string[] = [];

  for (const item of response.output ?? []) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content as Array<Record<string, unknown>>) {
        if (typeof part.text === "string") {
          chunks.push(part.text);
        }
      }
    }
  }

  return chunks.join("");
}

export function extractImages(response: UpstreamResponse): GeneratedImage[] {
  const images: GeneratedImage[] = [];

  for (const item of response.output ?? []) {
    if (item.type !== "image_generation_call") {
      continue;
    }

    const result = item.result;
    if (typeof result !== "string" || result.length === 0) {
      continue;
    }

    images.push({
      mimeType: "image/png",
      base64: result,
      revisedPrompt:
        typeof item.revised_prompt === "string" ? item.revised_prompt : undefined,
    });
  }

  return images;
}

export function extractUsage(response: UpstreamResponse): UsageSummary | undefined {
  if (!response.usage) {
    return undefined;
  }

  const usage = response.usage;
  const outputDetails = usage.output_tokens_details;

  return {
    inputTokens: numberValue(usage.input_tokens),
    outputTokens: numberValue(usage.output_tokens),
    reasoningTokens:
      typeof outputDetails === "object" && outputDetails !== null
        ? numberValue((outputDetails as Record<string, unknown>).reasoning_tokens)
        : 0,
    totalTokens: numberValue(usage.total_tokens),
  };
}

export function extractReasoningSummary(response: UpstreamResponse): string | null {
  const reasoning = response.reasoning;
  if (typeof reasoning === "object" && reasoning !== null) {
    const summary = (reasoning as Record<string, unknown>).summary;
    if (typeof summary === "string" && isDisplayableReasoningText(summary)) {
      return summary.trim();
    }
  }

  for (const item of response.output ?? []) {
    if (item.type !== "reasoning") {
      continue;
    }

    const summary = item.summary;
    if (typeof summary === "string" && isDisplayableReasoningText(summary)) {
      return summary.trim();
    }

    if (Array.isArray(summary)) {
      const text = summary
        .map((part) => {
          if (typeof part === "string") {
            return part;
          }
          if (typeof part === "object" && part !== null) {
            return String((part as Record<string, unknown>).text ?? "");
          }
          return "";
        })
        .join("\n")
        .trim();
      if (text && isDisplayableReasoningText(text)) {
        return text;
      }
    }
  }

  return null;
}

export function normalizeUpstreamError(status: number, body?: unknown): string {
  const message = extractErrorMessage(body);

  if (status === 401 || status === 403) {
    return "认证失败，请检查 SUB2API_KEY 或网关权限。";
  }
  if (status === 404) {
    return "网关路径或模型不存在，请检查 base URL 和模型名。";
  }
  if (status === 408) {
    return "请求超时，请稍后重试。";
  }
  if (status === 429) {
    return "请求过于频繁或额度不足，请稍后重试。";
  }
  if (status >= 500) {
    return message ? `AI 网关暂时不可用：${message}` : "AI 网关暂时不可用，请稍后重试。";
  }

  return message || "请求失败，请检查输入后重试。";
}

function extractErrorMessage(body: unknown): string {
  if (!body || typeof body !== "object") {
    return "";
  }

  const record = body as Record<string, unknown>;
  const error = record.error;

  if (typeof error === "object" && error !== null) {
    const message = (error as Record<string, unknown>).message;
    return typeof message === "string" ? message : "";
  }

  if (typeof record.message === "string") {
    return record.message;
  }

  return "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isDisplayableReasoningText(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  // Some Responses-compatible gateways echo the requested summary mode here
  // instead of returning a human-readable reasoning summary.
  return !["auto", "concise", "detailed", "none"].includes(normalized);
}
