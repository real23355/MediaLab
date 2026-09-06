const M = window.MediaTools;
const R = window.RawTools;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const IMAGE_LIMIT = 10;
const PAGE_SIZE = 100;
const TOTAL_FILE_LIMIT = Math.floor(4.2 * 1024 * 1024 * 1024);
const PIXEL_OVERLAY_MIN_SIZE = 46;

const state = {
  pending: [],
  docs: [],
  activeDocId: "",
  streams: [],
  activeStreamId: "",
  compareMode: false,
  leftId: "",
  rightId: "",
  syncView: true,
  syncPlayback: true,
  compareRenderToken: 0,
  compareViews: { left: null, right: null },
  compareSyncGuard: false,
  yuvTimer: null,
  renderToken: 0,
  sessionToken: 0,
  streamFile: null,
  stream: {
    analysis: null,
    fps: 25,
    page: 0,
    currentFrame: 0,
    decoder: "检测中"
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
  if (/\.raw$/.test(lower)) return "raw";
  if (/\.(heic|heif)$/.test(lower)) return "heic";
  if (/\.(png|jpe?g|bmp|webp)$/.test(lower)) return "image";
  if (/\.(265|h265|hevc)$/.test(lower)) return "h265";
  if (/\.(264|h264|avc)$/.test(lower)) return "h264";
  return "yuv";
}

function isVideoKind(kind) {
  return kind === "h264" || kind === "h265";
}

function currentWorkspaceKind() {
  if (state.docs.length) return "image";
  if (state.streams.length) return "video";
  return null;
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
    if ((doc.kind === "heic" || doc.kind === "image") && doc.url) URL.revokeObjectURL(doc.url);
  });
  state.docs = [];
  state.activeDocId = "";
  state.streams = [];
  state.activeStreamId = "";
  state.compareMode = false;
  state.leftId = "";
  state.rightId = "";
  state.compareViews = { left: null, right: null };
}

function returnHome() {
  state.sessionToken += 1;
  clearDocuments();
  resetPlayback();
  $$("#stream-compare video").forEach(video => video.pause());
  $("#stream-compare").innerHTML = "";
  show($("#stream-compare"), false);
  $("#stream-workspace").classList.remove("comparing");
  state.pending = [];
  state.streamFile = null;
  $("#pending-list").innerHTML = "";
  show($("#home"), true);
  show($("#type-screen"), false);
  show($("#workspace"), false);
  $("#workspace").classList.remove("image-mode", "stream-mode");
  show($("#new-file"), false);
  show($("#add-file"), false);
  show($("#compare-mode"), false);
  show($("#restart-app"), false);
  show($("#toast"), false);
}

$("#new-file").addEventListener("click", returnHome);
$("#brand-home").addEventListener("click", returnHome);
$("#restart-app").addEventListener("click", () => window.desktop.restartApp());
$("#add-file").addEventListener("click", async () => receiveInfos(await window.desktop.selectFiles()));
$("#compare-mode").addEventListener("click", () => {
  const count = state.docs.length || state.streams.length;
  if (count < 2) return;
  state.compareMode = !state.compareMode;
  $("#compare-mode").textContent = state.compareMode ? "退出 Compare" : "Compare";
  if (state.docs.length) renderImageCompare();
  else renderStreamCompare();
});

async function receiveInfos(infos) {
  if (!infos?.length) return;
  const detected = infos.map((file) => ({ ...file, kind: extensionKind(file.name) }));
  const incomingKind = isVideoKind(detected[0].kind) ? "video" : "image";
  if (detected.some((file) => (isVideoKind(file.kind) ? "video" : "image") !== incomingKind)) {
    toast("请不要同时拖入图片与视频；请先建立一种媒体类型的工作区。");
    return;
  }
  const workspaceKind = currentWorkspaceKind();
  if (workspaceKind && workspaceKind !== incomingKind) {
    toast(workspaceKind === "image"
      ? "当前工作区为图片对比模式，只能添加图片类文件"
      : "当前工作区为视频对比模式，只能添加 H.264/H.265 视频文件");
    return;
  }
  const known = new Set([
    ...state.pending.map((file) => file.path),
    ...state.docs.map((doc) => doc.file.path),
    ...state.streams.map((doc) => doc.file.path)
  ]);
  let accepted = detected.filter((file) => !known.has(file.path));
  if (!accepted.length) {
    toast("这些文件已经在当前工作区中。");
    return;
  }
  if (incomingKind === "image") {
    const remaining = Math.max(0, IMAGE_LIMIT - state.docs.length - state.pending.length);
    if (accepted.length > remaining) {
      toast(`图片类文件最多 ${IMAGE_LIMIT} 个，已保留可加入的前 ${remaining} 个。`);
      accepted = accepted.slice(0, remaining);
    }
  }
  const total = [...state.pending, ...state.docs.map((doc) => doc.file), ...state.streams.map((doc) => doc.file), ...accepted]
    .reduce((sum, file) => sum + file.size, 0);
  if (total > TOTAL_FILE_LIMIT) {
    toast("加入后文件总量将超过 4.2 GB 限制，请减少文件数量。");
    return;
  }
  state.pending.push(...accepted.map((file, index) => ({
    ...file,
    id: `${file.path}-${Date.now()}-${index}`
  })));
  renderPendingList();
  show($("#home"), false);
  show($("#type-screen"), true);
  show($("#new-file"), true);
  show($("#add-file"), true);
  show($("#restart-app"), true);
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

$("#home").addEventListener("click", async () => {
  const files = await window.desktop.selectFiles();
  await receiveInfos(files);
});

$("#home").addEventListener("keydown", (event) => {
  if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) {
    event.preventDefault();
    event.currentTarget.click();
  }
});
$("#home").addEventListener("dragover", (event) => {
  event.preventDefault();
  event.currentTarget.classList.add("dragging");
});
$("#home").addEventListener("dragleave", (event) => {
  if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.classList.remove("dragging");
});
$("#home").addEventListener("drop", async (event) => {
  event.preventDefault();
  event.currentTarget.classList.remove("dragging");
  await receiveDroppedFiles([...event.dataTransfer.files]);
});

$("#workspace").addEventListener("dragover", (event) => {
  event.preventDefault();
  $("#workspace").classList.add("workspace-dragging");
});
$("#workspace").addEventListener("dragleave", () => $("#workspace").classList.remove("workspace-dragging"));
$("#workspace").addEventListener("drop", async (event) => {
  event.preventDefault();
  $("#workspace").classList.remove("workspace-dragging");
  await receiveDroppedFiles([...event.dataTransfer.files]);
});

