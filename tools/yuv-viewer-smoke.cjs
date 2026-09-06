const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const path = require("node:path");

const y = [0, 32, 64, 96, 128, 160, 192, 255];
const i420 = [...y, 10, 30, 20, 40];
const nv21 = [...y, 20, 10, 40, 30];

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1920,
    height: 1080,
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "desktop", "src", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  await window.loadFile(path.join(__dirname, "..", "desktop", "src", "index.html"));
  const result = await window.webContents.executeJavaScript(`(async () => {
    const makeDoc = (id, format, values) => ({
      id,
      kind: "yuv",
      file: { name: id + ".yuv", path: id + ".yuv", size: 12, modified: Date.now() },
      candidates: [],
      config: { width: 4, height: 2, format, frameBytes: 12, frameCount: 1, dataOffset: 0, score: 1, reason: "test" },
      frame: 0,
      fps: 25,
      displayMode: "rgb",
      yuvFrameData: Uint8Array.from(${JSON.stringify(i420)}),
      yuvFrameKey: "0:0:12",
      playing: false,
      zoom: null,
      fitMode: true,
      pixel: { x: 0, y: 0 }
    });
    document.querySelector("#home").classList.add("hidden");
    document.querySelector("#workspace").classList.remove("hidden");
    document.querySelector("#workspace").classList.add("image-mode");
    document.querySelector("#image-layout").classList.remove("hidden");
    const left = makeDoc("left", "I420", ${JSON.stringify(i420)});
    state.docs = [left];
    state.activeDocId = left.id;
    await showActiveDocument();
    const canvas = document.querySelector("#yuv-canvas");
    const rgbSize = [canvas.width, canvas.height];
    const select = document.querySelector("#yuv-display");
    select.value = "y";
    select.dispatchEvent(new Event("change"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const yPixels = [...canvas.getContext("2d").getImageData(0, 0, 4, 2).data].filter((_, index) => index % 4 === 0);
    select.value = "u";
    select.dispatchEvent(new Event("change"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const uSize = [canvas.width, canvas.height];
    const uPixels = [...canvas.getContext("2d").getImageData(0, 0, 2, 1).data].filter((_, index) => index % 4 === 0);
    setImageZoom("yuv", 2);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const zoomedSurface = [document.querySelector("#yuv-stage .image-surface").style.width, document.querySelector("#yuv-stage .image-surface").style.height];
    const lowZoomOverlay = drawPixelOverlayCanvas(
      document.querySelector("#yuv-pixel-overlay"),
      document.querySelector("#yuv-stage"),
      document.querySelector("#yuv-stage .image-surface"),
      left.config.width,
      left.config.height,
      true,
      (x, y) => yuvOverlayLines(left, x, y)
    );
    left.displayMode = "rgb";
    left.pixelValues = "auto";
    await renderYuvFrame();
    setImageZoom("yuv", 128);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const highZoomOverlay = drawPixelOverlayCanvas(
      document.querySelector("#yuv-pixel-overlay"),
      document.querySelector("#yuv-stage"),
      document.querySelector("#yuv-stage .image-surface"),
      left.config.width,
      left.config.height,
      true,
      (x, y) => yuvOverlayLines(left, x, y)
    );
    const rgbOverlayLines = yuvOverlayLines(left, 2, 1);
    left.displayMode = "u";
    const sharedChromaLines = [yuvOverlayLines(left, 2, 0), yuvOverlayLines(left, 3, 1)];
    const offOverlay = drawPixelOverlayCanvas(
      document.querySelector("#yuv-pixel-overlay"),
      document.querySelector("#yuv-stage"),
      document.querySelector("#yuv-stage .image-surface"),
      left.config.width,
      left.config.height,
      false,
      (x, y) => yuvOverlayLines(left, x, y)
    );
    const singleStage = document.querySelector("#yuv-stage");
    const singleSurface = document.querySelector("#yuv-stage .image-surface");
    singleStage.style.flex = "0 0 240px";
    singleStage.style.width = "240px";
    singleStage.style.height = "160px";
    singleSurface.style.width = "6400px";
    singleSurface.style.height = "3200px";
    singleStage.scrollLeft = 1600;
    singleStage.scrollTop = 800;
    const pannedVisibleRange = drawPixelOverlayCanvas(
      document.querySelector("#yuv-pixel-overlay"),
      singleStage,
      singleSurface,
      100,
      50,
      true,
      () => ["Y:1", "U:2", "V:3"]
    );
    const pannedOverlayPosition = [document.querySelector("#yuv-pixel-overlay").style.left, document.querySelector("#yuv-pixel-overlay").style.top];

    const right = makeDoc("right", "NV21", ${JSON.stringify(nv21)});
    right.displayMode = "v";
    right.yuvFrameData = Uint8Array.from(${JSON.stringify(nv21)});
    state.docs = [left, right];
    state.leftId = left.id;
    state.rightId = right.id;
    state.compareMode = true;
    state.syncView = true;
    await renderImageCompare();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const compareCanvases = [...document.querySelectorAll("#image-compare .image-surface canvas")].map((item) => [item.width, item.height]);
    const comparePixels = [...document.querySelectorAll("#image-compare .image-surface canvas")].map((item) => [...item.getContext("2d").getImageData(0, 0, item.width, item.height).data].filter((_, index) => index % 4 === 0));
    setCompareZoom("left", 128);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      rgbSize,
      yPixels,
      uSize,
      uPixels,
      zoomedSurface,
      lowZoomOverlay,
      highZoomOverlay,
      rgbOverlayLines,
      sharedChromaLines,
      offOverlay,
      pannedVisibleRange,
      pannedOverlayPosition,
      compareSelectors: document.querySelectorAll("#image-compare .compare-display-mode").length,
      compareCanvases,
      comparePixels,
      compareZoom: [state.compareViews.left.zoom, state.compareViews.right.zoom],
      compareOverlays: [...document.querySelectorAll("#image-compare .compare-pixel-overlay")].map((item) => !item.hidden),
      compareOverlayLines: [yuvOverlayLines(left, 0, 0), yuvOverlayLines(right, 0, 0)],
      status: yuvPixelStatus(left, 1, 0, 2, 1)
    };
  })()`);
  assert.deepEqual(result.rgbSize, [4, 2]);
  assert.deepEqual(result.yPixels, y);
  assert.deepEqual(result.uSize, [2, 1]);
  assert.deepEqual(result.uPixels, [10, 30]);
  assert.deepEqual(result.zoomedSurface, ["4px", "2px"]);
  assert.equal(result.lowZoomOverlay.visible, false);
  assert.equal(result.highZoomOverlay.visible, true);
  assert.equal(result.highZoomOverlay.screenPixelsPerSourcePixel, 128);
  assert.ok(result.highZoomOverlay.cells <= 8);
  assert.deepEqual(result.rgbOverlayLines, ["Y:192", "U:30", "V:40"]);
  assert.deepEqual(result.sharedChromaLines, [["U:30"], ["U:30"]]);
  assert.equal(result.offOverlay.visible, false);
  assert.equal(result.pannedVisibleRange.visible, true);
  assert.ok(result.pannedVisibleRange.cells < 100, JSON.stringify(result.pannedVisibleRange));
  assert.deepEqual(result.pannedOverlayPosition, ["1600px", "800px"]);
  assert.equal(result.compareSelectors, 2);
  assert.deepEqual(result.compareCanvases, [[2, 1], [2, 1]]);
  assert.deepEqual(result.comparePixels, [[10, 30], [20, 40]]);
  assert.deepEqual(result.compareZoom, [128, 128]);
  assert.deepEqual(result.compareOverlays, [true, true]);
  assert.deepEqual(result.compareOverlayLines, [["U:10"], ["V:20"]]);
  assert.match(result.status, /U:30/);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  window.destroy();
  app.quit();
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});
