const M = window.MediaTools;
const R = window.RawTools;
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
  state.sessionToken += 1;
  clearDocuments();
  resetPlayback();
  state.pending = [];
  state.streamFile = null;
  $("#pending-list").innerHTML = "";
  show($("#home"), true);
  show($("#type-screen"), false);
  show($("#workspace"), false);
  $("#workspace").classList.remove("image-mode", "stream-mode");
  show($("#new-file"), false);
  show($("#restart-app"), false);
  show($("#toast"), false);
}

$("#new-file").addEventListener("click", returnHome);
$("#brand-home").addEventListener("click", returnHome);
$("#restart-app").addEventListener("click", () => window.desktop.restartApp());

async function receiveInfos(infos) {
  if (!infos?.length) return;
  returnHome();
  const accepted = infos.slice(0, IMAGE_LIMIT);
  if (infos.length > IMAGE_LIMIT) {
    toast(`YUV / RAW / HEIC 一次最多选择 ${IMAGE_LIMIT} 个文件，已保留前 ${IMAGE_LIMIT} 个。`);
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
    ["raw", "Bayer RAW 图像"],
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
  const sessionToken = state.sessionToken;
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
      $("#workspace").classList.remove("image-mode");
      $("#workspace").classList.add("stream-mode");
      await openStream(streamFiles[0], streamFiles[0].kind);
      return;
    }
    const docs = [];
    for (const file of state.pending) {
      if (file.kind === "yuv") docs.push(await createYuvDocument(file));
      else if (file.kind === "raw") docs.push(await createRawDocument(file));
      else if (file.kind === "heic") docs.push(await createHeicDocument(file));
      if (sessionToken !== state.sessionToken) {
        docs.forEach((doc) => {
          if (doc.kind === "heic" && doc.url) URL.revokeObjectURL(doc.url);
        });
        return;
      }
    }
    clearDocuments();
    state.docs = docs;
    state.activeDocId = docs[0]?.id || "";
    state.pending = [];
    show($("#type-screen"), false);
    show($("#workspace"), true);
    show($("#image-layout"), true);
    show($("#stream-workspace"), false);
    $("#workspace").classList.remove("stream-mode");
    $("#workspace").classList.add("image-mode");
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

function renderFileTabs() {
  $("#file-tabs").innerHTML = `
    <h2>已解析文件</h2>
    ${state.docs.map((doc, index) => `
      <button data-id="${escapeHtml(doc.id)}" class="${doc.id === state.activeDocId ? "active" : ""}">
        <b>${String(index + 1).padStart(2, "0")}</b>
        <span title="${escapeHtml(doc.file.name)}">${escapeHtml(doc.file.name)}</span>
        <em>${doc.kind === "yuv" ? "YUV" : doc.kind === "raw" ? "RAW" : "HEIC"}</em>
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
  $("#file-summary").innerHTML = fileMarkup(
    doc.file,
    doc.kind === "yuv" ? "YUV / SYUV" : doc.kind === "raw" ? "Bayer RAW" : "HEIC"
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
  if (viewer === "heic" && doc.kind === "heic") return doc;
  return null;
}

function viewerSize(viewer, doc) {
  return viewer === "heic"
    ? { width: doc.width, height: doc.height }
    : { width: doc.config.width, height: doc.config.height };
}

function updateViewerStatus(viewer) {
  const doc = viewerDocument(viewer);
  if (!doc) return;
  const zoom = Math.round((doc.zoom || 1) * 100);
  if (viewer === "yuv") {
    const pixel = doc.pixel || { x: 0, y: 0 };
    $("#yuv-status").textContent = `${doc.config.width}×${doc.config.height} | ${doc.config.format} | Zoom ${zoom}% | X:${pixel.x} Y:${pixel.y}`;
  } else if (viewer === "raw") {
    const pixel = doc.pixel || { x: 0, y: 0 };
    const value = doc.values[pixel.y * doc.config.width + pixel.x] || 0;
    const channel = R.bayerChannel(doc.config.bayer, pixel.x, pixel.y);
    $("#raw-status").textContent = `${doc.config.width}×${doc.config.height} | ${doc.config.bayer} | RAW${doc.config.bitDepth} | Zoom ${zoom}% | X:${pixel.x} Y:${pixel.y} RAW:${value} ${channel}`;
  } else {
    $("#heic-status").textContent = `${doc.width}×${doc.height} | HEIC | Zoom ${zoom}%`;
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
  doc.zoom = Math.max(0.1, Math.min(16, zoom));
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
  doc.zoom = Math.max(0.1, Math.min(16, availableWidth / width, availableHeight / height));
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
  state.stream.decoder = "检测中";
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
