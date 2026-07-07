export const MAX_IMAGE_ATTACHMENTS = 4;
export const MAX_IMAGE_ATTACHMENT_BYTES = 2 * 1024 * 1024;

export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

export type ClientImageAttachment = {
  id?: string;
  name: string;
  mimeType: SupportedImageMimeType;
  size: number;
  base64?: string;
  url?: string;
};

export type InputTextPart = {
  type: "input_text";
  text: string;
};

export type InputImagePart = {
  type: "input_image";
  image_url: string;
  detail: "auto";
};

export type MessageContentPart = InputTextPart | InputImagePart;

export function normalizeClientImageAttachments(value: unknown): ClientImageAttachment[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("图片附件格式不正确。");
  }
  if (value.length > MAX_IMAGE_ATTACHMENTS) {
    throw new Error(`单次最多上传 ${MAX_IMAGE_ATTACHMENTS} 张图片。`);
  }

  return value.map((item, index) => normalizeClientImageAttachment(item, index));
}

export function buildMessageContent(
  text: string,
  attachments: ClientImageAttachment[] | undefined,
): string | MessageContentPart[] {
  if (!attachments || attachments.length === 0) {
    return text;
  }

  const normalizedText = text.trim() || "请分析这些图片。";
  return [
    { type: "input_text", text: normalizedText },
    ...attachments.map((attachment) => ({
      type: "input_image" as const,
      image_url: `data:${attachment.mimeType};base64,${attachment.base64 ?? ""}`,
      detail: "auto" as const,
    })),
  ];
}

export function summarizeImageAttachments(attachments: ClientImageAttachment[]) {
  return {
    count: attachments.length,
    mimeTypes: attachments.map((attachment) => attachment.mimeType),
    approxBytes: attachments.reduce((total, attachment) => total + attachment.size, 0),
  };
}

export function isSupportedImageMimeType(value: string): value is SupportedImageMimeType {
  return SUPPORTED_IMAGE_MIME_TYPES.includes(value as SupportedImageMimeType);
}

function normalizeClientImageAttachment(value: unknown, index: number): ClientImageAttachment {
  if (!value || typeof value !== "object") {
    throw new Error(`第 ${index + 1} 张图片附件格式不正确。`);
  }

  const item = value as Record<string, unknown>;
  const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : "image";
  const mimeType = typeof item.mimeType === "string" ? item.mimeType : "";
  const base64 = typeof item.base64 === "string" ? item.base64.trim() : "";
  const declaredSize = typeof item.size === "number" && Number.isFinite(item.size) ? item.size : 0;
  const approxSize = Math.max(declaredSize, estimateBase64Bytes(base64));

  if (!isSupportedImageMimeType(mimeType)) {
    throw new Error("图片附件仅支持 PNG、JPEG、WEBP 和非动画 GIF。");
  }
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error(`第 ${index + 1} 张图片内容不是有效 base64。`);
  }
  if (approxSize > MAX_IMAGE_ATTACHMENT_BYTES) {
    throw new Error("单张图片不能超过 2MB。");
  }

  return {
    id: typeof item.id === "string" ? item.id : undefined,
    name,
    mimeType,
    size: approxSize,
    base64,
  };
}

function estimateBase64Bytes(value: string) {
  if (!value) {
    return 0;
  }

  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}
