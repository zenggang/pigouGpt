# Pigou AI Console 功能规格

状态：Draft v1.0
日期：2026-07-05
负责人：PigouGpt

## 1. 背景

Pigou AI Console 是一个部署到 Vercel 的轻量 AI 问答工作台。项目使用已有的 Sub2API 兼容网关。

- P0 推荐：`SUB2API_BASE_URL=https://your-sub2api-host.example.com/ai/v1`
- 域名入口待修复：`https://your-sub2api-domain.example.com/ai/v1`
- 服务端默认请求地址：`POST ${SUB2API_BASE_URL}/responses`
- `SUB2API_KEY` 只允许配置在本地 `.env.local` 和 Vercel 环境变量中。

说明：当前 `your-sub2api-domain.example.com` 域名入口在常见 Node/curl 客户端下会出现 HTTPS `ECONNRESET`，但 IP 入口 `https://your-sub2api-host.example.com/ai/v1` 已验证可被 Node `fetch` 正常访问。P0 为保证 Vercel 可运行，服务端 base URL 先使用 IP 入口；后续域名 TLS/SNI 问题修复后再切回域名。

浏览器端不能接触、输出或打包 `SUB2API_KEY`。所有模型请求必须经过 Next.js 服务端 API Route 转发。

当前本地仓库是一个空 git 仓库。如果实现阶段仍无项目文件，应按现代 Next.js + TypeScript 最佳实践初始化项目。

2026-07-06 追加范围：网站增加登录体系和 MySQL 持久化。注册不开放，允许登录的邮箱账号由数据库配置，首批账号为 `admin@example.com`、`operator@example.com`。数据库目标为 ECS 上的 MySQL，项目使用单独数据库 `your_app_database`。Vercel 不直连 3306，生产通过 ECS 上的 `pigou-db-api` 访问本机 MySQL。

## 2. 产品目标

构建一个第一屏即工作台的 AI 问答网站，名称暂定为 `Pigou AI Console`。整体风格参考 Vercel、Linear、Claude 的工具型界面：安静、专业、轻量，不做营销首页。

P0 体验目标接近基础 GPT 单会话：

- 支持邮箱 + 密码登录。
- 不开放注册，只有数据库启用账号可以登录。
- 支持 MySQL 持久化用户、session、会话、消息和 AI 响应元数据。
- 支持 Vercel 服务端通过 `DATABASE_API_BASE_URL` + `DATABASE_API_KEY` 调用 ECS 数据库 API。
- 支持历史会话列表，用户可以切换、删除会话，并继续多轮文本对话。
- 支持多个会话同时生成：一个会话运行中时，可以切换到其他会话继续发送。
- 支持 Markdown、代码块、复制、加载中、错误提示。
- 支持主动联网搜索：非图片问答默认向模型提供 `web_search` 工具；开放世界、资料查询、推荐对比、价格政策新闻等问题由模型主动联网核验。
- 支持通过自然语言意图生成图片，不提供单独生图按钮。
- 支持 Thinking 面板：展示思考中状态、可公开 reasoning summary 或最终回答里的简短思路摘要；不伪造隐藏内部推理。
- 支持推理强度选择：低 / 中 / 高。

## 3. 范围

### 3.1 P0 范围内

- 初始化或补齐 Next.js + TypeScript 项目，并适配 Vercel 部署。
- 用户级历史会话列表，支持删除。
- 单个会话内支持多轮上下文，支持切换历史会话继续追问。
- 会话级并发：每个会话独立维护请求状态和停止控制。
- 服务端 API Route 调用 Sub2API，前端只调用本项目 API。
- 文本回答固定使用流式输出，不提供关闭选项。
- 模型选择器：
  - 默认：`gpt-5.5`
  - 可用选项：`gpt-5.5`、`gpt-5.4`
  - `gpt-5.4` 以下模型不验证、不展示、不调用。
- 消息展示：
  - Markdown
  - fenced code block
  - inline code
  - 整段回答复制按钮
  - 代码块复制按钮
  - AI 生成图片输出展示
  - 错误状态展示
- 输入区：
  - `Enter` 发送
  - `Shift+Enter` 换行
  - 模型选择器放在输入区工具条
  - 输入条视觉参考 ChatGPT：圆角组合输入框，模型选择在发送按钮附近
  - 模型选择和推理强度选择都放在输入区工具条
  - 联网搜索由模型在服务端工具上下文中主动判断；开放世界问题默认先联网核验，也保留 `/search`、`/web`、`/browse` 命令式触发方式
  - 图片生成由服务端根据最近用户消息意图自动识别，也保留 `/image`、`/img`、`/draw` 命令式触发方式
