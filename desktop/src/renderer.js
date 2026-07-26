const M = window.MediaTools;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const IMAGE_LIMIT = 10;
const PAGE_SIZE = 100;

const state = {
  pending: [],
  docs: [],
  activeDocId: "",
  yuvTimer: null,
  renderToken: 0,
  streamFile: null,
  stream: {
    analysis: null,
    fps: 25,
    page: 0,
    currentFrame: 0
  }
};

function show(element, visible = true) {
  element.classList.toggle("hidden", !visible);
}

function toast(message) {
  const element = $("#toast");
  element.querySelector("span").textContent = message;
  show(element, true);
}

$("#toast button").addEventListener("click", () => show($("#toast"), false));

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function extensionKind(name) {
  const lower = name.toLowerCase();
  if (/\.(heic|heif)$/.test(lower)) return "heic";
  if (/\.(265|h265|hevc)$/.test(lower)) return "h265";
  if (/\.(264|h264|avc)$/.test(lower)) return "h264";
  return "yuv";
}

function fileMarkup(file, label = "") {
  const date = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  }).format(new Date(file.modified));
  return `
    <span class="file-icon">01</span>
    <div><strong title="${escapeHtml(file.path)}">${escapeHtml(file.name)}</strong>
    <small>${M.formatBytes(file.size)} · ${date}</small></div>
    ${label ? `<em>${escapeHtml(label)}</em>` : ""}
  `;
}

function clearDocuments() {
  stopYuv();
  state.docs.forEach((doc) => {
    if (doc.kind === "heic" && doc.url) URL.revokeObjectURL(doc.url);
  });
  state.docs = [];
  state.activeDocId = "";
}

function returnHome() {
  clearDocuments();
  resetPlayback();
  state.pending = [];
  state.streamFile = null;
  $("#pending-list").innerHTML = "";
  show($("#home"), true);
  show($("#type-screen"), false);
  show($("#workspace"), false);
  show($("#new-file"), false);
  show($("#toast"), false);
}

$("#new-file").addEventListener("click", returnHome);
$("#brand-home").addEventListener("click", returnHome);

async function receiveInfos(infos) {
  if (!infos?.length) return;
  returnHome();
  const accepted = infos.slice(0, IMAGE_LIMIT);
  if (infos.length > IMAGE_LIMIT) {
    toast(`YUV / HEIC 一次最多选择 ${IMAGE_LIMIT} 个文件，已保留前 ${IMAGE_LIMIT} 个。`);
  }
  state.pending = accepted.map((file, index) => ({
    ...file,
    id: `${file.path}-${index}`,
    kind: extensionKind(file.name)
  }));
  renderPendingList();
  show($("#home"), false);
  show($("#type-screen"), true);
  show($("#new-file"), true);
}

async function receiveDroppedFiles(files) {
  const infos = [];
  for (const file of files) {
    const filePath = window.desktop.pathForFile(file);
    if (!filePath) continue;
    infos.push(await window.desktop.fileInfo(filePath));
  }
  if (!infos.length) {
    toast("无法取得拖入文件的本地路径，请使用“选择文件”。");
    return;
  }
  await receiveInfos(infos);
}

$("#browse").addEventListener("click", async () => {
  const files = await window.desktop.selectFiles();
  await receiveInfos(files);
});

$("#drop-zone").addEventListener("dragover", (event) => {
  event.preventDefault();
  event.currentTarget.classList.add("dragging");
});
$("#drop-zone").addEventListener("dragleave", (event) => {
  event.currentTarget.classList.remove("dragging");
});
$("#drop-zone").addEventListener("drop", async (event) => {
  event.preventDefault();
  event.currentTarget.classList.remove("dragging");
  await receiveDroppedFiles([...event.dataTransfer.files]);
});

