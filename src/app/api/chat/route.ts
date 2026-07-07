import {
  streamChatResponse,
  validateChatRequest,
} from "@/lib/sub2api";
import type { ClientMessage, NormalizedEvent } from "@/lib/types";
import { AuthRequiredError, requireCurrentUser, type AuthUser } from "@/lib/auth";
import {
  assertConversationOwner,
  createConversation,
  saveAssistantMessage,
  saveUserMessage,
} from "@/lib/conversations";
import { createImageJob } from "@/lib/image-jobs";
import { persistUserImageAttachments } from "@/lib/image-storage";
import { extractVisibleThinkingFromContent } from "@/lib/thinking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json({ message: "请求体不是有效 JSON。" }, { status: 400 });
  }

  let chatRequest;
  try {
    chatRequest = validateChatRequest(payload);
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "请求参数不正确。" },
      { status: 400 },
    );
  }

  let user: AuthUser;
  let conversationId: string;
  const requestedConversationId = chatRequest.conversationId;
  try {
    user = await requireCurrentUser();

    if (requestedConversationId) {
      conversationId = requestedConversationId;
      const isOwner = await assertConversationOwner(user.id, conversationId);
      if (!isOwner) {
        return Response.json({ message: "会话不存在或无权访问。" }, { status: 404 });
      }
    } else {
      conversationId = (await createConversation(user.id)).id;
    }

    const latestUserMessage = [...chatRequest.messages]
      .reverse()
      .find((message) => message.role === "user");
    if (!latestUserMessage) {
      return Response.json({ message: "请输入问题后再发送。" }, { status: 400 });
    }
    const persistedAttachments = await persistUserImageAttachments(latestUserMessage.attachments ?? []);
    await saveUserMessage({
      id: latestUserMessage.id,
      userId: user.id,
      conversationId,
      content: latestUserMessage.content,
      model: chatRequest.model,
      mode: chatRequest.mode,
      attachments: persistedAttachments,
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return Response.json({ message: error.message }, { status: 401 });
    }

    console.error("chat request prepare failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ message: "会话保存失败，请检查数据库配置。" }, { status: 500 });
  }

  if (chatRequest.mode === "image") {
    const assistantId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    try {
      const job = await createImageJob({
        id: jobId,
        userId: user.id,
        conversationId,
        assistantMessageId: assistantId,
        // 图片任务在 ECS 异步执行，必须把最近上下文压进 prompt，否则 worker 只能看到“画一张图”这类指代句。
        prompt: buildContextualImagePrompt(chatRequest.messages),
        model: chatRequest.model,
        reasoningEffort: chatRequest.options?.reasoningEffort ?? "low",
      });

      return createSseResponse([
        { type: "thinking_delta", delta: "思考中..." },
        {
          type: "image_job",
          jobId: job.id,
          assistantMessageId: job.assistantMessageId,
          status: job.status,
        },
        { type: "done" },
      ]);
    } catch (error) {
      console.error("image job submit failed", {
        userId: user.id,
        conversationId,
        model: chatRequest.model,
        error: error instanceof Error ? error.message : String(error),
      });
      return Response.json(
        { message: error instanceof Error ? error.message : "图片任务创建失败。" },
        { status: 500 },
      );
    }
  }

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort(), { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      const write = (event: NormalizedEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          return false;
        }
        return true;
      };
      let assistantContent = "";
      let assistantThinking: string | null = null;
      let assistantStatus: "running" | "done" | "error" = "running";
      let assistantError: string | null = null;
      let responseId: string | undefined;
      let usage: Parameters<typeof saveAssistantMessage>[0]["usage"];
      const assistantId = crypto.randomUUID();
      const assistantStartedAt = Date.now();
      let lastSnapshotSavedAt = 0;

      const capture = (event: NormalizedEvent) => {
        if (event.type === "text_delta") {
          assistantContent += event.delta;
        }
        if (event.type === "thinking_delta") {
          assistantThinking =
            event.delta === "思考中..."
              ? assistantThinking
              : `${assistantThinking ?? ""}${event.delta}`;
        }
        if (event.type === "response_meta") {
          responseId = event.responseId;
          usage = event.usage;
        }
        if (event.type === "error") {
          assistantStatus = "error";
          assistantError = event.message;
        }
      };

      const saveAssistantSnapshot = async (
        status: "running" | "done" | "error",
        force = false,
      ) => {
        const now = Date.now();
        if (!force && now - lastSnapshotSavedAt < 2500) {
          return;
        }
        lastSnapshotSavedAt = now;

        const extracted = extractVisibleThinkingFromContent(assistantContent);
        const snapshotContent =
          extracted.content ||
          assistantError ||
          assistantContent ||
          (status === "running" ? "" : "已完成。");
        const snapshotThinking =
          extracted.thinking ||
          assistantThinking ||
          (status === "running" ? "思考中..." : null);

        const snapshotUsage =
          status === "running"
            ? usage
            : withUsageDuration(usage, Date.now() - assistantStartedAt);

        await saveAssistantMessage({
          id: assistantId,
          userId: user.id,
          conversationId,
          content: snapshotContent,
          thinking: snapshotThinking,
          images: [],
          usage: snapshotUsage,
          status,
          error: assistantError,
          responseId,
        });
      };

      try {
        const iterator = streamChatResponse(chatRequest, abortController.signal);

        // 普通 chat/search 仍是 SSE 直连；先落 running 快照，刷新页面时至少能恢复当前 assistant 占位。
        await saveAssistantSnapshot("running", true);
        write({ type: "thinking_delta", delta: "思考中..." });

        for await (const event of iterator) {
          if (event.type === "done") {
            continue;
          }
          capture(event);
          write(event);
          await saveAssistantSnapshot("running");
        }

        try {
          assistantStatus = assistantError ? "error" : "done";
          await saveAssistantSnapshot(assistantStatus, true);
        } catch (error) {
          console.error("assistant message save failed", {
            userId: user.id,
            conversationId,
            responseId,
            status: assistantStatus,
            contentLength: assistantContent.length,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        write({ type: "done" });
      } catch (error) {
        assistantStatus = "error";
        if (abortController.signal.aborted) {
          assistantError = "页面刷新或连接断开，本次流式输出已中断，可重新生成。";
        } else {
          assistantError = error instanceof Error ? error.message : "服务端请求失败。";
        }

        try {
          await saveAssistantSnapshot("error", true);
        } catch (saveError) {
          console.error("assistant interrupted message save failed", {
            userId: user.id,
            conversationId,
            responseId,
            error: saveError instanceof Error ? saveError.message : String(saveError),
          });
        }

        write({ type: "error", message: assistantError });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function buildContextualImagePrompt(messages: ClientMessage[]) {
  const latestUserIndex = messages.findLastIndex((message) => message.role === "user");
  const latestUserContent =
    latestUserIndex === -1 ? "" : stripToolCommand(messages[latestUserIndex].content);
  const previousMessages = messages
    .slice(0, latestUserIndex)
    .filter((message) => message.content.trim().length > 0)
    .slice(-6);

  if (previousMessages.length === 0) {
    return latestUserContent;
  }

  const context = previousMessages
    .map((message) => {
      const label = message.role === "user" ? "用户" : "助手";
      const maxLength = message.role === "assistant" ? 2400 : 900;
      return `${label}：${truncateForImageContext(message.content, maxLength)}`;
    })
    .join("\n\n");

  return [
    "你正在同一个多轮会话里生成图片，必须理解最近上下文，不能只按最后一句孤立作图。",
    "如果最新要求包含“你的观点、上面、刚才、这个、整体观点、总结”等指代，必须用最近上下文补全主题、观点和画面重点。",
    "最近上下文：",
    context,
    "用户最新生图要求：",
    latestUserContent,
    "请把上下文中的核心观点转换为具体、可视化、适合图片生成的画面描述；避免无关泛化主题。",
  ].join("\n\n");
}

function truncateForImageContext(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function stripToolCommand(text: string) {
  return text.replace(/^\/(?:image|img|draw|search|web|browse)\b\s*/i, "").trim() || text;
}

function createSseResponse(events: NormalizedEvent[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.close();
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    },
  );
}

function withUsageDuration(
  usage: Parameters<typeof saveAssistantMessage>[0]["usage"],
  durationMs: number,
) {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    reasoningTokens: usage?.reasoningTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    durationMs: Math.max(0, Math.round(durationMs)),
  };
}
