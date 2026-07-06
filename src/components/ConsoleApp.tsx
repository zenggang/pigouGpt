"use client";

import {
  Bot,
  Check,
  Copy,
  Download,
  ExternalLink,
  Globe2,
  Loader2,
  LogOut,
  PanelLeft,
  Plus,
  RefreshCcw,
  Send,
  Square,
  Trash2,
  X,
  UserRound,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CONVERSATION_TITLE, summarizeConversationTitle } from "@/lib/conversation-title";
import { extractVisibleThinkingFromContent } from "@/lib/thinking";
import { BrandMark } from "./BrandMark";
import { MarkdownMessage } from "./MarkdownMessage";

type Model = "gpt-5.5" | "gpt-5.4";
type ReasoningEffort = "low" | "medium" | "high";
type Role = "user" | "assistant";
type ImageJobStatus = "queued" | "running" | "succeeded" | "failed";

type GeneratedImage = {
  mimeType: "image/png";
  base64?: string;
  url?: string;
  revisedPrompt?: string;
};

type Usage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  durationMs?: number;
};

type Message = {
  id: string;
  role: Role;
  content: string;
  createdAt?: string;
  rawContent?: string;
  thinking?: string | null;
  images?: GeneratedImage[];
  usage?: Usage;
  durationMs?: number | null;
  status?: "streaming" | "running" | "done" | "error";
  error?: string | null;
  imageJobId?: string | null;
  imageJobStatus?: ImageJobStatus | null;
  imageJobStartedAt?: number;
  imageJobUpdatedAt?: number;
};

type ConversationSummary = {
  id: string;
  title: string;
  model: Model;
  mode: "chat" | "image" | "search";
  updatedAt: string;
};

type RunningConversation = {
  assistantId: string;
  mode: ConversationSummary["mode"];
  startedAt: number;
};

type NormalizedEvent =
  | { type: "thinking_delta"; delta: string }
  | { type: "text_delta"; delta: string }
  | { type: "image"; mimeType: "image/png"; base64?: string; url?: string; revisedPrompt?: string }
  | { type: "image_job"; jobId: string; assistantMessageId: string; status: ImageJobStatus }
  | { type: "response_meta"; responseId?: string; usage?: Usage }
  | { type: "done" }
  | { type: "error"; message: string; code?: string };

type ImageJobSnapshot = {
  id: string;
  conversationId: string;
  assistantMessageId: string;
  status: ImageJobStatus;
  error?: string | null;
  content?: string;
  thinking?: string | null;
  images?: GeneratedImage[];
  usage?: Usage;
  responseId?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
};

type SelectedImage = {
  image: GeneratedImage;
  messageId: string;
  index: number;
};

type DeleteMessageTarget = {
  conversationId: string;
  message: Message;
};

type ConversationCache = {
  conversations: ConversationSummary[];
  messagesByConversation: Record<string, Message[]>;
  updatedAt: string;
};

type ConsoleAppProps = {
  user: {
    email: string;
    name: string | null;
  };
  initialConversationId: string;
  initialMessages: Message[];
  initialConversations: ConversationSummary[];
};

const SETTINGS_KEY = "pigou-ai-console-settings-v1";
const CONVERSATION_CACHE_KEY_PREFIX = "pigou-ai-console-conversation-cache-v1";
const MODELS: Model[] = ["gpt-5.5", "gpt-5.4"];
const REASONING_OPTIONS: Array<{ value: ReasoningEffort; label: string }> = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

const seedMessages: Message[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "你好，我是 Pigou AI Console。可以直接提问、贴代码、生成图片，或继续追问上一轮内容。",
    thinking: "等待你的问题。",
    status: "done",
  },
];

