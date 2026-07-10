import express from "express";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const port = Number(process.env.PORT ?? "2571");
const host = process.env.HOST ?? "127.0.0.1";
const apiKey = process.env.PIGOU_DB_API_KEY;
const imageDir = process.env.PIGOU_IMAGE_DIR ?? "/var/lib/pigou-db-api/images";
const maxImageBytes = Number(process.env.PIGOU_IMAGE_MAX_BYTES ?? String(5 * 1024 * 1024));
const publicBaseUrl = (process.env.PIGOU_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
const sub2apiBaseUrl = process.env.SUB2API_BASE_URL?.replace(/\/+$/, "");
const sub2apiKey = process.env.SUB2API_KEY;
const mysqlDatabase = process.env.MYSQL_DATABASE;
const runningImageJobs = new Set();
const imageMimeTypes = new Map([
  ["image/png", { extension: "png", expressType: "png" }],
  ["image/jpeg", { extension: "jpg", expressType: "jpeg" }],
  ["image/webp", { extension: "webp", expressType: "webp" }],
  ["image/gif", { extension: "gif", expressType: "gif" }],
]);

if (!apiKey) {
  throw new Error("PIGOU_DB_API_KEY is required");
}
if (!mysqlDatabase) {
  throw new Error("MYSQL_DATABASE is required");
}

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? "3306"),
  database: mysqlDatabase,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT ?? "4"),
  queueLimit: 0,
  timezone: "Z",
});

const app = express();

app.get("/health", async (_req, res) => {
  try {
    await pool.query("select 1");
    res.json({ ok: true, mysql: true });
  } catch (error) {
    console.error("health mysql failed", safeError(error));
    res.status(503).json({ ok: false, mysql: false });
  }
});

app.post("/images", express.json({ limit: "8mb" }), async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const { mimeType, base64 } = req.body ?? {};
  const imageType = imageMimeTypes.get(mimeType);
  if (!imageType || typeof base64 !== "string" || !base64) {
    res.status(400).json({ message: "Invalid image payload" });
    return;
  }

  const imageBuffer = Buffer.from(base64, "base64");
  if (imageBuffer.length === 0 || imageBuffer.length > maxImageBytes) {
    res.status(413).json({ message: "Image payload too large" });
    return;
  }

  try {
    await mkdir(imageDir, { recursive: true });
    const fileName = `${randomUUID()}.${imageType.extension}`;
    await writeFile(join(imageDir, fileName), imageBuffer, { flag: "wx" });
    const path = `/images/${fileName}`;
    res.status(201).json({
      path,
      url: publicBaseUrl ? `${publicBaseUrl}${path}` : undefined,
      fileName,
      mimeType,
      size: imageBuffer.length,
    });
  } catch (error) {
    console.error("image save failed", safeError(error));
    res.status(500).json({ message: "Image save failed" });
  }
});

app.get("/images/:fileName", (req, res) => {
  const fileName = String(req.params.fileName ?? "");
  const match = fileName.match(/^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/i);
  if (!match) {
    res.status(404).end();
    return;
  }

  const extension = match[1].toLowerCase();
  res
    .type(extension === "jpg" ? "jpeg" : extension)
    .set("Cache-Control", "public, max-age=31536000, immutable")
    .sendFile(join(imageDir, fileName));
});

app.post("/image-jobs", express.json({ limit: "128kb" }), async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  if (!sub2apiBaseUrl || !sub2apiKey) {
    res.status(503).json({ message: "Sub2API is not configured on image worker" });
    return;
  }

  const payload = normalizeImageJobPayload(req.body);
  if (!payload) {
    res.status(400).json({ message: "Invalid image job payload" });
    return;
  }

  try {
    await createImageJob(payload);
    res.status(202).json({
      id: payload.id,
      status: "queued",
      assistantMessageId: payload.assistantMessageId,
    });
    queueImageJob(payload.id);
  } catch (error) {
    console.error("image job create failed", safeError(error));
    res.status(500).json({ message: "Image job create failed" });
  }
});

app.get("/image-jobs/:jobId", async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const jobId = String(req.params.jobId ?? "").trim();
  if (!isValidId(jobId)) {
    res.status(400).json({ message: "Invalid job id" });
    return;
  }

  try {
    const [rows] = await pool.query(
      `select
         j.id,
         j.user_id,
         j.conversation_id,
         j.assistant_message_id,
         j.status,
         j.error_message,
         j.images_json,
         j.usage_json,
         j.upstream_response_id,
         j.created_at,
         j.updated_at,
         j.completed_at,
         m.content,
         m.thinking
       from image_jobs j
       left join messages m on m.id = j.assistant_message_id
       where j.id = ?
       limit 1`,
      [jobId],
    );
    const row = rows[0];
    if (!row) {
      res.status(404).json({ message: "Image job not found" });
      return;
    }

    res.json(toImageJobResponse(row));
  } catch (error) {
    console.error("image job load failed", {
      jobId,
      error: safeError(error),
    });
    res.status(500).json({ message: "Image job load failed" });
  }
});

