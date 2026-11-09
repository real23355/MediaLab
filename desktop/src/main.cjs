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
const children = new Map();
const toolJobs=new Map();
let generation = 0;
let encoderChoice = null;

function checkSession(epoch) {
  if (epoch !== generation) throw new Error("解析已取消");
}

function progress(event, jobId, phase, percent, detail = "") {
  if (!event.sender.isDestroyed()) event.sender.send("parse-progress", { jobId, phase, percent, detail });
}

async function clearMediaSession() {
  generation += 1;
  encoderChoice = null;
  const outputs = [...tempOutputs];
  tempOutputs.clear();
  const pending = [...children.entries()];
  for (const [child] of pending) child.kill();
  await Promise.allSettled(pending.map(([, done]) => done));
  await Promise.allSettled(outputs.map(file => fsp.unlink(file)));
  return { cleared: outputs.length };
}
ipcMain.handle("reset-session", clearMediaSession);

function toolPath(name) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "ffmpeg", `${name}.exe`);
  }
  return path.join(__dirname, "..", "ffmpeg", "bin", `${name}.exe`);
}

function runTool(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { onStdout, onStderr, jobId, ...spawnOptions } = options;
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...spawnOptions,
    });
    const stdout = [];
    const stderr = [];
    let closed;
    children.set(child, new Promise(resolve => { closed = resolve; }));
    if(jobId)toolJobs.set(jobId,child);
    child.stdout.on("data", (chunk) => { stdout.push(chunk); onStdout?.(chunk); });
    let stderrSize=0;
    child.stderr.on("data", (chunk) => {stderr.push(chunk);stderrSize+=chunk.length;while(stderrSize>4*1024*1024&&stderr.length>1)stderrSize-=stderr.shift().length;onStderr?.(chunk);});
    child.on("error", reject);
    child.on("close", (code) => {
      children.delete(child);
      if(jobId&&toolJobs.get(jobId)===child)toolJobs.delete(jobId);
      closed();
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
    title: "选择 YUV / SYUV / Bayer RAW / HEIC / RGB 图片 / H.264 / H.265 文件",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "MediaLab 支持的文件",
        extensions: ["yuv", "raw", "syuv", "nv12", "nv21", "heic", "heif", "png", "jpg", "jpeg", "bmp", "webp", "264", "h264", "avc", "265", "h265", "hevc"]
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

ipcMain.handle("decode-heic", async (event, filePath,jobId) => {
  const epoch = generation;
  progress(event,jobId,"读取 HEIC",0);
  const source = await fsp.readFile(filePath);
  checkSession(epoch);
  progress(event,jobId,"提取 HEIC 图像",30);
  const extracted = extractHeicFrame(source);
  const base = path.basename(filePath, path.extname(filePath)).replace(/[^\w.-]+/g, "_");
  const input = path.join(
    os.tmpdir(),
    `MediaLab-heic-${base}-${Date.now()}-${Math.random().toString(16).slice(2)}.h265`
  );
  tempOutputs.add(input);
  try {
    await fsp.writeFile(input, extracted.annexB);
    checkSession(epoch);
    progress(event,jobId,"解码 HEIC",50);
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
    checkSession(epoch);
    progress(event,jobId,"HEIC 完成",100);
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

ipcMain.handle("probe-stream", async (event, filePath, kind, jobId) => {
  const epoch = generation;
  const size = (await fsp.stat(filePath)).size;
  checkSession(epoch);
  progress(event, jobId, "分析帧结构", 0);
  const inputFormat = kind === "h265" ? "hevc" : "h264";
  const args = [
    "-v", "error",
    "-f", inputFormat,
    "-skip_loop_filter", "all",
    "-skip_idct", "all",
    "-show_entries",
    "stream=index,codec_name,profile,level,width,height,pix_fmt,r_frame_rate,avg_frame_rate,nb_read_frames:format=size,format_name:frame=key_frame,pict_type,pkt_size,pkt_pos,best_effort_timestamp_time,coded_picture_number,display_picture_number",
    "-count_frames",
    "-show_frames",
    "-of", "json",
    filePath
  ];
  let tail = "";
  let last = 0;
  const { stdout } = await runTool(toolPath("ffprobe"), args, {
    onStdout(chunk) {
      tail += chunk.toString("utf8");
      const positions = [...tail.matchAll(/"pkt_pos"\s*:\s*"?(\d+)/g)];
      tail = tail.slice(-100);
      if (positions.length && Date.now() - last > 120 && epoch === generation) {
        last = Date.now();
        progress(event, jobId, "分析帧结构", Math.min(44, Number(positions.at(-1)[1]) / Math.max(1, size) * 45), "按文件读取位置估算");
      }
    }
  });
  checkSession(epoch);
  progress(event, jobId, "帧结构分析完成", 45);
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

ipcMain.handle("create-proxy", async (event, filePath, kind, fps, frameCount = 0, jobId) => {
  const epoch = generation;
  const inputFormat = kind === "h265" ? "hevc" : "h264";
  const base = path.basename(filePath, path.extname(filePath)).replace(/[^\w.-]+/g, "_");
  const output = path.join(
    os.tmpdir(),
    `MediaLab-${base}-${Date.now()}-${Math.random().toString(16).slice(2)}.mp4`
  );
  tempOutputs.add(output);
  let lastProgress = 45;
  let tail = "";
  const monitor = chunk => {
    tail += chunk.toString("utf8");
    const lines = tail.split(/\r?\n/); tail = lines.pop();
    for (const line of lines) {
      const match = /^frame=(\d+)/.exec(line);
      if (match && epoch === generation) {
        lastProgress = Math.max(lastProgress, Math.min(99, 45 + Number(match[1]) / Math.max(1, frameCount) * 54));
        progress(event, jobId, "生成播放画面", frameCount ? lastProgress : null, `已处理 ${match[1]} 帧`);
      }
    }
  };
  const proxyArgs = (accel, encoder) => [
    "-hide_banner",
    "-loglevel", "error",
    ...(accel ? ["-hwaccel", accel] : []),
    ...(accel === "cuda" ? ["-hwaccel_output_format", "cuda"] : []),
    "-fflags", "+genpts",
    "-r", String(Math.max(1, Number(fps) || 25)),
    "-f", inputFormat,
    "-i", filePath,
    "-an",
    "-c:v", encoder,
    ...(encoder === "h264_nvenc" ? ["-preset", "p1", "-rc", "constqp", "-qp", "20"] :
      encoder === "h264_qsv" ? ["-preset", "veryfast", "-global_quality", "20"] :
      encoder === "h264_amf" ? ["-quality", "speed", "-rc", "cqp", "-qp_i", "20", "-qp_p", "20"] :
      ["-preset", "ultrafast", "-crf", "20"]),
    "-bf", "0",
    ...(accel === "cuda" ? [] : ["-pix_fmt", "yuv420p"]),
    "-movflags", "+faststart",
    "-progress", "pipe:1", "-nostats",
    "-y",
    output
  ];
  const gpu = await app.getGPUInfo("basic").catch(() => ({}));
  checkSession(epoch);
  const vendors = (gpu.gpuDevice || []).map(device => device.vendorId);
  const encoders = [vendors.includes(0x10de) && "h264_nvenc", vendors.includes(0x8086) && "h264_qsv", vendors.includes(0x1002) && "h264_amf"].filter(Boolean);
  const attempts = [];
  if (encoderChoice?.encoder !== "libx264" && encoderChoice) attempts.push(encoderChoice);
  if (vendors.includes(0x10de)) attempts.push({ accel: "cuda", encoder: "h264_nvenc" });
  attempts.push(...encoders.map(encoder => ({ accel: "d3d11va", encoder })));
  attempts.push({ accel: "d3d11va", encoder: "libx264" }, { accel: null, encoder: "libx264" });
  const tried = new Set();
  let failure;
  for (const attempt of attempts) {
    const key = JSON.stringify(attempt);
    if (tried.has(key)) continue;
    tried.add(key);
    checkSession(epoch);
    tail = "";
    progress(event, jobId, failure ? "切换备用解码/编码方案" : "准备播放画面", lastProgress, `${attempt.accel?.toUpperCase() || "CPU"} → ${attempt.encoder}`);
    try {
      await runTool(toolPath("ffmpeg"), proxyArgs(attempt.accel, attempt.encoder), { onStdout: monitor });
      checkSession(epoch);
      encoderChoice = attempt;
      progress(event, jobId, "解析完成", 100, attempt.encoder);
      return { url: pathToFileURL(output).toString(), decoder: attempt.accel ? `Hardware Decode: ${attempt.accel.toUpperCase()}` : "Software Decode", hardware: Boolean(attempt.accel), encoder: attempt.encoder, fallbackReason: failure?.message };
    } catch (error) {
      checkSession(epoch);
      failure = error;
    }
  }
  await fsp.unlink(output).catch(() => {});
  tempOutputs.delete(output);
  throw failure;
});

ipcMain.handle("app-version", () => app.getVersion());
ipcMain.handle("cancel-job",async(_event,id)=>{const child=toolJobs.get(id);if(child){const done=children.get(child);child.kill();await done;}});

ipcMain.handle("extract-frame",async(event,filePath,kind,index,width,height,pixelFormat,jobId)=>{
  const epoch=generation;
  if(!Number.isInteger(index)||index<0||index>10000000)throw Error("无效帧号");
  if(!Number.isInteger(width)||!Number.isInteger(height)||width*height>40000000)throw Error("无效分辨率");
  if(!/^(yuv(420|422|444)p(10le|12le|16le)?|gray(10le|12le|16le)?)$/.test(pixelFormat))throw Error("原始采样查看暂不支持此像素格式："+pixelFormat);
  const raw=path.join(os.tmpdir(),`MediaLab-frame-${Date.now()}-${Math.random().toString(16).slice(2)}.raw`);
  tempOutputs.add(raw);
  progress(event,jobId,"解码原始帧",0,"从原文件读取，不经过播放代理");
  let tail="",last=0;
  try{
    const {stdout}=await runTool(toolPath("ffmpeg"),[
      "-hide_banner","-loglevel","info","-f",kind==="h265"?"hevc":"h264","-i",filePath,
      "-filter_complex",`[0:v]showinfo,select=eq(n\\,${index}),split[r][p];[p]format=rgb24[png]`,
      "-map","[png]","-frames:v","1","-c:v","png","-f","image2pipe","pipe:1",
      "-map","[r]","-frames:v","1","-c:v","rawvideo","-pix_fmt",pixelFormat,"-f","rawvideo","-y",raw
    ],{jobId,onStderr(chunk){
      tail+=chunk.toString();const matches=[...tail.matchAll(/\bn:\s*(\d+)/g)];tail=tail.slice(-150);
      if(matches.length&&Date.now()-last>100&&epoch===generation){last=Date.now();progress(event,jobId,"解码原始帧",Math.min(98,Number(matches.at(-1)[1])/(index+1)*98));}
    }});
    checkSession(epoch);
    if(!stdout.length)throw Error("该帧未成功解码，可能缺少参考帧");
    const bytes=await fsp.readFile(raw);checkSession(epoch);
    progress(event,jobId,"原始帧完成",100);
    return {png:stdout,bytes,width,height,pixelFormat,index};
  }finally{tempOutputs.delete(raw);await fsp.unlink(raw).catch(()=>{});}
});
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
  for (const child of children.keys()) child.kill();
  for (const output of tempOutputs) {
    try {
      fs.unlinkSync(output);
    } catch {
      // A failed cleanup must never block shutdown.
    }
  }
});
