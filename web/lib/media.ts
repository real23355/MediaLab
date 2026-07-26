export type MediaKind = "yuv" | "heic" | "h264" | "h265";

export type YuvFormat =
  | "I420"
  | "YV12"
  | "NV12"
  | "NV21"
  | "YUY2"
  | "UYVY"
  | "GRAY8";

export interface YuvCandidate {
  width: number;
  height: number;
  format: YuvFormat;
  frameBytes: number;
  frameCount: number;
  dataOffset: number;
  score: number;
  reason: string;
}

export interface StreamFrame {
  index: number;
  start: number;
  end: number;
  size: number;
  type: "I" | "P" | "B" | "其他";
  key: boolean;
  nalTypes: number[];
}

export interface StreamAnalysis {
  kind: "h264" | "h265";
  codecLabel: string;
  codecString: string;
  width?: number;
  height?: number;
  profile?: string;
  level?: string;
  frames: StreamFrame[];
  nalCount: number;
  nalHistogram: Array<{ type: number; label: string; count: number }>;
  keyframes: number;
  averageFrameSize: number;
  maxFrameSize: number;
  minFrameSize: number;
}

const COMMON_SIZES = [
  [3840, 2160],
  [2560, 1440],
  [2048, 1080],
  [1920, 1080],
  [1920, 1200],
  [1600, 900],
  [1440, 1080],
  [1280, 720],
  [1280, 960],
  [1024, 768],
  [960, 540],
  [854, 480],
  [800, 600],
  [720, 576],
  [720, 480],
  [640, 480],
  [640, 360],
  [480, 360],
  [352, 288],
  [352, 240],
  [320, 240],
  [320, 180],
  [176, 144],
  [160, 120],
] as const;

export const YUV_FORMATS: YuvFormat[] = [
  "I420",
  "YV12",
  "NV12",
  "NV21",
  "YUY2",
  "UYVY",
  "GRAY8",
];

export function bytesForYuvFrame(
  width: number,
  height: number,
  format: YuvFormat,
) {
  const pixels = width * height;
  if (format === "GRAY8") return pixels;
  if (format === "YUY2" || format === "UYVY") return pixels * 2;
  return Math.floor(pixels * 1.5);
}

function filenameHints(name: string) {
  const dimension = name.match(/(?:^|[_.\-\s])(\d{2,5})[xX×](\d{2,5})(?=$|[_.\-\s])/);
  const upper = name.toUpperCase();
  const format = YUV_FORMATS.find((item) => upper.includes(item));
  return {
    width: dimension ? Number(dimension[1]) : undefined,
    height: dimension ? Number(dimension[2]) : undefined,
    format,
  };
}

function syuvHints(data: Uint8Array, totalSize: number, filename: string) {
  if (!filename.toLowerCase().endsWith(".syuv") || data.byteLength < 16) return null;
  let cursor = 0;
  let width: number | undefined;
  let height: number | undefined;
  while (cursor + 5 <= Math.min(data.byteLength, 4096)) {
    const length =
      data[cursor + 1] |
      (data[cursor + 2] << 8) |
      (data[cursor + 3] << 16) |
      (data[cursor + 4] << 24);
    if (length < 0 || length > 512 || cursor + 5 + length > data.byteLength) break;
    const value = new TextDecoder("ascii")
      .decode(data.subarray(cursor + 5, cursor + 5 + length))
      .replace(/\0/g, "");
    const dimension = value.match(/^(\d{2,5})[xX×](\d{2,5})$/);
    if (dimension) {
      width = Number(dimension[1]);
      height = Number(dimension[2]);
    }
    cursor += 5 + length;
  }
  if (!width || !height) return null;
  const frameBytes = bytesForYuvFrame(width, height, "NV21");
  const dataOffset = totalSize % frameBytes;
  if (dataOffset <= 0 || dataOffset > 4096 || dataOffset > data.byteLength) return null;
  return { width, height, dataOffset };
}

