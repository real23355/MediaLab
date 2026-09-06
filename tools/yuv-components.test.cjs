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
  fs.readFileSync(path.join(__dirname, "..", "desktop", "src", "media.js"), "utf8"),
  { filename: "media.js" },
);

const M = window.MediaTools;
const Y = [0, 32, 64, 96, 128, 160, 192, 255];
const U = [10, 30];
const V = [20, 40];

function grayValues(image) {
  const values = [];
  for (let index = 0; index < image.data.length; index += 4) {
    assert.equal(image.data[index], image.data[index + 1]);
    assert.equal(image.data[index], image.data[index + 2]);
    assert.equal(image.data[index + 3], 255);
    values.push(image.data[index]);
  }
  return values;
}

const fixtures = {
  I420: Uint8Array.from([...Y, ...U, ...V]),
  YV12: Uint8Array.from([...Y, ...V, ...U]),
  NV12: Uint8Array.from([...Y, U[0], V[0], U[1], V[1]]),
  NV21: Uint8Array.from([...Y, V[0], U[0], V[1], U[1]]),
};

for (const [format, bytes] of Object.entries(fixtures)) {
  test(`${format} renders RGB and bit-exact Y/U/V planes`, () => {
    const rgb = M.renderYuv(bytes, 4, 2, format, "rgb");
    assert.deepEqual([rgb.width, rgb.height], [4, 2]);

    const yImage = M.renderYuv(bytes, 4, 2, format, "y");
    assert.deepEqual([yImage.width, yImage.height], [4, 2]);
    assert.deepEqual(grayValues(yImage), Y);

    const uImage = M.renderYuv(bytes, 4, 2, format, "u");
    assert.deepEqual([uImage.width, uImage.height], [2, 1]);
    assert.deepEqual(grayValues(uImage), U);

    const vImage = M.renderYuv(bytes, 4, 2, format, "v");
    assert.deepEqual([vImage.width, vImage.height], [2, 1]);
    assert.deepEqual(grayValues(vImage), V);

    const sample = M.displaySample(bytes, 4, 2, format, "u", 1, 0);
    assert.equal(sample.value, U[1]);
    assert.deepEqual([sample.sourceX, sample.sourceY], [2, 0]);
  });
}

test("YUY2 and UYVY expose half-width chroma without changing samples", () => {
  const yuy2 = Uint8Array.from([0, 11, 64, 21, 128, 31, 255, 41]);
  const uyvy = Uint8Array.from([11, 0, 21, 64, 31, 128, 41, 255]);
  for (const [format, bytes] of [["YUY2", yuy2], ["UYVY", uyvy]]) {
    assert.deepEqual(grayValues(M.renderYuv(bytes, 4, 1, format, "y")), [0, 64, 128, 255]);
    assert.deepEqual(grayValues(M.renderYuv(bytes, 4, 1, format, "u")), [11, 31]);
    assert.deepEqual(grayValues(M.renderYuv(bytes, 4, 1, format, "v")), [21, 41]);
  }
});

test("GRAY8 keeps direct luma and reports neutral missing chroma", () => {
  const bytes = Uint8Array.from([0, 85, 170, 255]);
  assert.deepEqual(grayValues(M.renderYuv(bytes, 2, 2, "GRAY8", "y")), [...bytes]);
  assert.deepEqual(grayValues(M.renderYuv(bytes, 2, 2, "GRAY8", "u")), [128, 128, 128, 128]);
  assert.deepEqual(grayValues(M.renderYuv(bytes, 2, 2, "GRAY8", "v")), [128, 128, 128, 128]);
});