function renderPendingList() {
  const options = [
    ["yuv", "YUV 原始图像"],
    ["raw", "Bayer RAW 图像"],
    ["heic", "HEIC 图片"],
    ["image", "RGB / 普通图片"],
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
  const sessionToken = state.sessionToken;
  const streamFiles = state.pending.filter((file) => file.kind === "h264" || file.kind === "h265");
  if (streamFiles.length && streamFiles.length !== state.pending.length) {
    toast("同一批次不能混合图片与视频文件。");
    return;
  }
  const pendingKind = streamFiles.length ? "video" : "image";
  const workspaceKind = currentWorkspaceKind();
  if (workspaceKind && workspaceKind !== pendingKind) {
    toast(workspaceKind === "image"
      ? "当前工作区为图片对比模式，只能添加图片类文件"
      : "当前工作区为视频对比模式，只能添加 H.264/H.265 视频文件");
    return;
  }
  const button = $("#parse-files");
  button.disabled = true;
  button.textContent = "正在解析…";
  try {
    if (streamFiles.length) {
      show($("#type-screen"), false);
      show($("#workspace"), true);
      show($("#image-layout"), false);
      show($("#stream-workspace"), true);
      $("#workspace").classList.remove("image-mode");
      $("#workspace").classList.add("stream-mode");
      const streams = [];
      for (const file of streamFiles) streams.push(await createStreamDocument(file, file.kind));
      state.streams.push(...streams);
      state.pending = [];
      ensureCompareSelection(state.streams);
      renderStreamTabs();
      activateStreamDocument(streams[0]);
      show($("#compare-mode"), state.streams.length >= 2);
      if (state.compareMode) renderStreamCompare();
      return;
    }
    const docs = [];
    for (const file of state.pending) {
      if (file.kind === "yuv") docs.push(await createYuvDocument(file));
      else if (file.kind === "raw") docs.push(await createRawDocument(file));
      else if (file.kind === "heic") docs.push(await createHeicDocument(file));
      else if (file.kind === "image") docs.push(await createImageDocument(file));
      if (sessionToken !== state.sessionToken) {
        docs.forEach((doc) => {
          if ((doc.kind === "heic" || doc.kind === "image") && doc.url) URL.revokeObjectURL(doc.url);
        });
        return;
      }
    }
    state.docs.push(...docs);
    state.activeDocId = docs[0]?.id || "";
    state.pending = [];
    show($("#type-screen"), false);
    show($("#workspace"), true);
    show($("#image-layout"), true);
    show($("#stream-workspace"), false);
    $("#workspace").classList.remove("stream-mode");
    $("#workspace").classList.add("image-mode");
    ensureCompareSelection(state.docs);
    show($("#compare-mode"), state.docs.length >= 2);
    renderFileTabs();
    if (state.compareMode) await renderImageCompare();
    else await showActiveDocument();
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
    displayMode: "rgb",
    pixelValues: "auto",
    yuvFrameData: null,
    yuvFrameKey: "",
    playing: false,
    zoom: null,
    fitMode: true
  };
}

async function createRawDocument(file) {
  if (!file.size) throw new Error(`${file.name} 是空文件。`);
  if (file.size > 256 * 1024 * 1024) {
    throw new Error(`${file.name} 超过 256 MB，当前版本拒绝一次性解码。`);
  }
  const bytes = new Uint8Array(await window.desktop.readSlice(file.path, 0, file.size));
  if (bytes.byteLength !== file.size) throw new Error(`${file.name} 未能完整读取。`);
  const config = R.detect(bytes.subarray(0, Math.min(bytes.byteLength, 2 * 1024 * 1024)), file.size, file.name);
  const values = R.decode(bytes, config);
  return {
    id: file.id,
    kind: "raw",
    file,
    bytes,
    values,
    config,
    levels: R.levels(values, config.bitDepth),
    mode: "rgb",
    autoStretch: true,
    blackLevel: 0,
    gain: 1,
    zoom: null,
    fitMode: true
  };
}

async function createHeicDocument(file) {
  if (file.size > 256 * 1024 * 1024) {
    throw new Error(`${file.name} 超过 256 MB，无法在当前版本中解码。`);
  }
  const decoded = await withTimeout(
    window.desktop.decodeHeic(file.path),
    45_000,
    "HEIC 解码超过 45 秒，已停止等待。可使用“重启应用”恢复。"
  );
  const pngBytes = decoded.bytes?.data
    ? new Uint8Array(decoded.bytes.data)
    : new Uint8Array(decoded.bytes);
  const blob = new Blob([pngBytes], { type: "image/png" });
  const url = URL.createObjectURL(blob);
  const size = await loadImageSize(url);
  return {
    id: file.id,
    kind: "heic",
    file,
    url,
    width: decoded.width || size.width,
    height: decoded.height || size.height,
    zoom: null,
    fitMode: true
  };
}

async function createImageDocument(file) {
  if (file.size > 256 * 1024 * 1024) throw new Error(`${file.name} 超过 256 MB，无法在当前版本中读取。`);
  const bytes = new Uint8Array(await window.desktop.readSlice(file.path, 0, file.size));
  const extension = file.name.toLowerCase().split(".").pop();
  const mime = extension === "png" ? "image/png"
    : extension === "webp" ? "image/webp"
      : extension === "bmp" ? "image/bmp" : "image/jpeg";
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const size = await loadImageSize(url);
  return { id: file.id, kind: "image", file, url, ...size, zoom: null, fitMode: true };
}

function withTimeout(promise, timeoutMs, message) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timeout));
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

function ensureCompareSelection(collection) {
  if (!collection.length) return;
  if (!collection.some((item) => item.id === state.leftId)) state.leftId = collection[0].id;
  if (!collection.some((item) => item.id === state.rightId) || (collection.length > 1 && state.rightId === state.leftId)) {
    state.rightId = collection[1]?.id || collection[0].id;
  }
}

function renderFileTabs() {
  $("#file-tabs").innerHTML = `
    <h2>已解析文件</h2>
    ${state.docs.map((doc, index) => `
      <div class="file-tab-row ${doc.id === state.activeDocId ? "active" : ""}" data-id="${escapeHtml(doc.id)}">
        <button class="doc-select">
          <b>${String(index + 1).padStart(2, "0")}</b>
          <span title="${escapeHtml(doc.file.name)}">${escapeHtml(doc.file.name)}</span>
          <em>${doc.kind === "yuv" ? "YUV" : doc.kind === "raw" ? "RAW" : doc.kind === "heic" ? "HEIC" : "RGB"}</em>
        </button>
        <div class="side-assign"><button data-side="left" class="${doc.id === state.leftId ? "selected" : ""}">Left</button><button data-side="right" class="${doc.id === state.rightId ? "selected" : ""}">Right</button></div>
      </div>
    `).join("")}
    <button id="add-image-file" class="add-file-tab">＋ 拖入或追加文件</button>
  `;
  $$("#file-tabs .doc-select").forEach((button) => {
    button.addEventListener("click", async () => {
      stopYuv();
      state.activeDocId = button.closest(".file-tab-row").dataset.id;
      renderFileTabs();
      if (!state.compareMode) await showActiveDocument();
    });
  });
  $$("#file-tabs .side-assign button").forEach((button) => button.addEventListener("click", async () => {
    const id = button.closest(".file-tab-row").dataset.id;
    if (button.dataset.side === "left") state.leftId = id;
    else state.rightId = id;
    renderFileTabs();
    if (state.compareMode) await renderImageCompare();
  }));
  $("#add-image-file").addEventListener("click", async () => receiveInfos(await window.desktop.selectFiles()));
}

async function showActiveDocument() {
  const doc = activeDocument();
  if (!doc) return;
  $("#file-summary").innerHTML = fileMarkup(
    doc.file,
    doc.kind === "yuv" ? "YUV / SYUV" : doc.kind === "raw" ? "Bayer RAW" : doc.kind === "heic" ? "HEIC" : "RGB 图片"
  );
  show($("#yuv-workspace"), doc.kind === "yuv");
  show($("#raw-workspace"), doc.kind === "raw");
  show($("#heic-workspace"), doc.kind === "heic");
  if (doc.kind === "yuv") {
    populateYuvFormats();
    syncYuvControls();
    renderCandidateList();
    await renderYuvFrame();
  } else if (doc.kind === "raw") {
    syncRawControls();
    await renderRawFrame();
  } else {
    $("#heic-image").src = doc.url;
    $("#heic-image").alt = doc.file.name;
    $("#heic-info").textContent = `${doc.width} × ${doc.height}`;
    requestAnimationFrame(() => {
      if (doc.zoom == null || doc.fitMode) fitImage("heic");
      else applyImageZoom("heic");
    });
  }
}

function viewerElements(viewer) {
  const ids = {
    yuv: ["#yuv-canvas", "#yuv-stage", "#yuv-panel"],
    raw: ["#raw-canvas", "#raw-stage", "#raw-panel"],
    heic: ["#heic-image", "#heic-stage", "#heic-panel"]
  }[viewer];
  const stage = $(ids[1]);
  return { element: $(ids[0]), stage, surface: stage.querySelector(".image-surface"), panel: $(ids[2]) };
}

function viewerDocument(viewer) {
  const doc = activeDocument();
  if (!doc) return null;
  if (viewer === "yuv" && doc.kind === "yuv") return doc;
  if (viewer === "raw" && doc.kind === "raw") return doc;
  if (viewer === "heic" && (doc.kind === "heic" || doc.kind === "image")) return doc;
  return null;
}

function viewerSize(viewer, doc) {
  if (viewer === "heic") return { width: doc.width, height: doc.height };
  if (viewer === "yuv") {
    return M.displaySize(doc.config.width, doc.config.height, doc.config.format, doc.displayMode || "rgb");
  }
  return { width: doc.config.width, height: doc.config.height };
}

function yuvModeLabel(mode) {
  return M.DISPLAY_MODES.find((item) => item.value === mode)?.label || mode.toUpperCase();
}