- 环境文件：
  - `.env.local` 必须加入 `.gitignore`
  - `.env.example` 只放占位值，不放真实 key
- README：
  - 本地启动
  - 环境变量
  - Vercel 部署配置
  - 网关兼容性说明

### 3.2 当前不做

- 团队共享。
- 多个持久化会话列表。
- 计费或用量管理 UI。
- Sub2API 管理后台。
- 浏览器直连 Sub2API。
- 修改或部署 Sub2API / 118 机器。
- 传图读图、图片附件上传和 vision 路由排障。
- ChatGPT 全量功能，如 memory、projects、canvas、artifacts、voice、file search、自定义 GPT。

## 3.3 登录和数据库范围

- 登录方式：邮箱 + 密码。
- 注册：不开放。
- 账号来源：MySQL `users` 表，`is_enabled=1` 且有 `password_hash` 才能登录。
- 首批账号：`admin@example.com`、`operator@example.com`。
- 初始化方式：生产环境在 ECS root 侧建库、建最小权限 MySQL 用户并写入首批账号；本地/隧道直连时可通过 `npm run db:setup` 读取 `INITIAL_USER_EMAILS` 和 `INITIAL_USER_PASSWORD` 写入 MySQL。
- session：服务端生成随机 token，浏览器只保存 httpOnly cookie，数据库保存 token hash 和过期时间。
- 数据库：ECS MySQL，单独数据库 `your_app_database`。
- 生产访问：Next.js 服务端调用 `https://your-private-db-api.example.com`，该接口只在服务端配置 API key，接口进程在 ECS 本机访问 `127.0.0.1:3306`。
- 直连回退：仅用于本地、SSH 隧道或其他明确可达的 MySQL 环境；配置了 `DATABASE_API_BASE_URL` 和 `DATABASE_API_KEY` 时，应用不创建直连 MySQL 连接池。
- 持久化数据：
  - 用户白名单和密码 hash
  - 登录 session
  - 当前用户会话
  - 用户消息
  - 助手消息、thinking 摘要、图片 URL JSON、usage、上游 response id
  - AI 生成图片原始文件存放在 ECS `pigou-db-api` 文件目录，MySQL 不保存 base64 大对象。

## 4. 用户体验要求

### 4.1 布局

使用紧凑、安静的工作台布局。

左侧栏：

- 新建会话 / 清空当前会话。
- 历史会话列表，当前会话高亮。
- 点击历史会话加载该会话消息。
- 会话运行中显示小型加载标识。
- 每条历史会话提供删除按钮。

顶部栏：

- `Pigou AI Console`
- 当前模型
- 连接状态
- 当前响应状态：空闲、thinking、流式输出、错误。

主区域：

- 可滚动消息流。
- 空状态仍然是工作台，不做大 hero。
- 用户消息和助手消息清晰区分。
- 助手消息支持 Markdown 和操作按钮。
- 只有实际存在 thinking 数据时才展示 thinking 区域。

底部输入区：

- 多行 textarea。
- 发送按钮。
- 请求进行中显示停止按钮。
- 请求失败时在输入区附近显示简洁错误。

### 4.2 视觉风格

- 内部工具质感，专业克制。
- 中性色、细边框、轻量强调色。
- 不做营销 hero。
- 不使用花哨渐变球、装饰光斑或大面积装饰图形。
- 避免卡片套卡片。
- 桌面和移动端都要稳定，不出现文字溢出或按钮挤压。
- 常见操作使用图标按钮，并提供可理解的 tooltip 或 aria label。

### 4.3 交互细节

- `Enter`：当输入文本非空时发送。
- `Shift+Enter`：插入换行。
- 请求进行中禁用重复发送，除非实现了明确的停止 / 取消逻辑。
- 新建会话会清空当前浏览器侧消息历史。
- Regenerate 尽量复用上一条用户输入重新请求。
- 复制回答时复制 Markdown 源文本。
- 复制代码时只复制对应代码块。

## 5. 会话模型

### 5.1 状态模型

当前维护一个用户级活跃会话：

- React state 负责当前页面交互。
- MySQL 保存会话和消息，刷新后从服务端恢复。
- localStorage 只保存模型等 UI 设置。
- 新建会话会创建新的 `conversations` 记录，当前 UI 切换到空会话。
- 历史会话列表读取 `conversations` 表，按 `updated_at desc` 排序。
- 删除会话删除 `conversations` 记录，并通过外键级联删除该会话下的消息。
- 前端按 `conversationId` 独立维护消息缓存、错误状态、AbortController 和运行状态。

