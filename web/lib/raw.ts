export type BayerPattern = "RGGB" | "BGGR" | "GRBG" | "GBRG";
export type RawPacking = "MIPI_RAW10" | "UNPACKED16_LE" | "UNPACKED16_BE";
export type RawViewMode = "gray" | "rgb";

export interface RawConfig {
  width: number;
  height: number;
  bitDepth: number;
  bayer: BayerPattern;
  packing: RawPacking;
  frameBytes: number;
  reason: string;
}

export interface RawLevels {
  low: number;
  high: number;
  min: number;
  max: number;
}

const COMMON_RAW_SIZES = [
  [3840, 2160],
  [2560, 1440],
  [2048, 1536],
  [2048, 1080],
  [1920, 1080],
  [1600, 1200],
  [1280, 720],
] as const;

export const BAYER_PATTERNS: BayerPattern[] = ["RGGB", "BGGR", "GRBG", "GBRG"];

export const RAW_PACKINGS: Array<{ value: RawPacking; label: string }> = [
  { value: "UNPACKED16_LE", label: "RAW Unpacked16 LE" },
  { value: "UNPACKED16_BE", label: "RAW Unpacked16 BE" },
  { value: "MIPI_RAW10", label: "MIPI RAW10 Packed" },
];

export function bytesForRawFrame(
  width: number,
  height: number,
  bitDepth: number,
  packing: RawPacking,
) {
  if (packing === "MIPI_RAW10") {
    if (bitDepth !== 10) return 0;
    return Math.ceil(width / 4) * 5 * height;
  }
  return width * height * 2;
}

function nameHints(name: string) {
  const dimension = name.match(/(?:^|[_.\-\s])(\d{2,5})[xX×](\d{2,5})(?=$|[_.\-\s])/);
  const bitDepth = name.match(/(?:^|[_.\-\s])(8|10|12|14|16)(?:bit|b)(?=$|[_.\-\s])/i);
  const upper = name.toUpperCase();
  return {
    width: dimension ? Number(dimension[1]) : undefined,
    height: dimension ? Number(dimension[2]) : undefined,
    bitDepth: bitDepth ? Number(bitDepth[1]) : undefined,
    bayer: BAYER_PATTERNS.find((pattern) => upper.includes(pattern)),
  };
}

function analyzeUnpackedSample(sample: Uint8Array, bitDepth: number) {
  const words = Math.floor(sample.byteLength / 2);
  const maximum = 2 ** bitDepth - 1;
  let leValid = 0;
  let beValid = 0;
  for (let offset = 0; offset + 1 < sample.byteLength; offset += 2) {
    const le = sample[offset] | (sample[offset + 1] << 8);
    const be = (sample[offset] << 8) | sample[offset + 1];
    if (le <= maximum) leValid += 1;
    if (be <= maximum) beValid += 1;
  }
  return {
    leRatio: leValid / Math.max(1, words),
    beRatio: beValid / Math.max(1, words),
  };
}

export function detectRaw(
  sample: Uint8Array,
  totalSize: number,
  filename: string,
): RawConfig {
  if (!totalSize) throw new Error("RAW 文件为空");
  const hints = nameHints(filename);
  const bitDepth = hints.bitDepth ?? 10;
  const dimensions: Array<readonly [number, number]> = hints.width && hints.height
    ? [[hints.width, hints.height], ...COMMON_RAW_SIZES]
    : [...COMMON_RAW_SIZES];

  for (const [width, height] of dimensions) {
    const packed = bytesForRawFrame(width, height, 10, "MIPI_RAW10");
    if (totalSize === packed) {
      return {
        width,
        height,
        bitDepth: 10,
        bayer: hints.bayer ?? "RGGB",
        packing: "MIPI_RAW10",
        frameBytes: packed,
        reason: `${hints.width ? "文件名" : "文件大小"}识别 · MIPI RAW10 Packed`,
      };
    }
    const unpacked = bytesForRawFrame(width, height, bitDepth, "UNPACKED16_LE");
    if (totalSize === unpacked) {
      const endian = analyzeUnpackedSample(sample, bitDepth);
      const packing: RawPacking = endian.beRatio > endian.leRatio
        ? "UNPACKED16_BE"
        : "UNPACKED16_LE";
      return {
        width,
        height,
        bitDepth,
        bayer: hints.bayer ?? "RGGB",
        packing,
        frameBytes: unpacked,
        reason: `${hints.width ? "文件名" : "文件大小"}识别 · 16-bit 容器 · ${packing.endsWith("LE") ? "小端" : "大端"}`,
      };
    }
  }

  const fallbackWidth = hints.width ?? 3840;
  const fallbackHeight = hints.height ?? 2160;
  const fallbackPacking: RawPacking = "UNPACKED16_LE";
  return {
    width: fallbackWidth,
    height: fallbackHeight,
    bitDepth,
    bayer: hints.bayer ?? "RGGB",
    packing: fallbackPacking,
    frameBytes: bytesForRawFrame(fallbackWidth, fallbackHeight, bitDepth, fallbackPacking),
    reason: "无法由文件大小确认，请手动校正参数",
  };
}

