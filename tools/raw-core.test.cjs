const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

global.window = {};
global.ImageData = class ImageData {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
};
vm.runInThisContext(
  fs.readFileSync(path.join(__dirname, "..", "desktop", "src", "raw.js"), "utf8"),
  { filename: "raw.js" },
);
const R = window.RawTools;

function packRaw10(values) {
  const output = new Uint8Array(Math.ceil(values.length / 4) * 5);
  for (let offset = 0; offset < values.length; offset += 4) {
    const target = (offset / 4) * 5;
    let low = 0;
    for (let index = 0; index < 4; index += 1) {
      const value = values[offset + index] || 0;
      output[target + index] = value >> 2;
      low |= (value & 3) << (index * 2);
    }
    output[target + 4] = low;
  }
  return output;
}

test("MIPI RAW10 4-pixel/5-byte unpack is bit exact", () => {
  const expected = Uint16Array.from([0, 1, 2, 3, 255, 511, 768, 1023]);
  const decoded = R.decode(packRaw10(expected), {
    width: 8, height: 1, bitDepth: 10, bayer: "RGGB",
    packing: "MIPI_RAW10", frameBytes: 10, reason: "test"
  });
  assert.deepEqual([...decoded], [...expected]);
});

test("unpacked16 little-endian RAW10 masks and decodes correctly", () => {
  const bytes = Uint8Array.from([0x00, 0x00, 0xff, 0x03, 0x00, 0x02, 0x55, 0x01]);
  const decoded = R.decode(bytes, {
    width: 4, height: 1, bitDepth: 10, bayer: "RGGB",
    packing: "UNPACKED16_LE", frameBytes: 8, reason: "test"
  });
  assert.deepEqual([...decoded], [0, 1023, 512, 341]);
});

test("all four Bayer patterns expose the expected 2x2 channels", () => {
  assert.deepEqual([R.bayerChannel("RGGB", 0, 0), R.bayerChannel("RGGB", 1, 0), R.bayerChannel("RGGB", 0, 1), R.bayerChannel("RGGB", 1, 1)], ["R", "Gr", "Gb", "B"]);
  assert.equal(R.bayerChannel("BGGR", 0, 0), "B");
  assert.equal(R.bayerChannel("GRBG", 1, 0), "R");
  assert.equal(R.bayerChannel("GBRG", 0, 1), "R");
});

test("invalid RAW size reports a clear mismatch", () => {
  assert.throws(
    () => R.decode(new Uint8Array(7), { width: 4, height: 1, bitDepth: 10, bayer: "RGGB", packing: "UNPACKED16_LE" }),
    /RAW 文件大小不匹配/,
  );
});
