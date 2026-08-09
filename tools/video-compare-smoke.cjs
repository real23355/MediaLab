const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1920,
    height: 1080,
    webPreferences: {
      preload: path.join(__dirname, "..", "desktop", "src", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
  });
  await window.loadFile(path.join(__dirname, "..", "desktop", "src", "index.html"));
  const leftUrl = pathToFileURL(path.join(__dirname, "..", "artifacts", "compare-fixtures", "left-proxy.mp4")).toString();
  const rightUrl = pathToFileURL(path.join(__dirname, "..", "artifacts", "compare-fixtures", "right-proxy.mp4")).toString();
  const result = await window.webContents.executeJavaScript(`(async () => {
    const frames = Array.from({ length: 50 }, (_, index) => ({ index, type: index === 0 ? "I" : "P", key: index === 0, size: 1000 + index, offset: index * 1000 }));
    state.streams = [
      { id: "left-video", kind: "h264", file: { name: "left.h264", size: 176874, modified: Date.now() }, analysis: { codec: "h264", width: 320, height: 240, frames }, fps: 25, decoder: "Hardware Decode: D3D11VA", hardware: true, proxyUrl: ${JSON.stringify(leftUrl)}, proxyError: "" },
      { id: "right-video", kind: "h265", file: { name: "right.h265", size: 57295, modified: Date.now() }, analysis: { codec: "hevc", width: 320, height: 240, frames }, fps: 25, decoder: "Hardware Decode: D3D11VA", hardware: true, proxyUrl: ${JSON.stringify(rightUrl)}, proxyError: "" }
    ];
    state.activeStreamId = "left-video";
    state.leftId = "left-video";
    state.rightId = "right-video";
    state.compareMode = true;
    state.syncPlayback = true;
    renderStreamTabs();
    renderStreamCompare();
    const videos = [...document.querySelectorAll("#stream-compare video")];
    await Promise.all(videos.map((video) => video.readyState >= 1 ? Promise.resolve() : new Promise((resolve) => video.addEventListener("loadedmetadata", resolve, { once: true }))));
    document.querySelector("#play-both").click();
    await new Promise((resolve) => setTimeout(resolve, 180));
    const bothPlaying = videos.every((video) => !video.paused);
    document.querySelector("#pause-both").click();
    const bothPaused = videos.every((video) => video.paused);
    const leftSlider = document.querySelector("#stream-compare [data-side='left'] input[type='range']");
    leftSlider.value = "20";
    leftSlider.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const seekTimes = videos.map((video) => video.currentTime);
    document.querySelector("#stream-compare [data-side='left'] [data-action='next']").click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const steppedTimes = videos.map((video) => video.currentTime);
    const gpuLabels = [...document.querySelectorAll(".compare-video-meta")].map((node) => node.textContent);
    state.streams[1].hardware = false;
    state.streams[1].decoder = "Software Decode";
    renderStreamCompare();
    const fallbackLabels = [...document.querySelectorAll(".compare-video-meta")].map((node) => node.textContent);
    return {
      viewers: videos.length,
      bothPlaying,
      bothPaused,
      seekTimes,
      steppedTimes,
      gpuLabels,
      fallbackLabels,
      leftAssigned: document.querySelectorAll("#stream-file-tabs [data-side='left'].selected").length,
      rightAssigned: document.querySelectorAll("#stream-file-tabs [data-side='right'].selected").length,
    };
  })()`);
  assert.equal(result.viewers, 2);
  assert.equal(result.bothPlaying, true);
  assert.equal(result.bothPaused, true);
  assert.ok(Math.abs(result.seekTimes[0] - 0.8) < 0.08, JSON.stringify(result.seekTimes));
  assert.ok(Math.abs(result.seekTimes[1] - 0.8) < 0.08, JSON.stringify(result.seekTimes));
  assert.ok(Math.abs(result.steppedTimes[0] - 0.84) < 0.08, JSON.stringify(result.steppedTimes));
  assert.ok(Math.abs(result.steppedTimes[1] - 0.84) < 0.08, JSON.stringify(result.steppedTimes));
  assert.ok(result.gpuLabels.every((label) => label.includes("GPU 硬解")));
  assert.ok(result.fallbackLabels[0].includes("GPU 硬解"));
  assert.ok(result.fallbackLabels[1].includes("软件解码"));
  assert.equal(result.leftAssigned, 1);
  assert.equal(result.rightAssigned, 1);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  window.destroy();
  app.quit();
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});
