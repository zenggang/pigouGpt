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
  if (attachment.size > MAX_UPLOAD_IMAGE_BYTES) {
    throw new Error("User attachment is larger than upload limit.");
  }

  const response = await fetch(`${config.baseUrl}/images`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      mimeType: attachment.mimeType,
      base64: attachment.base64,
      name: attachment.name,
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
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    url,
  };
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