function yuvPixelStatus(doc, x, y, width, height) {
  const mode = doc.displayMode || "rgb";
  const sample = doc.yuvFrameData
    ? M.displaySample(doc.yuvFrameData, doc.config.width, doc.config.height, doc.config.format, mode, x, y)
    : null;
  const values = !sample ? ""
    : mode === "rgb"
      ? ` | Y:${sample.yValue} U:${sample.uValue} V:${sample.vValue}`
      : ` | ${mode.toUpperCase()}:${sample.value}`;
  return `${width}×${height} | ${doc.config.format} · ${yuvModeLabel(mode)} | X:${sample?.x ?? x} Y:${sample?.y ?? y}${values}`;
}

function yuvOverlayLines(doc, x, y) {
  if (!doc.yuvFrameData) return [];
  const mode = doc.displayMode || "rgb";
  const componentX = mode === "u" || mode === "v" ? Math.floor(x / 2) : x;
  const componentY = (mode === "u" || mode === "v")
    && doc.config.format !== "YUY2" && doc.config.format !== "UYVY" && doc.config.format !== "GRAY8"
    ? Math.floor(y / 2)
    : y;
  const sample = M.displaySample(doc.yuvFrameData, doc.config.width, doc.config.height, doc.config.format, mode, componentX, componentY);
  if (mode === "rgb") return [`Y:${sample.yValue}`, `U:${sample.uValue}`, `V:${sample.vValue}`];
  return [`${mode.toUpperCase()}:${sample.value}`];
}

function drawPixelOverlayCanvas(canvas, stage, surface, width, height, enabled, linesForPixel) {
  if (!canvas || !stage || !surface || !enabled) {
    if (canvas) canvas.hidden = true;
    return { visible: false, cells: 0, screenPixelsPerSourcePixel: 0 };
  }
  const bounds = surface.getBoundingClientRect();
  const scaleX = bounds.width / Math.max(1, width);
  const scaleY = bounds.height / Math.max(1, height);
  const screenPixelsPerSourcePixel = Math.min(scaleX, scaleY);
  if (screenPixelsPerSourcePixel < PIXEL_OVERLAY_MIN_SIZE) {
    canvas.hidden = true;
    return { visible: false, cells: 0, screenPixelsPerSourcePixel };
  }

  const viewportWidth = stage.clientWidth;
  const viewportHeight = stage.clientHeight;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.hidden = false;
  canvas.style.left = `${stage.scrollLeft}px`;
  canvas.style.top = `${stage.scrollTop}px`;
  canvas.style.width = `${viewportWidth}px`;
  canvas.style.height = `${viewportHeight}px`;
  const pixelWidth = Math.max(1, Math.round(viewportWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(viewportHeight * dpr));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const context = canvas.getContext("2d");
  if (!context) return { visible: false, cells: 0, screenPixelsPerSourcePixel };
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, viewportWidth, viewportHeight);

  const startX = Math.max(0, Math.floor((stage.scrollLeft - surface.offsetLeft) / scaleX));
  const startY = Math.max(0, Math.floor((stage.scrollTop - surface.offsetTop) / scaleY));
  const endX = Math.min(width, Math.ceil((stage.scrollLeft + viewportWidth - surface.offsetLeft) / scaleX));
  const endY = Math.min(height, Math.ceil((stage.scrollTop + viewportHeight - surface.offsetTop) / scaleY));
  const fontSize = Math.max(10, Math.min(14, screenPixelsPerSourcePixel / 4));
  const lineHeight = fontSize * 1.15;
  context.font = `600 ${fontSize}px Consolas, monospace`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  let cells = 0;

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const left = surface.offsetLeft + x * scaleX - stage.scrollLeft;
      const top = surface.offsetTop + y * scaleY - stage.scrollTop;
      context.strokeStyle = "rgba(255, 255, 255, 0.58)";
      context.lineWidth = 1;
      context.strokeRect(left + 0.5, top + 0.5, scaleX - 1, scaleY - 1);
      const lines = linesForPixel(x, y);
      const blockHeight = lines.length * lineHeight;
      const centerY = top + scaleY / 2 - blockHeight / 2 + lineHeight / 2;
      context.fillStyle = "rgba(10, 18, 16, 0.62)";
      context.fillRect(left + 3, top + Math.max(3, (scaleY - blockHeight) / 2 - 3), scaleX - 6, blockHeight + 6);
      context.fillStyle = "#ffffff";
      context.shadowColor = "rgba(0, 0, 0, 0.9)";
      context.shadowBlur = 2;
      lines.forEach((line, index) => context.fillText(line, left + scaleX / 2, centerY + index * lineHeight));
      context.shadowBlur = 0;
      cells += 1;
    }
  }
  return { visible: true, cells, screenPixelsPerSourcePixel };
}

let yuvOverlayFrame = 0;
function scheduleYuvPixelOverlay() {
  cancelAnimationFrame(yuvOverlayFrame);
  yuvOverlayFrame = requestAnimationFrame(() => {
    const doc = viewerDocument("yuv");
    if (!doc) return;
    const { stage, surface } = viewerElements("yuv");
    drawPixelOverlayCanvas(
      $("#yuv-pixel-overlay"), stage, surface, doc.config.width, doc.config.height,
      (doc.pixelValues || "auto") !== "off",
      (x, y) => yuvOverlayLines(doc, x, y)
    );
  });
}

function updateViewerStatus(viewer) {
  const doc = viewerDocument(viewer);
  if (!doc) return;
  const zoom = Math.round((doc.zoom || 1) * 100);
  if (viewer === "yuv") {
    const pixel = doc.pixel || { x: 0, y: 0 };
    const size = viewerSize("yuv", doc);
    $("#yuv-status").textContent = `${yuvPixelStatus(doc, pixel.x, pixel.y, size.width, size.height)} | Zoom ${zoom}%`;
  } else if (viewer === "raw") {
    const pixel = doc.pixel || { x: 0, y: 0 };
    const value = doc.values[pixel.y * doc.config.width + pixel.x] || 0;
    const channel = R.bayerChannel(doc.config.bayer, pixel.x, pixel.y);
    $("#raw-status").textContent = `${doc.config.width}×${doc.config.height} | ${doc.config.bayer} | RAW${doc.config.bitDepth} | Zoom ${zoom}% | X:${pixel.x} Y:${pixel.y} RAW:${value} ${channel}`;
  } else {
    $("#heic-status").textContent = `${doc.width}×${doc.height} | ${doc.kind === "heic" ? "HEIC" : "RGB"} | Zoom ${zoom}%`;
  }
}

function applyImageZoom(viewer) {
  const doc = viewerDocument(viewer);
  if (!doc || doc.zoom == null) return;
  const { surface } = viewerElements(viewer);
  const { width, height } = viewerSize(viewer, doc);
  surface.style.width = `${Math.max(1, Math.round(width * doc.zoom))}px`;
  surface.style.height = `${Math.max(1, Math.round(height * doc.zoom))}px`;
  const value = $(`.zoom-toolbar[data-viewer="${viewer}"] .zoom-value`);
  const exact = [...value.options].find((option) => Number(option.value) === doc.zoom);
  value.querySelector("option[data-custom]")?.remove();
  if (exact) value.value = exact.value;
  else {
    const option = document.createElement("option");
    option.dataset.custom = "true";
    option.value = String(doc.zoom);
    option.textContent = `${Math.round(doc.zoom * 100)}%`;
    value.append(option);
    value.value = option.value;
  }
  updateViewerStatus(viewer);
  if (viewer === "yuv") scheduleYuvPixelOverlay();
}

function setImageZoom(viewer, zoom, anchor) {
  const doc = viewerDocument(viewer);
  if (!doc) return;
  const { stage, surface } = viewerElements(viewer);
  const previous = doc.zoom || 1;
  doc.fitMode = false;
  const bounds = stage.getBoundingClientRect();
  const viewportX = (anchor?.x ?? bounds.left + stage.clientWidth / 2) - bounds.left;
  const viewportY = (anchor?.y ?? bounds.top + stage.clientHeight / 2) - bounds.top;
  const imageX = (stage.scrollLeft + viewportX - surface.offsetLeft) / previous;
  const imageY = (stage.scrollTop + viewportY - surface.offsetTop) / previous;
  doc.zoom = Math.max(0.1, Math.min(128, zoom));
  applyImageZoom(viewer);
  requestAnimationFrame(() => {
    stage.scrollLeft = surface.offsetLeft + imageX * doc.zoom - viewportX;
    stage.scrollTop = surface.offsetTop + imageY * doc.zoom - viewportY;
  });
}

