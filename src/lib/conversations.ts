import "server-only";

import type { RowDataPacket } from "mysql2/promise";
import type {
  ChatMode,
  GeneratedImage,
  ImageJobStatus,
  PigouModel,
  UsageSummary,
} from "./types";
import { DEFAULT_CONVERSATION_TITLE, summarizeConversationTitle } from "./conversation-title";
import { execute, firstRow, queryRows } from "./db";

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  thinking?: string | null;
  images?: GeneratedImage[];
  usage?: UsageSummary;
  status?: "running" | "done" | "error";
  error?: string | null;
  imageJobId?: string | null;
  imageJobStatus?: ImageJobStatus | null;
};

export type ConversationSnapshot = {
  conversationId: string;
  messages: StoredMessage[];
};

export type ConversationSummary = {
  id: string;
  title: string;
  model: PigouModel;
  mode: ChatMode;
  updatedAt: string;
};

type ConversationRow = RowDataPacket & {
  id: string;
  title: string;
  model: PigouModel;
  mode: ChatMode;
  updated_at: Date | string;
};

type MessageRow = RowDataPacket & {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: Date | string;
  thinking: string | null;
  images_json: string | null;
  usage_json: string | null;
  status: "running" | "done" | "error";
  error_message: string | null;
  image_job_id: string | null;
  image_job_status: ImageJobStatus | null;
  image_job_created_at: Date | string | null;
  image_job_completed_at: Date | string | null;
};

export async function getLatestConversationSnapshot(userId: number): Promise<ConversationSnapshot> {
  const conversation =
    firstRow(
      await queryRows<ConversationRow[]>(
        `select id
         from conversations
         where user_id = ?
         order by updated_at desc
         limit 1`,
        [userId],
      ),
    ) ?? (await createConversation(userId));

  return {
    conversationId: conversation.id,
    messages: await listConversationMessages(userId, conversation.id),
  };
}

export async function getConversationSnapshot(
  userId: number,
  conversationId: string,
): Promise<ConversationSnapshot | null> {
  const conversation = firstRow(
    await queryRows<ConversationRow[]>(
      `select id, title, model, mode, updated_at
       from conversations
       where user_id = ? and id = ?
       limit 1`,
      [userId, conversationId],
    ),
  );

  if (!conversation) {
    return null;
  }

  return {
    conversationId: conversation.id,
    messages: await listConversationMessages(userId, conversation.id),
  };
}

export async function listConversations(userId: number): Promise<ConversationSummary[]> {
  const rows = await queryRows<ConversationRow[]>(
    `select id, title, model, mode, updated_at
     from conversations
     where user_id = ?
     order by updated_at desc
     limit 50`,
    [userId],
  );

  return rows.map(toConversationSummary);
}

export async function createConversation(userId: number) {
  const id = crypto.randomUUID();
  await execute(
    `insert into conversations (id, user_id, title)
     values (?, ?, ?)`,
    [id, userId, "新的会话"],
  );
  return {
    id,
    title: "新的会话",
    model: "gpt-5.5" as PigouModel,
    mode: "chat" as ChatMode,
    updatedAt: new Date().toISOString(),
  };
}

export async function listConversationMessages(
  userId: number,
  conversationId: string,
): Promise<StoredMessage[]> {
  const rows = await queryRows<MessageRow[]>(
    `select m.id, m.role, m.content, m.created_at, m.thinking, m.images_json, m.usage_json,
            m.status, m.error_message,
            j.id as image_job_id,
            j.status as image_job_status,
            j.created_at as image_job_created_at,
            j.completed_at as image_job_completed_at
     from messages m
     join conversations c on c.id = m.conversation_id
     left join image_jobs j on j.assistant_message_id = m.id
     where c.user_id = ? and m.conversation_id = ?
     order by m.created_at asc, m.id asc`,
    [userId, conversationId],
  );

  return rows.map((row) => {
    const usage = parseJson<UsageSummary | undefined>(row.usage_json, undefined);
    const imageJobDurationMs = durationBetween(
      row.image_job_created_at,
      row.image_job_completed_at,
    );

    return {
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: normalizeMysqlDateTime(row.created_at),
      thinking: row.thinking,
      images: parseJson<GeneratedImage[]>(row.images_json, []),
      usage:
        imageJobDurationMs === null ? usage : withUsageDuration(usage, imageJobDurationMs),
      status: row.status,
      error: row.error_message,
      imageJobId: row.image_job_id,
      imageJobStatus: row.image_job_status,
    };
  });
}

export async function assertConversationOwner(userId: number, conversationId: string) {
  const conversation = firstRow(
    await queryRows<ConversationRow[]>(
      "select id from conversations where id = ? and user_id = ? limit 1",
      [conversationId, userId],
    ),
  );

  return !!conversation;
}

