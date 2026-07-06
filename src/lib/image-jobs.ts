import "server-only";

import type {
  GeneratedImage,
  ImageJobStatus,
  PigouModel,
  ReasoningEffort,
  UsageSummary,
} from "./types";

export type ImageJobSnapshot = {
  id: string;
  userId: number;
  conversationId: string;
  assistantMessageId: string;
  status: ImageJobStatus;
  error?: string | null;
  content: string;
  thinking?: string | null;
  images: GeneratedImage[];
  usage?: UsageSummary;
  responseId?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
};

export async function createImageJob(params: {
  id: string;
  userId: number;
  conversationId: string;
  assistantMessageId: string;
  prompt: string;
  model: PigouModel;
  reasoningEffort: ReasoningEffort;
}) {
  const config = getDatabaseApiConfig();
  const response = await fetch(`${config.baseUrl}/image-jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(params),
  });

  const body = (await response.json().catch(() => null)) as
    | { message?: string; id?: string; status?: ImageJobStatus; assistantMessageId?: string }
    | null;

  if (!response.ok) {
    throw new Error(body?.message || "图片任务创建失败。");
  }

  return {
    id: body?.id ?? params.id,
    status: body?.status ?? "queued",
    assistantMessageId: body?.assistantMessageId ?? params.assistantMessageId,
  };
}

export async function getImageJob(jobId: string): Promise<ImageJobSnapshot> {
  const config = getDatabaseApiConfig();
  const response = await fetch(`${config.baseUrl}/image-jobs/${encodeURIComponent(jobId)}`, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    cache: "no-store",
  });

  const body = (await response.json().catch(() => null)) as
    | (Partial<ImageJobSnapshot> & { message?: string })
    | null;

  if (!response.ok) {
    throw new Error(body?.message || "图片任务查询失败。");
  }
  if (!body?.id || !body.status || !body.conversationId || !body.assistantMessageId) {
    throw new Error("图片任务返回格式不正确。");
  }

  return {
    id: body.id,
    userId: Number(body.userId),
    conversationId: body.conversationId,
    assistantMessageId: body.assistantMessageId,
    status: body.status,
    error: body.error ?? null,
    content: body.content ?? "",
    thinking: body.thinking ?? null,
    images: Array.isArray(body.images) ? body.images : [],
    usage: body.usage,
    responseId: body.responseId,
    createdAt: body.createdAt,
    updatedAt: body.updatedAt,
    completedAt: body.completedAt ?? null,
  };
}

function getDatabaseApiConfig() {
  const baseUrl = process.env.DATABASE_API_BASE_URL?.replace(/\/+$/, "");
  const apiKey = process.env.DATABASE_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error("服务端未配置 DATABASE_API_BASE_URL / DATABASE_API_KEY，无法创建异步图片任务。");
  }

  return { baseUrl, apiKey };
}
