# Pigou AI Chat Stream Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the GPT-5.6 upstream path and ensure failed or interrupted text requests terminate with a clear error instead of exposing planning text or remaining permanently in `running`.

**Architecture:** Keep the existing Vercel SSE route and GPT-5.6 model selection. Add small testable JavaScript helpers for bounded asynchronous reads and stale-message recovery, integrate them into the TypeScript route/data flow, suppress raw upstream reasoning summaries, and repair only confirmed stale production rows after deployment.

**Tech Stack:** Next.js 16 Route Handlers, TypeScript, Web Streams/SSE, Node.js `node:test`, MySQL through the ECS database API, Vercel CLI, nginx/chisel/systemd on ECS.

---

### Task 1: Add a failing resilience verification

**Files:**
- Create: `scripts/verify-chat-stream-resilience.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing verification**

Create a Node verification that imports `withTimeout` from `src/lib/upstream-runtime.mjs` and `recoverStaleTextMessage` from `src/lib/stale-message.mjs`, tests timeout rejection and stale-row recovery with `node:assert`, then asserts from source that `sub2api.ts` suppresses reasoning-summary deltas and `ConsoleApp.tsx` rejects a stream without `done` or `error`.

- [ ] **Step 2: Register and run the verification**

Add `"verify:chat-stream-resilience": "node scripts/verify-chat-stream-resilience.mjs"` to `package.json` and run:

```bash
npm run verify:chat-stream-resilience
```

Expected: FAIL because the helper modules and integration do not exist.

- [ ] **Step 3: Commit the red test**

```bash
git add package.json scripts/verify-chat-stream-resilience.mjs
git commit -m "test: define chat stream recovery behavior"
```

### Task 2: Bound the upstream connection and stream

**Files:**
- Create: `src/lib/upstream-runtime.mjs`
- Modify: `src/lib/sub2api.ts`

- [ ] **Step 1: Implement the minimal timeout helper**

Export `UpstreamTimeoutError` and `withTimeout(promise, timeoutMs, message, onTimeout)`; it must clear its timer on resolve/reject and call `onTimeout` before rejecting with the typed timeout error.

- [ ] **Step 2: Integrate connection and idle timeouts**

In `streamChatResponse`, create a linked upstream `AbortController`, use a 30-second timeout around `fetch`, and a 90-second timeout around each `reader.read()`. On an application timeout, log model/mode/stage/elapsed time and yield `AI 网关响应超时，请稍后重新生成。`; preserve browser abort behavior as an interruption.

- [ ] **Step 3: Normalize gateway failures**

Update error normalization so HTML/nginx bodies are never included in the user-visible message. Retain structured JSON messages where safe.

- [ ] **Step 4: Suppress raw reasoning summaries**

Ignore `response.reasoning_summary_text.delta`, `response.reasoning_summary_part.added`, and completed-response reasoning summaries. Continue emitting final text, metadata and completion.

- [ ] **Step 5: Run the focused verification**

```bash
npm run verify:chat-stream-resilience
```

Expected: timeout and reasoning tests pass; stale/client assertions remain failing until Tasks 3 and 4.

### Task 3: Recover stale stored messages

**Files:**
- Create: `src/lib/stale-message.mjs`
- Modify: `src/lib/conversations.ts`
- Modify: `scripts/verify-stale-running-messages.mjs`

- [ ] **Step 1: Implement pure stale recovery**

Export `STALE_RUNNING_MESSAGE_MS` and `recoverStaleTextMessage`. For a non-image assistant text message older than five minutes with status `running`, return status `error`, clear thinking, preserve non-empty content, and set both empty content and missing error to `上次请求已中断，可重新生成。`. Leave fresh requests, user rows and image jobs unchanged.

- [ ] **Step 2: Apply recovery during history mapping**

Build the stored message as today, then pass it through the helper before returning it from `listConversationMessages`. Remove the existing branch that marks partial stale output as `done`.

- [ ] **Step 3: Update and run focused verifications**

```bash
npm run verify:stale-running-messages
npm run verify:chat-stream-resilience
```

Expected: stale recovery tests pass; only the client terminal assertion may remain failing.

### Task 4: Reject an unterminated browser stream

**Files:**
- Modify: `src/components/ConsoleApp.tsx`

- [ ] **Step 1: Track terminal SSE events**

Make `handleSseBlock` return `done`, `error`, or `null`; make `consumeSse` accumulate and return the terminal state after draining the stream.

- [ ] **Step 2: Fail abnormal stream closure**

After `consumeSse`, throw `连接意外中断，请重新生成。` when no terminal event was received. Only call `finalizeAssistant` after `done` or `error`; the existing error state must remain an error.

- [ ] **Step 3: Run the focused verification**

```bash
npm run verify:chat-stream-resilience
```

Expected: PASS with all resilience checks.

- [ ] **Step 4: Commit the implementation**

```bash
git add src/lib/upstream-runtime.mjs src/lib/stale-message.mjs src/lib/sub2api.ts src/lib/conversations.ts src/components/ConsoleApp.tsx scripts/verify-stale-running-messages.mjs
git commit -m "fix: terminate interrupted Pigou chat streams"
```

### Task 5: Verify, restore remote services, deploy and repair stale rows

**Files:**
- Modify if validation requires it: `README.md`

- [ ] **Step 1: Run the complete local verification**

```bash
npm run verify:chat-stream-resilience
npm run verify:stale-running-messages
npm run verify:image-attachments
npm run verify:attachment-ui
npm run verify:persisted-attachments
npm run verify:gpt-5-6-default
npm run lint
npm run build
git diff --check
```

Expected: every command exits 0; Next.js production build includes `/api/chat`.

- [ ] **Step 2: Restore the ECS upstream path**

Record the current nginx/chisel status, restart only the confirmed faulty controllable service, and validate local ports `19090`, `11880`, and the authenticated `/v1/models` or `/v1/responses` path. Do not claim the remote-end Sub2API is repaired if the tunnel reconnects but inference still fails.

- [ ] **Step 3: Deploy Vercel production**

```bash
vercel --prod --yes
```

Expected: deployment reaches Ready and `chat.pigou.top` resolves to the production deployment.

- [ ] **Step 4: Repair only confirmed stale production rows**

Back up the selected row ids/status/content lengths, then update non-image assistant rows older than five minutes from `running` to `error`, clear their reasoning summary, and set a retryable error message. Re-query the same ids and verify no qualifying row remains `running`.

- [ ] **Step 5: Perform production smoke tests**

Verify the site and database health, a real GPT-5.6 minimal request, a real web-search request, bounded failure when the upstream is unavailable, no raw English planning display, no newly stuck `running` message, and unchanged image-job health.

- [ ] **Step 6: Commit any final documentation and report exact evidence**

```bash
git status --short --branch
git log -3 --oneline
```

Expected: the worktree is clean, local `main` contains the implementation commits, and production validation results are recorded for handoff.