function fitImage(viewer) {
  const doc = viewerDocument(viewer);
  if (!doc) return;
  const { stage } = viewerElements(viewer);
  const { width, height } = viewerSize(viewer, doc);
  const style = getComputedStyle(stage);
  const availableWidth = Math.max(1, stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
  const availableHeight = Math.max(1, stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
  doc.fitMode = true;
  doc.zoom = Math.max(0.1, Math.min(128, availableWidth / width, availableHeight / height));
  applyImageZoom(viewer);
  stage.scrollLeft = 0;
  stage.scrollTop = 0;
}

$$(".zoom-toolbar button").forEach((button) => {
  button.addEventListener("click", async () => {
    const toolbar = button.closest(".zoom-toolbar");
    const viewer = toolbar.dataset.viewer;
    const doc = viewerDocument(viewer);
    if (!doc) return;
    const action = button.dataset.action;
    if (action === "in") setImageZoom(viewer, (doc.zoom || 1) * 1.25);
    else if (action === "out") setImageZoom(viewer, (doc.zoom || 1) / 1.25);
    else if (action === "reset") setImageZoom(viewer, 1);
    else if (action === "fit") fitImage(viewer);
    else if (action === "fullscreen") {
      const { panel } = viewerElements(viewer);
      if (document.fullscreenElement) await document.exitFullscreen();
      else await panel.requestFullscreen();
    }
  });
});

$$('.zoom-toolbar select[data-action="preset"]').forEach((select) => {
  select.addEventListener("change", () => setImageZoom(select.closest(".zoom-toolbar").dataset.viewer, Number(select.value)));
});

["yuv", "raw", "heic"].forEach((viewer) => {
  const { stage, surface } = viewerElements(viewer);
  let drag = null;
  stage.addEventListener("wheel", (event) => {
    if (!viewerDocument(viewer)) return;
    event.preventDefault();
    const doc = viewerDocument(viewer);
    setImageZoom(viewer, (doc.zoom || 1) * (event.deltaY < 0 ? 1.12 : 1 / 1.12), { x: event.clientX, y: event.clientY });
  }, { passive: false });
  if (viewer === "yuv") stage.addEventListener("scroll", scheduleYuvPixelOverlay, { passive: true });
  stage.addEventListener("pointerdown", (event) => {
    if (!viewerDocument(viewer) || (event.button !== 0 && event.button !== 1)) return;
    drag = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add("panning");
    event.preventDefault();
  });
  stage.addEventListener("pointermove", (event) => {
    if (drag) {
      stage.scrollLeft = drag.left - (event.clientX - drag.x);
      stage.scrollTop = drag.top - (event.clientY - drag.y);
      return;
    }
    const doc = viewerDocument(viewer);
    if (!doc || viewer === "heic") return;
    const bounds = surface.getBoundingClientRect();
    const size = viewerSize(viewer, doc);
    const x = Math.floor(((event.clientX - bounds.left) / Math.max(1, bounds.width)) * size.width);
    const y = Math.floor(((event.clientY - bounds.top) / Math.max(1, bounds.height)) * size.height);
    if (x >= 0 && y >= 0 && x < size.width && y < size.height) {
      doc.pixel = { x, y };
      updateViewerStatus(viewer);
    }
  });
  const stop = () => {
    drag = null;
    stage.classList.remove("panning");
  };
  stage.addEventListener("pointerup", stop);
  stage.addEventListener("pointercancel", stop);
  let resizeFrame = 0;
  const observer = new ResizeObserver(() => {
    const doc = viewerDocument(viewer);
    if (!doc || !doc.fitMode) return;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      const current = viewerDocument(viewer);
      if (current?.fitMode) fitImage(viewer);
    });
  });
  observer.observe(stage);
});

function populateYuvFormats() {
  $("#yuv-format").innerHTML = M.FORMATS.map((format) => `<option>${format}</option>`).join("");
  $("#yuv-display").innerHTML = M.DISPLAY_MODES
    .map((item) => `<option value="${item.value}">${item.label}</option>`)
    .join("");
}

function syncYuvControls() {
  const doc = activeDocument();
  if (!doc || doc.kind !== "yuv") return;
  const config = doc.config;
  $("#yuv-format").value = config.format;
  $("#yuv-display").value = doc.displayMode || "rgb";
  $("#yuv-pixel-values").value = doc.pixelValues || "auto";
  $("#yuv-width").value = config.width;
  $("#yuv-height").value = config.height;
  $("#yuv-fps").value = doc.fps;
  $("#yuv-slider").max = Math.max(0, config.frameCount - 1);
  $("#yuv-slider").value = doc.frame;
  $("#yuv-counter").textContent = `帧 ${doc.frame + 1} / ${config.frameCount}`;
  $("#yuv-viewer-title").textContent = doc.displayMode === "rgb"
    ? "YUV 画面"
    : `${(doc.displayMode || "rgb").toUpperCase()} 分量`;
  $("#yuv-detected").innerHTML = `
    <span>当前解析</span>
    <strong>${config.width} × ${config.height} · ${config.format}</strong>
    <small>每帧 ${M.formatBytes(config.frameBytes)} · 共 ${config.frameCount.toLocaleString("zh-CN")} 帧
    ${config.dataOffset ? ` · 文件头 ${config.dataOffset} B` : ""}</small>
  `;
}