app.use(express.json({ limit: "128kb" }));

app.post("/query", async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const { mode, sql, values } = req.body ?? {};
  if ((mode !== "query" && mode !== "execute") || typeof sql !== "string") {
    res.status(400).json({ message: "Invalid database request" });
    return;
  }

  const normalizedSql = sql.trim();
  if (!isAllowedStatement(normalizedSql)) {
    res.status(400).json({ message: "Unsupported SQL statement" });
    return;
  }

  try {
    if (mode === "query") {
      const [rows] = await pool.query(normalizedSql, Array.isArray(values) ? values : []);
      res.json({ rows });
      return;
    }

    const [result] = await pool.execute(normalizedSql, Array.isArray(values) ? values : []);
    res.json({
      result: {
        affectedRows: result.affectedRows,
        insertId: result.insertId,
        warningStatus: result.warningStatus,
      },
    });
  } catch (error) {
    console.error("database query failed", {
      mode,
      sql: normalizedSql.slice(0, 160),
      error: safeError(error),
    });
    res.status(500).json({ message: "Database query failed" });
  }
});

await ensureSchema();
app.listen(port, host, () => {
  console.log(`pigou db api listening on http://${host}:${port}`);
  resumePendingImageJobs().catch((error) => {
    console.error("image job resume failed", safeError(error));
  });
});

async function ensureSchema() {
  try {
    await pool.query("select id from image_jobs limit 0");
    return;
  } catch (error) {
    if (error?.code !== "ER_NO_SUCH_TABLE") {
      throw error;
    }
    if (process.env.PIGOU_ENABLE_SCHEMA_MIGRATION !== "1") {
      throw new Error("image_jobs table is missing. Run database/schema.sql with a migration account first.");
    }
  }

  await pool.execute(`
    create table if not exists image_jobs (
      id varchar(64) not null,
      user_id bigint unsigned not null,
      conversation_id varchar(64) not null,
      assistant_message_id varchar(64) not null,
      prompt longtext not null,
      model varchar(32) not null,
      reasoning_effort varchar(32) not null default 'low',
      status varchar(32) not null default 'queued',
      error_message varchar(500) null,
      images_json longtext null,
      usage_json text null,
      upstream_response_id varchar(191) null,
      started_at datetime(3) null,
      completed_at datetime(3) null,
      created_at datetime(3) not null default current_timestamp(3),
      updated_at datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
      primary key (id),
      key idx_image_jobs_user_created (user_id, created_at),
      key idx_image_jobs_conversation (conversation_id),
      key idx_image_jobs_assistant_message (assistant_message_id),
      key idx_image_jobs_status_created (status, created_at)
    ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci
  `);
}

function normalizeImageJobPayload(body) {
  const payload = body ?? {};
  const id = String(payload.id ?? "").trim();
  const userId = Number(payload.userId);
  const conversationId = String(payload.conversationId ?? "").trim();
  const assistantMessageId = String(payload.assistantMessageId ?? "").trim();
  const prompt = String(payload.prompt ?? "").trim();
  const model = String(payload.model ?? "").trim();
  const reasoningEffort = String(payload.reasoningEffort ?? "low").trim();

  if (
    !isValidId(id) ||
    !Number.isSafeInteger(userId) ||
    userId <= 0 ||
    !isValidId(conversationId) ||
    !isValidId(assistantMessageId) ||
    !prompt ||
    !["gpt-5.6-sol", "gpt-5.5", "gpt-5.4"].includes(model) ||
    !["low", "medium", "high"].includes(reasoningEffort)
  ) {
    return null;
  }

  return {
    id,
    userId,
    conversationId,
    assistantMessageId,
    prompt,
    model,
    reasoningEffort,
  };
}

