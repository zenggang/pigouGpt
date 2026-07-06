import { AuthRequiredError, requireCurrentUser } from "@/lib/auth";
import {
  createConversation,
  deleteConversation,
  getConversationSnapshot,
  listConversations,
} from "@/lib/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser();
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversationId");

    if (conversationId) {
      const snapshot = await getConversationSnapshot(user.id, conversationId);
      if (!snapshot) {
        return Response.json({ message: "会话不存在或无权访问。" }, { status: 404 });
      }
      return Response.json(snapshot);
    }

    return Response.json({ conversations: await listConversations(user.id) });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return Response.json({ message: error.message }, { status: 401 });
    }

    console.error("conversation load failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ message: "加载会话失败。" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const user = await requireCurrentUser();
    const conversation = await createConversation(user.id);
    return Response.json({ conversationId: conversation.id, conversation });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return Response.json({ message: error.message }, { status: 401 });
    }

    console.error("conversation create failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ message: "新建会话失败。" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireCurrentUser();
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversationId")?.trim();

    if (!conversationId) {
      return Response.json({ message: "缺少 conversationId。" }, { status: 400 });
    }

    const deleted = await deleteConversation(user.id, conversationId);
    if (!deleted) {
      return Response.json({ message: "会话不存在或无权访问。" }, { status: 404 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return Response.json({ message: error.message }, { status: 401 });
    }

    console.error("conversation delete failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ message: "删除会话失败。" }, { status: 500 });
  }
}