function yuvPixel(
  data: Uint8Array,
  width: number,
  height: number,
  format: YuvFormat,
  x: number,
  y: number,
  offset = 0,
) {
  const pixels = width * height;
  if (format === "GRAY8") {
    return [data[offset + y * width + x] ?? 0, 128, 128] as const;
  }
  if (format === "YUY2" || format === "UYVY") {
    const pair = offset + (y * width + (x & ~1)) * 2;
    if (format === "YUY2") {
      return [
        data[pair + (x % 2) * 2] ?? 0,
        data[pair + 1] ?? 128,
        data[pair + 3] ?? 128,
      ] as const;
    }
    return [
      data[pair + 1 + (x % 2) * 2] ?? 0,
      data[pair] ?? 128,
      data[pair + 2] ?? 128,
    ] as const;
  }
  const yValue = data[offset + y * width + x] ?? 0;
  const chromaIndex = Math.floor(y / 2) * Math.ceil(width / 2) + Math.floor(x / 2);
  const chromaWidth = Math.ceil(width / 2);
  const chromaHeight = Math.ceil(height / 2);
  const chromaSize = chromaWidth * chromaHeight;
  let u = 128;
  let v = 128;
  if (format === "I420") {
    u = data[offset + pixels + chromaIndex] ?? 128;
    v = data[offset + pixels + chromaSize + chromaIndex] ?? 128;
  } else if (format === "YV12") {
    v = data[offset + pixels + chromaIndex] ?? 128;
    u = data[offset + pixels + chromaSize + chromaIndex] ?? 128;
  } else {
    const uv = offset + pixels + Math.floor(y / 2) * width + Math.floor(x / 2) * 2;
    const first = data[uv] ?? 128;
    const second = data[uv + 1] ?? 128;
    [u, v] = format === "NV12" ? [first, second] : [second, first];
  }
  return [yValue, u, v] as const;
}

function contentScore(
  data: Uint8Array,
  width: number,
  height: number,
  format: YuvFormat,
) {
  const cols = Math.min(24, width);
  const rows = Math.min(18, height);
  let lumaSum = 0;
  let lumaSq = 0;
  let chromaDistance = 0;
  let chromaJumps = 0;
  let samples = 0;
  for (let gy = 0; gy < rows; gy += 1) {
    let previous: readonly [number, number, number] | undefined;
    const y = Math.min(height - 1, Math.floor(((gy + 0.5) * height) / rows));
    for (let gx = 0; gx < cols; gx += 1) {
      const x = Math.min(width - 1, Math.floor(((gx + 0.5) * width) / cols));
      const pixel = yuvPixel(data, width, height, format, x, y);
      lumaSum += pixel[0];
      lumaSq += pixel[0] * pixel[0];
      chromaDistance += Math.abs(pixel[1] - 128) + Math.abs(pixel[2] - 128);
      if (previous) {
        chromaJumps +=
          Math.abs(pixel[1] - previous[1]) + Math.abs(pixel[2] - previous[2]);
      }
      previous = pixel;
      samples += 1;
    }
  }
  const mean = lumaSum / Math.max(samples, 1);
  const variance = lumaSq / Math.max(samples, 1) - mean * mean;
  const jump = chromaJumps / Math.max(samples - rows, 1);
  const distance = chromaDistance / Math.max(samples, 1);
  return Math.min(10, variance / 500) - jump * 0.045 - Math.max(0, distance - 105) * 0.02;
}

export function detectYuv(
  data: Uint8Array,
  filename: string,
): YuvCandidate[] {
  const hints = filenameHints(filename);
  const syuv = syuvHints(data, data.byteLength, filename);
  const sizes: Array<readonly [number, number]> = hints.width && hints.height
    ? [[hints.width, hints.height], ...COMMON_SIZES]
    : syuv
      ? [[syuv.width, syuv.height], ...COMMON_SIZES]
      : [...COMMON_SIZES];
  const unique = new Set<string>();
  const candidates: YuvCandidate[] = [];

  for (const [width, height] of sizes) {
    const key = `${width}x${height}`;
    if (unique.has(key)) continue;
    unique.add(key);
    for (const format of YUV_FORMATS) {
      if ((format === "YUY2" || format === "UYVY") && width % 2 !== 0) continue;
      if (!["YUY2", "UYVY", "GRAY8"].includes(format) && (width % 2 || height % 2)) {
        continue;
      }
      const frameBytes = bytesForYuvFrame(width, height, format);
      const dataOffset =
        syuv && syuv.width === width && syuv.height === height ? syuv.dataOffset : 0;
      const payloadBytes = data.byteLength - dataOffset;
      if (frameBytes <= 0 || payloadBytes <= 0 || payloadBytes % frameBytes !== 0) continue;
      const frameCount = payloadBytes / frameBytes;
      if (frameCount < 1 || frameCount > 100000) continue;
      let score = contentScore(data.subarray(dataOffset), width, height, format);
      const reasons: string[] = [];
      if (dataOffset > 0) {
        score += format === "NV21" ? 220 : 150;
        reasons.push(`SYUV 文件头 ${dataOffset} B`);
      }
      if (hints.width === width && hints.height === height) {
        score += 100;
        reasons.push("文件名含分辨率");
      }
      if (hints.format === format) {
        score += 60;
        reasons.push("文件名含像素格式");
      }
      if (frameCount >= 2 && frameCount <= 3600) score += 7;
      if (width >= height) score += 2;
      if (width * height >= 320 * 180) score += 1;
      reasons.push(`${frameCount.toLocaleString("zh-CN")} 帧整除`);
      candidates.push({
        width,
        height,
        format,
        frameBytes,
        frameCount,
        dataOffset,
        score,
        reason: reasons.join(" · "),
      });
    }
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 20);
}