### 5.2 多轮上下文策略

P0 策略：

- 当前 HTTP `/responses` 已确认不支持 `previous_response_id`。
- P0 多轮对话采用“前端保存消息历史，服务端拼接完整上下文”的方式。
- UI 内部消息结构要统一转换为 Responses API input items。
- 后续如果要改成服务端会话状态，需要另行实现 Responses WebSocket v2 或其他可用会话机制。

P0 请求示例：

```json
{
  "model": "gpt-5.5",
  "input": [
    {
      "role": "user",
      "content": [
        { "type": "input_text", "text": "我的代号是 banana，请记住。" }
      ]
    },
    {
      "role": "assistant",
      "content": [
        { "type": "output_text", "text": "已记住。" }
      ]
    },
    {
      "role": "user",
      "content": [
        { "type": "input_text", "text": "我的代号是什么？只回答代号。" }
      ]
    }
  ],
  "stream": true
}
```

## 6. API 契约

### 6.1 前端到本项目服务端

`POST /api/chat`

请求结构：

```json
{
  "conversationId": "uuid",
  "model": "gpt-5.5",
  "conversationStrategy": "full_history",
  "messages": [
    {
      "id": "local-user-1",
      "role": "user",
      "content": "帮我解释一下 Next.js API Route 的作用"
    }
  ],
  "options": {
    "showThinking": true
  }
}
```

流式响应：

- 服务端返回 `text/event-stream`。
- 前端消费本项目归一化后的事件，不直接绑定上游所有事件细节。

归一化事件示例：

```json
{ "type": "text_delta", "delta": "你好" }
{ "type": "thinking_delta", "delta": "正在整理问题..." }
{ "type": "image", "mimeType": "image/png", "base64": "..." }
{ "type": "response_meta", "responseId": "resp_xxx", "usage": { "totalTokens": 123 } }
{ "type": "done" }
{ "type": "error", "message": "认证失败，请检查 SUB2API_KEY" }
```

非流式兜底响应：

```json
{
  "message": {
    "role": "assistant",
    "content": "回答正文",
    "images": [],
    "thinking": null
  },
  "responseId": "resp_xxx",
  "usage": {
    "inputTokens": 0,
    "outputTokens": 0,
    "reasoningTokens": 0,
    "totalTokens": 0
  }
}
```

鉴权要求：

- `/api/chat` 必须有有效 `pigou_session` cookie。
- 会话 ID 必须属于当前登录用户。
- 未登录返回 401。
- 会话不存在或不属于当前用户返回 404。

### 6.2 本项目服务端到 Sub2API

目标地址：

```text
POST ${SUB2API_BASE_URL}/responses
```

默认请求头：

```text
Content-Type: application/json
Authorization: Bearer ${SUB2API_KEY}
```

如果实际网关要求其他认证头，后续只修改服务端 adapter，前端调用契约保持不变。

## 7. 文本对话

### 7.1 请求结构

纯文本用户消息转换为 Responses API input item：

```json
[
  {
    "role": "user",
    "content": [
      { "type": "input_text", "text": "你好，介绍一下你自己" }
    ]
  }
]
```

### 7.2 响应解析

服务端 adapter 需要解析：

- `output_text` 或等价结构里的助手文本。
- 顶层 `id` 作为 `responseId`。
- `usage` 作为 token 用量元数据。
- 响应头里的 request ID 只用于服务端日志。

流式解析至少处理：

- `response.output_text.delta`
- `response.output_text.done`
- `response.completed`
- `response.failed` 或等价错误事件

## 8. 后续传图读图

### 8.1 本期决策

传图读图本期不做，不作为 P0 实现和验收范围，也不继续排查当前 `502` 根因。

保留后续目标：

用户可以在同一轮消息中附加一张或多张图片，并向模型提问。

后续支持文件类型：

- PNG
- JPEG / JPG
- WEBP
- 非动画 GIF，前提是浏览器侧处理简单

后续客户端限制：

- 默认每轮最多 4 张图片。
- 默认每张图片 base64 前最大 10 MB。
- 发送前拦截不支持的 MIME 类型。
- 图片过大时给出明确错误。

服务端将图片附件转换为 `input_image`：