async function loadYuvFrameData(doc) {
  const config = doc.config;
  const key = `${config.dataOffset || 0}:${doc.frame}:${config.frameBytes}`;
  if (doc.yuvFrameKey === key && doc.yuvFrameData?.byteLength === config.frameBytes) {
    return doc.yuvFrameData;
  }
  const raw = new Uint8Array(await window.desktop.readSlice(
    doc.file.path,
    (config.dataOffset || 0) + doc.frame * config.frameBytes,
    config.frameBytes
  ));
  if (raw.byteLength < config.frameBytes) throw new Error("文件长度不足一帧");
  doc.yuvFrameKey = key;
  doc.yuvFrameData = raw;
  return raw;
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
    const raw = await loadYuvFrameData(doc);
    if (token !== state.renderToken) return;
    const mode = doc.displayMode || "rgb";
    const size = M.displaySize(config.width, config.height, config.format, mode);
    const image = M.renderYuv(raw, config.width, config.height, config.format, mode);
    const canvas = $("#yuv-canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext("2d", { alpha: false }).putImageData(image, 0, 0);
    if (doc.zoom == null || doc.fitMode) fitImage("yuv");
    else applyImageZoom("yuv");
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
$("#yuv-display").addEventListener("change", async (event) => {
  const doc = activeDocument();
  if (!doc || doc.kind !== "yuv") return;
  doc.displayMode = event.target.value;
  doc.pixel = { x: 0, y: 0 };
  syncYuvControls();
  await renderYuvFrame();
});
$("#yuv-pixel-values").addEventListener("change", (event) => {
  const doc = activeDocument();
  if (!doc || doc.kind !== "yuv") return;
  doc.pixelValues = event.target.value;
  scheduleYuvPixelOverlay();
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

function populateRawOptions() {
  $("#raw-bayer").innerHTML = R.BAYER_PATTERNS.map((pattern) => `<option>${pattern}</option>`).join("");
  $("#raw-packing").innerHTML = R.RAW_PACKINGS.map((packing) => `<option value="${packing.value}">${packing.label}</option>`).join("");
}

function syncRawControls() {
  const doc = activeDocument();
  if (!doc || doc.kind !== "raw") return;
  populateRawOptions();
  $("#raw-width").value = doc.config.width;
  $("#raw-height").value = doc.config.height;
  $("#raw-bit-depth").value = doc.config.bitDepth;
  $("#raw-bayer").value = doc.config.bayer;
  $("#raw-packing").value = doc.config.packing;
  $("#raw-mode").value = doc.mode;
  $("#raw-auto-stretch").checked = doc.autoStretch;
  $("#raw-black").value = doc.blackLevel;
  $("#raw-gain").value = doc.gain;
  const packing = R.RAW_PACKINGS.find((item) => item.value === doc.config.packing)?.label || doc.config.packing;
  $("#raw-info").textContent = `${doc.config.width} × ${doc.config.height} · ${doc.mode === "rgb" ? "Demosaic RGB" : "Grayscale"}`;
  $("#raw-detected").innerHTML = `
    <span>检测结果</span>
    <strong>${doc.config.width} × ${doc.config.height} · ${doc.config.bayer} · ${doc.config.bitDepth} bit</strong>
    <small>${packing} · ${M.formatBytes(doc.config.frameBytes)}</small>
    <small>数据范围 ${doc.levels.min}–${doc.levels.max} · 拉伸 ${doc.levels.low}–${doc.levels.high}</small>
    <small>${escapeHtml(doc.config.reason)}</small>
  `;
  updateViewerStatus("raw");
}

async function renderRawFrame() {
  const token = ++state.renderToken;
  const doc = activeDocument();
  if (!doc || doc.kind !== "raw") return;
  try {
    const image = R.render(
      doc.values, doc.config, doc.mode, doc.levels,
      doc.autoStretch, doc.blackLevel, doc.gain
    );
    if (token !== state.renderToken) return;
    const canvas = $("#raw-canvas");
    canvas.width = doc.config.width;
    canvas.height = doc.config.height;
    canvas.getContext("2d", { alpha: false }).putImageData(image, 0, 0);
    syncRawControls();
    if (doc.zoom == null || doc.fitMode) fitImage("raw");
    else applyImageZoom("raw");
  } catch (error) {
    toast(`RAW 预览失败：${error.message}`);
  }
}

async function changeRawConfig() {
  const doc = activeDocument();
  if (!doc || doc.kind !== "raw") return;
  const next = {
    ...doc.config,
    width: Math.max(1, Number($("#raw-width").value) || 1),
    height: Math.max(1, Number($("#raw-height").value) || 1),
    bitDepth: Math.max(1, Number($("#raw-bit-depth").value) || 10),
    bayer: $("#raw-bayer").value,
    packing: $("#raw-packing").value,
    reason: "手动调整"
  };
  next.frameBytes = R.frameBytes(next.width, next.height, next.bitDepth, next.packing);
  try {
    const values = R.decode(doc.bytes, next);
    doc.config = next;
    doc.values = values;
    doc.levels = R.levels(values, next.bitDepth);
    doc.pixel = { x: 0, y: 0 };
    await renderRawFrame();
  } catch (error) {
    toast(error.message);
    syncRawControls();
  }
}

["#raw-width", "#raw-height", "#raw-bit-depth", "#raw-bayer", "#raw-packing"].forEach((selector) => {
  $(selector).addEventListener("change", changeRawConfig);
});
$("#raw-mode").addEventListener("change", async (event) => {
  const doc = activeDocument();
  if (!doc || doc.kind !== "raw") return;
  doc.mode = event.target.value;
  await renderRawFrame();
});
$("#raw-auto-stretch").addEventListener("change", async (event) => {
  const doc = activeDocument();
  if (!doc || doc.kind !== "raw") return;
  doc.autoStretch = event.target.checked;
  await renderRawFrame();
});
$("#raw-black").addEventListener("change", async (event) => {
  const doc = activeDocument();
  if (!doc || doc.kind !== "raw") return;
  doc.blackLevel = Math.max(0, Number(event.target.value) || 0);
  await renderRawFrame();
});
$("#raw-gain").addEventListener("change", async (event) => {
  const doc = activeDocument();
  if (!doc || doc.kind !== "raw") return;
  doc.gain = Math.max(0.1, Number(event.target.value) || 1);
  await renderRawFrame();
});

function compareDoc(side) {
  const id = side === "left" ? state.leftId : state.rightId;
  return state.docs.find((doc) => doc.id === id);
}

function compareDocSize(doc) {
  if (doc.kind === "heic" || doc.kind === "image") return { width: doc.width, height: doc.height };
  if (doc.kind === "yuv") {
    return M.displaySize(doc.config.width, doc.config.height, doc.config.format, doc.displayMode || "rgb");
  }
  return { width: doc.config.width, height: doc.config.height };
}

function compareFormat(doc) {
  if (doc.kind === "yuv") return `${doc.config.format} · ${yuvModeLabel(doc.displayMode || "rgb")} · 帧 ${doc.frame + 1}/${doc.config.frameCount}`;
  if (doc.kind === "raw") return `${doc.config.bayer} · RAW${doc.config.bitDepth}`;
  return doc.kind === "heic" ? "HEIC" : "RGB";
}

async function renderImageCompare() {
  const container = $("#image-compare");
  const enabled = state.compareMode && state.docs.length >= 2;
  show(container, enabled);
  show($("#yuv-workspace"), !enabled && activeDocument()?.kind === "yuv");
  show($("#raw-workspace"), !enabled && activeDocument()?.kind === "raw");
  show($("#heic-workspace"), !enabled && activeDocument()?.kind === "heic");
  show($("#file-summary"), !enabled);
  if (!enabled) {
    if (activeDocument()) await showActiveDocument();
    return;
  }
  ensureCompareSelection(state.docs);
  const left = compareDoc("left");
  const right = compareDoc("right");
  if (!left || !right) return;
  const token = ++state.compareRenderToken;
  const cards = [["left", "Left", left], ["right", "Right", right]].map(([side, label, doc]) => {
    const size = compareDocSize(doc);
    const media = doc.kind === "heic" || doc.kind === "image"
      ? `<img alt="${escapeHtml(doc.file.name)}" draggable="false" />`
      : "<canvas></canvas>";
    return `<section class="compare-side" data-side="${side}">
      <div class="compare-side-label"><b>${label}</b><span title="${escapeHtml(doc.file.name)}">${escapeHtml(doc.file.name)}</span><em>${escapeHtml(compareFormat(doc))}</em>
        ${doc.kind === "yuv" ? `<div class="compare-yuv-controls"><label class="display-mode-control">Display:<select class="compare-display-mode">${M.DISPLAY_MODES.map((item) => `<option value="${item.value}" ${item.value === (doc.displayMode || "rgb") ? "selected" : ""}>${item.label}</option>`).join("")}</select></label><label class="display-mode-control">Pixel Values:<select class="compare-pixel-values"><option value="auto" ${(doc.pixelValues || "auto") === "auto" ? "selected" : ""}>Auto</option><option value="off" ${doc.pixelValues === "off" ? "selected" : ""}>Off</option></select></label></div>` : ""}
      </div>
      <div class="panel viewer image-viewer-panel compare-image-viewer">
        <div class="viewer-head"><strong>${label} Viewer</strong><span>${size.width} × ${size.height}</span><div class="zoom-toolbar">
          <button data-action="out">−</button><span class="compare-zoom-value">100%</span><button data-action="in">＋</button><button data-action="fit">Fit</button><button data-action="reset">100%</button><button data-action="fullscreen">全屏</button>
        </div></div>
        <div class="canvas-stage checker zoom-stage compare-stage"><div class="image-surface">${media}</div>${doc.kind === "yuv" ? `<canvas class="pixel-overlay compare-pixel-overlay" aria-hidden="true"></canvas>` : ""}</div>
        <div class="viewer-status">${size.width}×${size.height} | ${escapeHtml(compareFormat(doc))} | X:0 Y:0</div>
      </div>
    </section>`;
  }).join("");
  container.innerHTML = `<div class="compare-toolbar panel"><strong>Compare 图片对比</strong><label><input id="sync-view" type="checkbox" ${state.syncView ? "checked" : ""}/> Sync View</label><span>${state.syncView ? "Zoom / Pan / Fit / 100% 联动" : "左右视图独立"}</span></div><div class="compare-grid image-compare-grid">${cards}</div>`;
  $("#sync-view").addEventListener("change", (event) => {
    state.syncView = event.target.checked;
    renderImageCompare();
  });
  $$("#image-compare .compare-display-mode").forEach((select) => select.addEventListener("change", async () => {
    const side = select.closest(".compare-side").dataset.side;
    const doc = compareDoc(side);
    if (!doc || doc.kind !== "yuv") return;
    doc.displayMode = select.value;
    doc.pixel = { x: 0, y: 0 };
    await renderImageCompare();
  }));
  $$("#image-compare .compare-pixel-values").forEach((select) => select.addEventListener("change", () => {
    const side = select.closest(".compare-side").dataset.side;
    const doc = compareDoc(side);
    if (!doc || doc.kind !== "yuv") return;
    doc.pixelValues = select.value;
    scheduleComparePixelOverlay(side);
  }));
  await Promise.all([renderCompareImage("left", left, token), renderCompareImage("right", right, token)]);
  if (token !== state.compareRenderToken) return;
  bindCompareImageControls("left");
  bindCompareImageControls("right");
  requestAnimationFrame(() => {
    fitCompareImage("left", false);
    fitCompareImage("right", false);
  });
}

async function renderCompareImage(side, doc, token) {
  const root = $(`#image-compare [data-side="${side}"]`);
  if (!root) return;
  const surface = root.querySelector(".image-surface");
  if (doc.kind === "heic" || doc.kind === "image") {
    surface.querySelector("img").src = doc.url;
    return;
  }
  let image;
  if (doc.kind === "yuv") {
    const config = doc.config;
    const raw = await loadYuvFrameData(doc);
    if (token !== state.compareRenderToken) return;
    image = M.renderYuv(raw, config.width, config.height, config.format, doc.displayMode || "rgb");
  } else {
    image = R.render(doc.values, doc.config, doc.mode, doc.levels, doc.autoStretch, doc.blackLevel, doc.gain);
  }
  const canvas = surface.querySelector("canvas");
  const size = compareDocSize(doc);
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext("2d", { alpha: false }).putImageData(image, 0, 0);
}

function compareElements(side) {
  const root = $(`#image-compare [data-side="${side}"]`);
  const stage = root?.querySelector(".compare-stage");
  return { root, stage, surface: stage?.querySelector(".image-surface") };
}

const compareOverlayFrames = { left: 0, right: 0 };
function scheduleComparePixelOverlay(side) {
  cancelAnimationFrame(compareOverlayFrames[side]);
  compareOverlayFrames[side] = requestAnimationFrame(() => {
    const doc = compareDoc(side);
    const { root, stage, surface } = compareElements(side);
    if (!doc || doc.kind !== "yuv" || !root || !stage || !surface) return;
    drawPixelOverlayCanvas(
      root.querySelector(".compare-pixel-overlay"), stage, surface, doc.config.width, doc.config.height,
      (doc.pixelValues || "auto") !== "off",
      (x, y) => yuvOverlayLines(doc, x, y)
    );
  });
}

function compareCenter(side, zoom) {
  const doc = compareDoc(side);
  const { stage, surface } = compareElements(side);
  if (!doc || !stage || !surface) return { x: 0.5, y: 0.5 };
  const size = compareDocSize(doc);
  return {
    x: Math.max(0, Math.min(1, (stage.scrollLeft + stage.clientWidth / 2 - surface.offsetLeft) / Math.max(0.1, zoom) / size.width)),
    y: Math.max(0, Math.min(1, (stage.scrollTop + stage.clientHeight / 2 - surface.offsetTop) / Math.max(0.1, zoom) / size.height))
  };
}

function applyCompareView(side, center) {
  const doc = compareDoc(side);
  const view = state.compareViews[side];
  const { root, stage, surface } = compareElements(side);
  if (!doc || !view || !root || !stage || !surface) return;
  const size = compareDocSize(doc);
  surface.style.width = `${Math.max(1, Math.round(size.width * view.zoom))}px`;
  surface.style.height = `${Math.max(1, Math.round(size.height * view.zoom))}px`;
  root.querySelector(".compare-zoom-value").textContent = `${Math.round(view.zoom * 100)}%`;
  scheduleComparePixelOverlay(side);
  if (center) requestAnimationFrame(() => {
    stage.scrollLeft = surface.offsetLeft + center.x * size.width * view.zoom - stage.clientWidth / 2;
    stage.scrollTop = surface.offsetTop + center.y * size.height * view.zoom - stage.clientHeight / 2;
  });
}

function setCompareZoom(side, zoom, anchor, sync = true) {
  const { stage, surface } = compareElements(side);
  const doc = compareDoc(side);
  if (!stage || !surface || !doc) return;
  const previous = state.compareViews[side]?.zoom || 1;
  const bounds = stage.getBoundingClientRect();
  const viewportX = (anchor?.x ?? bounds.left + stage.clientWidth / 2) - bounds.left;
  const viewportY = (anchor?.y ?? bounds.top + stage.clientHeight / 2) - bounds.top;
  const size = compareDocSize(doc);
  const center = {
    x: Math.max(0, Math.min(1, (stage.scrollLeft + viewportX - surface.offsetLeft) / previous / size.width)),
    y: Math.max(0, Math.min(1, (stage.scrollTop + viewportY - surface.offsetTop) / previous / size.height))
  };
  state.compareViews[side] = { zoom: Math.max(0.1, Math.min(128, zoom)), fitMode: false };
  applyCompareView(side, center);
  if (sync && state.syncView) {
    const other = side === "left" ? "right" : "left";
    state.compareViews[other] = { zoom: state.compareViews[side].zoom, fitMode: false };
    applyCompareView(other, center);
  }
}

function fitCompareImage(side, sync = true) {
  const doc = compareDoc(side);
  const { stage } = compareElements(side);
  if (!doc || !stage) return;
  const size = compareDocSize(doc);
  const style = getComputedStyle(stage);
  const width = Math.max(1, stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
  const height = Math.max(1, stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
  state.compareViews[side] = { zoom: Math.max(0.1, Math.min(128, width / size.width, height / size.height)), fitMode: true };
  applyCompareView(side, { x: 0.5, y: 0.5 });
  if (sync && state.syncView) fitCompareImage(side === "left" ? "right" : "left", false);
}

function syncComparePan(source) {
  if (!state.syncView) return;
  const view = state.compareViews[source];
  if (!view) return;
  const center = compareCenter(source, view.zoom);
  const other = source === "left" ? "right" : "left";
  state.compareViews[other] = { zoom: view.zoom, fitMode: false };
  applyCompareView(other, center);
}

function bindCompareImageControls(side) {
  const { root, stage, surface } = compareElements(side);
  if (!root || !stage || !surface) return;
  root.querySelectorAll(".zoom-toolbar button").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.action;
    const zoom = state.compareViews[side]?.zoom || 1;
    if (action === "in") setCompareZoom(side, zoom * 1.25);
    else if (action === "out") setCompareZoom(side, zoom / 1.25);
    else if (action === "reset") setCompareZoom(side, 1);
    else if (action === "fit") fitCompareImage(side);
    else if (action === "fullscreen") {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.querySelector(".image-viewer-panel").requestFullscreen();
    }
  }));
  stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    setCompareZoom(side, (state.compareViews[side]?.zoom || 1) * (event.deltaY < 0 ? 1.12 : 1 / 1.12), { x: event.clientX, y: event.clientY });
  }, { passive: false });
  stage.addEventListener("scroll", () => scheduleComparePixelOverlay(side), { passive: true });
  let drag;
  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    drag = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add("panning");
    event.preventDefault();
  });
  stage.addEventListener("pointermove", (event) => {
    if (drag) {
      stage.scrollLeft = drag.left - (event.clientX - drag.x);
      stage.scrollTop = drag.top - (event.clientY - drag.y);
      syncComparePan(side);
      return;
    }
    const doc = compareDoc(side);
    if (!doc) return;
    const bounds = surface.getBoundingClientRect();
    const size = compareDocSize(doc);
    const x = Math.floor((event.clientX - bounds.left) / Math.max(1, bounds.width) * size.width);
    const y = Math.floor((event.clientY - bounds.top) / Math.max(1, bounds.height) * size.height);
    if (x >= 0 && y >= 0 && x < size.width && y < size.height) {
      root.querySelector(".viewer-status").textContent = doc.kind === "yuv"
        ? yuvPixelStatus(doc, x, y, size.width, size.height)
        : `${size.width}×${size.height} | ${compareFormat(doc)} | X:${x} Y:${y}`;
    }
  });
  const stop = () => {
    drag = null;
    stage.classList.remove("panning");
  };
  stage.addEventListener("pointerup", stop);
  stage.addEventListener("pointercancel", stop);
  new ResizeObserver(() => {
    if (state.compareViews[side]?.fitMode) fitCompareImage(side, false);
  }).observe(stage);
}