export function ConsoleApp({
  user,
  initialConversationId,
  initialMessages,
  initialConversations,
}: ConsoleAppProps) {
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [conversations, setConversations] = useState<ConversationSummary[]>(
    initialConversations,
  );
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, Message[]>>({
    [initialConversationId]: initialMessages.length > 0 ? initialMessages : seedMessages,
  });
  const [input, setInput] = useState("");
  const [model, setModel] = useState<Model>("gpt-5.5");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");
  const [runningConversations, setRunningConversations] = useState<
    Record<string, RunningConversation>
  >({});
  const [errorsByConversation, setErrorsByConversation] = useState<Record<string, string | null>>(
    {},
  );
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<SelectedImage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null);
  const [deleteMessageTarget, setDeleteMessageTarget] = useState<DeleteMessageTarget | null>(
    null,
  );
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const pollingJobsRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const hasHydratedStorageRef = useRef(false);
  const hasHydratedConversationCacheRef = useRef(false);

  const conversationCacheKey = useMemo(
    () => `${CONVERSATION_CACHE_KEY_PREFIX}:${user.email}`,
    [user.email],
  );
  const messages = displayMessages(messagesByConversation[conversationId]);
  const activeRunning = runningConversations[conversationId] ?? null;
  const isStreaming = Boolean(activeRunning);
  const runningCount = Object.keys(runningConversations).length;
  const activeImageJobs = useMemo(
    () => collectActiveImageJobs(messagesByConversation),
    [messagesByConversation],
  );
  const activeImageJobKey = useMemo(
    () =>
      activeImageJobs
        .map((job) => `${job.conversationId}:${job.messageId}:${job.jobId}`)
        .sort()
        .join("|"),
    [activeImageJobs],
  );
  const currentImageJobCount = activeImageJobs.filter(
    (job) => job.conversationId === conversationId,
  ).length;
  const error = errorsByConversation[conversationId] ?? null;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const stored = readStoredSettings();
      setModel(stored.model);
      setReasoningEffort(stored.reasoningEffort);
      hasHydratedStorageRef.current = true;
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!hasHydratedStorageRef.current) {
      return;
    }

    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ model, reasoningEffort }),
    );
  }, [model, reasoningEffort]);

  useEffect(() => {
    hasHydratedConversationCacheRef.current = false;
    const timeout = window.setTimeout(() => {
      const cached = readConversationCache(conversationCacheKey);
      if (cached) {
        // 历史会话列表以服务端 MySQL 为准；本地缓存只用于已打开会话内容的快速回显。
        setMessagesByConversation((current) =>
          mergeCachedMessages(current, cached.messagesByConversation),
        );
      }
      hasHydratedConversationCacheRef.current = true;
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [conversationCacheKey]);

  useEffect(() => {
    if (!hasHydratedConversationCacheRef.current) {
      return;
    }

    writeConversationCache(conversationCacheKey, {
      conversations,
      messagesByConversation: compactMessagesByConversation(messagesByConversation),
      updatedAt: new Date().toISOString(),
    });
  }, [conversationCacheKey, conversations, messagesByConversation]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [conversationId, messages]);

  useEffect(() => {
    if (activeImageJobs.length === 0) {
      return;
    }

    const jobs = activeImageJobs;
    const poll = async () => {
      await Promise.all(
        jobs.map(async (job) => {
          if (pollingJobsRef.current.has(job.jobId)) {
            return;
          }
          pollingJobsRef.current.add(job.jobId);
          try {
            await pollImageJob(job.conversationId, job.messageId, job.jobId);
          } finally {
            pollingJobsRef.current.delete(job.jobId);
          }
        }),
      );
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 4000);
    return () => window.clearInterval(timer);
    // 只在活跃 job 集合变化时重建轮询；普通状态刷新不应打断正在进行的轮询请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeImageJobKey]);

  useEffect(() => {
    if (activeImageJobs.length === 0) {
      return;
    }

    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeImageJobs.length]);

  const statusLabel = useMemo(() => {
    if (error) {
      return "错误";
    }
    if (isStreaming) {
      if (activeRunning?.mode === "image") {
        return "图片生成中";
      }
      if (activeRunning?.mode === "search") {
        return "联网搜索中";
      }
      return "流式输出";
    }
    if (currentImageJobCount > 0) {
      return "图片生成中";
    }
    if (activeImageJobs.length > 0) {
      return `${activeImageJobs.length} 个图片任务运行中`;
    }
    if (runningCount > 0) {
      return `${runningCount} 个会话运行中`;
    }
    return "空闲";
  }, [
    activeImageJobs.length,
    activeRunning?.mode,
    currentImageJobCount,
    error,
    isStreaming,
    runningCount,
  ]);

  const activeSummary = useMemo(() => {
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    return lastUser?.content.slice(0, 42) || "新的单会话";
  }, [messages]);

  const activeConversationTitle = useMemo(() => {
    return (
      conversations.find((conversation) => conversation.id === conversationId)?.title ||
      activeSummary
    );
  }, [activeSummary, conversationId, conversations]);

  async function sendMessage(override?: string) {
    const text = (override ?? input).trim();
    const targetConversationId = conversationId;
    if (!text || runningConversations[targetConversationId]) {
      return;
    }

    setConversationError(targetConversationId, null);
    setInput("");

    const startedAt = currentTimestamp();
    const sentAt = new Date(startedAt).toISOString();
    const userMessage: Message = {
      id: createId(),
      role: "user",
      content: text,
      createdAt: sentAt,
      status: "done",
    };
    const assistantId = createId();
    const inferredMode = inferConversationModeForUi(text);
    const assistantMessage: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: sentAt,
      thinking: "思考中...",
      images: [],
      status: "streaming",
      imageJobStartedAt: inferredMode === "image" ? startedAt : undefined,
      imageJobUpdatedAt: inferredMode === "image" ? startedAt : undefined,
    };
    const currentMessages = withoutSeedMessages(
      messagesByConversation[targetConversationId] ?? seedMessages,
    );
    const nextMessages = [...currentMessages, userMessage, assistantMessage];
    const currentConversation = conversations.find(
      (conversation) => conversation.id === targetConversationId,
    );
    const optimisticTitle = shouldSetInitialTitle(currentConversation?.title, currentMessages)
      ? summarizeConversationTitle(text)
      : currentConversation?.title || activeConversationTitle;
    setConversationMessages(targetConversationId, nextMessages);
    promoteConversation({
      id: targetConversationId,
      title: optimisticTitle,
      model,
      mode: inferredMode,
      updatedAt: new Date().toISOString(),
    });

    const controller = new AbortController();
    abortControllersRef.current.set(targetConversationId, controller);
    setRunningConversations((current) => ({
      ...current,
      [targetConversationId]: {
        assistantId,
        mode: inferredMode,
        startedAt: Date.now(),
      },
    }));

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId: targetConversationId,
          model,
          conversationStrategy: "full_history",
          messages: nextMessages
            .filter((message) => message.role === "user" || message.role === "assistant")
            .filter((message) => !isSeedMessage(message))
            .filter((message) => message.id !== assistantId)
            .map(({ id, role, content }) => ({ id, role, content })),
          options: { showThinking: true, reasoningEffort },
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || "服务端请求失败。");
      }

      await consumeSse(response.body, targetConversationId, assistantId);
      finalizeAssistant(targetConversationId, assistantId);
    } catch (requestError) {
      const message =
        requestError instanceof Error && requestError.name === "AbortError"
          ? "请求已取消。"
          : requestError instanceof Error
            ? requestError.message
            : "请求失败，请稍后重试。";

      setConversationError(targetConversationId, message);
      updateAssistant(targetConversationId, assistantId, (assistant) => ({
        ...assistant,
        status: "error",
        error: message,
        content: assistant.content || message,
        durationMs: assistant.durationMs ?? elapsedSince(assistant.createdAt),
        usage: withUsageDuration(
          assistant.usage,
          assistant.durationMs ?? elapsedSince(assistant.createdAt),
        ),
      }));
    } finally {
      abortControllersRef.current.delete(targetConversationId);
      setRunningConversations((current) => {
        const next = { ...current };
        delete next[targetConversationId];
        return next;
      });
    }
  }

  async function consumeSse(
    body: ReadableStream<Uint8Array>,
    targetConversationId: string,
    assistantId: string,
  ) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        handleSseBlock(block, targetConversationId, assistantId);
        boundary = buffer.indexOf("\n\n");
      }
    }

    if (buffer.trim()) {
      handleSseBlock(buffer, targetConversationId, assistantId);
    }
  }

  function handleSseBlock(
    block: string,
    targetConversationId: string,
    assistantId: string,
  ) {
    const dataLine = block
      .split("\n")
      .find((line) => line.startsWith("data:"))
      ?.slice(5)
      .trim();

    if (!dataLine) {
      return;
    }

    let event: NormalizedEvent;
    try {
      event = JSON.parse(dataLine) as NormalizedEvent;
    } catch {
      return;
    }

    if (event.type === "text_delta") {
      updateAssistant(targetConversationId, assistantId, (assistant) => ({
        ...assistant,
        ...mergeStreamingTextDelta(assistant, event.delta),
      }));
    }

    if (event.type === "thinking_delta") {
      updateAssistant(targetConversationId, assistantId, (assistant) => ({
        ...assistant,
        thinking:
          event.delta === "思考中..."
            ? assistant.thinking || event.delta
            : appendThinking(assistant.thinking, event.delta),
      }));
    }

    if (event.type === "image") {
      updateAssistant(targetConversationId, assistantId, (assistant) => ({
        ...assistant,
        images: [...(assistant.images ?? []), event],
      }));
    }

    if (event.type === "image_job") {
      const timestamp = currentTimestamp();
      updateAssistant(targetConversationId, assistantId, (assistant) => ({
        ...assistant,
        status: "streaming",
        imageJobId: event.jobId,
        imageJobStatus: event.status,
        imageJobStartedAt: assistant.imageJobStartedAt ?? timestamp,
        imageJobUpdatedAt: timestamp,
        thinking: assistant.thinking || "思考中...",
      }));
    }

    if (event.type === "response_meta") {
      updateAssistant(targetConversationId, assistantId, (assistant) => ({
        ...assistant,
        usage: event.usage ?? assistant.usage,
      }));
    }

    if (event.type === "error") {
      setConversationError(targetConversationId, event.message);
      updateAssistant(targetConversationId, assistantId, (assistant) => ({
        ...assistant,
        status: "error",
        error: event.message,
        content: assistant.content || event.message,
        durationMs: assistant.durationMs ?? elapsedSince(assistant.createdAt),
        usage: withUsageDuration(
          assistant.usage,
          assistant.durationMs ?? elapsedSince(assistant.createdAt),
        ),
      }));
    }
  }

  function finalizeAssistant(targetConversationId: string, assistantId: string) {
    updateAssistant(targetConversationId, assistantId, (assistant) => {
      const rawContent = assistant.rawContent ?? assistant.content;
      const extracted = extractVisibleThinkingFromContent(rawContent);
      const hasImages = (assistant.images?.length ?? 0) > 0;
      if (assistant.imageJobId && isActiveImageJobStatus(assistant.imageJobStatus)) {
        return {
          ...assistant,
          rawContent: undefined,
          content: extracted.content || assistant.content,
          thinking:
            extracted.thinking || (assistant.thinking === "思考中..." ? "思考中..." : assistant.thinking),
          status: "streaming",
        };
      }

      return {
        ...assistant,
        rawContent: undefined,
        content: extracted.content || assistant.content || (hasImages ? "" : "已完成。"),
        thinking:
          extracted.thinking || (assistant.thinking === "思考中..." ? null : assistant.thinking),
        durationMs: assistant.durationMs ?? elapsedSince(assistant.createdAt),
        usage: withUsageDuration(
          assistant.usage,
          assistant.durationMs ?? elapsedSince(assistant.createdAt),
        ),
        status: assistant.status === "error" ? "error" : "done",
      };
    });
  }

  async function pollImageJob(
    targetConversationId: string,
    assistantId: string,
    jobId: string,
  ) {
    const response = await fetch(`/api/image-job?jobId=${encodeURIComponent(jobId)}`, {
      cache: "no-store",
    });
    const body = (await response.json().catch(() => null)) as
      | (Partial<ImageJobSnapshot> & { message?: string })
      | null;

    if (!response.ok) {
      const message = body?.message || "图片任务查询失败。";
      setConversationError(targetConversationId, message);
      updateAssistant(targetConversationId, assistantId, (assistant) => ({
        ...assistant,
        status: "error",
        imageJobStatus: "failed",
        error: message,
        content: assistant.content || message,
      }));
      return;
    }

    const job = body as ImageJobSnapshot;
    const timestamp = currentTimestamp();
    if (job.status === "succeeded") {
      const durationMs =
        job.usage?.durationMs ?? durationFromJobTimestamps(job) ?? elapsedSince(job.createdAt);
      updateAssistant(targetConversationId, assistantId, (assistant) => ({
        ...assistant,
        content: job.content || assistant.content || "图片已生成。",
        thinking: job.thinking ?? null,
        images: job.images ?? assistant.images ?? [],
        createdAt: assistant.createdAt ?? job.createdAt,
        durationMs,
        usage: withUsageDuration(job.usage ?? assistant.usage, durationMs),
        status: "done",
        error: null,
        imageJobId: job.id,
        imageJobStatus: job.status,
        imageJobStartedAt: assistant.imageJobStartedAt ?? parseJobTime(job.createdAt) ?? timestamp,
        imageJobUpdatedAt: timestamp,
      }));
      promoteConversation({
        id: targetConversationId,
        title:
          conversations.find((conversation) => conversation.id === targetConversationId)?.title ||
          "图片会话",
        model,
        mode: "image",
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    if (job.status === "failed") {
      const message = job.error || job.content || "图片生成失败。";
      const durationMs = durationFromJobTimestamps(job) ?? elapsedSince(job.createdAt);
      setConversationError(targetConversationId, message);
      updateAssistant(targetConversationId, assistantId, (assistant) => ({
        ...assistant,
        content: job.content || assistant.content || message,
        thinking: job.thinking ?? null,
        createdAt: assistant.createdAt ?? job.createdAt,
        durationMs,
        usage: withUsageDuration(assistant.usage, durationMs),
        status: "error",
        error: message,
        imageJobId: job.id,
        imageJobStatus: job.status,
        imageJobStartedAt: assistant.imageJobStartedAt ?? parseJobTime(job.createdAt) ?? timestamp,
        imageJobUpdatedAt: timestamp,
      }));
      return;
    }

    updateAssistant(targetConversationId, assistantId, (assistant) => ({
      ...assistant,
      status: "streaming",
      createdAt: assistant.createdAt ?? job.createdAt,
      imageJobId: job.id,
      imageJobStatus: job.status,
      imageJobStartedAt: assistant.imageJobStartedAt ?? parseJobTime(job.createdAt) ?? timestamp,
      imageJobUpdatedAt: timestamp,
      thinking: assistant.thinking || "思考中...",
    }));
  }

  function updateAssistant(
    targetConversationId: string,
    id: string,
    updater: (message: Message) => Message,
  ) {
    setMessagesByConversation((current) => {
      const currentMessages = current[targetConversationId] ?? seedMessages;
      return {
        ...current,
        [targetConversationId]: currentMessages.map((message) =>
          message.id === id ? updater(message) : message,
        ),
      };
    });
  }

  async function fetchConversationMessages(targetConversationId: string) {
    try {
      const response = await fetch(
        `/api/conversation?conversationId=${encodeURIComponent(targetConversationId)}`,
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.message || "加载会话失败。");
      }

      setConversationMessages(
        body.conversationId,
        body.messages?.length > 0 ? body.messages : seedMessages,
      );
    } catch (requestError) {
      setConversationError(
        targetConversationId,
        requestError instanceof Error ? requestError.message : "加载会话失败。",
      );
    }
  }

  function stopRequest() {
    abortControllersRef.current.get(conversationId)?.abort();
  }

  async function loadConversation(targetConversationId: string) {
    setIsMobileSidebarOpen(false);

    if (targetConversationId === conversationId) {
      return;
    }

    setConversationError(targetConversationId, null);
    setConversationId(targetConversationId);

    if (hasCachedMessages(messagesByConversation[targetConversationId])) {
      void fetchConversationMessages(targetConversationId);
      return;
    }

    await fetchConversationMessages(targetConversationId);
  }

  async function clearConversation() {
    setConversationError(conversationId, null);

    try {
      const response = await fetch("/api/conversation", { method: "POST" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.message || "新建会话失败。");
      }
      setConversationId(body.conversationId);
      setConversationMessages(body.conversationId, seedMessages);
      setIsMobileSidebarOpen(false);
      if (body.conversation) {
        promoteConversation(body.conversation);
      }
    } catch (requestError) {
      setConversationError(
        conversationId,
        requestError instanceof Error ? requestError.message : "新建会话失败。",
      );
    }
  }

  async function deleteConversation(targetConversationId: string) {
    abortControllersRef.current.get(targetConversationId)?.abort();
    abortControllersRef.current.delete(targetConversationId);

    const previousConversationId = conversationId;
    const previousConversations = conversations;
    const previousMessagesByConversation = messagesByConversation;
    const previousErrorsByConversation = errorsByConversation;
    const previousRunningConversations = runningConversations;
    const remaining = conversations.filter(
      (conversation) => conversation.id !== targetConversationId,
    );
    const nextConversation = remaining[0] ?? null;

    // 删除操作先更新本地缓存和界面，后端请求失败再回滚，避免列表点击/删除被 ECS 接口延迟拖慢。
    setConversations(remaining);
    setMessagesByConversation((current) => {
      const next = { ...current };
      delete next[targetConversationId];
      return next;
    });
    setErrorsByConversation((current) => {
      const next = { ...current };
      delete next[targetConversationId];
      return next;
    });
    setRunningConversations((current) => {
      const next = { ...current };
      delete next[targetConversationId];
      return next;
    });

    if (targetConversationId === conversationId) {
      if (nextConversation) {
        setConversationId(nextConversation.id);
        if (!hasCachedMessages(messagesByConversation[nextConversation.id])) {
          void fetchConversationMessages(nextConversation.id);
        }
      } else {
        void clearConversation();
      }
    }

    try {
      const response = await fetch(
        `/api/conversation?conversationId=${encodeURIComponent(targetConversationId)}`,
        { method: "DELETE" },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.message || "删除会话失败。");
      }
    } catch (requestError) {
      setConversationId(previousConversationId);
      setConversations(previousConversations);
      setMessagesByConversation(previousMessagesByConversation);
      setErrorsByConversation(previousErrorsByConversation);
      setRunningConversations(previousRunningConversations);
      setConversationError(
        previousConversationId,
        requestError instanceof Error ? requestError.message : "删除会话失败。",
      );
    }
  }

  async function deleteMessage(targetConversationId: string, messageId: string) {
    const previousMessagesByConversation = messagesByConversation;
    const previousErrorsByConversation = errorsByConversation;
    const activeRun = runningConversations[targetConversationId];
    if (activeRun?.assistantId === messageId) {
      abortControllersRef.current.get(targetConversationId)?.abort();
    }

    setMessagesByConversation((current) => {
      const currentMessages = withoutSeedMessages(current[targetConversationId] ?? seedMessages);
      return {
        ...current,
        [targetConversationId]: currentMessages.filter((message) => message.id !== messageId),
      };
    });
    setConversationError(targetConversationId, null);

    try {
      const response = await fetch(
        `/api/message?conversationId=${encodeURIComponent(
          targetConversationId,
        )}&messageId=${encodeURIComponent(messageId)}`,
        { method: "DELETE" },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.message || "删除消息失败。");
      }
    } catch (requestError) {
      setMessagesByConversation(previousMessagesByConversation);
      setErrorsByConversation(previousErrorsByConversation);
      setConversationError(
        targetConversationId,
        requestError instanceof Error ? requestError.message : "删除消息失败。",
      );
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    window.location.href = "/login";
  }

  function copyMessage(message: Message) {
    setCopiedMessageId(message.id);
    window.setTimeout(() => setCopiedMessageId(null), 1200);
    void writeClipboardText(messageClipboardText(message)).catch(() => undefined);
  }

  function regenerate() {
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    if (lastUser) {
      void sendMessage(lastUser.content);
    }
  }

  function promoteConversation(nextConversation: ConversationSummary) {
    setConversations((current) => [
      nextConversation,
      ...current.filter((conversation) => conversation.id !== nextConversation.id),
    ]);
  }

  function setConversationMessages(targetConversationId: string, nextMessages: Message[]) {
    setMessagesByConversation((current) => ({
      ...current,
      [targetConversationId]: nextMessages,
    }));
  }

  function setConversationError(targetConversationId: string, message: string | null) {
    setErrorsByConversation((current) => ({
      ...current,
      [targetConversationId]: message,
    }));
  }

  const sidebarContent = (
    <>
      <button
        type="button"
        onClick={() => void clearConversation()}
        className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-medium text-white transition hover:bg-zinc-800"
      >
        <PanelLeft size={16} />
        新建会话
      </button>

      <div className="mt-4 flex min-h-0 flex-1 flex-col rounded-lg border border-zinc-200 bg-white">
        <div className="border-b border-zinc-100 px-3 py-3">
          <div className="text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
            最近
          </div>
        </div>

        <div className="app-scrollbar-none min-h-0 flex-1 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <div className="px-2 py-4 text-xs leading-5 text-zinc-400">暂无会话</div>
          ) : (
            <div className="space-y-1">
              {conversations.map((conversation) => {
                const isActive = conversation.id === conversationId;
                const isRunningConversation =
                  Boolean(runningConversations[conversation.id]) ||
                  activeImageJobs.some((job) => job.conversationId === conversation.id);

                return (
                  <div
                    key={conversation.id}
                    className={`group flex items-start gap-1 rounded-md transition ${
                      isActive ? "bg-zinc-950 text-white" : "text-zinc-700 hover:bg-zinc-50"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => void loadConversation(conversation.id)}
                      className="min-w-0 flex-1 cursor-pointer px-2.5 py-2 text-left"
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        {isRunningConversation && (
                          <Loader2 size={12} className="shrink-0 animate-spin" />
                        )}
                        <div className="line-clamp-1 text-sm font-medium">
                          {conversation.title || "新的会话"}
                        </div>
                      </div>
                      <div
                        className={`mt-1 text-[11px] ${
                          isActive ? "text-zinc-300" : "text-zinc-400"
                        }`}
                      >
                        {formatConversationTime(conversation.updatedAt)}
                      </div>
                    </button>
                    <button
                      type="button"
                      className={`mr-1 mt-1.5 inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md opacity-100 transition hover:bg-red-50 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100 ${
                        isActive ? "text-zinc-300" : "text-zinc-400"
                      }`}
                      aria-label="删除会话"
                      title="删除会话"
                      onClick={() => setDeleteTarget(conversation)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="mt-auto">
        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-zinc-600">
            <UserRound size={14} />
            当前账号
          </div>
          <div className="truncate text-sm text-zinc-900">{user.email}</div>
        </div>
      </div>
    </>
  );

  return (
    <div className="fixed inset-0 flex overflow-hidden bg-[#f7f7f5] text-zinc-950">
      <aside className="hidden w-72 shrink-0 border-r border-zinc-200 bg-[#fbfbfa] p-3 lg:flex lg:flex-col">
        <button
          type="button"
          onClick={() => void clearConversation()}
          className="flex h-10 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-medium text-white transition hover:bg-zinc-800"
        >
          <PanelLeft size={16} />
          新建会话
        </button>

        <div className="mt-4 flex min-h-0 flex-1 flex-col rounded-lg border border-zinc-200 bg-white">
          <div className="border-b border-zinc-100 px-3 py-3">
            <div className="text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
              最近
            </div>
          </div>

          <div className="app-scrollbar-none min-h-0 flex-1 overflow-y-auto p-2">
            {conversations.length === 0 ? (
              <div className="px-2 py-4 text-xs leading-5 text-zinc-400">暂无会话</div>
            ) : (
              <div className="space-y-1">
                {conversations.map((conversation) => {
                  const isActive = conversation.id === conversationId;
                  const isRunningConversation =
                    Boolean(runningConversations[conversation.id]) ||
                    activeImageJobs.some((job) => job.conversationId === conversation.id);

                  return (
                    <div
                    key={conversation.id}
                      className={`group flex items-start gap-1 rounded-md transition ${
                      isActive
                        ? "bg-zinc-950 text-white"
                        : "text-zinc-700 hover:bg-zinc-50"
                    }`}
                  >
                      <button
                        type="button"
                        onClick={() => void loadConversation(conversation.id)}
                        className="min-w-0 flex-1 cursor-pointer px-2.5 py-2 text-left"
                      >
                        <div className="flex min-w-0 items-center gap-1.5">
                          {isRunningConversation && (
                            <Loader2 size={12} className="shrink-0 animate-spin" />
                          )}
                          <div className="line-clamp-1 text-sm font-medium">
                            {conversation.title || "新的会话"}
                          </div>
                        </div>
                        <div
                          className={`mt-1 text-[11px] ${
                            isActive ? "text-zinc-300" : "text-zinc-400"
                          }`}
                        >
                          {formatConversationTime(conversation.updatedAt)}
                        </div>
                      </button>
                      <button
                        type="button"
                        className={`mr-1 mt-1.5 inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md opacity-100 transition hover:bg-red-50 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100 ${
                          isActive ? "text-zinc-300" : "text-zinc-400"
                        }`}
                        aria-label="删除会话"
                        title="删除会话"
                        onClick={() => setDeleteTarget(conversation)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="mt-auto">
          <div className="rounded-lg border border-zinc-200 bg-white p-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-zinc-600">
              <UserRound size={14} />
              当前账号
            </div>
            <div className="truncate text-sm text-zinc-900">{user.email}</div>
          </div>
        </div>
      </aside>

      {isMobileSidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-black/35 backdrop-blur-[1px]"
            aria-label="关闭会话侧栏"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-[min(20rem,calc(100vw-3rem))] flex-col border-r border-zinc-200 bg-[#fbfbfa] p-3 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <BrandMark size="sm" />
                <div className="truncate text-sm font-semibold text-zinc-950">
                  Pigou AI Console
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileSidebarOpen(false)}
                className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-950"
                aria-label="关闭会话侧栏"
              >
                <X size={15} />
              </button>
            </div>
            {sidebarContent}
          </aside>
        </div>
      )}

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 bg-white/80 px-3 backdrop-blur sm:px-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen(true)}
              className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-950 lg:hidden"
              aria-label="打开会话列表"
              title="打开会话列表"
            >
              <PanelLeft size={16} />
            </button>
            <BrandMark size="sm" />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold text-zinc-950">Pigou AI Console</h1>
              <p className="truncate text-xs text-zinc-500">
                {model} · 推理{reasoningLabel(reasoningEffort)} · 自动识别意图
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-600 sm:inline-flex">
              <UserRound size={13} />
              <span className="max-w-44 truncate">{user.email}</span>
            </div>
            <StatusPill error={!!error} label={statusLabel} />
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-950"
              aria-label="退出登录"
              title="退出登录"
            >
              <LogOut size={15} />
            </button>
            <button
              type="button"
              onClick={() => void clearConversation()}
              className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-950 lg:hidden"
              aria-label="新建会话"
              title="新建会话"
            >
              <Plus size={16} />
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="app-scrollbar-none relative min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-6">
          <div className="mx-auto flex max-w-4xl flex-col gap-4">
            {messages.map((message) => {
              const messageTime = formatMessageTime(message.createdAt);
              const messageDurationMs = getMessageDurationMs(message, now);
              const canDeleteMessage = !isSeedMessage(message);

              return (
                <article
                  key={message.id}
                  className={
                    message.role === "user"
                      ? "group ml-auto max-w-[84%] rounded-2xl rounded-br-md bg-zinc-950 px-4 py-3 text-sm leading-6 text-white shadow-sm"
                      : "group max-w-[92%] rounded-2xl rounded-bl-md border border-zinc-200 bg-white px-4 py-3 text-sm leading-6 text-zinc-800 shadow-sm"
                  }
                >
                {message.role === "assistant" && (
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-zinc-500">
                      <Bot size={14} />
                      <span>Assistant</span>
                      {messageTime && <span className="font-normal text-zinc-400">{messageTime}</span>}
                      {!isRunningMessage(message) && messageDurationMs !== null && (
                        <span className="font-normal text-zinc-400">
                          耗时 {formatElapsed(messageDurationMs)}
                        </span>
                      )}
                      {isRunningMessage(message) && (
                        <Loader2 size={13} className="animate-spin text-zinc-400" />
                      )}
                    </div>
                  </div>
                )}

                {message.role === "assistant" &&
                  isRunningMessage(message) &&
                  !message.content &&
                  (!message.images || message.images.length === 0) && (
                    message.imageJobId ? (
                      <ImageJobWaiting
                        status={message.imageJobStatus}
                        startedAt={message.imageJobStartedAt}
                        now={now}
                      />
                    ) : isPlaceholderThinking(message.thinking) ? (
                      <AssistantWaiting />
                    ) : null
                  )}

                {message.role === "assistant" &&
                  message.thinking &&
                  !(
                    isRunningMessage(message) &&
                    !message.content &&
                    (!message.images || message.images.length === 0) &&
                    isPlaceholderThinking(message.thinking)
                  ) && (
                    <ThinkingPanel
                      key={`${message.id}-${isRunningMessage(message) ? "running" : "done"}`}
                      thinking={message.thinking}
                      isRunning={isRunningMessage(message)}
                    />
                  )}

                {message.content && (
                  <div className={message.role === "user" ? "whitespace-pre-wrap" : "markdown-body"}>
                    {message.role === "user" ? message.content : <MarkdownMessage content={message.content} />}
                  </div>
                )}

                {message.role === "user" && (
                  <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-zinc-400">
                    {messageTime && <span>{messageTime}</span>}
                    <button
                      type="button"
                      onClick={() => copyMessage(message)}
                      className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 opacity-80 transition hover:bg-white/10 hover:text-white group-hover:opacity-100"
                      aria-label="复制消息"
                      title="复制消息"
                    >
                      {copiedMessageId === message.id ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                    {canDeleteMessage && (
                      <button
                        type="button"
                        onClick={() => setDeleteMessageTarget({ conversationId, message })}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md opacity-80 transition hover:bg-white/10 hover:text-red-200 group-hover:opacity-100"
                        aria-label="删除消息"
                        title="删除消息"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                )}

                {message.role === "assistant" && <SourceLinks content={message.content} />}

                {message.images && message.images.length > 0 && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {message.images.map((image, index) => (
                      <figure
                        key={`${message.id}-image-${index}`}
                        className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50"
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedImage({ image, messageId: message.id, index })}
                          className="group/image relative block w-full overflow-hidden text-left"
                          aria-label="打开图片预览"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={imageSource(image)}
                            alt={image.revisedPrompt || "AI 生成图片"}
                            className="aspect-square w-full object-cover transition duration-200 group-hover/image:scale-[1.02]"
                          />
                          <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/55 px-3 py-2 text-xs text-white opacity-0 transition group-hover/image:opacity-100">
                            <span>点击预览</span>
                            <ExternalLink size={13} />
                          </span>
                        </button>
                        {image.revisedPrompt && (
                          <figcaption className="border-t border-zinc-200 px-3 py-2 text-xs leading-5 text-zinc-500">
                            {image.revisedPrompt}
                          </figcaption>
                        )}
                      </figure>
                    ))}
                  </div>
                )}

                {message.usage && message.usage.totalTokens > 0 && (
                  <div className="mt-3 text-xs text-zinc-400">
                    tokens {message.usage.totalTokens}
                    {message.usage.reasoningTokens > 0
                      ? ` · reasoning ${message.usage.reasoningTokens}`
                      : ""}
                  </div>
                )}

                {message.error && (
                  <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {message.error}
                  </div>
                )}

                {message.role === "assistant" && (
                  <div className="mt-3 flex items-center justify-end gap-1 border-t border-zinc-100 pt-2">
                    <button
                      type="button"
                      onClick={() => copyMessage(message)}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950"
                      aria-label="复制回答"
                      title="复制回答"
                    >
                      {copiedMessageId === message.id ? <Check size={13} /> : <Copy size={13} />}
                      {copiedMessageId === message.id ? "已复制" : "复制"}
                    </button>
                    {canDeleteMessage && (
                      <button
                        type="button"
                        onClick={() => setDeleteMessageTarget({ conversationId, message })}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-red-50 hover:text-red-600"
                        aria-label="删除消息"
                        title="删除消息"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                )}
              </article>
              );
            })}
          </div>
        </div>

        {selectedImage && (
          <ImagePreviewDialog
            selectedImage={selectedImage}
            onClose={() => setSelectedImage(null)}
          />
        )}

        {deleteTarget && (
          <DeleteConversationDialog
            conversation={deleteTarget}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={() => {
              const target = deleteTarget;
              setDeleteTarget(null);
              void deleteConversation(target.id);
            }}
          />
        )}

        {deleteMessageTarget && (
          <DeleteMessageDialog
            message={deleteMessageTarget.message}
            onCancel={() => setDeleteMessageTarget(null)}
            onConfirm={() => {
              const target = deleteMessageTarget;
              setDeleteMessageTarget(null);
              void deleteMessage(target.conversationId, target.message.id);
            }}
          />
        )}

        <section className="shrink-0 border-t border-zinc-200 bg-[#fbfbfa] p-3 sm:p-4">
          <div className="mx-auto max-w-4xl">
            {error && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="rounded-[28px] border border-zinc-200 bg-white p-3 shadow-sm">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder="输入问题，也可以直接描述要生成的图片；Enter 发送，Shift+Enter 换行"
                className="max-h-44 min-h-16 w-full resize-none rounded-2xl px-3 py-2 text-sm leading-6 text-zinc-950 outline-none placeholder:text-zinc-400"
                disabled={isStreaming}
              />

              <div className="flex items-center justify-between gap-3 px-1 pt-2">
                <div className="flex min-w-0 items-center gap-2 text-xs text-zinc-500">
                  <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 text-zinc-600">
                    <Globe2 size={13} />
                    联网自动
                  </span>
                  <button
                    type="button"
                    onClick={regenerate}
                    disabled={isStreaming || !messages.some((message) => message.role === "user")}
                    className="hidden h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 sm:inline-flex"
                  >
                    <RefreshCcw size={14} />
                    重新生成
                  </button>
                </div>

                <div className="relative flex items-center gap-2">
                  <label className="sr-only" htmlFor="model-select">
                    模型
                  </label>
                  <select
                    id="model-select"
                    value={model}
                    onChange={(event) => setModel(event.target.value as Model)}
                    className="h-9 rounded-full border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 outline-none transition hover:bg-zinc-50 focus:border-zinc-400"
                    disabled={isStreaming}
                  >
                    {MODELS.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                  <label className="sr-only" htmlFor="reasoning-effort-select">
                    推理强度
                  </label>
                  <select
                    id="reasoning-effort-select"
                    value={reasoningEffort}
                    onChange={(event) => setReasoningEffort(event.target.value as ReasoningEffort)}
                    className="h-9 rounded-full border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 outline-none transition hover:bg-zinc-50 focus:border-zinc-400"
                    disabled={isStreaming}
                  >
                    {REASONING_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>
                        推理 {item.label}
                      </option>
                    ))}
                  </select>

                  {isStreaming ? (
                    <button
                      type="button"
                      onClick={stopRequest}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-white transition hover:bg-zinc-700"
                      aria-label="停止"
                    >
                      <Square size={15} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void sendMessage()}
                      disabled={!input.trim()}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-zinc-950 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                      aria-label="发送"
                    >
                      <Send size={16} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function StatusPill({ error, label }: { error: boolean; label: string }) {
  return (
    <div
      className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium ${
        error
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-700"
      }`}
    >
      {error ? <WifiOff size={13} /> : <Wifi size={13} />}
      {label}
    </div>
  );
}

function DeleteConversationDialog({
  conversation,
  onCancel,
  onConfirm,
}: {
  conversation: ConversationSummary;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="删除会话确认"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
            <Trash2 size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-zinc-950">删除会话</div>
            <div className="mt-1 line-clamp-2 text-sm leading-5 text-zinc-600">
              {conversation.title || "新的会话"}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="关闭"
          >
            <X size={15} />
          </button>
        </div>

        <div className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm leading-5 text-red-700">
          删除后会从历史列表移除该会话。
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-red-600 px-3 text-sm font-medium text-white transition hover:bg-red-500"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteMessageDialog({
  message,
  onCancel,
  onConfirm,
}: {
  message: Message;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="删除消息确认"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
            <Trash2 size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-zinc-950">删除消息</div>
            <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-5 text-zinc-600">
              {messageDeletePreview(message)}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="关闭"
          >
            <X size={15} />
          </button>
        </div>

        <div className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm leading-5 text-red-700">
          删除后会从当前会话中移除该条消息。
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-red-600 px-3 text-sm font-medium text-white transition hover:bg-red-500"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

function ThinkingPanel({
  thinking,
  isRunning,
}: {
  thinking: string;
  isRunning: boolean;
}) {
  return (
    <details
      open={isRunning || undefined}
      className="mb-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600"
    >
      <summary className="cursor-pointer font-medium text-zinc-700">思考过程</summary>
      <div className="mt-2 whitespace-pre-wrap leading-5">{thinking}</div>
    </details>
  );
}

function ImagePreviewDialog({
  selectedImage,
  onClose,
}: {
  selectedImage: SelectedImage;
  onClose: () => void;
}) {
  const { image, index } = selectedImage;
  const fileName = imageFileName(index);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-200 px-4">
          <div className="min-w-0 text-sm font-medium text-zinc-800">图片预览</div>
          <div className="flex items-center gap-2">
            <a
              href={imageDownloadHref(image, fileName)}
              download={fileName}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-3 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
            >
              <Download size={14} />
              下载
            </a>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-950"
              aria-label="关闭图片预览"
            >
              <X size={15} />
            </button>
          </div>
        </div>
        <div className="min-h-0 overflow-auto bg-zinc-950 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageSource(image)}
            alt={image.revisedPrompt || "AI 生成图片"}
            className="mx-auto max-h-[72dvh] max-w-full rounded-lg object-contain"
          />
        </div>
        {image.revisedPrompt && (
          <div className="shrink-0 border-t border-zinc-200 px-4 py-3 text-xs leading-5 text-zinc-500">
            {image.revisedPrompt}
          </div>
        )}
      </div>
    </div>
  );
}

function AssistantWaiting() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-zinc-500 shadow-sm">
          <Loader2 size={15} className="animate-spin" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-zinc-800">思考中</div>
        </div>
      </div>
    </div>
  );
}

function ImageJobWaiting({
  status,
  startedAt,
  now,
}: {
  status: ImageJobStatus | null | undefined;
  startedAt: number | undefined;
  now: number;
}) {
  const elapsedMs = startedAt ? Math.max(0, now - startedAt) : 0;
  const statusText =
    status === "queued" ? "排队中" : status === "running" ? "生成中" : "准备中";

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50">
      <div className="flex items-start gap-3 px-3 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-zinc-500 shadow-sm">
          <Loader2 size={16} className="animate-spin" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <div className="text-sm font-medium text-zinc-900">图片生成中</div>
            <div className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] text-zinc-500">
              {statusText}
            </div>
            {startedAt && (
              <div className="text-[11px] text-zinc-400">
                已用时 {formatElapsed(elapsedMs)}
              </div>
            )}
          </div>
          <div className="mt-2 grid gap-2 text-xs text-zinc-500 sm:grid-cols-3">
            <ImageJobStep active done label="提交任务" />
            <ImageJobStep active={status === "queued" || status === "running"} label="生成图片" />
            <ImageJobStep label="自动展示" />
          </div>
        </div>
      </div>
      <div className="border-t border-zinc-200 bg-white/70 px-3 py-3">
        <div className="relative aspect-[16/9] overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
          <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-zinc-100 via-white to-zinc-200" />
          <div className="absolute left-4 top-4 h-3 w-40 rounded-full bg-zinc-200" />
          <div className="absolute left-4 top-10 h-2 w-28 rounded-full bg-zinc-200" />
          <div className="absolute inset-x-4 bottom-5 h-24 rounded-lg border border-dashed border-zinc-300 bg-white/50" />
          <div className="absolute bottom-0 left-0 h-1 w-full overflow-hidden bg-zinc-200">
            <div className="h-full w-1/2 animate-[pigou-progress_1.4s_ease-in-out_infinite] bg-zinc-900" />
          </div>
        </div>
        <div className="mt-2 text-xs leading-5 text-zinc-500">
          图片请求已提交到后台，完成后会自动替换为生成结果。
        </div>
      </div>
    </div>
  );
}

function ImageJobStep({
  active,
  done,
  label,
}: {
  active?: boolean;
  done?: boolean;
  label: string;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 ${
        active || done
          ? "border-zinc-300 bg-white text-zinc-700"
          : "border-zinc-200 bg-zinc-50 text-zinc-400"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          done ? "bg-emerald-500" : active ? "animate-pulse bg-zinc-900" : "bg-zinc-300"
        }`}
      />
      <span>{label}</span>
    </div>
  );
}

function SourceLinks({ content }: { content: string }) {
  const links = extractSourceLinks(content);
  if (links.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 text-xs">
      <span className="font-medium text-zinc-500">来源</span>
      {links.map((link) => (
        <a
          key={link.url}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 py-1 text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-950"
        >
          <span className="max-w-40 truncate">{link.label}</span>
          <ExternalLink size={12} />
        </a>
      ))}
    </div>
  );
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function currentTimestamp() {
  return new Date().getTime();
}

function readStoredSettings(): {
  model: Model;
  reasoningEffort: ReasoningEffort;
} {
  const fallback = {
    model: "gpt-5.5" as Model,
    reasoningEffort: "medium" as ReasoningEffort,
  };

  if (typeof window === "undefined") {
    return fallback;
  }

  const stored = window.localStorage.getItem(SETTINGS_KEY);
  if (!stored) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(stored) as {
      model?: Model;
      reasoningEffort?: ReasoningEffort;
    };

    return {
      model: parsed.model && MODELS.includes(parsed.model) ? parsed.model : fallback.model,
      reasoningEffort: isReasoningEffort(parsed.reasoningEffort)
        ? parsed.reasoningEffort
        : fallback.reasoningEffort,
    };
  } catch {
    window.localStorage.removeItem(SETTINGS_KEY);
    return fallback;
  }
}

function readConversationCache(key: string): ConversationCache | null {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = window.localStorage.getItem(key);
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<ConversationCache>;
    if (!Array.isArray(parsed.conversations) || !parsed.messagesByConversation) {
      return null;
    }

    return {
      conversations: parsed.conversations.filter(isConversationSummary).slice(0, 50),
      messagesByConversation: sanitizeCachedMessagesByConversation(
        parsed.messagesByConversation,
      ),
      updatedAt:
        typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}

function writeConversationCache(key: string, cache: ConversationCache) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(cache));
  } catch {
    window.localStorage.removeItem(key);
  }
}

function mergeCachedMessages(
  current: Record<string, Message[]>,
  cached: Record<string, Message[]>,
) {
  const next = { ...current };

  for (const [conversationId, cachedMessages] of Object.entries(cached)) {
    const currentMessages = next[conversationId];
    if (!hasCachedMessages(currentMessages) && cachedMessages.length > 0) {
      next[conversationId] = cachedMessages;
    }
  }

  return next;
}

function compactMessagesByConversation(
  messagesByConversation: Record<string, Message[]>,
) {
  const compacted: Record<string, Message[]> = {};

  for (const [conversationId, messages] of Object.entries(messagesByConversation)) {
    const compactedMessages = withoutSeedMessages(messages)
      .slice(-40)
      .map(compactMessageForCache);
    if (compactedMessages.length > 0) {
      compacted[conversationId] = compactedMessages;
    }
  }

  return compacted;
}

function sanitizeCachedMessagesByConversation(value: unknown) {
  const result: Record<string, Message[]> = {};
  if (!value || typeof value !== "object") {
    return result;
  }

  for (const [conversationId, messages] of Object.entries(value)) {
    if (!Array.isArray(messages)) {
      continue;
    }
    const sanitizedMessages = messages
      .filter(isMessage)
      .map((message) => {
        if (isRunningMessage(message) && !message.imageJobId) {
          return {
            ...message,
            status: "done" as const,
            thinking: message.thinking === "思考中..." ? null : message.thinking,
          };
        }
        return message;
      })
      .filter((message) => !isSeedMessage(message));

    if (sanitizedMessages.length > 0) {
      result[conversationId] = sanitizedMessages.slice(-40);
    }
  }

  return result;
}

function compactMessageForCache(message: Message): Message {
  const cacheableMessage = { ...message };
  delete cacheableMessage.rawContent;
  return {
    ...cacheableMessage,
    images: message.images?.map(compactImageForCache),
  };
}

function compactImageForCache(image: GeneratedImage): GeneratedImage {
  if (image.url) {
    return {
      mimeType: image.mimeType,
      url: image.url,
      revisedPrompt: image.revisedPrompt,
    };
  }

  if (image.base64 && image.base64.length <= 200_000) {
    return image;
  }

  return {
    mimeType: image.mimeType,
    revisedPrompt: image.revisedPrompt,
  };
}

function isConversationSummary(value: unknown): value is ConversationSummary {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    (record.model === "gpt-5.5" || record.model === "gpt-5.4") &&
    (record.mode === "chat" || record.mode === "image" || record.mode === "search") &&
    typeof record.updatedAt === "string"
  );
}

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    (record.role === "user" || record.role === "assistant") &&
    typeof record.content === "string"
  );
}

function appendThinking(current: string | null | undefined, delta: string) {
  if (!current || current === "思考中...") {
    return delta;
  }
  return `${current}${delta}`;
}

function mergeStreamingTextDelta(message: Message, delta: string): Partial<Message> {
  const rawContent = `${message.rawContent ?? message.content}${delta}`;
  const extracted = extractStreamingThinkingFromContent(rawContent);
  if (!extracted) {
    return {
      rawContent,
      content: rawContent,
    };
  }

  return {
    rawContent,
    content: extracted.content,
    thinking: extracted.thinking || message.thinking,
  };
}

function extractStreamingThinkingFromContent(content: string): {
  thinking: string | null;
  content: string;
} | null {
  const normalized = content.trimStart();
  const marker = normalized.match(/^(?:#+\s*)?(?:思路摘要|思考过程|分析过程)[:：]?\s*/);
  if (!marker) {
    return null;
  }

  const rest = normalized.slice(marker[0].length);
  const split = rest.search(
    /\n\s*(?:#+\s*)?(?:回答|结论|步骤|正文|具体回答|最终回答)[:：]\s*/,
  );
  if (split === -1) {
    return {
      thinking: rest.trim() || "思考中...",
      content: "",
    };
  }

  return extractVisibleThinkingFromContent(content);
}

function reasoningLabel(value: ReasoningEffort) {
  return REASONING_OPTIONS.find((item) => item.value === value)?.label ?? "中";
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === "low" || value === "medium" || value === "high";
}

function isRunningMessage(message: Message) {
  return message.status === "streaming" || message.status === "running";
}

function isPlaceholderThinking(thinking: string | null | undefined) {
  return !thinking || thinking === "思考中...";
}

function displayMessages(messages: Message[] | undefined) {
  return messages && messages.length > 0 ? messages : seedMessages;
}

function isSeedMessage(message: Message) {
  return message.id === "welcome";
}

function withoutSeedMessages(messages: Message[]) {
  return messages.filter((message) => !isSeedMessage(message));
}

function hasCachedMessages(messages: Message[] | undefined) {
  return Boolean(messages && withoutSeedMessages(messages).length > 0);
}

function shouldSetInitialTitle(title: string | undefined, currentMessages: Message[]) {
  return (
    (!title || title === DEFAULT_CONVERSATION_TITLE) &&
    !currentMessages.some((message) => message.role === "user")
  );
}

function imageSource(image: GeneratedImage) {
  return image.url ?? `data:${image.mimeType};base64,${image.base64 ?? ""}`;
}

function imageDownloadHref(image: GeneratedImage, fileName: string) {
  if (!image.url) {
    return imageSource(image);
  }

  return `/api/image-download?url=${encodeURIComponent(image.url)}&name=${encodeURIComponent(fileName)}`;
}

function imageFileName(index: number) {
  return `pigou-image-${index + 1}.png`;
}

function parseJobTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatElapsed(valueMs: number) {
  const totalSeconds = Math.max(0, Math.floor(valueMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}m ${seconds
      .toString()
      .padStart(2, "0")}s`;
  }
  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function elapsedSince(value: string | null | undefined) {
  const timestamp = parseJobTime(value);
  if (!timestamp) {
    return null;
  }

  return Math.max(0, currentTimestamp() - timestamp);
}

function withUsageDuration(
  usage: Usage | undefined,
  durationMs: number | null | undefined,
): Usage | undefined {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    return usage;
  }

  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    reasoningTokens: usage?.reasoningTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    durationMs: Math.max(0, Math.round(durationMs)),
  };
}

