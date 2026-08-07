# PigouAI Stream Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove UI placeholder residue and move final chat persistence off the SSE critical path using a durable Redis Stream on ECS.

**Architecture:** The browser clears placeholder thinking on the first visible text delta. The Vercel route streams `done` before final persistence and schedules one final snapshot with Next.js `after()`. The ECS DB API enqueues validated snapshots in Redis Stream; a consumer group writes idempotently to MySQL and acknowledges only after success.

**Tech Stack:** Next.js 16 Route Handlers, React 19, Node.js, Express, Redis Stream, MySQL, Vercel, systemd/user runtime.

---

### Task 1: Define regression behavior

**Files:**
- Modify: `scripts/verify-chat-stream-resilience.mjs`
- Create: `scripts/verify-message-snapshot-queue.mjs`
- Modify: `package.json`

- [ ] Assert first plain `text_delta` clears placeholder thinking.
- [ ] Assert `/api/chat` writes `done` before scheduling final persistence.
- [ ] Assert ECS queue code uses `XADD`, consumer groups, `XACK`, pending recovery and validated payloads.
- [ ] Run both verification scripts and observe failures caused by missing behavior.

### Task 2: Fix browser streaming state

**Files:**
- Create: `src/lib/streaming-message.mjs`
- Modify: `src/components/ConsoleApp.tsx`

- [ ] Move plain text delta state merging into a directly testable helper.
- [ ] Clear only the synthetic `思考中...` placeholder on the first visible text; preserve real extracted thinking.
- [ ] Run the focused verification and confirm it passes.

### Task 3: Remove database work from the SSE tail

**Files:**
- Modify: `src/app/api/chat/route.ts`
- Modify: `src/lib/conversations.ts`
- Modify: `src/lib/db.ts`

- [ ] Keep one initial running snapshot before upstream generation starts.
- [ ] Capture stream state in memory without awaiting periodic MySQL writes.
- [ ] Write terminal `done`/`error`, close SSE, then use `after()` to submit the final snapshot.
- [ ] Add a dedicated snapshot API client so generic SQL remains unavailable to the browser.
- [ ] Run focused verification and production build.

### Task 4: Add the durable ECS queue

**Files:**
- Modify: `ecs-db-api/server.mjs`
- Modify: `ecs-db-api/package.json`
- Modify: `README.md`

- [ ] Add authenticated `POST /message-snapshots` with strict field validation.
- [ ] Enqueue JSON snapshots with Redis `XADD` and return `202` after Redis accepts them.
- [ ] Create a consumer group, recover pending messages, write message and conversation updates in one MySQL transaction, then `XACK`.
- [ ] Log queue id, assistant id, status, latency and retry failures without secrets.
- [ ] Run queue verification and lint/build checks.

### Task 5: Deploy and verify

**Files:**
- Deploy: `ecs-db-api/`
- Deploy: Vercel production from merged `main`

- [ ] Install a localhost-only Redis runtime with AOF and startup recovery.
- [ ] Back up ECS DB API files, install dependencies, restart and verify health.
- [ ] Submit a synthetic snapshot and verify Redis pending reaches zero and MySQL contains the terminal row; remove the synthetic row afterward.
- [ ] Run all local verification scripts, lint, build and `git diff --check`.
- [ ] Commit, fast-forward merge to `main`, push, deploy Vercel production and run authenticated browser smoke tests.
- [ ] Remove the temporary global worktree and feature branch.