function notice(message, type = "working", stream = false) {
  const element = stream ? $("#stream-notice") : $("#notice");
  element.textContent = message;
  element.className = `notice ${type}`;
  show(element, Boolean(message));
}

async function createStreamDocument(file, kind) {
  notice(`正在分析 ${file.name}…`, "working", true);
  const analysis = await window.desktop.probeStream(file.path, kind);
  const doc = {
    id: file.id,
    kind,
    file,
    analysis,
    fps: parseRate(analysis.rate) || 25,
    decoder: "检测中",
    hardware: false,
    proxyUrl: "",
    proxyError: ""
  };
  try {
    const result = await window.desktop.createProxy(file.path, kind, doc.fps);
    doc.proxyUrl = typeof result === "string" ? result : result.url;
    doc.decoder = typeof result === "string" ? "Software Decode" : result.decoder;
    doc.hardware = Boolean(result.hardware);
  } catch (error) {
    doc.decoder = "仅分析";
    doc.proxyError = error.message;
  }
  notice("", "working", true);
  return doc;
}

function activateStreamDocument(doc) {
  if (!doc) return;
  resetPlayback();
  state.activeStreamId = doc.id;
  state.streamFile = doc.file;
  state.stream.analysis = doc.analysis;
  state.stream.page = 0;
  state.stream.currentFrame = 0;
  state.stream.decoder = doc.decoder;
  state.stream.fps = doc.fps;
  $("#stream-summary").innerHTML = fileMarkup(doc.file, doc.kind === "h264" ? "H.264 / AVC" : "H.265 / HEVC");
  renderStreamSummary();
  renderFrameChart();
  renderFrameTable();
  updateCurrentFrameUi();
  const video = $("#stream-video");
  const placeholder = $("#video-placeholder");
  if (doc.proxyUrl) {
    video.src = doc.proxyUrl;
    video.load();
    $("#proxy-status").textContent = `${doc.kind.toUpperCase()} | ${doc.analysis.width || "—"}×${doc.analysis.height || "—"} | ${doc.decoder}`;
    $("#play-badge").textContent = doc.hardware ? "GPU 硬解" : "软件解码";
    $("#play-badge").className = `badge ready ${doc.hardware ? "hardware" : "software"}`;
    show(placeholder, false);
  } else {
    $("#proxy-status").textContent = "播放代理生成失败";
    $("#play-badge").textContent = "仅分析";
    $("#play-badge").className = "badge error";
    placeholder.innerHTML = `<b>逐帧分析仍可使用</b><span>${escapeHtml(doc.proxyError || "无法生成播放代理")}</span>`;
    show(placeholder, true);
  }
  renderStreamTabs();
}