```json
{
  "role": "user",
  "content": [
    { "type": "input_text", "text": "这张图里有什么？" },
    {
      "type": "input_image",
      "image_url": "data:image/png;base64,...",
      "detail": "auto"
    }
  ]
}
```

### 8.2 后续隐私和日志

- 不记录图片 base64。
- 图片消息不记录完整大 prompt。
- 服务端日志只记录图片数量、MIME 类型、近似总大小、模型、状态、耗时、request ID。

## 9. 图片生成

### 9.1 功能要求

用户可以在同一聊天界面中通过提示词生成图片。

P0 行为：

- 不提供单独“生图”按钮。
- 服务端根据最近用户消息识别生图意图，例如“生成一张……图片”“帮我画一张……”。
- 保留 `/image`、`/img`、`/draw` 作为明确命令式触发。
- 服务端仍调用 `/responses`，并传入 `tools: [{ "type": "image_generation" }]`。
- 生成结果以内联图片方式展示为助手消息。
- 图片生成等待期间必须显示类似 GPT 的可见等待态，持续提示“正在生成图片/仍在生成中”，不能只显示空白 assistant 卡片。
- 如果模型同时返回文本说明，也展示文本。
- 如果上游返回 `revised_prompt`，可在折叠元信息中展示。

上游请求示例：

```json
{
  "model": "gpt-5.5",
  "input": "Generate an image of a clean internal AI console UI",
  "tools": [
    { "type": "image_generation", "action": "generate" }
  ]
}
```

### 9.2 多轮图片生成

P0 图片生成按完整消息历史延续上下文，但不保证能编辑上一张图片：

- 用户：生成一个极简 dashboard 图
- 助手：返回图片
- 用户：改成深色模式
- 服务端：带上最近消息历史和 `tools: [{ "type": "image_generation" }]`

由于当前 HTTP `/responses` 不支持 `previous_response_id`，P0 可以只支持全新图片生成，并在 UI 或 README 中说明图片编辑 / 细化能力受网关限制。

### 9.3 图片生成流式

图片生成的 partial image 流式展示不作为 P0 必须项。

如果上游返回 partial image 事件，UI 可以展示渐进预览；如果不实现，则展示生成中状态，最终返回后展示完整图片。

## 10. Thinking 展示

### 10.1 产品规则

P0 需要有接近主流 AI 产品的 Thinking 体验：

- 请求进行中展示“思考中”状态。
- 如果上游返回可公开 reasoning summary，展示为 Thinking 内容。
- 如果上游不返回 reasoning 正文，则通过应用侧 instructions 要求模型在最终回答中提供简短“思路摘要”，并展示到 Thinking 面板或回答前置区域。
- 如果只有 reasoning token 数量，则可以作为元数据展示。

UI 不能编造、模拟或自行生成隐藏内部推理。普通加载文案只能作为状态，不能标成模型真实 thinking。

### 10.2 可展示内容来源

支持以下来源：

- `reasoning.summary` 非空。
- `output` 中 `type=reasoning` 且包含公开 summary 文本。
- 流式 reasoning summary delta 事件。
- 最终回答中按应用 instructions 输出的简短“思路摘要”。
- `usage.output_tokens_details.reasoning_tokens` 这类元数据。

展示规则：

- 回答完成后 thinking 默认折叠。
- 流式过程中先展示“思考中”状态；收到公开 summary 或最终思路摘要后再展示文本。
- 如果只有 reasoning token 数量，只展示为元数据，例如“Reasoning tokens used: N”，不当作思考正文。
- 如果没有公开 summary、没有最终思路摘要、也没有 reasoning 元数据，则隐藏 thinking 区域。

### 10.3 请求选项

当前已确认接口接受 `reasoning` 配置，但只观察到顶层 reasoning 元数据，没有拿到上游可展示 thinking 正文。

可传入：

```json
{
  "reasoning": {
    "effort": "medium",
    "summary": "auto"
  }
}
```

具体字段和值必须以 `${SUB2API_BASE_URL}/responses` 的真实返回为准；P0 默认 base URL 是 `https://your-sub2api-host.example.com/ai/v1`。

应用侧短 instructions 建议：

```text
请默认用中文回答。对于需要推理、比较、排查或方案设计的问题，先给 1-3 条简短“思路摘要”，再给结论或步骤；不要输出隐藏内部推理全文。
```

## 11. 错误处理

### 11.1 环境变量错误

- 缺少 `SUB2API_BASE_URL`：显示“服务端未配置 SUB2API_BASE_URL”。
- 缺少 `SUB2API_KEY`：显示“服务端未配置 SUB2API_KEY”。
- 前端错误中不能包含环境变量值。

