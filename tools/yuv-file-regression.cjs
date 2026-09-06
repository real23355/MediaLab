const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const input = process.argv[2];
if (!input) {
  process.stderr.write("Usage: node tools/yuv-file-regression.cjs <input.yuv|input.syuv>\n");
  process.exit(2);
}

global.window = {};
global.ImageData = class ImageData {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
};
vm.runInThisContext(
  fs.readFileSync(path.join(__dirname, "..", "desktop", "src", "media.js"), "utf8"),
  { filename: "media.js" },
);

const bytes = new Uint8Array(fs.readFileSync(input));
const candidates = window.MediaTools.detectYuv(bytes, bytes.byteLength, path.basename(input));
assert.ok(candidates.length, "YUV format was not detected");
const config = candidates[0];
const frame = bytes.subarray(config.dataOffset, config.dataOffset + config.frameBytes);
assert.equal(frame.byteLength, config.frameBytes);

const modes = {};
for (const mode of ["rgb", "y", "u", "v"]) {
  const image = window.MediaTools.renderYuv(frame, config.width, config.height, config.format, mode);
  const expected = window.MediaTools.displaySize(config.width, config.height, config.format, mode);
  assert.deepEqual([image.width, image.height], [expected.width, expected.height]);
  modes[mode] = `${image.width}x${image.height}`;
}

process.stdout.write(JSON.stringify({
  input,
  detected: {
    width: config.width,
    height: config.height,
    format: config.format,
    dataOffset: config.dataOffset,
    frameBytes: config.frameBytes,
    frameCount: config.frameCount,
  },
  modes,
}, null, 2) + "\n");