function renderStreamTabs() {
  const element = $("#stream-file-tabs");
  if (!state.streams.length) { show(element, false); return; }
  show(element, true);
  element.innerHTML = `<h2>视频文件</h2><div class="stream-tab-list">${state.streams.map((doc, index) => `
    <div class="stream-tab-row ${doc.id === state.activeStreamId ? "active" : ""}" data-id="${escapeHtml(doc.id)}">
      <button class="stream-select"><b>${String(index + 1).padStart(2, "0")}</b><span title="${escapeHtml(doc.file.name)}">${escapeHtml(doc.file.name)}</span><em>${doc.kind.toUpperCase()}</em></button>
      <div class="side-assign"><button data-side="left" class="${doc.id === state.leftId ? "selected" : ""}">Left</button><button data-side="right" class="${doc.id === state.rightId ? "selected" : ""}">Right</button></div>
    </div>`).join("")}<button id="add-stream-file" class="add-file-tab">＋ 追加 H.264/H.265</button></div>`;
  $$("#stream-file-tabs .stream-select").forEach((button) => button.addEventListener("click", () => {
    const doc = state.streams.find((item) => item.id === button.closest(".stream-tab-row").dataset.id);
    activateStreamDocument(doc);
  }));
  $$("#stream-file-tabs .side-assign button").forEach((button) => button.addEventListener("click", () => {
    const id = button.closest(".stream-tab-row").dataset.id;
    if (button.dataset.side === "left") state.leftId = id;
    else state.rightId = id;
    renderStreamTabs();
    if (state.compareMode) renderStreamCompare();
  }));
  $("#add-stream-file").addEventListener("click", async () => receiveInfos(await window.desktop.selectFiles()));
}

function streamCompareDoc(side) {
  const id = side === "left" ? state.leftId : state.rightId;
  return state.streams.find((doc) => doc.id === id);
}

function renderStreamCompare() {
  const container = $("#stream-compare");
  const enabled = state.compareMode && state.streams.length >= 2;
  show(container, enabled);
  $("#stream-workspace").classList.toggle("comparing", enabled);
  $$("#stream-compare video").forEach((video) => video.pause());
  if (!enabled) { container.innerHTML = ""; return; }
  $("#stream-video").pause();
  ensureCompareSelection(state.streams);
  const left = streamCompareDoc("left");
  const right = streamCompareDoc("right");
  if (!left || !right) return;
  const cards = [["left", "Left", left], ["right", "Right", right]].map(([side, label, doc]) => {
    const count = doc.analysis.frames.length;
    const badge = doc.hardware ? "GPU 硬解" : doc.proxyUrl ? "软件解码" : "仅分析";
    return `<section class="panel compare-video-card" data-side="${side}">
      <div class="compare-side-label"><b>${label}</b><span title="${escapeHtml(doc.file.name)}">${escapeHtml(doc.file.name)}</span><em>${doc.kind.toUpperCase()} · ${escapeHtml(doc.decoder)}</em></div>
      <div class="canvas-stage compare-video-stage"><video controls ${doc.proxyUrl ? `src="${escapeHtml(doc.proxyUrl)}"` : ""}></video><div class="current-frame-badge"><span>当前帧</span><strong>#0</strong><em>—</em></div>${doc.proxyUrl ? "" : `<div class="placeholder"><b>逐帧分析仍可使用</b><span>${escapeHtml(doc.proxyError || "播放代理不可用")}</span></div>`}</div>
      <div class="compare-transport"><button data-action="prev">|←</button><button data-action="toggle">▶</button><button data-action="next">→|</button><span>00:00.000</span><input type="range" min="0" max="${Math.max(0, count - 1)}" value="0" /></div>
      <div class="compare-video-meta">${doc.analysis.width || "—"}×${doc.analysis.height || "—"} · ${count.toLocaleString("zh-CN")} 帧 · ${badge}</div>
      <div class="video-divider" role="separator" aria-label="调整视频与帧大小区域高度" aria-orientation="horizontal" tabindex="0"></div>
      ${compareFrameChartMarkup(doc)}
    </section>`;
  }).join("");
  container.innerHTML = `<div class="compare-toolbar panel"><strong>Compare 视频对比</strong><button id="play-both" class="primary">▶ Play Both</button><button id="pause-both">Ⅱ Pause Both</button><label><input id="sync-playback" type="checkbox" ${state.syncPlayback ? "checked" : ""}/> Sync Playback</label></div><div class="compare-grid video-compare-grid">${cards}</div>`;
  $("#sync-playback").addEventListener("change", (event) => { state.syncPlayback = event.target.checked; });
  $("#play-both").addEventListener("click", () => {
    const videos = $$("#stream-compare video");
    videos.forEach((video) => video.play().catch(() => undefined));
  });
  $("#pause-both").addEventListener("click", () => $$("#stream-compare video").forEach((video) => video.pause()));
  bindCompareVideo("left", left);
  bindCompareVideo("right", right);
  bindVideoDividers(container);
}