### 11.2 上游错误

统一归一化：

- `401` / `403`：认证失败，请检查 `SUB2API_KEY` 或网关权限。
- `404`：网关路径或模型不存在，请检查 base URL 和模型名。
- `408` / timeout：请求超时，请稍后重试。
- `429`：请求过于频繁或额度不足，请稍后重试。
- `5xx`：AI 网关暂时不可用，请稍后重试。
- 图片安全拦截：图片请求未通过安全检查，请调整提示词或输入图片。

### 11.3 日志

服务端日志应包含：

- model
- mode
- 是否 stream
- 图片数量和总大小
- status code
- latency
- upstream request ID
- 归一化错误码

服务端日志不能包含：

- `SUB2API_KEY`
- 完整 Authorization header
- 图片 base64
- 失控的大响应体

## 12. 安全要求

- 所有 Sub2API 调用必须在服务端完成。
- `.env.local` 必须在 `.gitignore` 中。
- `.env.example` 只能放占位符。
- 缺少环境变量时服务端 route 必须 fail closed。
- 客户端代码不能引用 `process.env.SUB2API_KEY`。
- 上游原始错误如果包含敏感信息，不能直接透传给前端。
- 图片上传只能由服务端使用 `DATABASE_API_KEY` 调用 ECS `POST /images`；浏览器只读取不可枚举文件名的公开图片 URL。

## 13. Vercel 部署要求

Vercel 必配环境变量：

```text
SUB2API_BASE_URL=https://your-sub2api-host.example.com/ai/v1
SUB2API_KEY=<在 Vercel 控制台配置，不提交到代码>
DATABASE_API_BASE_URL=https://your-private-db-api.example.com
DATABASE_API_KEY=<在 Vercel 控制台配置，不提交到代码>
MYSQL_CONNECTION_LIMIT=4
AUTH_SESSION_DAYS=7
```

建议：

- `https://your-sub2api-domain.example.com/ai/v1` 修复前不要作为 Vercel 生产 base URL。
- API Route 使用 Node runtime，除非 Edge runtime 的流式兼容性已验证。
- 当前 Vercel Hobby 计划下 `/api/chat` 最大执行时间为 300s；600s 需要 Pro/Enterprise 或异步图片任务架构。
- README 需要说明图片生成耗时可能明显长于文本问答。

## 14. 验收标准

### 14.1 本地启动

- `npm install` 成功。
- `npm run dev` 能启动。
- 未登录访问首页跳转到 `/login`。
- 使用 `admin@example.com` 或 `operator@example.com` 和初始化密码能登录进入问答工作台。

### 14.2 文本问答

- 配置有效环境变量后，输入“你好”能获得模型回答。
- 追问能引用同一活跃会话的上一轮内容。
- 登录后发送消息，刷新页面后能从 MySQL 恢复消息。
- Markdown 和代码块正确渲染。
- 复制按钮可用。

### 14.3 流式输出

- 文本请求固定走 SSE，UI 不提供关闭流式输出的选项。
- 如果上游返回 SSE，文本应增量显示。

### 14.4 图片生成

- 用户可触发图片生成。
- 服务端通过 `/responses` + `image_generation` tool 请求。
- 图片生成期间 UI 有持续等待反馈。
- UI 能展示返回的 base64 图片。
- 图片生成失败时有清晰错误。

### 14.7 历史会话和并发

- 侧栏展示当前用户历史会话列表，按更新时间倒序。
- 点击历史会话可恢复该会话消息。
- 删除历史会话后，该会话及消息从 MySQL 删除。
- 一个会话正在生成时，可以切换到另一个会话继续提问。
- 每个运行中的会话都有独立停止控制，不互相取消。

### 14.5 Thinking

- 请求进行中 UI 展示“思考中”状态。
- 如果上游返回可展示 reasoning summary，UI 展示到 Thinking 面板。
- 如果上游不返回 reasoning 正文，但最终回答包含“思路摘要”，UI 展示简短思路摘要。
- 如果只有 reasoning token 数，UI 只展示 token 元数据。
- UI 不得伪造隐藏内部推理。

### 14.6 密钥安全

- 不提交真实 token/key/password。
- 浏览器网络请求只打本项目 `/api/chat`，不直连 Sub2API 网关。
- 浏览器不调用数据库 API，不暴露 `DATABASE_API_KEY`。
- 构建产物和客户端 bundle 不暴露 `SUB2API_KEY`。