async function createImageJob(payload) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.execute(
      `insert into messages (
         id, conversation_id, user_id, role, content, thinking, images_json,
         usage_json, status, error_message, upstream_response_id
       )
       values (?, ?, ?, 'assistant', '', ?, '[]', null, 'running', null, null)
       on duplicate key update
         content = values(content),
         thinking = values(thinking),
         images_json = values(images_json),
         usage_json = values(usage_json),
         status = values(status),
         error_message = null,
         upstream_response_id = null`,
      [payload.assistantMessageId, payload.conversationId, payload.userId, "思考中..."],
    );

    await connection.execute(
      `insert into image_jobs (
         id, user_id, conversation_id, assistant_message_id, prompt, model,
         reasoning_effort, status
       )
       values (?, ?, ?, ?, ?, ?, ?, 'queued')
       on duplicate key update
         prompt = values(prompt),
         model = values(model),
         reasoning_effort = values(reasoning_effort),
         status = 'queued',
         error_message = null,
         images_json = null,
         usage_json = null,
         upstream_response_id = null,
         started_at = null,
         completed_at = null`,
      [
        payload.id,
        payload.userId,
        payload.conversationId,
        payload.assistantMessageId,
        payload.prompt,
        payload.model,
        payload.reasoningEffort,
      ],
    );

    await connection.execute(
      `update conversations
       set model = ?,
           mode = 'image',
           updated_at = current_timestamp(3)
       where id = ? and user_id = ?`,
      [payload.model, payload.conversationId, payload.userId],
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function queueImageJob(jobId) {
  if (runningImageJobs.has(jobId)) {
    return;
  }

  setImmediate(() => {
    runImageJob(jobId).catch((error) => {
      console.error("image job background failed", {
        jobId,
        error: safeError(error),
      });
    });
  });
}

async function resumePendingImageJobs() {
  if (!sub2apiBaseUrl || !sub2apiKey) {
    return;
  }

  const [rows] = await pool.query(
    `select id
     from image_jobs
     where status in ('queued', 'running')
     order by created_at asc
     limit 10`,
  );

  for (const row of rows) {
    queueImageJob(row.id);
  }
}

async function runImageJob(jobId) {
  if (runningImageJobs.has(jobId)) {
    return;
  }
  runningImageJobs.add(jobId);

  try {
    const [rows] = await pool.query(
      `select id, user_id, conversation_id, assistant_message_id, prompt, model, reasoning_effort, status
       from image_jobs
       where id = ?
       limit 1`,
      [jobId],
    );
    const job = rows[0];
    if (!job || job.status === "succeeded" || job.status === "failed") {
      return;
    }

    await pool.execute(
      `update image_jobs
       set status = 'running',
           started_at = coalesce(started_at, current_timestamp(3)),
           updated_at = current_timestamp(3)
       where id = ?`,
      [jobId],
    );
    await pool.execute(
      `update messages
       set status = 'running',
           error_message = null,
           thinking = '思考中...'
       where id = ?`,
      [job.assistant_message_id],
    );

    const startedAt = Date.now();
    const upstream = await requestImageGeneration(job);
    const rawImages = extractImages(upstream);
    const text = extractText(upstream);

    if (rawImages.length === 0) {
      throw new Error(text || "图片生成完成，但上游没有返回可展示的图片。");
    }

    const images = [];
    for (const image of rawImages) {
      images.push(await persistGeneratedImage(image));
    }

    const usage = withUsageDuration(extractUsage(upstream), Date.now() - startedAt);
    const content = text || "图片已生成。";

    await pool.execute(
      `update messages
       set content = ?,
           thinking = null,
           images_json = ?,
           usage_json = ?,
           status = 'done',
           error_message = null,
           upstream_response_id = ?
       where id = ?`,
      [
        content,
        JSON.stringify(images),
        usage ? JSON.stringify(usage) : null,
        upstream.id ?? null,
        job.assistant_message_id,
      ],
    );
    await pool.execute(
      `update image_jobs
       set status = 'succeeded',
           error_message = null,
           images_json = ?,
           usage_json = ?,
           upstream_response_id = ?,
           completed_at = current_timestamp(3),
           updated_at = current_timestamp(3)
       where id = ?`,
      [
        JSON.stringify(images),
        usage ? JSON.stringify(usage) : null,
        upstream.id ?? null,
        jobId,
      ],
    );
    await pool.execute(
      `update conversations
       set updated_at = current_timestamp(3)
       where id = ?`,
      [job.conversation_id],
    );

    console.info("image job completed", {
      jobId,
      model: job.model,
      latencyMs: Date.now() - startedAt,
      imageCount: images.length,
      responseId: upstream.id,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message.slice(0, 500) : "图片生成失败。";
    console.error("image job failed", {
      jobId,
      error: safeError(error),
    });

    const [rows] = await pool.query(
      `select assistant_message_id
       from image_jobs
       where id = ?
       limit 1`,
      [jobId],
    );
    const assistantMessageId = rows[0]?.assistant_message_id;

    if (assistantMessageId) {
      await pool.execute(
        `update messages
         set content = ?,
             thinking = null,
             status = 'error',
             error_message = ?
         where id = ?`,
        [message, message, assistantMessageId],
      );
    }

    await pool.execute(
      `update image_jobs
       set status = 'failed',
           error_message = ?,
           completed_at = current_timestamp(3),
           updated_at = current_timestamp(3)
       where id = ?`,
      [message, jobId],
    );
  } finally {
    runningImageJobs.delete(jobId);
  }
}

async function requestImageGeneration(job) {
  const response = await fetch(`${sub2apiBaseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sub2apiKey}`,
    },
    body: JSON.stringify({
      model: job.model,
      instructions:
        "请默认用中文回答。当前任务是生成一张图片；如上游返回说明文字，只保留简短说明，不要输出隐藏内部推理全文。",
      input: stripToolCommand(job.prompt),
      reasoning: {
        effort: job.reasoning_effort,
        summary: "auto",
      },
      tools: [{ type: "image_generation", action: "generate", quality: "low" }],
      stream: false,
      store: false,
    }),
  });

  const body = await safeJson(response);
  if (!response.ok) {
    throw new Error(normalizeUpstreamError(response.status, body));
  }

  return body ?? {};
}

async function persistGeneratedImage(image) {
  const base64 = image.base64;
  if (typeof base64 !== "string" || !base64) {
    throw new Error("图片结果为空。");
  }

  const imageBuffer = Buffer.from(base64, "base64");
  if (imageBuffer.length === 0 || imageBuffer.length > maxImageBytes) {
    throw new Error("图片结果过大，无法保存。");
  }

  await mkdir(imageDir, { recursive: true });
  const fileName = `${randomUUID()}.png`;
  await writeFile(join(imageDir, fileName), imageBuffer, { flag: "wx" });
  const path = `/images/${fileName}`;

  return {
    mimeType: "image/png",
    url: publicBaseUrl ? `${publicBaseUrl}${path}` : path,
    revisedPrompt: image.revisedPrompt,
  };
}

function toImageJobResponse(row) {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    assistantMessageId: row.assistant_message_id,
    status: row.status,
    error: row.error_message,
    content: row.content ?? "",
    thinking: row.thinking ?? null,
    images: parseJson(row.images_json, []),
    usage: parseJson(row.usage_json, undefined),
    responseId: row.upstream_response_id ?? undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    completedAt: row.completed_at ? toIso(row.completed_at) : null,
  };
}

