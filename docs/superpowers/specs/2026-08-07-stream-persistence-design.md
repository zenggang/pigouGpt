# PigouAI 流式展示与异步持久化设计

## 目标

- 首个正文事件到达后立即隐藏“思考中...”占位。
- 上游正文和终止事件不再等待 MySQL 写入，浏览器按到达顺序即时展示。
- 文本消息快照通过 ECS 本机 Redis Stream 可靠排队，由后台消费者最终写入 MySQL。
- 继续保留刷新恢复、错误终态、会话排序和历史消息查询语义。

## 已确认根因

1. `mergeStreamingTextDelta()` 在普通正文分支没有清理占位 `thinking`，正文展示后仍渲染思考面板。
2. `/api/chat` 在每个快照及最终终态上同步等待远程 DB API；最终 `done` 必须等消息 upsert 和会话 touch 完成。
3. 2026-08-07 15:03 的生产请求中，上游流本身耗时 `64160ms`。异步持久化只能消除上游完成后的尾延迟，不能缩短模型自身推理时间。
4. ECS 当前没有 Redis/Valkey 服务，Redis 必须作为仅本机监听、开启 AOF 的独立运行时部署。

## 数据流

1. Vercel 收到上游 SSE 后立即 `enqueue()` 给浏览器。
2. 路由只在内存中合并当前 assistant 快照；`text_delta` 到达时立即清除占位 thinking。
3. 服务端写出明确 `done` 或 `error` 后关闭 SSE。
4. Next.js `after()` 在响应结束后把最终快照提交到 ECS `/message-snapshots`。
5. ECS 接口校验业务字段后执行 Redis `XADD` 并立即返回 `202`。
6. Redis consumer group 顺序读取快照，在 MySQL 事务中 upsert message 并 touch conversation；成功后 `XACK`，失败则保留 pending，消费者重启后自动认领重试。

## 边界与降级

- 初始 running 快照仍同步保存一次，确保长推理期间刷新有可恢复占位；它发生在上游请求前，不阻塞已经返回的正文。
- 最终 Redis 投递失败会记录 assistantId、conversationId、status 和错误，不向用户伪报业务失败；原始 running 记录会由现有 stale recovery 转为可重新生成。
- Redis 只绑定 `127.0.0.1`，不开放公网；AOF 使用 `everysec`。
- consumer 必须幂等：同一 assistantId 使用 MySQL upsert，晚到的终态覆盖 running 快照。

## 验收

- 回归用例证明普通 `text_delta` 会把 `thinking` 从“思考中...”置空。
- 回归用例证明 `done` 写入 SSE 的顺序早于最终持久化完成。
- Redis 队列接口返回 202，消费者完成后 MySQL 可查到 `done` 消息且 Stream pending 为 0。
- 生产浏览器实测记录首正文、终止事件和 UI 停止转圈时间；正文出现时不得显示占位思考面板。