function durationFromJobTimestamps(job: ImageJobSnapshot) {
  const startedAt = parseJobTime(job.createdAt);
  const completedAt = parseJobTime(job.completedAt);
  if (!startedAt || !completedAt) {
    return null;
  }

  return Math.max(0, completedAt - startedAt);
}

function getMessageDurationMs(message: Message, now: number) {
  if (typeof message.durationMs === "number" && Number.isFinite(message.durationMs)) {
    return message.durationMs;
  }
  if (typeof message.usage?.durationMs === "number" && Number.isFinite(message.usage.durationMs)) {
    return message.usage.durationMs;
  }

  const createdAt = parseJobTime(message.createdAt);
  if (message.role === "assistant" && isRunningMessage(message) && createdAt) {
    return Math.max(0, now - createdAt);
  }

  return null;
}

function isActiveImageJobStatus(status: ImageJobStatus | null | undefined) {
  return status === "queued" || status === "running";
}

function collectActiveImageJobs(messagesByConversation: Record<string, Message[]>) {
  const jobs: Array<{ conversationId: string; messageId: string; jobId: string }> = [];

  for (const [conversationId, messages] of Object.entries(messagesByConversation)) {
    for (const message of messages) {
      if (
        message.role === "assistant" &&
        message.imageJobId &&
        (isActiveImageJobStatus(message.imageJobStatus) || isRunningMessage(message))
      ) {
        jobs.push({
          conversationId,
          messageId: message.id,
          jobId: message.imageJobId,
        });
      }
    }
  }

  return jobs;
}