export function renderYuvFrame(
  data: Uint8Array,
  candidate: Pick<YuvCandidate, "width" | "height" | "format" | "frameBytes">,
  frameIndex: number,
) {
  const { width, height, format, frameBytes } = candidate;
  const output = new ImageData(width, height);
  const offset = ("dataOffset" in candidate ? Number(candidate.dataOffset) || 0 : 0) +
    frameIndex * frameBytes;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [yv, u, v] = yuvPixel(data, width, height, format, x, y, offset);
      const c = yv - 16;
      const d = u - 128;
      const e = v - 128;
      const i = (y * width + x) * 4;
      output.data[i] = clamp((298 * c + 409 * e + 128) >> 8);
      output.data[i + 1] = clamp((298 * c - 100 * d - 208 * e + 128) >> 8);
      output.data[i + 2] = clamp((298 * c + 516 * d + 128) >> 8);
      output.data[i + 3] = 255;
    }
  }
  return output;
}

function clamp(value: number) {
  return Math.max(0, Math.min(255, value));
}

interface NalUnit {
  start: number;
  payloadStart: number;
  end: number;
  type: number;
}

function splitAnnexB(data: Uint8Array, kind: "h264" | "h265") {
  const starts: Array<{ start: number; payloadStart: number }> = [];
  for (let i = 0; i + 3 < data.length; i += 1) {
    if (data[i] !== 0 || data[i + 1] !== 0) continue;
    if (data[i + 2] === 1) {
      starts.push({ start: i, payloadStart: i + 3 });
      i += 2;
    } else if (data[i + 2] === 0 && data[i + 3] === 1) {
      starts.push({ start: i, payloadStart: i + 4 });
      i += 3;
    }
  }
  return starts
    .map((item, index): NalUnit | undefined => {
      const end = starts[index + 1]?.start ?? data.length;
      if (item.payloadStart >= end) return undefined;
      const header = data[item.payloadStart];
      const type = kind === "h264" ? header & 0x1f : (header >> 1) & 0x3f;
      return { ...item, end, type };
    })
    .filter((item): item is NalUnit => Boolean(item));
}

function rbsp(bytes: Uint8Array) {
  const result: number[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    if (
      i >= 2 &&
      bytes[i] === 3 &&
      bytes[i - 1] === 0 &&
      bytes[i - 2] === 0
    ) {
      continue;
    }
    result.push(bytes[i]);
  }
  return new Uint8Array(result);
}

class BitReader {
  private bit = 0;
  constructor(private readonly data: Uint8Array) {}
  read(count = 1) {
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      const byte = this.data[this.bit >> 3] ?? 0;
      value = value * 2 + ((byte >> (7 - (this.bit & 7))) & 1);
      this.bit += 1;
    }
    return value;
  }
  skip(count: number) {
    this.bit += count;
  }
  ue() {
    let zeros = 0;
    while (zeros < 31 && this.read(1) === 0) zeros += 1;
    return 2 ** zeros - 1 + (zeros ? this.read(zeros) : 0);
  }
  se() {
    const value = this.ue();
    return value & 1 ? (value + 1) / 2 : -(value / 2);
  }
}

function skipScalingList(reader: BitReader, size: number) {
  let last = 8;
  let next = 8;
  for (let j = 0; j < size; j += 1) {
    if (next !== 0) next = (last + reader.se() + 256) % 256;
    last = next === 0 ? last : next;
  }
}

