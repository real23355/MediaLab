const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const path = require("node:path");

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
    document.querySelector("#home").classList.add("hidden");
    document.querySelector("#workspace").classList.remove("hidden");
    document.querySelector("#workspace").classList.add("image-mode");
    document.querySelector("#image-layout").classList.remove("hidden");
    state.docs = [
      { id: "left-image", kind: "image", file: { name: "left.png", size: 1, modified: Date.now() }, url: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='4000' height='2000'/>", width: 4000, height: 2000 },
      { id: "right-image", kind: "heic", file: { name: "right.heic", size: 1, modified: Date.now() }, url: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='2000' height='1000'/>", width: 2000, height: 1000 }
    ];
    state.activeDocId = "left-image";
    state.leftId = "left-image";
    state.rightId = "right-image";
    state.compareMode = true;
    state.syncView = true;
    renderFileTabs();
    await renderImageCompare();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    setCompareZoom("left", 2);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const linkedZoom = [state.compareViews.left.zoom, state.compareViews.right.zoom];
    applyCompareView("left", { x: 0.62, y: 0.41 });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    syncComparePan("left");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const normalized = compareCenter("right", state.compareViews.right.zoom);
    state.syncView = false;
    setCompareZoom("left", 3);
    const independentZoom = [state.compareViews.left.zoom, state.compareViews.right.zoom];
    return {
      viewers: document.querySelectorAll("#image-compare .compare-side").length,
      leftAssigned: document.querySelectorAll("#file-tabs [data-side='left'].selected").length,
      rightAssigned: document.querySelectorAll("#file-tabs [data-side='right'].selected").length,
      linkedZoom,
      independentZoom,
      normalized,
      addButton: Boolean(document.querySelector("#add-image-file")),
      compareHeight: document.querySelector(".image-compare-grid").clientHeight
    };
  })()`);
  assert.equal(result.viewers, 2);
  assert.equal(result.leftAssigned, 1);
  assert.equal(result.rightAssigned, 1);
  assert.deepEqual(result.linkedZoom, [2, 2]);
  assert.deepEqual(result.independentZoom, [3, 2]);
  assert.ok(Math.abs(result.normalized.x - 0.62) < 0.02, JSON.stringify(result.normalized));
  assert.ok(Math.abs(result.normalized.y - 0.41) < 0.02, JSON.stringify(result.normalized));
  assert.equal(result.addButton, true);
  assert.ok(result.compareHeight > 500, String(result.compareHeight));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  window.destroy();
  app.quit();
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});
