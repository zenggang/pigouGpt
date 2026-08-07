export const DEFAULT_MESSAGE_SNAPSHOT_STREAM = "pigou:message-snapshots";
export const DEFAULT_MESSAGE_SNAPSHOT_GROUP = "pigou-db-api";

const MESSAGE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const TERMINAL_STATUSES = new Set(["running", "done", "error"]);

export function normalizeMessageSnapshot(body) {
  const payload = body ?? {};
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  const userId = Number(payload.userId);
  const conversationId =
    typeof payload.conversationId === "string" ? payload.conversationId.trim() : "";
  const content = payload.content;
  const thinking = payload.thinking ?? null;
  const usage = payload.usage ?? null;
  const status = payload.status;
  const error = payload.error ?? null;
  const responseId = payload.responseId ?? null;

  if (
    !MESSAGE_ID_PATTERN.test(id) ||
    !Number.isSafeInteger(userId) ||
    userId <= 0 ||
    !MESSAGE_ID_PATTERN.test(conversationId) ||
    typeof content !== "string" ||
    content.length > 100_000 ||
    (thinking !== null && (typeof thinking !== "string" || thinking.length > 50_000)) ||
    !TERMINAL_STATUSES.has(status) ||
    (error !== null && (typeof error !== "string" || error.length > 500)) ||
    (responseId !== null && (typeof responseId !== "string" || responseId.length > 191)) ||
    (usage !== null && (!isPlainObject(usage) || JSON.stringify(usage).length > 16_000))
  ) {
    return null;
  }

  return {
    id,
    userId,
    conversationId,
    content,
    thinking,
    usage,
    status,
    error,
    responseId,
  };
}

export async function ensureMessageSnapshotGroup(
  redis,
  stream = DEFAULT_MESSAGE_SNAPSHOT_STREAM,
  group = DEFAULT_MESSAGE_SNAPSHOT_GROUP,
) {
  try {
    await redis.xGroupCreate(stream, group, "0", { MKSTREAM: true });
  } catch (error) {
    if (!String(error?.message ?? error).includes("BUSYGROUP")) {
      throw error;
    }
  }
}

export async function enqueueMessageSnapshot(
  redis,
  snapshot,
  stream = DEFAULT_MESSAGE_SNAPSHOT_STREAM,
) {
  return redis.xAdd(
    stream,
    "*",
    { payload: JSON.stringify(snapshot) },
    {
      TRIM: {
        strategy: "MAXLEN",
        strategyModifier: "~",
        threshold: 10_000,
      },
    },
  );
}

export async function consumeMessageSnapshots({
  redis,
  pool,
  stream = DEFAULT_MESSAGE_SNAPSHOT_STREAM,
  group = DEFAULT_MESSAGE_SNAPSHOT_GROUP,
  consumer,
  signal,
  logger = console,
}) {
  await recoverPendingSnapshots({ redis, pool, stream, group, consumer, logger });

  while (!signal?.aborted) {
    try {
      const batches = await redis.xReadGroup(
        group,
        consumer,
        [{ key: stream, id: ">" }],
        { COUNT: 10, BLOCK: 5_000 },
      );

      for (const message of flattenStreamMessages(batches)) {
        await persistAndAcknowledge({ redis, pool, stream, group, message, logger });
      }
    } catch (error) {
      if (signal?.aborted) {
        return;
      }
      logger.error("message snapshot consume failed", {
        consumer,
        error: safeError(error),
      });
      await delay(1_000);
    }
  }
}

async function recoverPendingSnapshots({ redis, pool, stream, group, consumer, logger }) {
  let cursor = "0-0";

  do {
    const claimed = await redis.xAutoClaim(stream, group, consumer, 30_000, cursor, {
      COUNT: 20,
    });
    cursor = claimed.nextId;
    for (const message of claimed.messages.filter(Boolean)) {
      await persistAndAcknowledge({ redis, pool, stream, group, message, logger });
    }
  } while (cursor !== "0-0");
}

async function persistAndAcknowledge({ redis, pool, stream, group, message, logger }) {
  const startedAt = Date.now();
  const snapshot = parseQueuedSnapshot(message.message?.payload);
  if (!snapshot) {
    logger.error("invalid message snapshot discarded", { queueId: message.id });
    await redis.xAck(stream, group, message.id);
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `insert into messages (
         id, conversation_id, user_id, role, content, thinking, images_json,
         usage_json, status, error_message, upstream_response_id
       )
       values (?, ?, ?, 'assistant', ?, ?, '[]', ?, ?, ?, ?)
       on duplicate key update
         content = values(content),
         thinking = values(thinking),
         usage_json = values(usage_json),
         status = values(status),
         error_message = values(error_message),
         upstream_response_id = values(upstream_response_id)`,
      [
        snapshot.id,
        snapshot.conversationId,
        snapshot.userId,
        snapshot.content,
        snapshot.thinking,
        snapshot.usage ? JSON.stringify(snapshot.usage) : null,
        snapshot.status,
        snapshot.error,
        snapshot.responseId,
      ],
    );
    await connection.execute(
      `update conversations
       set updated_at = current_timestamp(3)
       where id = ? and user_id = ?`,
      [snapshot.conversationId, snapshot.userId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  await redis.xAck(stream, group, message.id);
  logger.info("message snapshot persisted", {
    queueId: message.id,
    assistantId: snapshot.id,
    conversationId: snapshot.conversationId,
    status: snapshot.status,
    latencyMs: Date.now() - startedAt,
  });
}

function parseQueuedSnapshot(value) {
  if (typeof value !== "string") {
    return null;
  }
  try {
    return normalizeMessageSnapshot(JSON.parse(value));
  } catch {
    return null;
  }
}

function flattenStreamMessages(batches) {
  return (batches ?? []).flatMap((batch) => batch.messages ?? []);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