function extractText(response) {
  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  const chunks = [];
  for (const item of response.output ?? []) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (typeof part?.text === "string") {
          chunks.push(part.text);
        }
      }
    }
  }

  return chunks.join("");
}

function extractImages(response) {
  const images = [];
  for (const item of response.output ?? []) {
    if (item?.type !== "image_generation_call") {
      continue;
    }
    if (typeof item.result !== "string" || !item.result) {
      continue;
    }
    images.push({
      mimeType: "image/png",
      base64: item.result,
      revisedPrompt: typeof item.revised_prompt === "string" ? item.revised_prompt : undefined,
    });
  }
  return images;
}

function extractUsage(response) {
  if (!response.usage) {
    return undefined;
  }

  const usage = response.usage;
  const outputDetails = usage.output_tokens_details;
  return {
    inputTokens: numberValue(usage.input_tokens),
    outputTokens: numberValue(usage.output_tokens),
    reasoningTokens:
      typeof outputDetails === "object" && outputDetails !== null
        ? numberValue(outputDetails.reasoning_tokens)
        : 0,
    totalTokens: numberValue(usage.total_tokens),
  };
}

function withUsageDuration(usage, durationMs) {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    reasoningTokens: usage?.reasoningTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    durationMs: Math.max(0, Math.round(durationMs)),
  };
}

function normalizeUpstreamError(status, body) {
  const message = extractErrorMessage(body);
  if (status === 401 || status === 403) {
    return "认证失败，请检查 SUB2API_KEY 或网关权限。";
  }
  if (status === 404) {
    return "网关路径或模型不存在，请检查 base URL 和模型名。";
  }
  if (status === 408) {
    return "请求超时，请稍后重试。";
  }
  if (status === 429) {
    return "请求过于频繁或额度不足，请稍后重试。";
  }
  if (status >= 500) {
    return message ? `AI 网关暂时不可用：${message}` : "AI 网关暂时不可用，请稍后重试。";
  }
  return message || "请求失败，请检查输入后重试。";
}

function extractErrorMessage(body) {
  if (!body || typeof body !== "object") {
    return "";
  }
  if (body.error && typeof body.error === "object" && typeof body.error.message === "string") {
    return body.error.message;
  }
  return typeof body.message === "string" ? body.message : "";
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 300) };
  }
}

function stripToolCommand(text) {
  return text.replace(/^\/(?:image|img|draw|search|web|browse)\b\s*/i, "").trim() || text;
}

function parseJson(value, fallback) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isValidId(value) {
  return /^[0-9a-f-]{16,64}$/i.test(value);
}

function isAllowedStatement(sql) {
  if (sql.includes(";")) {
    return false;
  }
  return /^(select|insert|update|delete)\b/i.test(sql);
}

function isAuthorized(req) {
  const authorization = req.header("authorization") ?? "";
  return authorization === `Bearer ${apiKey}`;
}

function safeError(error) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}