## 15. 后续实现建议

建议技术栈：

- Next.js App Router
- TypeScript
- React Markdown 相关库用于 Markdown / 代码块渲染
- 轻量语法高亮库
- CSS Modules 或 Tailwind，按项目初始化选择

服务端 adapter 建议隔离：

- `app/api/chat/route.ts`
- `lib/sub2api.ts`
- `lib/response-parser.ts`
- `lib/types.ts`

隔离原因：

- 网关兼容性问题只需改 adapter。
- 流式和非流式解析可以共享统一消息类型。
- 后续增加文件、认证、多会话持久化时更容易扩展。

## 16. 网关兼容性 smoke test

实现完成前必须用真实 `.env.local` 跑：

1. 文本非流式：
   - 仅作为网关兼容性探测，不作为 UI 功能入口
2. 文本流式：
   - UI 固定流式
   - 验证是否返回 `response.output_text.delta`
3. 多轮上下文：
   - 使用完整消息历史请求第二轮
   - 验证第二轮能引用上一轮用户事实
4. 图片生成：
   - 输入“生成一张极简黑白按钮图片”
   - 服务端自动带上 `tools: [{ "type": "image_generation" }]`
   - 验证是否返回 `image_generation_call.result`
5. Thinking：
   - 验证 `reasoning.summary`
   - 验证 `output` 中是否有 `type=reasoning`
   - 验证是否有流式 reasoning 事件
   - 验证是否只有 `usage.output_tokens_details.reasoning_tokens`
6. 错误 key：
   - 故意使用无效 key，UI 显示认证失败
7. 缺少 key：
   - 无 `SUB2API_KEY` 时服务端直接返回配置错误，不请求上游

## 17. 当前接口可行性探测

探测时间：2026-07-05

探测说明：

- 本地没有 `.env.local`。
- 用户在本轮临时提供了 Sub2API key，仅用于接口探测。
- key 没有写入仓库、`.env.local` 或规格文件。
- 下列结论基于当前公网入口 `https://your-sub2api-domain.example.com/ai/v1` 和 IP 入口 `https://your-sub2api-host.example.com/ai/v1` 的对比。

### 17.1 网络和客户端兼容性

已确认：

- DNS 解析正常，`your-sub2api-domain.example.com` 当前解析到 `your-server-ip`。
- 80 / 443 端口可连通。
- HTTP 明文访问会返回 nginx `301 Moved Permanently`。
- TLS 证书有效，证书 CN 为 `your-sub2api-domain.example.com`。
- `https://your-sub2api-host.example.com/ai/v1/models` 已验证可被 Node `fetch` 和 `curl` 正常访问，并返回预期的 `401 INVALID_API_KEY`。
- `https://your-sub2api-host.example.com/ai/v1` 已通过 Node `fetch` 完成真实 key 下的 models、文本、流式和图片生成请求。

重要风险：

- `curl`、Node `fetch`、Node `https.request`、Node `tls.connect`、Python `urllib` 访问 HTTPS 都出现 `ECONNRESET`。
- 使用 `openssl s_client` 手工发送 HTTP/1.1 请求可以正常拿到业务响应。
- Next.js / Vercel 默认会使用 Node HTTP 客户端；在当前现象下，直接用 `fetch` 调 `https://your-sub2api-domain.example.com/ai/v1/responses` 大概率不可用。
- P0 已决定使用 `https://your-sub2api-host.example.com/ai/v1` 作为服务端 base URL 绕过该问题。

### 17.2 模型列表

`GET /ai/v1/models` 使用真实 key，通过 IP 入口 Node `fetch` 返回 `200 OK`。

结果摘要：

- 返回模型数量：17。
- P0 目标模型存在：
  - `gpt-5.4`
  - `gpt-5.5`

结论：

- 模型选择器只展示 `gpt-5.5` 和 `gpt-5.4`。
- `gpt-5.5` 和 `gpt-5.4` 已确认文本可用。
- `gpt-5.4` 以下模型不再纳入验证和实现范围。

### 17.3 文本非流式

`POST /ai/v1/responses`：

```json
{
  "model": "gpt-5.5",
  "input": "请只回复 pong",
  "store": true
}
```

结果摘要：

- HTTP 状态：`200 OK`
- 响应类型：`application/json; charset=utf-8`
- 传输方式：`Transfer-Encoding: chunked`
- response status：`completed`
- model：`gpt-5.5`
- output types：`message`
- 输出文本：`pong`
- usage 示例：`input_tokens=4390`、`output_tokens=17`，其中 `reasoning_tokens=10`

