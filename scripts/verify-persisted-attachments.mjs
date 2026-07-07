import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const conversations = readFileSync(new URL("../src/lib/conversations.ts", import.meta.url), "utf8");
const chatRoute = readFileSync(new URL("../src/app/api/chat/route.ts", import.meta.url), "utf8");
const imageStorage = readFileSync(new URL("../src/lib/image-storage.ts", import.meta.url), "utf8");
const ecsApi = readFileSync(new URL("../ecs-db-api/server.mjs", import.meta.url), "utf8");

assert.match(conversations, /images:\s*row\.role === "assistant"/);
assert.match(conversations, /attachments:\s*row\.role === "user"/);
assert.match(conversations, /JSON\.stringify\(params\.attachments \?\? \[\]\)/);
assert.match(chatRoute, /persistUserImageAttachments/);
assert.match(imageStorage, /persistUserImageAttachments/);
assert.match(imageStorage, /ClientImageAttachment/);
assert.match(imageStorage, /normalizeUserAttachmentForUpload/);
assert.match(imageStorage, /await import\("sharp"\)/);
assert.match(imageStorage, /jpeg\(\{\s*quality,/);
assert.match(imageStorage, /previewBuffer\.length < sourceBuffer\.length/);
assert.match(imageStorage, /storageMimeTypeForAttachment/);
assert.match(imageStorage, /mimeType:\s*storageMimeTypeForAttachment\(uploadableAttachment\)/);
assert.match(ecsApi, /image\/jpeg/);
