const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const sizes = [
  [1280, 720],
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
];

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "desktop", "src", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  await window.loadFile(path.join(__dirname, "..", "desktop", "src", "index.html"));
  await window.webContents.executeJavaScript(`
    document.querySelector("#home").classList.add("hidden");
    document.querySelector("#workspace").classList.remove("hidden");
    document.querySelector("#workspace").classList.add("image-mode");
    document.querySelector("#image-layout").classList.remove("hidden");
    document.querySelector("#stream-workspace").classList.add("hidden");
    document.querySelector("#raw-workspace").classList.remove("hidden");
    document.querySelector("#yuv-workspace").classList.add("hidden");
    document.querySelector("#heic-workspace").classList.add("hidden");
    document.querySelector("#file-tabs").innerHTML = "<h2>已解析文件</h2>";
    document.querySelector("#file-summary").innerHTML = "<div><strong>D65_6086k.raw</strong><small>3840 × 2160</small></div>";
    state.docs = [{
      id: "layout-test",
      kind: "raw",
      config: { width: 3840, height: 2160, bitDepth: 10, bayer: "RGGB", packing: "unpacked16le" },
      values: new Uint16Array(1),
      zoom: null,
      fitMode: true,
      pixel: { x: 0, y: 0 }
    }];
    state.activeDocId = "layout-test";
    document.querySelector("#raw-canvas").width = 3840;
    document.querySelector("#raw-canvas").height = 2160;
    fitImage("raw");
  `);

  const results = [];
  for (const [width, height] of sizes) {
    window.setContentSize(width, height);
    await delay(180);
    const result = await window.webContents.executeJavaScript(`
      fitImage("raw");
      (() => {
        const stage = document.querySelector("#raw-stage");
        const surface = stage.querySelector(".image-surface");
        const style = getComputedStyle(stage);
        return {
          viewport: { width: innerWidth, height: innerHeight },
          viewer: { width: stage.clientWidth, height: stage.clientHeight },
          usable: {
            width: stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
            height: stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
          },
          surface: { width: surface.offsetWidth, height: surface.offsetHeight },
          fitScale: surface.offsetWidth / 3840,
          fitMode: state.docs[0].fitMode
        };
      })()
    `);
    results.push(result);
  }

  await window.webContents.executeJavaScript('setImageZoom("raw", 1)');
  window.setContentSize(1920, 1080);
  await delay(180);
  const manualAfterResize = await window.webContents.executeJavaScript(`(() => {
    const stage = document.querySelector("#raw-stage");
    const surface = stage.querySelector(".image-surface");
    return {
      fitMode: state.docs[0].fitMode,
      surface: { width: surface.offsetWidth, height: surface.offsetHeight }
    };
  })()`);

  const output = `${JSON.stringify({ measurements: results, manualAfterResize }, null, 2)}\n`;
  fs.writeFileSync(path.join(__dirname, "..", "artifacts", "desktop-layout-v005.json"), output);
  process.stdout.write(output);
  window.destroy();
  app.quit();
}).catch((error) => {
  const output = `${error.stack || error.message}\n`;
  fs.writeFileSync(path.join(__dirname, "..", "artifacts", "desktop-layout-v005.error.log"), output);
  process.stderr.write(output);
  app.exit(1);
});
