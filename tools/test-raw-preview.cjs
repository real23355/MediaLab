const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: node tools/test-raw-preview.cjs <input.raw> <output.png>");
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

const source = fs.readFileSync(path.join(__dirname, "..", "desktop", "src", "raw.js"), "utf8");
vm.runInThisContext(source, { filename: "raw.js" });
const bytes = new Uint8Array(fs.readFileSync(input));
const config = window.RawTools.detect(bytes.subarray(0, 2 * 1024 * 1024), bytes.byteLength, path.basename(input));
const values = window.RawTools.decode(bytes, config);
const levels = window.RawTools.levels(values, config.bitDepth);
const image = window.RawTools.render(values, config, "rgb", levels, true, 0, 1);

const sharp = require("C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp");
fs.mkdirSync(path.dirname(output), { recursive: true });
sharp(Buffer.from(image.data), {
  raw: { width: config.width, height: config.height, channels: 4 },
}).png().toFile(output).then((info) => {
  console.log(JSON.stringify({ config, levels, output, info }, null, 2));
});
