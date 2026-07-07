import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const sourcePath = new URL("../src/lib/image-attachments.ts", import.meta.url);
const source = readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const tmp = mkdtempSync(join(tmpdir(), "pigou-image-attachments-"));
const modulePath = join(tmp, "image-attachments.mjs");
writeFileSync(modulePath, compiled);

try {
  const {
    MAX_IMAGE_ATTACHMENTS,
    MAX_IMAGE_ATTACHMENT_BYTES,
    buildMessageContent,
    normalizeClientImageAttachments,
  } = await import(pathToFileURL(modulePath).href);

  assert.equal(MAX_IMAGE_ATTACHMENTS, 4);
  assert.equal(MAX_IMAGE_ATTACHMENT_BYTES, 2 * 1024 * 1024);

  const onePixelPng = "iVBORw0KGgo=";
  const attachments = normalizeClientImageAttachments([
    {
      id: "a1",
      name: "shot.png",
      mimeType: "image/png",
      size: 8,
      base64: onePixelPng,
    },
  ]);

  assert.equal(attachments.length, 1);
  assert.deepEqual(buildMessageContent("这张图里有什么？", attachments), [
    { type: "input_text", text: "这张图里有什么？" },
    {
      type: "input_image",
      image_url: `data:image/png;base64,${onePixelPng}`,
      detail: "auto",
    },
  ]);

  assert.throws(
    () =>
      normalizeClientImageAttachments(
        Array.from({ length: 5 }, (_, index) => ({
          id: `a${index}`,
          name: `shot-${index}.png`,
          mimeType: "image/png",
          size: 8,
          base64: onePixelPng,
        })),
      ),
    /最多上传 4 张图片/,
  );

  assert.throws(
    () =>
      normalizeClientImageAttachments([
        {
          id: "too-large",
          name: "large.png",
          mimeType: "image/png",
          size: MAX_IMAGE_ATTACHMENT_BYTES + 1,
          base64: onePixelPng,
        },
      ]),
    /不能超过 2MB/,
  );

  assert.throws(
    () =>
      normalizeClientImageAttachments([
        {
          id: "bad-type",
          name: "note.txt",
          mimeType: "text/plain",
          size: 8,
          base64: onePixelPng,
        },
      ]),
    /仅支持 PNG、JPEG、WEBP 和非动画 GIF/,
  );
} finally {
  rmSync(tmp, { force: true, recursive: true });
}
