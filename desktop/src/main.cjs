const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { extractHeicFrame } = require("./heic.cjs");

app.setName("MediaLab");
app.commandLine.appendSwitch("disable-features", "OutOfBlinkCors");

let mainWindow;
const tempOutputs = new Set();

function toolPath(name) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "ffmpeg", `${name}.exe`);
  }
  return path.join(__dirname, "..", "ffmpeg", "bin", `${name}.exe`);
}

function runTool(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const out = Buffer.concat(stdout);
      const err = Buffer.concat(stderr).toString("utf8");
      if (code === 0) resolve({ stdout: out, stderr: err });
      else reject(new Error(err.trim() || `${path.basename(executable)} 退出码 ${code}`));
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: "#f4f5f1",
    title: "MediaLab——视频码流与图像分析工具",
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
}

ipcMain.handle("select-files", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择 YUV / SYUV / HEIC / H.264 / H.265 文件",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "MediaLab 支持的文件",
        extensions: ["yuv", "raw", "syuv", "heic", "heif", "264", "h264", "avc", "265", "h265", "hevc"]
      },
      { name: "所有文件", extensions: ["*"] }
    ]
  });
  if (result.canceled || !result.filePaths.length) return [];
  return Promise.all(result.filePaths.map(fileInfo));
});

ipcMain.handle("file-info", async (_event, filePath) => fileInfo(filePath));

async function fileInfo(filePath) {
  const stat = await fsp.stat(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    size: stat.size,
    modified: stat.mtimeMs
  };
}

ipcMain.handle("read-slice", async (_event, filePath, start, length) => {
  const handle = await fsp.open(filePath, "r");
  try {
    const safeLength = Math.max(0, Math.min(Number(length), 256 * 1024 * 1024));
    const buffer = Buffer.allocUnsafe(safeLength);
    const { bytesRead } = await handle.read(buffer, 0, safeLength, Number(start));
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
});

ipcMain.handle("decode-heic", async (_event, filePath) => {
  const source = await fsp.readFile(filePath);
  const extracted = extractHeicFrame(source);
  const base = path.basename(filePath, path.extname(filePath)).replace(/[^\w.-]+/g, "_");
  const input = path.join(
    os.tmpdir(),
    `MediaLab-heic-${base}-${Date.now()}-${Math.random().toString(16).slice(2)}.h265`
  );
  tempOutputs.add(input);
  try {
    await fsp.writeFile(input, extracted.annexB);
    const { stdout } = await runTool(toolPath("ffmpeg"), [
      "-hide_banner",
      "-loglevel", "error",
      "-f", "hevc",
      "-i", input,
      "-frames:v", "1",
      "-f", "image2pipe",
      "-c:v", "png",
      "pipe:1"
    ]);
    return {
      bytes: stdout,
      width: extracted.width,
      height: extracted.height
    };
  } finally {
    tempOutputs.delete(input);
    try {
      await fsp.unlink(input);
    } catch {
      // Temporary cleanup failure is safe to ignore.
    }
  }
});

ipcMain.handle("probe-stream", async (_event, filePath, kind) => {
  const inputFormat = kind === "h265" ? "hevc" : "h264";
  const args = [
    "-v", "error",
    "-f", inputFormat,
    "-show_entries",
    "stream=index,codec_name,profile,level,width,height,pix_fmt,r_frame_rate,avg_frame_rate,nb_read_frames:format=size,format_name:frame=key_frame,pict_type,pkt_size,pkt_pos,best_effort_timestamp_time,coded_picture_number,display_picture_number",
    "-count_frames",
    "-show_frames",
    "-of", "json",
    filePath
  ];
  const { stdout } = await runTool(toolPath("ffprobe"), args);
  const parsed = JSON.parse(stdout.toString("utf8"));
  const stream = parsed.streams?.[0] || {};
  const frames = (parsed.frames || [])
    .filter((frame) => frame.pict_type === "I" || frame.pict_type === "P")
    .map((frame, index) => ({
      index,
      type: frame.pict_type,
      key: Number(frame.key_frame) === 1 || frame.pict_type === "I",
      size: Number(frame.pkt_size) || 0,
      offset: Number(frame.pkt_pos) || 0,
      timestamp: Number(frame.best_effort_timestamp_time) || null,
      coded: Number(frame.coded_picture_number) || index,
      display: Number(frame.display_picture_number) || index
    }));
  return {
    codec: stream.codec_name || inputFormat,
    profile: stream.profile || "—",
    level: stream.level || null,
    width: Number(stream.width) || null,
    height: Number(stream.height) || null,
    pixelFormat: stream.pix_fmt || "—",
    rate: stream.avg_frame_rate || stream.r_frame_rate || null,
    frameCount: Number(stream.nb_read_frames) || frames.length,
    formatName: parsed.format?.format_name || inputFormat,
    size: Number(parsed.format?.size) || (await fsp.stat(filePath)).size,
    frames
  };
});

ipcMain.handle("create-proxy", async (_event, filePath, kind, fps) => {
  const inputFormat = kind === "h265" ? "hevc" : "h264";
  const base = path.basename(filePath, path.extname(filePath)).replace(/[^\w.-]+/g, "_");
  const output = path.join(
    os.tmpdir(),
    `MediaLab-${base}-${Date.now()}-${Math.random().toString(16).slice(2)}.mp4`
  );
  tempOutputs.add(output);
  const args = [
    "-hide_banner",
    "-loglevel", "error",
    "-fflags", "+genpts",
    "-r", String(Math.max(1, Number(fps) || 25)),
    "-f", inputFormat,
    "-i", filePath,
    "-an",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-y",
    output
  ];
  await runTool(toolPath("ffmpeg"), args);
  return pathToFileURL(output).toString();
});

ipcMain.handle("app-version", () => app.getVersion());
ipcMain.handle("restart-app", () => {
  app.relaunch();
  app.exit(0);
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  for (const output of tempOutputs) {
    try {
      fs.unlinkSync(output);
    } catch {
      // A failed cleanup must never block shutdown.
    }
  }
});
