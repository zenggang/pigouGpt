import { AuthRequiredError, requireCurrentUser } from "@/lib/auth";
import { deleteMessage } from "@/lib/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  try {
    const user = await requireCurrentUser();
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversationId")?.trim();
    const messageId = url.searchParams.get("messageId")?.trim();

    if (!conversationId || !messageId) {
      return Response.json({ message: "缺少 conversationId 或 messageId。" }, { status: 400 });
    }

    const deleted = await deleteMessage(user.id, conversationId, messageId);
    if (!deleted) {
      return Response.json({ message: "消息不存在或无权访问。" }, { status: 404 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return Response.json({ message: error.message }, { status: 401 });
    }

    console.error("message delete failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ message: "删除消息失败。" }, { status: 500 });
  }
}