补充模型探测：

- `gpt-5.4` 文本调用返回 `200 OK`。

结论：

- 文本非流式业务能力可用。
- 服务端 parser 必须支持 HTTP chunked body 解码。
- 简单 prompt 的 input token 很高，说明网关或上游会注入较长 instructions；后续要关注成本和上下文占用。

### 17.4 文本流式

`POST /ai/v1/responses`：

```json
{
  "model": "gpt-5.5",
  "input": "请分三段简短回复，每段一个词：红、绿、蓝",
  "stream": true
}
```

结果摘要：

- HTTP 状态：`200 OK`
- 响应类型：`text/event-stream`
- 传输方式：`Transfer-Encoding: chunked`
- 事件包含：
  - `response.created`
  - `response.in_progress`
  - `response.output_item.added`
  - `response.content_part.added`
  - `response.output_text.delta`
  - `response.output_text.done`
  - `response.completed`
- 文本 delta 可拼出：`红\n\n绿\n\n蓝`

结论：

- SSE 流式协议本身可用。
- 服务端 parser 同时要处理 SSE 和 chunked transfer。
- 使用 IP 入口时，Node `fetch` 可以正常消费 SSE。

### 17.5 多轮上下文

使用上一轮返回的 `response.id` 调：

```json
{
  "model": "gpt-5.5",
  "previous_response_id": "resp_xxx",
  "input": "上一条我让你只回复什么？只回答那个英文单词。",
  "store": true
}
```

结果摘要：

- HTTP 状态：`400 Bad Request`
- 错误信息：`previous_response_id is only supported on Responses WebSocket v2`
- error type：`invalid_request_error`

完整历史兜底探测：

- 使用 `{ role, content: string }` 形式发送完整历史，第二轮返回 `200 OK`，能回答上一轮给定事实。
- 使用 content parts 形式发送完整历史，第二轮返回 `200 OK`，能回答上一轮给定事实。

结论：

- 当前 HTTP `/responses` 不支持 `previous_response_id`。
- P0 多轮必须使用“前端保存消息历史，服务端拼接完整上下文”的策略。
- 如果以后要用 `previous_response_id`，需要另行调研并实现 Responses WebSocket v2。

### 17.6 传图读图

已测两种输入：

- data URL 图片：`input_image.image_url=data:image/png;base64,...`
- 公开图片 URL：`input_image.image_url=https://upload.wikimedia.org/...jpg`

结果摘要：

- HTTP 状态：`502 Bad Gateway`
- error message：`Upstream request failed`
- error type：`upstream_error`
- 118 侧日志显示上游错误包含：下载图片失败，上游状态码 `400`。

结论：

- 当前网关的 HTTP `/responses` 读图能力不可用，至少本次 data URL 和 URL 两种方式都失败。
- 本期不实现上传入口、读图请求结构和 vision 路由排障。
- 若后续要上线读图能力，需要先修复 Sub2API / 上游 provider 的图片下载或 vision 路由问题，再恢复 UI 和 API 验收。

### 17.7 图片生成

`POST /ai/v1/responses`：

```json
{
  "model": "gpt-5.5",
  "input": "生成一张极简黑白线稿图：一个方形按钮，白色背景。",
  "tools": [
    { "type": "image_generation", "action": "generate", "quality": "low" }
  ]
}
```

结果摘要：

- HTTP 状态：`200 OK`
- response status：`completed`
- output types：`message`、`image_generation_call`
- 文本输出：`已生成。`
- 返回 `image_generation_call.result`
- 图片 base64 长度约 `870KB` 到 `905KB`
- 返回 `revised_prompt`
- raw 响应接近 `1MB`
- 已观察到一次约 20 秒完成，也观察到一次 Node 客户端约 114 秒完成

结论：

- 图片生成能力可用。
- UI 和服务端 parser 必须支持较大 JSON/chunked 响应。
- 服务端 API Route 需要给图片生成留出更长超时；Vercel 部署时要关注函数最大执行时间。
- README 需要提示图片生成耗时和响应体明显大于文本问答。

### 17.8 Thinking / Reasoning

已测：

```json
{
  "model": "gpt-5.5",
  "input": "比较 9.11 和 9.9 哪个更大，只回答结论并简短说明。",
  "reasoning": {
    "effort": "medium",
    "summary": "auto"
  }
}
```

结果摘要：

