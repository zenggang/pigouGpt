import "server-only";

import type { ClientImageAttachment } from "./image-attachments";
import type { GeneratedImage } from "./types";

const MAX_UPLOAD_IMAGE_BYTES = 5 * 1024 * 1024;

type UploadResponse = {
  url?: string;
  path?: string;
  fileName?: string;
};

type ImageApiConfig = {
  baseUrl: string;
  apiKey: string;
};

export async function persistGeneratedImages(
  images: GeneratedImage[],
): Promise<GeneratedImage[]> {
  if (images.length === 0) {
    return [];
  }

  const config = getImageApiConfig();
  if (!config) {
    return stripBase64(images);
  }

  const savedImages: GeneratedImage[] = [];
  for (const image of images) {
    if (!image.base64) {
      savedImages.push(image);
      continue;
    }

    try {
      savedImages.push(await uploadImage(config, image));
    } catch (error) {
      console.error("generated image upload failed", {
        mimeType: image.mimeType,
        base64Length: image.base64.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return savedImages;
}

function getImageApiConfig() {
  const baseUrl = process.env.DATABASE_API_BASE_URL?.replace(/\/+$/, "");
  const apiKey = process.env.DATABASE_API_KEY;
  if (!baseUrl || !apiKey) {
    return null;
  }
  return { baseUrl, apiKey };
}

async function uploadImage(
  config: ImageApiConfig,
  image: GeneratedImage,
): Promise<GeneratedImage> {
  const approxBytes = Math.floor((image.base64?.length ?? 0) * 0.75);
  if (approxBytes > MAX_UPLOAD_IMAGE_BYTES) {
    throw new Error("Generated image is larger than upload limit.");
  }

  const response = await fetch(`${config.baseUrl}/images`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      mimeType: image.mimeType,
      base64: image.base64,
      revisedPrompt: image.revisedPrompt,
    }),
  });

  const body = (await response.json().catch(() => null)) as UploadResponse | { message?: string } | null;
  if (!response.ok) {
    throw new Error((body as { message?: string } | null)?.message || "Image upload failed.");
  }

  const url =
    typeof (body as UploadResponse | null)?.url === "string"
      ? (body as UploadResponse).url
      : typeof (body as UploadResponse | null)?.path === "string"
        ? `${config.baseUrl}${(body as UploadResponse).path}`
        : "";

  if (!url) {
    throw new Error("Image upload response missing URL.");
  }

  return {
    mimeType: image.mimeType,
    url,
    revisedPrompt: image.revisedPrompt,
  };
}

export async function persistUserImageAttachments(
  attachments: ClientImageAttachment[],
): Promise<ClientImageAttachment[]> {
  if (attachments.length === 0) {
    return [];
  }

  const config = getImageApiConfig();
  if (!config) {
    return stripAttachmentBase64(attachments);
  }

  const savedAttachments: ClientImageAttachment[] = [];
  for (const attachment of attachments) {
    if (attachment.url) {
      savedAttachments.push(stripAttachmentBase64([attachment])[0]);
      continue;
    }
    if (!attachment.base64) {
      savedAttachments.push(stripAttachmentBase64([attachment])[0]);
      continue;
    }

    try {
      savedAttachments.push(await uploadUserAttachment(config, attachment));
    } catch (error) {
      console.error("user image attachment upload failed", {
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        base64Length: attachment.base64.length,
        error: error instanceof Error ? error.message : String(error),
      });
      savedAttachments.push(stripAttachmentBase64([attachment])[0]);
    }
  }

  console.info("user image attachments persisted", {
    attachmentCount: attachments.length,
    savedUrlCount: savedAttachments.filter((attachment) => Boolean(attachment.url)).length,
    mimeTypes: attachments.map((attachment) => attachment.mimeType),
    approxBytes: attachments.reduce((total, attachment) => total + attachment.size, 0),
  });

  return savedAttachments;
}

async function uploadUserAttachment(
  config: ImageApiConfig,
  attachment: ClientImageAttachment,
): Promise<ClientImageAttachment> {
  const uploadableAttachment = await normalizeUserAttachmentForUpload(attachment);
  if (uploadableAttachment.size > MAX_UPLOAD_IMAGE_BYTES) {
    throw new Error("User attachment is larger than upload limit.");
  }

  const response = await fetch(`${config.baseUrl}/images`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      mimeType: uploadableAttachment.mimeType,
      base64: uploadableAttachment.base64,
      name: uploadableAttachment.name,
    }),
  });

  const body = (await response.json().catch(() => null)) as UploadResponse | { message?: string } | null;
  if (!response.ok) {
    throw new Error((body as { message?: string } | null)?.message || "Image upload failed.");
  }

  const url =
    typeof (body as UploadResponse | null)?.url === "string"
      ? (body as UploadResponse).url
      : typeof (body as UploadResponse | null)?.path === "string"
        ? `${config.baseUrl}${(body as UploadResponse).path}`
        : "";

  if (!url) {
    throw new Error("Image upload response missing URL.");
  }

  return {
    id: attachment.id,
    name: uploadableAttachment.name,
    mimeType: uploadableAttachment.mimeType,
    size: uploadableAttachment.size,
    url,
  };
}

async function normalizeUserAttachmentForUpload(
  attachment: ClientImageAttachment,
): Promise<ClientImageAttachment> {
  if (attachment.mimeType === "image/png" || !attachment.base64) {
    return attachment;
  }

  // 兼容旧客户端和未刷新的页面：ECS 图片接口当前只稳定接受 PNG，服务端再兜底转一次。
  const { default: sharp } = await import("sharp");
  const pngBuffer = await sharp(Buffer.from(attachment.base64, "base64")).png().toBuffer();

  return {
    ...attachment,
    name: normalizedPngFileName(attachment.name),
    mimeType: "image/png",
    size: pngBuffer.length,
    base64: pngBuffer.toString("base64"),
  };
}

function normalizedPngFileName(name: string) {
  const trimmed = name.trim() || "image";
  return /\.(?:png|jpe?g|webp|gif)$/i.test(trimmed)
    ? trimmed.replace(/\.(?:png|jpe?g|webp|gif)$/i, ".png")
    : `${trimmed}.png`;
}

function stripBase64(images: GeneratedImage[]) {
  // Vercel 本地文件系统不持久，缺少 ECS 文件接口时只避免把大 base64 写入数据库。
  return images.map((image) => ({
    mimeType: image.mimeType,
    url: image.url,
    revisedPrompt: image.revisedPrompt,
  }));
}

function stripAttachmentBase64(attachments: ClientImageAttachment[]) {
  // 用户附件历史只保存链接和轻量元数据；base64 仅用于当次 vision 请求，避免刷新缓存和数据库膨胀。
  return attachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    url: attachment.url,
  }));
}