function parseH264Sps(payload: Uint8Array) {
  const raw = rbsp(payload.slice(1));
  const reader = new BitReader(raw);
  const profileIdc = reader.read(8);
  const compatibility = reader.read(8);
  const levelIdc = reader.read(8);
  reader.ue();
  let chromaFormat = 1;
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profileIdc)) {
    chromaFormat = reader.ue();
    if (chromaFormat === 3) reader.read();
    reader.ue();
    reader.ue();
    reader.read();
    if (reader.read()) {
      for (let i = 0; i < (chromaFormat !== 3 ? 8 : 12); i += 1) {
        if (reader.read()) skipScalingList(reader, i < 6 ? 16 : 64);
      }
    }
  }
  reader.ue();
  const pocType = reader.ue();
  if (pocType === 0) reader.ue();
  else if (pocType === 1) {
    reader.read();
    reader.se();
    reader.se();
    const cycle = reader.ue();
    for (let i = 0; i < cycle; i += 1) reader.se();
  }
  reader.ue();
  reader.read();
  const widthMbs = reader.ue() + 1;
  const heightMap = reader.ue() + 1;
  const frameMbsOnly = reader.read();
  if (!frameMbsOnly) reader.read();
  reader.read();
  let cropLeft = 0;
  let cropRight = 0;
  let cropTop = 0;
  let cropBottom = 0;
  if (reader.read()) {
    cropLeft = reader.ue();
    cropRight = reader.ue();
    cropTop = reader.ue();
    cropBottom = reader.ue();
  }
  const cropUnitX = chromaFormat === 0 ? 1 : chromaFormat === 3 ? 1 : 2;
  const cropUnitY =
    (chromaFormat === 0 ? 1 : chromaFormat === 1 ? 2 : 1) * (2 - frameMbsOnly);
  const width = widthMbs * 16 - (cropLeft + cropRight) * cropUnitX;
  const height = heightMap * 16 * (2 - frameMbsOnly) - (cropTop + cropBottom) * cropUnitY;
  const profileNames: Record<number, string> = {
    66: "Baseline",
    77: "Main",
    88: "Extended",
    100: "High",
    110: "High 10",
    122: "High 4:2:2",
    244: "High 4:4:4",
  };
  const hex = (value: number) => value.toString(16).padStart(2, "0").toUpperCase();
  return {
    width,
    height,
    profile: profileNames[profileIdc] ?? `Profile ${profileIdc}`,
    level: `${Math.floor(levelIdc / 10)}.${levelIdc % 10}`,
    codecString: `avc1.${hex(profileIdc)}${hex(compatibility)}${hex(levelIdc)}`,
  };
}

function skipHevcProfileTierLevel(reader: BitReader, maxSubLayersMinus1: number) {
  reader.skip(2 + 1 + 5 + 32 + 48 + 8);
  const profilePresent: number[] = [];
  const levelPresent: number[] = [];
  for (let i = 0; i < maxSubLayersMinus1; i += 1) {
    profilePresent.push(reader.read());
    levelPresent.push(reader.read());
  }
  if (maxSubLayersMinus1 > 0) reader.skip((8 - maxSubLayersMinus1) * 2);
  for (let i = 0; i < maxSubLayersMinus1; i += 1) {
    if (profilePresent[i]) reader.skip(2 + 1 + 5 + 32 + 48);
    if (levelPresent[i]) reader.skip(8);
  }
}

function parseH265Sps(payload: Uint8Array) {
  const raw = rbsp(payload.slice(2));
  const reader = new BitReader(raw);
  reader.read(4);
  const maxSubLayersMinus1 = reader.read(3);
  reader.read();
  skipHevcProfileTierLevel(reader, maxSubLayersMinus1);
  reader.ue();
  const chromaFormat = reader.ue();
  if (chromaFormat === 3) reader.read();
  const pictureWidth = reader.ue();
  const pictureHeight = reader.ue();
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  if (reader.read()) {
    left = reader.ue();
    right = reader.ue();
    top = reader.ue();
    bottom = reader.ue();
  }
  const subWidth = chromaFormat === 1 || chromaFormat === 2 ? 2 : 1;
  const subHeight = chromaFormat === 1 ? 2 : 1;
  return {
    width: pictureWidth - subWidth * (left + right),
    height: pictureHeight - subHeight * (top + bottom),
    profile: "HEVC",
    level: undefined,
    codecString: "hev1.1.6.L93.B0",
  };
}

function h264SliceInfo(data: Uint8Array, nal: NalUnit) {
  try {
    const reader = new BitReader(rbsp(data.slice(nal.payloadStart + 1, nal.end)));
    const firstMb = reader.ue();
    const rawType = reader.ue() % 5;
    const type: StreamFrame["type"] =
      rawType === 2 || rawType === 4 ? "I" : rawType === 1 ? "B" : "P";
    return { first: firstMb === 0, type };
  } catch {
    return { first: false, type: "其他" as const };
  }
}

function h265SliceInfo(data: Uint8Array, nal: NalUnit) {
  const firstByte = data[nal.payloadStart + 2] ?? 0;
  return {
    first: Boolean(firstByte & 0x80),
    type: nal.type >= 16 && nal.type <= 21 ? ("I" as const) : ("P" as const),
  };
}

