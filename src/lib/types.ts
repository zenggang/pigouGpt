import type { ClientImageAttachment } from "./image-attachments";

export const PIGOU_MODELS = ["gpt-5.6-sol", "gpt-5.5", "gpt-5.4"] as const;
export type PigouModel = (typeof PIGOU_MODELS)[number];
export const DEFAULT_PIGOU_MODEL: PigouModel = "gpt-5.6-sol";
export type ReasoningEffort = "low" | "medium" | "high";

export type ChatRole = "user" | "assistant";

export type ClientMessage = {
  id: string;
  role: ChatRole;
  content: string;
  thinking?: string | null;
  images?: GeneratedImage[];
  attachments?: ClientImageAttachment[];
};

export type ChatMode = "chat" | "image" | "search";

export type ChatRequest = {
  conversationId?: string;
  model: PigouModel;
  conversationStrategy?: "full_history";
  messages: ClientMessage[];
  mode: ChatMode;
  options?: {
    showThinking?: boolean;
    reasoningEffort?: ReasoningEffort;
  };
};

export type UsageSummary = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  durationMs?: number;
};

export type GeneratedImage = {
  mimeType: "image/png";
  base64?: string;
  url?: string;
  revisedPrompt?: string;
};

export type ImageJobStatus = "queued" | "running" | "succeeded" | "failed";

export type NormalizedEvent =
  | { type: "thinking_delta"; delta: string }
  | { type: "text_delta"; delta: string }
  | { type: "image"; mimeType: "image/png"; base64?: string; url?: string; revisedPrompt?: string }
  | { type: "image_job"; jobId: string; assistantMessageId: string; status: ImageJobStatus }
  | { type: "response_meta"; responseId?: string; usage?: UsageSummary }
  | { type: "done" }
  | { type: "error"; message: string; code?: string };

export type UpstreamResponse = {
  id?: string;
  status?: string;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  } | null;
  output_text?: string;
  output?: Array<Record<string, unknown>>;
  reasoning?: unknown;
  usage?: Record<string, unknown>;
};
