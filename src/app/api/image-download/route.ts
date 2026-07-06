import { AuthRequiredError, requireCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_PATH_PATTERN = /^\/images\/[0-9a-f-]{36}\.png$/i;

export async function GET(request: Request) {
  try {
    await requireCurrentUser();

    const requestUrl = new URL(request.url);
    const rawUrl = requestUrl.searchParams.get("url");
    const rawName = requestUrl.searchParams.get("name") ?? "pigou-image.png";
    const imageUrl = validateImageUrl(rawUrl);
    if (!imageUrl) {
      return Response.json({ message: "图片下载地址不合法。" }, { status: 400 });
    }

    const upstream = await fetch(imageUrl, { cache: "no-store" });
    if (!upstream.ok) {
      return Response.json({ message: "图片文件不存在或暂时不可用。" }, { status: 404 });
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.includes("image/png")) {
      return Response.json({ message: "图片格式不正确。" }, { status: 415 });
    }

    const fileName = sanitizeFileName(rawName);
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return Response.json({ message: error.message }, { status: 401 });
    }

    console.error("image download failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ message: "图片下载失败。" }, { status: 500 });
  }
}

function validateImageUrl(value: string | null) {
  if (!value) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  const databaseBaseUrl = process.env.DATABASE_API_BASE_URL?.replace(/\/+$/, "");
  if (!databaseBaseUrl) {
    return null;
  }

  const allowedBase = new URL(databaseBaseUrl);
  const expectedPathPrefix = `${allowedBase.pathname.replace(/\/+$/, "")}/images/`;
  const isSameOrigin = parsed.origin === allowedBase.origin;
  const isAllowedPath =
    parsed.pathname.startsWith(expectedPathPrefix) &&
    IMAGE_PATH_PATTERN.test(parsed.pathname.slice(allowedBase.pathname.replace(/\/+$/, "").length));

  return isSameOrigin && isAllowedPath ? parsed.toString() : null;
}

function sanitizeFileName(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, "").replace(/^\.+/, "");
  return cleaned.endsWith(".png") ? cleaned || "pigou-image.png" : `${cleaned || "pigou-image"}.png`;
}