function extractSourceLinks(content: string) {
  const matches = content.match(/https?:\/\/[^\s)\]}>，。；、]+/g) ?? [];
  const uniqueUrls = [...new Set(matches)].slice(0, 6);

  return uniqueUrls
    .map((url) => {
      try {
        const parsed = new URL(url);
        return {
          url,
          label: parsed.hostname.replace(/^www\./, ""),
        };
      } catch {
        return null;
      }
    })
    .filter((link): link is { url: string; label: string } => Boolean(link));
}

function formatConversationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const now = new Date();
  const dayFormatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const sameDay = dayFormatter.format(date) === dayFormatter.format(now);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    ...(sameDay ? {} : { month: "2-digit", day: "2-digit" }),
  }).format(date);
}

function formatMessageTime(value: string | undefined) {
  return value ? formatConversationTime(value) : "";
}

function messageClipboardText(message: Message) {
  const parts = [message.content.trim()].filter(Boolean);
  const prompts =
    message.images
      ?.map((image, index) =>
        image.revisedPrompt ? `图片 ${index + 1}：${image.revisedPrompt}` : "",
      )
      .filter(Boolean) ?? [];

  return [...parts, ...prompts].join("\n\n") || "图片消息";
}

async function writeClipboardText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // 某些内嵌浏览器或非安全上下文会拒绝 Clipboard API，保留传统复制路径给用户明确反馈。
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function messageDeletePreview(message: Message) {
  const text = messageClipboardText(message).replace(/\s+/g, " ").trim();
  if (!text) {
    return message.role === "assistant" ? "Assistant 消息" : "用户消息";
  }

  return text.length > 120 ? `${text.slice(0, 120)}...` : text;
}

function inferConversationModeForUi(text: string): ConversationSummary["mode"] {
  const lowerText = text.toLowerCase();
  if (/^\/(?:image|img|draw)\b/.test(lowerText)) {
    return "image";
  }
  if (/^\/(?:search|web)\b/.test(lowerText)) {
    return "search";
  }
  if (/(?:最新|今天|现在|实时|新闻|搜索|查一下|联网|网上|价格|天气|股价|汇率)/.test(text)) {
    return "search";
  }
  if (
    !/(?:mermaid|svg|html|css|ascii|代码|流程图|时序图|架构图)/i.test(lowerText) &&
    /(?:生成|画|绘制|画出|创建|制作|设计).{0,60}(?:图片|图像|插画|画|画作|绘画|油画|水彩|素描|海报|头像|logo|照片|壁纸|画面)|(?:画|绘制|画出)\s*(?:一只|一个|一位|一辆|一朵|一座|一幅|一副|一张|一艘|一条|一片|一架|一栋|一间)/i.test(
      text,
    )
  ) {
    return "image";
  }
  return "chat";
}