export function decodeRaw(data: Uint8Array, config: RawConfig) {
  const expected = bytesForRawFrame(
    config.width,
    config.height,
    config.bitDepth,
    config.packing,
  );
  if (!expected || data.byteLength !== expected) {
    throw new Error(
      `RAW 文件大小不匹配：当前 ${data.byteLength.toLocaleString("zh-CN")} B，` +
      `${config.width}×${config.height} ${config.packing} 需要 ${expected.toLocaleString("zh-CN")} B`,
    );
  }
  const pixels = config.width * config.height;
  const output = new Uint16Array(pixels);
  const mask = 2 ** config.bitDepth - 1;
  if (config.packing === "MIPI_RAW10") {
    // MIPI RAW10: B0..B3 store P0..P3 bits [9:2]. B4 packs each pixel's low 2 bits.
    const rowBytes = Math.ceil(config.width / 4) * 5;
    for (let y = 0; y < config.height; y += 1) {
      let source = y * rowBytes;
      const rowEnd = (y + 1) * config.width;
      for (let target = y * config.width; target < rowEnd; target += 4, source += 5) {
        const low = data[source + 4] ?? 0;
        for (let index = 0; index < 4 && target + index < rowEnd; index += 1) {
          output[target + index] = (((data[source + index] ?? 0) << 2) | ((low >> (index * 2)) & 3)) & mask;
        }
      }
    }
  } else {
    const littleEndian = config.packing === "UNPACKED16_LE";
    for (let index = 0, offset = 0; index < pixels; index += 1, offset += 2) {
      const word = littleEndian
        ? data[offset] | (data[offset + 1] << 8)
        : (data[offset] << 8) | data[offset + 1];
      output[index] = word & mask;
    }
  }
  return output;
}

export function rawLevels(values: Uint16Array, bitDepth: number): RawLevels {
  const histogram = new Uint32Array(2 ** bitDepth);
  let min = histogram.length - 1;
  let max = 0;
  for (const value of values) {
    const sample = Math.min(histogram.length - 1, value);
    histogram[sample] += 1;
    min = Math.min(min, sample);
    max = Math.max(max, sample);
  }
  const percentile = (fraction: number) => {
    const target = values.length * fraction;
    let count = 0;
    for (let value = 0; value < histogram.length; value += 1) {
      count += histogram[value];
      if (count >= target) return value;
    }
    return max;
  };
  const low = percentile(0.001);
  const high = Math.max(low + 1, percentile(0.999));
  return { low, high, min, max };
}

export function bayerChannel(pattern: BayerPattern, x: number, y: number) {
  const maps: Record<BayerPattern, readonly [string, string, string, string]> = {
    RGGB: ["R", "Gr", "Gb", "B"],
    BGGR: ["B", "Gb", "Gr", "R"],
    GRBG: ["Gr", "R", "B", "Gb"],
    GBRG: ["Gb", "B", "R", "Gr"],
  };
  return maps[pattern][(y & 1) * 2 + (x & 1)];
}

function color(channel: string) {
  return channel[0] as "R" | "G" | "B";
}

export function renderRawPreview(
  values: Uint16Array,
  config: RawConfig,
  mode: RawViewMode,
  levels: RawLevels,
  autoStretch: boolean,
  blackLevel: number,
  gain: number,
) {
  const output = new ImageData(config.width, config.height);
  const maximum = 2 ** config.bitDepth - 1;
  const low = (autoStretch ? levels.low : 0) + blackLevel;
  const high = autoStretch ? levels.high : maximum;
  const scale = (255 * gain) / Math.max(1, high - low);
  const display = (value: number) => Math.max(0, Math.min(255, Math.round((value - low) * scale)));
  const sample = (x: number, y: number) => {
    const safeX = Math.max(0, Math.min(config.width - 1, x));
    const safeY = Math.max(0, Math.min(config.height - 1, y));
    return values[safeY * config.width + safeX];
  };
  const average = (points: Array<[number, number]>) => {
    let total = 0;
    for (const [x, y] of points) total += sample(x, y);
    return total / points.length;
  };

  for (let y = 0; y < config.height; y += 1) {
    for (let x = 0; x < config.width; x += 1) {
      const index = y * config.width + x;
      const target = index * 4;
      if (mode === "gray") {
        const gray = display(values[index]);
        output.data[target] = gray;
        output.data[target + 1] = gray;
        output.data[target + 2] = gray;
      } else {
        const here = color(bayerChannel(config.bayer, x, y));
        let red: number;
        let green: number;
        let blue: number;
        if (here === "R") {
          red = values[index];
          green = average([[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]);
          blue = average([[x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1]]);
        } else if (here === "B") {
          blue = values[index];
          green = average([[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]);
          red = average([[x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1]]);
        } else {
          green = values[index];
          const horizontal = color(bayerChannel(config.bayer, x ^ 1, y));
          if (horizontal === "R") {
            red = average([[x - 1, y], [x + 1, y]]);
            blue = average([[x, y - 1], [x, y + 1]]);
          } else {
            blue = average([[x - 1, y], [x + 1, y]]);
            red = average([[x, y - 1], [x, y + 1]]);
          }
        }
        output.data[target] = display(red);
        output.data[target + 1] = display(green);
        output.data[target + 2] = display(blue);
      }
      output.data[target + 3] = 255;
    }
  }
  return output;
}