function renderPendingList() {
  const options = [
    ["yuv", "YUV 原始图像"],
    ["heic", "HEIC 图片"],
    ["h264", "H.264 裸码流"],
    ["h265", "H.265 裸码流"]
  ];
  $("#pending-list").innerHTML = state.pending.map((file, index) => `
    <div class="pending-row" data-id="${escapeHtml(file.id)}">
      <span class="file-icon">${String(index + 1).padStart(2, "0")}</span>
      <div><strong title="${escapeHtml(file.path)}">${escapeHtml(file.name)}</strong>
      <small>${M.formatBytes(file.size)}</small></div>
      <label><span>解析选项</span>
        <select>${options.map(([value, label]) =>
          `<option value="${value}" ${file.kind === value ? "selected" : ""}>${label}</option>`
        ).join("")}</select>
      </label>
    </div>
  `).join("");
  $$("#pending-list .pending-row").forEach((row) => {
    row.querySelector("select").addEventListener("change", (event) => {
      const entry = state.pending.find((file) => file.id === row.dataset.id);
      if (entry) entry.kind = event.target.value;
    });
  });
  $("#parse-files").textContent = `开始解析 ${state.pending.length} 个文件`;
}

$("#parse-files").addEventListener("click", parsePendingFiles);

async function parsePendingFiles() {
  const streamFiles = state.pending.filter((file) => file.kind === "h264" || file.kind === "h265");
  if (streamFiles.length && state.pending.length !== 1) {
    toast("H.264 / H.265 当前一次只支持一个文件，请返回首页后单独选择该码流。");
    return;
  }
  const button = $("#parse-files");
  button.disabled = true;
  button.textContent = "正在解析…";
  try {
    if (streamFiles[0]) {
      show($("#type-screen"), false);
      show($("#workspace"), true);
      show($("#image-layout"), false);
      show($("#stream-workspace"), true);
      await openStream(streamFiles[0], streamFiles[0].kind);
      return;
    }
    const docs = [];
    for (const file of state.pending) {
      if (file.kind === "yuv") docs.push(await createYuvDocument(file));
      else if (file.kind === "heic") docs.push(await createHeicDocument(file));
    }
    clearDocuments();
    state.docs = docs;
    state.activeDocId = docs[0]?.id || "";
    state.pending = [];
    show($("#type-screen"), false);
    show($("#workspace"), true);
    show($("#image-layout"), true);
    show($("#stream-workspace"), false);
    renderFileTabs();
    await showActiveDocument();
  } catch (error) {
    toast(`解析失败：${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = "开始解析";
  }
}

async function createYuvDocument(file) {
  const sampleLength = Math.min(file.size, 32 * 1024 * 1024);
  const sample = new Uint8Array(await window.desktop.readSlice(file.path, 0, sampleLength));
  const candidates = M.detectYuv(sample, file.size, file.name);
  const frameBytes = M.frameBytes(1920, 1080, "I420");
  return {
    id: file.id,
    kind: "yuv",
    file,
    candidates,
    config: candidates[0] || {
      width: 1920,
      height: 1080,
      format: "I420",
      frameBytes,
      frameCount: Math.max(1, Math.floor(file.size / frameBytes)),
      dataOffset: 0,
      reason: "手动参数"
    },
    frame: 0,
    fps: 25,
    playing: false
  };
}

async function createHeicDocument(file) {
  if (file.size > 256 * 1024 * 1024) {
    throw new Error(`${file.name} 超过 256 MB，无法在当前版本中解码。`);
  }
  if (typeof window.heic2any !== "function") throw new Error("HEIC 解码器未加载");
  const bytes = new Uint8Array(await window.desktop.readSlice(file.path, 0, file.size));
  const result = await window.heic2any({
    blob: new Blob([bytes], { type: "image/heic" }),
    toType: "image/png"
  });
  const blob = Array.isArray(result) ? result[0] : result;
  const url = URL.createObjectURL(blob);
  const size = await loadImageSize(url);
  return { id: file.id, kind: "heic", file, url, ...size };
}

function loadImageSize(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("转换后的 HEIC 图像无法显示"));
    image.src = url;
  });
}

function activeDocument() {
  return state.docs.find((doc) => doc.id === state.activeDocId) || state.docs[0];
}

function renderFileTabs() {
  $("#file-tabs").innerHTML = `
    <h2>已解析文件</h2>
    ${state.docs.map((doc, index) => `
      <button data-id="${escapeHtml(doc.id)}" class="${doc.id === state.activeDocId ? "active" : ""}">
        <b>${String(index + 1).padStart(2, "0")}</b>
        <span title="${escapeHtml(doc.file.name)}">${escapeHtml(doc.file.name)}</span>
        <em>${doc.kind === "yuv" ? "YUV" : "HEIC"}</em>
      </button>
    `).join("")}
  `;
  $$("#file-tabs button").forEach((button) => {
    button.addEventListener("click", async () => {
      stopYuv();
      state.activeDocId = button.dataset.id;
      renderFileTabs();
      await showActiveDocument();
    });
  });
}

async function showActiveDocument() {
  const doc = activeDocument();
  if (!doc) return;
  $("#file-summary").innerHTML = fileMarkup(doc.file, doc.kind === "yuv" ? "YUV / SYUV" : "HEIC");
  show($("#yuv-workspace"), doc.kind === "yuv");
  show($("#heic-workspace"), doc.kind === "heic");
  if (doc.kind === "yuv") {
    populateYuvFormats();
    syncYuvControls();
    renderCandidateList();
    await renderYuvFrame();
  } else {
    $("#heic-image").src = doc.url;
    $("#heic-image").alt = doc.file.name;
    $("#heic-info").textContent = `${doc.width} × ${doc.height}`;
  }
}

function populateYuvFormats() {
  $("#yuv-format").innerHTML = M.FORMATS.map((format) => `<option>${format}</option>`).join("");
}

function syncYuvControls() {
  const doc = activeDocument();
  if (!doc || doc.kind !== "yuv") return;
  const config = doc.config;
  $("#yuv-format").value = config.format;
  $("#yuv-width").value = config.width;
  $("#yuv-height").value = config.height;
  $("#yuv-fps").value = doc.fps;
  $("#yuv-slider").max = Math.max(0, config.frameCount - 1);
  $("#yuv-slider").value = doc.frame;
  $("#yuv-counter").textContent = `帧 ${doc.frame + 1} / ${config.frameCount}`;
  $("#yuv-detected").innerHTML = `
    <span>当前解析</span>
    <strong>${config.width} × ${config.height} · ${config.format}</strong>
    <small>每帧 ${M.formatBytes(config.frameBytes)} · 共 ${config.frameCount.toLocaleString("zh-CN")} 帧
    ${config.dataOffset ? ` · 文件头 ${config.dataOffset} B` : ""}</small>
  `;
}

function renderCandidateList() {
  const doc = activeDocument();
  if (!doc || doc.kind !== "yuv") return;
  const container = $("#yuv-candidates");
  container.innerHTML = doc.candidates.slice(0, 10).map((candidate, index) => `
    <button data-index="${index}">
      <b>${index === 0 && candidate.score > 70 ? "高" : index === 0 ? "中" : "备选"}</b>
      <span>${candidate.width}×${candidate.height} ${candidate.format}</span>
      <small>${candidate.reason}</small>
    </button>
  `).join("");
  container.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", async () => {
      doc.config = doc.candidates[Number(button.dataset.index)];
      doc.frame = 0;
      syncYuvControls();
      await renderYuvFrame();
    });
  });
}

async function renderYuvFrame() {
  const token = ++state.renderToken;
  const doc = activeDocument();
  if (!doc || doc.kind !== "yuv") return;
  const config = doc.config;
  doc.frame = Math.max(0, Math.min(doc.frame, config.frameCount - 1));
  try {
    const raw = new Uint8Array(await window.desktop.readSlice(
      doc.file.path,
      (config.dataOffset || 0) + doc.frame * config.frameBytes,
      config.frameBytes
    ));
    if (token !== state.renderToken) return;
    if (raw.byteLength < config.frameBytes) throw new Error("文件长度不足一帧");
    const image = M.renderYuv(raw, config.width, config.height, config.format);
    const canvas = $("#yuv-canvas");
    canvas.width = config.width;
    canvas.height = config.height;
    canvas.getContext("2d", { alpha: false }).putImageData(image, 0, 0);
    $("#yuv-slider").value = doc.frame;
    $("#yuv-counter").textContent = `帧 ${doc.frame + 1} / ${config.frameCount}`;
    $("#yuv-time").textContent = M.formatTime(doc.frame / Math.max(1, doc.fps));
  } catch (error) {
    toast(`YUV 画面读取失败：${error.message}`);
  }
}

async function changeYuvConfig() {
  const doc = activeDocument();
  if (!doc || doc.kind !== "yuv") return;
  const width = Math.max(1, Number($("#yuv-width").value) || 1);
  const height = Math.max(1, Number($("#yuv-height").value) || 1);
  const format = $("#yuv-format").value;
  const bytes = M.frameBytes(width, height, format);
  doc.config = {
    ...doc.config,
    width,
    height,
    format,
    frameBytes: bytes,
    frameCount: Math.max(1, Math.floor((doc.file.size - (doc.config.dataOffset || 0)) / bytes)),
    reason: "手动调整"
  };
  doc.frame = 0;
  syncYuvControls();
  await renderYuvFrame();
}

["#yuv-format", "#yuv-width", "#yuv-height"].forEach((selector) => {
  $(selector).addEventListener("change", changeYuvConfig);
});
$("#yuv-fps").addEventListener("change", () => {
  const doc = activeDocument();
  if (!doc || doc.kind !== "yuv") return;
  doc.fps = Math.max(1, Number($("#yuv-fps").value) || 25);
  renderYuvFrame();
});
$("#yuv-slider").addEventListener("input", async (event) => {
  stopYuv();
  const doc = activeDocument();
  if (!doc || doc.kind !== "yuv") return;
  doc.frame = Number(event.target.value);
  await renderYuvFrame();
});
$("#yuv-prev").addEventListener("click", async () => {
  stopYuv();
  const doc = activeDocument();
  if (!doc || doc.kind !== "yuv") return;
  doc.frame = Math.max(0, doc.frame - 1);
  await renderYuvFrame();
});
$("#yuv-next").addEventListener("click", async () => {
  stopYuv();
  const doc = activeDocument();
  if (!doc || doc.kind !== "yuv") return;
  doc.frame = Math.min(doc.config.frameCount - 1, doc.frame + 1);
  await renderYuvFrame();
});
$("#yuv-play").addEventListener("click", () => {
  const doc = activeDocument();
  if (!doc || doc.kind !== "yuv") return;
  if (doc.playing) stopYuv();
  else startYuv();
});

function startYuv() {
  const doc = activeDocument();
  if (!doc || doc.kind !== "yuv") return;
  doc.playing = true;
  $("#yuv-play").textContent = "Ⅱ";
  state.yuvTimer = setInterval(async () => {
    const current = activeDocument();
    if (!current || current.id !== doc.id || current.kind !== "yuv"
      || current.frame >= current.config.frameCount - 1) {
      stopYuv();
      return;
    }
    current.frame += 1;
    await renderYuvFrame();
  }, 1000 / Math.max(1, doc.fps));
}

function stopYuv() {
  state.docs.forEach((doc) => {
    if (doc.kind === "yuv") doc.playing = false;
  });
  $("#yuv-play").textContent = "▶";
  if (state.yuvTimer) clearInterval(state.yuvTimer);
  state.yuvTimer = null;
}

function notice(message, type = "working", stream = false) {
  const element = stream ? $("#stream-notice") : $("#notice");
  element.textContent = message;
  element.className = `notice ${type}`;
  show(element, Boolean(message));
}

async function openStream(file, kind) {
  resetPlayback();
  state.streamFile = file;
  $("#stream-summary").innerHTML = fileMarkup(file, kind === "h264" ? "H.264 / AVC" : "H.265 / HEVC");
  notice("正在读取与分析码流…", "working", true);
  const analysis = await window.desktop.probeStream(file.path, kind);
  state.stream.analysis = analysis;
  state.stream.page = 0;
  state.stream.currentFrame = 0;
  state.stream.fps = parseRate(analysis.rate) || 25;
  renderStreamSummary();
  renderFrameChart();
  renderFrameTable();
  updateCurrentFrameUi();
  notice("", "working", true);
  prepareProxy(file, kind);
}

function parseRate(rate) {
  if (!rate) return 0;
  const [top, bottom] = String(rate).split("/").map(Number);
  return bottom ? top / bottom : top;
}

function renderStreamSummary() {
  const analysis = state.stream.analysis;
  const frames = analysis.frames;
  const duration = frames.length / state.stream.fps;
  const bitrate = duration ? (analysis.size * 8) / duration : 0;
  const keyframes = frames.filter((frame) => frame.key).length;
  const average = frames.length ? frames.reduce((sum, frame) => sum + frame.size, 0) / frames.length : 0;
  const max = frames.length ? Math.max(...frames.map((frame) => frame.size)) : 0;
  const min = frames.length ? Math.min(...frames.map((frame) => frame.size)) : 0;
  $("#stream-metrics").innerHTML = [
    ["分辨率", analysis.width ? `${analysis.width} × ${analysis.height}` : "未读出"],
    ["编码帧", frames.length.toLocaleString("zh-CN")],
    ["I 帧", keyframes.toLocaleString("zh-CN")],
    ["最大帧", M.formatBytes(max)],
    ["最小帧", M.formatBytes(min)],
    ["估算时长", M.formatTime(duration)]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
  $("#stream-info").innerHTML = [
    ["编码", analysis.codec.toUpperCase()],
    ["Profile", analysis.profile],
    ["Level", analysis.level ?? "—"],
    ["像素格式", analysis.pixelFormat],
    ["帧率", `${state.stream.fps.toFixed(3)} fps`],
    ["平均帧大小", M.formatBytes(average)],
    ["最大帧大小", M.formatBytes(max)],
    ["最小帧大小", M.formatBytes(min)],
    ["估算码率", bitrate ? `${(bitrate / 1_000_000).toFixed(2)} Mbps` : "—"]
  ].map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("");
}

function renderFrameChart() {
  const frames = state.stream.analysis.frames;
  const slots = Math.min(200, frames.length);
  const sampled = [];
  for (let slot = 0; slot < slots; slot += 1) {
    const start = Math.floor((slot * frames.length) / slots);
    const end = Math.max(start + 1, Math.floor(((slot + 1) * frames.length) / slots));
    const group = frames.slice(start, end);
    const largest = group.reduce((best, frame) => frame.size > best.size ? frame : best);
    sampled.push({ ...largest, rangeStart: start, rangeEnd: end });
  }
  const max = Math.max(1, ...sampled.map((frame) => frame.size));
  $("#y-axis").innerHTML = [1, 0.75, 0.5, 0.25, 0].map((tick) => `
    <span style="bottom:${tick * 100}%">${M.formatBytes(max * tick)}</span>
  `).join("");
  $("#frame-chart").innerHTML = sampled.map((frame) => `
    <button
      data-frame="${frame.index}"
      data-start="${frame.rangeStart}"
      data-end="${frame.rangeEnd}"
      class="${frame.type === "I" ? "iframe" : "pframe"}"
      style="height:${Math.max(3, frame.size / max * 100)}%"
      title="帧 ${frame.index} · ${M.formatBytes(frame.size)}"
    ></button>
  `).join("");
  $("#last-frame").textContent = `帧 ${Math.max(0, frames.length - 1)}`;
  $("#frame-chart").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => selectStreamFrame(Number(button.dataset.frame), true));
  });
}

function renderFrameTable() {
  const frames = state.stream.analysis.frames;
  const page = state.stream.page;
  const start = page * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, frames.length);
  $("#page-range").textContent = frames.length ? `第 ${start + 1}–${end} 帧` : "无帧数据";
  $("#page-prev").disabled = page === 0;
  $("#page-next").disabled = end >= frames.length;
  $("#frame-rows").innerHTML = frames.slice(start, end).map((frame) => `
    <tr data-frame="${frame.index}" class="${state.stream.currentFrame === frame.index ? "selected" : ""}">
      <td>#${frame.index}</td>
      <td><span class="frame-type ${frame.type === "I" ? "iframe" : "pframe"}">${frame.type}</span></td>
      <td><b>${M.formatBytes(frame.size)}</b></td>
      <td>0x${Math.max(0, frame.offset).toString(16).toUpperCase().padStart(8, "0")}</td>
      <td>${M.formatTime(frame.index / state.stream.fps)}</td>
      <td><button data-frame="${frame.index}">定位</button></td>
    </tr>
  `).join("");
  $("#frame-rows").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => selectStreamFrame(Number(button.dataset.frame), true));
  });
}

$("#page-prev").addEventListener("click", () => {
  state.stream.page = Math.max(0, state.stream.page - 1);
  renderFrameTable();
});
$("#page-next").addEventListener("click", () => {
  state.stream.page += 1;
  renderFrameTable();
});

function selectStreamFrame(frame, seek) {
  const frames = state.stream.analysis?.frames || [];
  if (!frames.length) return;
  const target = Math.max(0, Math.min(frame, frames.length - 1));
  state.stream.currentFrame = target;
  const targetPage = Math.floor(target / PAGE_SIZE);
  if (state.stream.page !== targetPage) {
    state.stream.page = targetPage;
    renderFrameTable();
  }
  updateCurrentFrameUi();
  if (!seek) return;
  const video = $("#stream-video");
  if (!video.src) {
    toast("播放代理仍在生成；当前帧选择已记录。");
    return;
  }
  video.currentTime = target / state.stream.fps;
  video.play().catch(() => {});
}

function updateCurrentFrameUi() {
  const frame = state.stream.analysis?.frames[state.stream.currentFrame];
  if (!frame) return;
  $("#current-frame-badge strong").textContent = `#${frame.index}`;
  $("#current-frame-badge em").textContent = `${frame.type} · ${M.formatBytes(frame.size)}`;
  $$("#frame-chart button").forEach((button) => {
    const start = Number(button.dataset.start);
    const end = Number(button.dataset.end);
    button.classList.toggle("active", frame.index >= start && frame.index < end);
  });
  $$("#frame-rows tr").forEach((row) => {
    row.classList.toggle("selected", Number(row.dataset.frame) === frame.index);
  });
}

$("#stream-video").addEventListener("timeupdate", (event) => {
  if (!state.stream.analysis) return;
  const frame = Math.floor(event.currentTarget.currentTime * state.stream.fps + 0.0001);
  selectStreamFrame(frame, false);
});
$("#stream-video").addEventListener("seeked", (event) => {
  if (!state.stream.analysis) return;
  const frame = Math.round(event.currentTarget.currentTime * state.stream.fps);
  selectStreamFrame(frame, false);
});

async function prepareProxy(file, kind) {
  const status = $("#proxy-status");
  const badge = $("#play-badge");
  const placeholder = $("#video-placeholder");
  status.textContent = "正在本地生成 H.264 播放代理…";
  badge.textContent = "处理中";
  badge.className = "badge waiting";
  show(placeholder, true);
  try {
    const url = await window.desktop.createProxy(file.path, kind, state.stream.fps);
    const video = $("#stream-video");
    video.src = url;
    video.load();
    status.textContent = "内置 FFmpeg 解码 · 原文件未修改";
    badge.textContent = "可播放";
    badge.className = "badge ready";
    show(placeholder, false);
  } catch (error) {
    status.textContent = "播放代理生成失败";
    badge.textContent = "仅分析";
    badge.className = "badge error";
    placeholder.innerHTML = `<b>逐帧分析仍可使用</b><span>${escapeHtml(error.message)}</span>`;
    show(placeholder, true);
  }
}

function resetPlayback() {
  stopYuv();
  const video = $("#stream-video");
  video.pause();
  video.removeAttribute("src");
  video.load();
  state.stream.analysis = null;
  state.stream.currentFrame = 0;
  state.stream.page = 0;
}
