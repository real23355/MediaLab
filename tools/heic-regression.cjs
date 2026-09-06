const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { extractHeicFrame } = require("../desktop/src/heic.cjs");

const [input, ffmpeg] = process.argv.slice(2);
if (!input || !ffmpeg) {
  process.stderr.write("Usage: node tools/heic-regression.cjs <input.heic> <ffmpeg.exe>\n");
  process.exit(2);
}

const extracted = extractHeicFrame(fs.readFileSync(input));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "MediaLab-heic-test-"));
const stream = path.join(directory, "frame.h265");
try {
  fs.writeFileSync(stream, extracted.annexB);
  const result = spawnSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-f", "hevc", "-i", stream,
    "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "pipe:1",
  ], { windowsHide: true, maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr.toString("utf8") || `ffmpeg exit ${result.status}`);
  assert.ok(result.stdout.length > 8, "decoded PNG is empty");
  assert.deepEqual([...result.stdout.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual([extracted.width, extracted.height], [2560, 1440]);
  process.stdout.write(JSON.stringify({
    input,
    width: extracted.width,
    height: extracted.height,
    annexBBytes: extracted.annexB.length,
    pngBytes: result.stdout.length,
  }, null, 2) + "\n");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
