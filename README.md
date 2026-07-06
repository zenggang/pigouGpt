# Pigou AI Console

Pigou AI Console 是一个部署到 Vercel 的轻量 AI 问答工作台。浏览器只请求本项目的 `/api/chat`，Sub2API key 只在服务端环境变量中使用。

## 功能

- 邮箱 + 密码登录；不开放注册
- 登录账号由 MySQL `users` 表配置，初始化账号通过环境变量指定
- ECS MySQL 持久化用户、登录 session、会话和消息；Vercel 通过服务端数据库 API 访问，不开放公网 3306
- 历史会话列表，支持切换、删除会话，并允许多个会话同时生成
- 输入区内选择 `gpt-5.5` / `gpt-5.4`
- 输入区内选择推理强度：低 / 中 / 高
- 文本固定流式输出，不提供关闭选项
- Markdown、代码块和复制按钮
- Thinking 状态与简短思路摘要展示
- 非图片问答默认向模型提供 `web_search` 工具；开放世界、资料查询、推荐对比、价格政策新闻等问题由模型主动联网核验
- 输入中明确表达生图意图时，Vercel 先提交 ECS 异步图片任务，前端轮询展示状态；后台再通过 `/responses` + `image_generation` 生成图片
- AI 生成图片会上传到 ECS `pigou-db-api` 文件目录，MySQL 历史消息只保存图片 URL，不保存 base64 大对象
- 缺少 key、认证失败、上游错误的清晰提示

本期不做传图读图和图片附件上传。

## 本地启动

```bash
npm install
cp .env.example .env.local
npm run dev
```

然后打开 `http://localhost:3000`。

`.env.local` 示例：

```bash
SUB2API_BASE_URL=https://your-sub2api-host.example.com/ai/v1
SUB2API_KEY=<你的 Sub2API key>
DATABASE_API_BASE_URL=https://your-private-db-api.example.com
DATABASE_API_KEY=<你的数据库接口 key>
INITIAL_USER_EMAILS=admin@example.com,operator@example.com
INITIAL_USER_PASSWORD=<初始化登录密码>
AUTH_SESSION_DAYS=7
```

不要提交 `.env.local` 或任何真实 key。

## 数据库访问方案

生产环境推荐保持 MySQL 只监听 ECS 本机 `127.0.0.1:3306`。Next.js 服务端配置 `DATABASE_API_BASE_URL` 和 `DATABASE_API_KEY` 后，会请求 ECS 上的 `pigou-db-api`；该小服务再用最小权限 MySQL 账号访问 `your_app_database`。

示例配置：

```text
DATABASE_API_BASE_URL=https://your-private-db-api.example.com
```

`pigou-db-api` 同时承担图片生成后台任务和图片文件存储：

- `POST /image-jobs`：Vercel 提交异步图片任务，ECS 立即返回 job id，然后在后台请求 Sub2API。
- `GET /image-jobs/:jobId`：Vercel 轮询任务状态，前端展示“思考中”、完成图片或错误提示。
- `POST /images`：只允许服务端带 `DATABASE_API_KEY` 上传图片文件。
- `GET /images/:fileName`：浏览器展示历史图片。

数据库 API 反向代理的请求体限制需要大于生成图 base64，建议至少配置为 `8m`。

ECS `pigou-db-api` 需要配置：

```bash
PIGOU_DB_API_KEY=<数据库接口 key>
PIGOU_PUBLIC_BASE_URL=https://your-private-db-api.example.com
SUB2API_BASE_URL=https://your-sub2api-host.example.com/ai/v1
SUB2API_KEY=<Sub2API key>
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=your_app_database
MYSQL_USER=<最小权限 MySQL 账号>
MYSQL_PASSWORD=<MySQL 密码>
```

后续新增账号不走注册页，直接在 MySQL `users` 表插入或更新启用账号。

## MySQL 初始化

目标数据库单独使用 `your_app_database`。如果你使用本地 MySQL 或 SSH 隧道直连 MySQL，可以创建一个最小权限账号，例如：

```sql
CREATE DATABASE IF NOT EXISTS your_app_database
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'pigou_console'@'localhost' IDENTIFIED BY '<strong-password>';
GRANT SELECT, INSERT, UPDATE, DELETE ON your_app_database.* TO 'pigou_console'@'localhost';
FLUSH PRIVILEGES;
```

然后在 `.env.local` 配好 `DATABASE_URL` 和 `INITIAL_USER_PASSWORD`，执行：

```bash
npm run db:setup
```

脚本会：

- 按 `DATABASE_URL` 中的数据库名创建数据库。
- 执行 `database/schema.sql` 建表。
- 启用 `INITIAL_USER_EMAILS` 中的账号。
- 为这些账号写入同一个初始化密码 hash。

如果 `.env.local` 同时配置了 `DATABASE_API_BASE_URL` 和 `DATABASE_API_KEY`，应用运行时会优先使用数据库 API，不会创建直连 MySQL 连接池。

## Vercel 环境变量

在 Vercel Project Settings -> Environment Variables 中配置：

```text
SUB2API_BASE_URL=https://your-sub2api-host.example.com/ai/v1
SUB2API_KEY=<在 Vercel 控制台配置，不提交到代码>
DATABASE_API_BASE_URL=https://your-private-db-api.example.com
DATABASE_API_KEY=<在 Vercel 控制台配置，不提交到代码>
MYSQL_CONNECTION_LIMIT=4
AUTH_SESSION_DAYS=7
```

真实 Sub2API 和数据库 API 地址只配置在 `.env.local` / Vercel 环境变量中，不写入公开仓库。

## 部署

```bash
npm run build
npx vercel --prod
```

如果首次部署，按 Vercel CLI 提示登录并关联项目。部署完成后，用返回的 Vercel 域名进行 smoke test。

当前项目在 Vercel Hobby 计划下，`/api/chat` 的 `maxDuration` 最高只能设置为 `300s`。图片生成已改为 ECS 异步任务 + 前端轮询，Vercel 函数不再等待图片生成完成。

## Smoke Test

- 无 `SUB2API_KEY` 时，页面应显示“服务端未配置 SUB2API_KEY”。
- key 错误时，页面应显示认证失败提示。
- 未登录访问首页，应跳转到 `/login`。
- 非 `users` 表启用账号不能登录。
- 登录后发送消息，刷新页面后应从 MySQL 恢复消息。
- 侧栏历史会话可切换，切换后恢复对应消息。
- 历史会话可删除，删除当前会话后自动切换到下一条或新建会话。
- 一个会话生成中时，可以切换到另一个会话继续发送消息。
- 输入“你好”应返回流式文本。
- 追问上一轮内容，应能引用同一会话历史。
- 输入“搜索一下今天 OpenAI API web search 推荐的工具 type”，应返回带来源 URL 的回答。
- 输入“生成一张……图片”或“帮我画一张……”，应先显示等待状态，后台完成后展示生成图片。
- 图片生成超过 300 秒时，页面应持续轮询，不出现空白卡死；刷新页面后仍能从历史会话恢复未完成任务并继续轮询。

图片生成响应体接近 1MB，耗时可能明显长于文本问答。