function compareFrameChartMarkup(doc) {
  const frames = doc.analysis.frames;
  const slots = Math.min(200, frames.length);
  const max = frames.reduce((value, frame) => Math.max(value, frame.size), 1);
  const min = frames.reduce((value, frame) => Math.min(value, frame.size), Infinity);
  const bars = Array.from({ length: slots }, (_, slot) => {
    const start = Math.floor(slot * frames.length / slots);
    const end = Math.floor((slot + 1) * frames.length / slots);
    const peak = frames.slice(start, end).reduce((a, b) => a.size > b.size ? a : b);
    return `<button data-frame="${peak.index}" data-start="${start}" data-end="${end}" class="${peak.key ? "iframe" : "pframe"}" style="height:${Math.max(3, peak.size / max * 100)}%" title="帧 ${peak.index} · ${M.formatBytes(peak.size)}${end - start > 1 ? '（区间峰值）' : ''}"></button>`;
  }).join("");
  return `<section class="compare-frame-analysis"><div class="section-head"><h2>Frame Size <small class="chart-current"></small></h2><span class="frame-extrema">最大 ${M.formatBytes(max)} · 最小 ${M.formatBytes(Number.isFinite(min) ? min : 0)}</span></div><div class="chart-shell"><div class="y-axis">${[1,.5,0].map(tick => `<span style="bottom:${tick * 100}%">${M.formatBytes(max * tick)}</span>`).join("")}</div><div class="frame-chart">${bars}</div></div><div class="axis chart-axis"><span>帧 0 · I 橙 / P 绿 · 区间峰值</span><span>帧 ${Math.max(0, frames.length - 1)}</span></div></section>`;
}

function bindVideoDividers(root) {
  root.querySelectorAll(".video-divider").forEach((divider) => {
    const workspace = $("#stream-workspace");
    const resize = (height) => {
      const limit = Math.max(110, workspace.clientHeight * .5);
      const value = Math.round(Math.max(110, Math.min(limit, height)));
      workspace.style.setProperty("--frame-height", `${value}px`);
      divider.setAttribute("aria-valuenow", String(value));
    };
    divider.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      divider.setPointerCapture(event.pointerId);
      const initial = divider.nextElementSibling.getBoundingClientRect().height;
      const y = event.clientY;
      divider.onpointermove = (move) => resize(initial + y - move.clientY);
      divider.onlostpointercapture = () => { divider.onpointermove = null; };
    });
    divider.addEventListener("keydown", (event) => {
      if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      resize(divider.nextElementSibling.getBoundingClientRect().height + (event.key === "ArrowUp" ? 20 : -20));
    });
  });
}
bindVideoDividers($("#stream-workspace"));

function bindCompareVideo(side, doc) {
  const root = $(`#stream-compare [data-side="${side}"]`);
  const video = root?.querySelector("video");
  if (!root || !video) return;
  const slider = root.querySelector('input[type="range"]');
  const toggle = root.querySelector('[data-action="toggle"]');
  const update = () => {
    const frame = Math.max(0, Math.min(doc.analysis.frames.length - 1, Math.round(video.currentTime * doc.fps)));
    const data = doc.analysis.frames[frame];
    slider.value = frame;
    root.querySelector(".compare-transport span").textContent = M.formatTime(frame / doc.fps);
    root.querySelector(".current-frame-badge strong").textContent = `#${frame}`;
    root.querySelector(".current-frame-badge em").textContent = data ? `${data.type} · ${M.formatBytes(data.size)}` : "—";
    root.querySelector(".chart-current").textContent = data ? `#${frame} · ${data.type} · ${M.formatBytes(data.size)}` : "";
    root.querySelectorAll(".frame-chart button").forEach(button => button.classList.toggle("active", frame >= Number(button.dataset.start) && frame < Number(button.dataset.end)));
    if (state.activeStreamId === doc.id && state.stream.currentFrame !== frame) selectStreamFrame(frame, false);
    toggle.textContent = video.paused ? "▶" : "Ⅱ";
    if (!state.syncPlayback || state.compareSyncGuard || video.paused) return;
    const otherSide = side === "left" ? "right" : "left";
    const other = $(`#stream-compare [data-side="${otherSide}"] video`);
    if (other && !other.paused && Math.abs(other.currentTime - video.currentTime) > 0.1) {
      state.compareSyncGuard = true;
      other.currentTime = Math.min(video.currentTime, Number.isFinite(other.duration) ? other.duration : video.currentTime);
      queueMicrotask(() => { state.compareSyncGuard = false; });
    }
  };
  video.addEventListener("timeupdate", update);
  video.addEventListener("play", update);
  video.addEventListener("pause", update);
  video.addEventListener("seeked", update);
  const followFrame = () => {
    if (!video.isConnected) return;
    update();
    video.requestVideoFrameCallback?.(followFrame);
  };
  video.requestVideoFrameCallback?.(followFrame);
  root.querySelectorAll(".frame-chart button").forEach(button => button.addEventListener("click", () => seekCompareVideo(side, Number(button.dataset.frame) / doc.fps, true)));
  update();
  toggle.addEventListener("click", () => video.paused ? video.play().catch(() => undefined) : video.pause());
  root.querySelector('[data-action="prev"]').addEventListener("click", () => stepCompareVideo(side, -1));
  root.querySelector('[data-action="next"]').addEventListener("click", () => stepCompareVideo(side, 1));
  slider.addEventListener("input", () => seekCompareVideo(side, Number(slider.value) / doc.fps, true));
}

function seekCompareVideo(side, seconds, sync) {
  const video = $(`#stream-compare [data-side="${side}"] video`);
  if (!video) return;
  video.pause();
  video.currentTime = Math.max(0, seconds);
  if (sync && state.syncPlayback && !state.compareSyncGuard) {
    state.compareSyncGuard = true;
    const other = side === "left" ? "right" : "left";
    const otherVideo = $(`#stream-compare [data-side="${other}"] video`);
    if (otherVideo) {
      otherVideo.pause();
      otherVideo.currentTime = Math.max(0, seconds);
    }
    queueMicrotask(() => { state.compareSyncGuard = false; });
  }
}

function stepCompareVideo(side, delta) {
  const doc = streamCompareDoc(side);
  const video = $(`#stream-compare [data-side="${side}"] video`);
  if (!doc || !video) return;
  seekCompareVideo(side, video.currentTime + delta / doc.fps, false);
  if (state.syncPlayback) {
    const other = side === "left" ? "right" : "left";
    const otherDoc = streamCompareDoc(other);
    if (otherDoc && Math.abs(otherDoc.fps - doc.fps) < 0.01) {
      const otherVideo = $(`#stream-compare [data-side="${other}"] video`);
      if (otherVideo) seekCompareVideo(other, otherVideo.currentTime + delta / otherDoc.fps, false);
    }
  }
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
    ["实际解码器", state.stream.decoder],
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
  if (state.compareMode) {
    const side = state.activeStreamId === state.leftId ? "left" : state.activeStreamId === state.rightId ? "right" : null;
    if (side) { seekCompareVideo(side, target / state.stream.fps, true); return; }
  }
  const video = $("#stream-video");
  if (!video.src) {
    toast("播放代理仍在生成；当前帧选择已记录。");
    return;
  }
  video.pause();
  video.currentTime = target / state.stream.fps;
}

function updateCurrentFrameUi() {
  const frame = state.stream.analysis?.frames[state.stream.currentFrame];
  if (!frame) return;
  $("#current-frame-badge strong").textContent = `#${frame.index}`;
  $("#current-frame-badge em").textContent = `${frame.type} · ${M.formatBytes(frame.size)}`;
  $("#chart-current-frame").textContent = `#${frame.index} · ${frame.type} · ${M.formatBytes(frame.size)}`;
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
function followStreamFrame() {
  const video = $("#stream-video");
  if (state.stream.analysis && !video.paused) selectStreamFrame(Math.floor(video.currentTime * state.stream.fps + .0001), false);
  video.requestVideoFrameCallback?.(followStreamFrame);
}
$("#stream-video").requestVideoFrameCallback?.(followStreamFrame);

async function prepareProxy(file, kind) {
  const status = $("#proxy-status");
  const badge = $("#play-badge");
  const placeholder = $("#video-placeholder");
  status.textContent = "正在本地生成 H.264 播放代理…";
  badge.textContent = "处理中";
  badge.className = "badge waiting";
  show(placeholder, true);
  try {
    const result = await window.desktop.createProxy(file.path, kind, state.stream.fps);
    const url = typeof result === "string" ? result : result.url;
    state.stream.decoder = typeof result === "string" ? "Software Decode" : result.decoder;
    const video = $("#stream-video");
    video.src = url;
    video.load();
    status.textContent = `${kind.toUpperCase()} | ${state.stream.analysis.width || "—"}×${state.stream.analysis.height || "—"} | ${state.stream.decoder}`;
    badge.textContent = "可播放";
    badge.textContent = result.hardware ? "GPU 硬解" : "软件解码";
    badge.className = `badge ready ${result.hardware ? "hardware" : "software"}`;
    renderStreamSummary();
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