- HTTP 状态：`200 OK`
- response status：`completed`
- 顶层 `reasoning` 存在
- `reasoning.effort=medium`
- `reasoning.summary=detailed`
- 未看到可直接展示的 reasoning 文本
- 未看到 `type=reasoning` 的 output item
- `reasoning_tokens=0`

结论：

- 当前接口接受 reasoning 参数，并返回 reasoning 元数据。
- 当前未验证到上游直接返回的可展示 thinking 正文。
- P0 UI 应展示“思考中”状态和可公开思路摘要；如果只有 reasoning token 数，再展示元数据。
- 不能展示或伪造隐藏内部推理全文。

### 17.9 Sub2API 默认 instructions 注入

已确认：

- Sub2API 118 当前 `config.yaml` 只包含服务、数据库、Redis、JWT、默认用户额度等基础配置，没有直接写 prompt 正文。
- 默认 prompt 注入来自 PostgreSQL `public.settings`：
  - `enable_claude_oauth_system_prompt_injection=true`
  - `claude_oauth_system_prompt_blocks` 长度约 `1900` 字符
  - 当前有 3 个启用 block：`{billing_header}`、Claude Code 身份说明、软件工程交互式 agent 行为说明。
- Sub2API 日志里能看到 2026-06-30 更新过 `claude_oauth_system_prompt_blocks` 相关设置。

作用：

- 让 OAuth / Codex / Claude 兼容链路在没有客户端系统提示时，也具备稳定的 agent 身份、行为边界和计费头等默认上下文。
- 对 OpenClaw / Claude Code 类 agent 场景有价值，可以减少每个客户端重复维护系统 prompt。
- 对 Pigou AI Console 这种通用问答工作台，副作用是每次请求都会多带默认上下文，增加 input token、成本和延迟，并可能引入“Claude Code / 编程 agent”风格偏置。

P0 决策：

- 不修改 Sub2API 全局默认注入策略，避免影响 118 上其他客户端和 agent。
- Pigou AI Console 服务端只追加很短的应用侧 instructions，例如中文优先、简洁准确、不要暴露网关细节。
- 如果后续 token 成本明显偏高，再为 Pigou 创建独立 Sub2API key / channel / group，并在该范围内关闭或缩短默认注入，做 A/B smoke test 后再切换。

## 18. 当前待确认问题

以下是目前仍未完全闭环的问题。能通过本地和远程探测确认的部分已经写入第 17 节；这些问题不阻塞 P0 文本、多轮、流式和图片生成实现。

1. `your-sub2api-domain.example.com` 域名 HTTPS reset 的最终根因仍未修复；P0 已用 IP 入口绕过，不阻塞网站实现。
2. Vercel 生产环境访问 `https://your-sub2api-host.example.com/ai/v1` 仍需部署后 smoke test；本地 Node `fetch` 已确认可用。
3. 读图 502 本期不处理；后续如果恢复传图读图，再继续排查 Sub2API / provider 侧图片下载或 vision 路由。

## 19. 实现策略调整

基于当前探测，P0 实现策略调整为：

- 服务端 adapter 使用标准 `fetch`，P0 base URL 使用 `https://your-sub2api-host.example.com/ai/v1`。
- `https://your-sub2api-domain.example.com/ai/v1` 修复前不作为默认生产 base URL。
- 多轮对话不使用 `previous_response_id`，改为发送完整消息历史。
- 模型默认使用 `gpt-5.5`；`gpt-5.4` 作为可用备选；`gpt-5.4` 以下模型不验证、不展示、不调用。
- 本期不实现传图读图和图片附件上传；读图 502 不阻塞 P0。
- 图片生成可以作为 P0 能力实现。
- Thinking 展示“思考中”状态、可公开 reasoning summary 或最终回答里的简短思路摘要；不能伪造隐藏内部推理全文。
- P0 不调整 Sub2API 全局默认 instructions 注入；Pigou 站点只使用短应用侧 instructions。
- 响应 parser 必须支持：
  - HTTP chunked JSON
  - chunked SSE
  - `message`
  - `image_generation_call`
  - `usage`
  - `reasoning` 元数据

## 20. 参考资料

- OpenAI Responses API Reference: https://developers.openai.com/api/docs/api-reference/responses
- OpenAI Images and Vision Guide: https://developers.openai.com/api/docs/guides/images-vision
- OpenAI Image Generation Guide: https://developers.openai.com/api/docs/guides/image-generation
- OpenAI Conversation State Guide: https://developers.openai.com/api/docs/guides/conversation-state
