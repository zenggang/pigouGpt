import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/components/ConsoleApp.tsx", import.meta.url), "utf8");

assert.match(source, /onPaste=\{\(event\) => void handleAttachmentPaste\(event\)\}/);
assert.match(source, /placeholder="[^"]*可粘贴图片[^"]*"/);
assert.match(source, /<ImagePlus size=\{14\} \/>\s*附件/);
assert.match(source, /normalizeImageFileForAttachment/);
assert.match(source, /mimeType:\s*"image\/png"/);
assert.match(source, /normalizedPngFileName/);
assert.match(source, /attachment\.base64 \|\| attachment\.url/);
