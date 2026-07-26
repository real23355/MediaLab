(function () {
  const FORMATS = ["I420", "YV12", "NV12", "NV21", "YUY2", "UYVY", "GRAY8"];
  const COMMON_SIZES = [
    [3840, 2160], [2560, 1440], [2048, 1080], [1920, 1080], [1920, 1200],
    [1600, 900], [1440, 1080], [1280, 960], [1280, 720], [1024, 768],
    [960, 540], [854, 480], [800, 600], [720, 576], [720, 480],
    [640, 480], [640, 360], [480, 360], [352, 288], [352, 240],
    [320, 240], [320, 180], [176, 144], [160, 120]
  ];

  function frameBytes(width, height, format) {
    const pixels = width * height;
    if (format === "GRAY8") return pixels;
    if (format === "YUY2" || format === "UYVY") return pixels * 2;
    return Math.floor(pixels * 1.5);
  }

  function filenameHints(name) {
    const dimension = name.match(/(?:^|[_.\-\s])(\d{2,5})[xX×](\d{2,5})(?=$|[_.\-\s])/);
    const upper = name.toUpperCase();
    return {
      width: dimension ? Number(dimension[1]) : undefined,
      height: dimension ? Number(dimension[2]) : undefined,
      format: FORMATS.find((item) => upper.includes(item))
    };
  }

  function syuvHints(sample, totalSize, filename) {
    if (!filename.toLowerCase().endsWith(".syuv") || sample.byteLength < 16) return null;
    let cursor = 0;
    let width;
    let height;
    while (cursor + 5 <= Math.min(sample.byteLength, 4096)) {
      const length =
        sample[cursor + 1]
        | (sample[cursor + 2] << 8)
        | (sample[cursor + 3] << 16)
        | (sample[cursor + 4] << 24);
      if (length < 0 || length > 512 || cursor + 5 + length > sample.byteLength) break;
      const value = new TextDecoder("ascii")
        .decode(sample.subarray(cursor + 5, cursor + 5 + length))
        .replace(/\0/g, "");
      const dimension = value.match(/^(\d{2,5})[xX×](\d{2,5})$/);
      if (dimension) {
        width = Number(dimension[1]);
        height = Number(dimension[2]);
      }
      cursor += 5 + length;
    }
    if (!width || !height) return null;
    const bytes = frameBytes(width, height, "NV21");
    const dataOffset = totalSize % bytes;
    if (dataOffset <= 0 || dataOffset > 4096 || dataOffset > sample.byteLength) return null;
    return { width, height, dataOffset };
  }

  function pixel(data, width, height, format, x, y, offset = 0) {
    const pixels = width * height;
    if (format === "GRAY8") return [data[offset + y * width + x] ?? 0, 128, 128];
    if (format === "YUY2" || format === "UYVY") {
      const pair = offset + (y * width + (x & ~1)) * 2;
      if (format === "YUY2") {
        return [
          data[pair + (x % 2) * 2] ?? 0,
          data[pair + 1] ?? 128,
          data[pair + 3] ?? 128
        ];
      }
      return [
        data[pair + 1 + (x % 2) * 2] ?? 0,
        data[pair] ?? 128,
        data[pair + 2] ?? 128
      ];
    }
    const yv = data[offset + y * width + x] ?? 0;
    const cw = Math.ceil(width / 2);
    const ch = Math.ceil(height / 2);
    const ci = Math.floor(y / 2) * cw + Math.floor(x / 2);
    const cs = cw * ch;
    let u = 128;
    let v = 128;
    if (format === "I420") {
      u = data[offset + pixels + ci] ?? 128;
      v = data[offset + pixels + cs + ci] ?? 128;
    } else if (format === "YV12") {
      v = data[offset + pixels + ci] ?? 128;
      u = data[offset + pixels + cs + ci] ?? 128;
    } else {
      const uv = offset + pixels + Math.floor(y / 2) * width + Math.floor(x / 2) * 2;
      const first = data[uv] ?? 128;
      const second = data[uv + 1] ?? 128;
      [u, v] = format === "NV12" ? [first, second] : [second, first];
    }
    return [yv, u, v];
  }

  function contentScore(data, width, height, format) {
    const cols = Math.min(24, width);
    const rows = Math.min(18, height);
    let luma = 0;
    let lumaSq = 0;
    let jump = 0;
    let chroma = 0;
    let samples = 0;
    for (let gy = 0; gy < rows; gy += 1) {
      let previous;
      const y = Math.min(height - 1, Math.floor(((gy + 0.5) * height) / rows));
      for (let gx = 0; gx < cols; gx += 1) {
        const x = Math.min(width - 1, Math.floor(((gx + 0.5) * width) / cols));
        const value = pixel(data, width, height, format, x, y);
        luma += value[0];
        lumaSq += value[0] * value[0];
        chroma += Math.abs(value[1] - 128) + Math.abs(value[2] - 128);
        if (previous) jump += Math.abs(value[1] - previous[1]) + Math.abs(value[2] - previous[2]);
        previous = value;
        samples += 1;
      }
    }
    const mean = luma / Math.max(samples, 1);
    const variance = lumaSq / Math.max(samples, 1) - mean * mean;
    return Math.min(10, variance / 500)
      - (jump / Math.max(samples - rows, 1)) * 0.045
      - Math.max(0, chroma / Math.max(samples, 1) - 105) * 0.02;
  }

  function detectYuv(sample, totalSize, filename) {
    const hints = filenameHints(filename);
    const syuv = syuvHints(sample, totalSize, filename);
    const sizes = hints.width && hints.height
      ? [[hints.width, hints.height], ...COMMON_SIZES]
      : syuv
        ? [[syuv.width, syuv.height], ...COMMON_SIZES]
        : COMMON_SIZES;
    const seen = new Set();
    const candidates = [];
    for (const [width, height] of sizes) {
      const dimensionKey = `${width}x${height}`;
      if (seen.has(dimensionKey)) continue;
      seen.add(dimensionKey);
      for (const format of FORMATS) {
        if ((format === "YUY2" || format === "UYVY") && width % 2) continue;
        if (!["YUY2", "UYVY", "GRAY8"].includes(format) && (width % 2 || height % 2)) continue;
        const bytes = frameBytes(width, height, format);
        const dataOffset =
          syuv && syuv.width === width && syuv.height === height ? syuv.dataOffset : 0;
        const payloadSize = totalSize - dataOffset;
        if (!bytes || payloadSize <= 0 || payloadSize % bytes !== 0) continue;
        const count = payloadSize / bytes;
        if (count < 1 || count > 100000) continue;
        let score = contentScore(sample.subarray(dataOffset), width, height, format);
        const reasons = [];
        if (dataOffset > 0) {
          score += format === "NV21" ? 220 : 150;
          reasons.push(`SYUV 文件头 ${dataOffset} B`);
        }
        if (hints.width === width && hints.height === height) {
          score += 100;
          reasons.push("文件名分辨率");
        }
        if (hints.format === format) {
          score += 60;
          reasons.push("文件名像素格式");
        }
        if (count >= 2 && count <= 3600) score += 7;
        if (width >= height) score += 2;
        reasons.push(`${count.toLocaleString("zh-CN")} 帧整除`);
        candidates.push({
          width,
          height,
          format,
          frameBytes: bytes,
          frameCount: count,
          dataOffset,
          score,
          reason: reasons.join(" · ")
        });
      }
    }
    return candidates.sort((a, b) => b.score - a.score).slice(0, 20);
  }

  function renderYuv(data, width, height, format) {
    const image = new ImageData(width, height);
    const clamp = (value) => Math.max(0, Math.min(255, value));
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const [yv, u, v] = pixel(data, width, height, format, x, y);
        const c = yv - 16;
        const d = u - 128;
        const e = v - 128;
        const index = (y * width + x) * 4;
        image.data[index] = clamp((298 * c + 409 * e + 128) >> 8);
        image.data[index + 1] = clamp((298 * c - 100 * d - 208 * e + 128) >> 8);
        image.data[index + 2] = clamp((298 * c + 516 * d + 128) >> 8);
        image.data[index + 3] = 255;
      }
    }
    return image;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "—";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let unit = units[0];
    for (let i = 1; i < units.length && value >= 1024; i += 1) {
      value /= 1024;
      unit = units[i];
    }
    return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${unit}`;
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "00:00.000";
    const minutes = Math.floor(seconds / 60);
    const rest = seconds - minutes * 60;
    return `${String(minutes).padStart(2, "0")}:${rest.toFixed(3).padStart(6, "0")}`;
  }

  window.MediaTools = {
    FORMATS,
    frameBytes,
    detectYuv,
    renderYuv,
    formatBytes,
    formatTime
  };
})();