const H264_NAL_NAMES: Record<number, string> = {
  1: "非 IDR Slice",
  5: "IDR Slice",
  6: "SEI",
  7: "SPS",
  8: "PPS",
  9: "AUD",
};

const H265_NAL_NAMES: Record<number, string> = {
  0: "TRAIL_N",
  1: "TRAIL_R",
  19: "IDR_W_RADL",
  20: "IDR_N_LP",
  21: "CRA",
  32: "VPS",
  33: "SPS",
  34: "PPS",
  35: "AUD",
  39: "SEI Prefix",
  40: "SEI Suffix",
};

export function analyzeStream(
  data: Uint8Array,
  kind: "h264" | "h265",
): StreamAnalysis {
  const nals = splitAnnexB(data, kind);
  if (!nals.length) throw new Error("没有找到 Annex-B 起始码（00 00 01）");

  const histogram = new Map<number, number>();
  nals.forEach((nal) => histogram.set(nal.type, (histogram.get(nal.type) ?? 0) + 1));

  const frames: StreamFrame[] = [];
  let pendingStart = nals[0].start;
  let pendingTypes: number[] = [];
  let hasVcl = false;
  let frameType: StreamFrame["type"] = "其他";
  let isKey = false;

  const pushFrame = (end: number) => {
    if (!hasVcl || end <= pendingStart) return;
    frames.push({
      index: frames.length,
      start: pendingStart,
      end,
      size: end - pendingStart,
      type: frameType,
      key: isKey,
      nalTypes: [...pendingTypes],
    });
    pendingStart = end;
    pendingTypes = [];
    hasVcl = false;
    frameType = "其他";
    isKey = false;
  };

  nals.forEach((nal) => {
    const vcl = kind === "h264" ? nal.type >= 1 && nal.type <= 5 : nal.type <= 31;
    const aud = kind === "h264" ? nal.type === 9 : nal.type === 35;
    const slice = vcl
      ? kind === "h264"
        ? h264SliceInfo(data, nal)
        : h265SliceInfo(data, nal)
      : undefined;
    if ((aud && hasVcl) || (slice?.first && hasVcl)) pushFrame(nal.start);
    if (!pendingTypes.length) pendingStart = nal.start;
    pendingTypes.push(nal.type);
    if (vcl) {
      hasVcl = true;
      if (frameType === "其他" || slice?.type === "I") frameType = slice?.type ?? "其他";
      const key = kind === "h264" ? nal.type === 5 : nal.type >= 16 && nal.type <= 21;
      isKey ||= key;
    }
  });
  pushFrame(data.length);

  let parsed:
    | {
        width: number;
        height: number;
        profile?: string;
        level?: string;
        codecString: string;
      }
    | undefined;
  try {
    const sps = nals.find((nal) => nal.type === (kind === "h264" ? 7 : 33));
    if (sps) {
      parsed =
        kind === "h264"
          ? parseH264Sps(data.slice(sps.payloadStart, sps.end))
          : parseH265Sps(data.slice(sps.payloadStart, sps.end));
    }
  } catch {
    parsed = undefined;
  }

  const sizes = frames.map((frame) => frame.size);
  const names = kind === "h264" ? H264_NAL_NAMES : H265_NAL_NAMES;
  return {
    kind,
    codecLabel: kind === "h264" ? "H.264 / AVC" : "H.265 / HEVC",
    codecString: parsed?.codecString ?? (kind === "h264" ? "avc1.42E01E" : "hev1.1.6.L93.B0"),
    width: parsed?.width,
    height: parsed?.height,
    profile: parsed?.profile,
    level: parsed?.level,
    frames,
    nalCount: nals.length,
    nalHistogram: [...histogram.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({
        type,
        label: names[type] ?? `NAL ${type}`,
        count,
      })),
    keyframes: frames.filter((frame) => frame.key).length,
    averageFrameSize: sizes.length
      ? sizes.reduce((total, size) => total + size, 0) / sizes.length
      : 0,
    maxFrameSize: sizes.length ? Math.max(...sizes) : 0,
    minFrameSize: sizes.length ? Math.min(...sizes) : 0,
  };
}

export function detectKind(file: File): MediaKind {
  const name = file.name.toLowerCase();
  if (/\.(heic|heif)$/.test(name)) return "heic";
  if (/\.(265|h265|hevc)$/.test(name)) return "h265";
  if (/\.(264|h264|avc)$/.test(name)) return "h264";
  return "yuv";
}

export function formatBytes(bytes: number) {
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