export async function deleteConversation(userId: number, conversationId: string) {
  const result = await execute("delete from conversations where id = ? and user_id = ?", [
    conversationId,
    userId,
  ]);

  return result.affectedRows > 0;
}

export async function deleteMessage(userId: number, conversationId: string, messageId: string) {
  const message = firstRow(
    await queryRows<(RowDataPacket & { id: string })[]>(
      `select id
       from messages
       where id = ? and conversation_id = ? and user_id = ?
       limit 1`,
      [messageId, conversationId, userId],
    ),
  );

  if (!message) {
    return false;
  }

  // 图片任务没有外键依赖消息表；先清理任务，避免已删除消息被轮询结果重新回填到界面。
  await execute("delete from image_jobs where assistant_message_id = ? and user_id = ?", [
    messageId,
    userId,
  ]);
  const result = await execute(
    "delete from messages where id = ? and conversation_id = ? and user_id = ?",
    [messageId, conversationId, userId],
  );
  await touchConversation(conversationId);

  return result.affectedRows > 0;
}

export async function saveUserMessage(params: {
  id: string;
  userId: number;
  conversationId: string;
  content: string;
  model: PigouModel;
  mode: ChatMode;
}) {
  await execute(
    `insert into messages (id, conversation_id, user_id, role, content, status)
     values (?, ?, ?, 'user', ?, 'done')
     on duplicate key update content = values(content), status = 'done'`,
    [params.id, params.conversationId, params.userId, params.content],
  );

  await touchConversation(params.conversationId, {
    firstUserTitle: summarizeConversationTitle(params.content),
    model: params.model,
    mode: params.mode,
  });
}

export async function saveAssistantMessage(params: {
  id: string;
  userId: number;
  conversationId: string;
  content: string;
  thinking?: string | null;
  images?: GeneratedImage[];
  usage?: UsageSummary;
  status: "running" | "done" | "error";
  error?: string | null;
  responseId?: string;
}) {
  await execute(
    `insert into messages (
       id, conversation_id, user_id, role, content, thinking, images_json,
       usage_json, status, error_message, upstream_response_id
     )
     values (?, ?, ?, 'assistant', ?, ?, ?, ?, ?, ?, ?)
     on duplicate key update
       content = values(content),
       thinking = values(thinking),
       images_json = values(images_json),
       usage_json = values(usage_json),
       status = values(status),
       error_message = values(error_message),
       upstream_response_id = values(upstream_response_id)`,
    [
      params.id,
      params.conversationId,
      params.userId,
      params.content,
      params.thinking ?? null,
      JSON.stringify(params.images ?? []),
      params.usage ? JSON.stringify(params.usage) : null,
      params.status,
      params.error ?? null,
      params.responseId ?? null,
    ],
  );

  await touchConversation(params.conversationId);
}

async function touchConversation(
  conversationId: string,
  options: {
    firstUserTitle?: string;
    model?: PigouModel;
    mode?: ChatMode;
  } = {},
) {
  await execute(
    `update conversations
     set title = case
           when ? is not null
             and (title = ? or title = '')
             and (
               select count(*)
               from messages m
               where m.conversation_id = conversations.id and m.role = 'user'
             ) = 1
           then ?
           else title
         end,
         model = coalesce(?, model),
         mode = coalesce(?, mode),
         updated_at = current_timestamp(3)
     where id = ?`,
    [
      options.firstUserTitle ?? null,
      DEFAULT_CONVERSATION_TITLE,
      options.firstUserTitle ?? null,
      options.model ?? null,
      options.mode ?? null,
      conversationId,
    ],
  );
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toConversationSummary(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    mode: row.mode,
    updatedAt: normalizeMysqlDateTime(row.updated_at),
  };
}

function normalizeMysqlDateTime(value: Date | string) {
  const raw = value instanceof Date ? value.toISOString() : value;
  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z)?$/,
  );
  if (!match) {
    return new Date(raw).toISOString();
  }

  const [, year, month, day, hour, minute, second, millisecond = "0"] = match;
  const paddedMillisecond = millisecond.padEnd(3, "0").slice(0, 3);
  // MySQL DATETIME 没有时区；ECS DB API 会把东八区墙钟时间误标成 Z，这里按上海时区还原真实时间点。
  return new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}.${paddedMillisecond}+08:00`,
  ).toISOString();
}

function durationBetween(start: Date | string | null, end: Date | string | null) {
  if (!start || !end) {
    return null;
  }

  const startTime = new Date(normalizeMysqlDateTime(start)).getTime();
  const endTime = new Date(normalizeMysqlDateTime(end)).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return null;
  }

  return Math.max(0, endTime - startTime);
}

function withUsageDuration(usage: UsageSummary | undefined, durationMs: number): UsageSummary {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    reasoningTokens: usage?.reasoningTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    durationMs: Math.max(0, Math.round(durationMs)),
  };
}
