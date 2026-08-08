(function () {
  const BAYER_PATTERNS = ["RGGB", "BGGR", "GRBG", "GBRG"];
  const RAW_PACKINGS = [
    { value: "UNPACKED16_LE", label: "RAW Unpacked16 LE" },
    { value: "UNPACKED16_BE", label: "RAW Unpacked16 BE" },
    { value: "MIPI_RAW10", label: "MIPI RAW10 Packed" }
  ];
  const COMMON_SIZES = [
    [3840, 2160], [2560, 1440], [2048, 1536], [2048, 1080],
    [1920, 1080], [1600, 1200], [1280, 720]
  ];

  function frameBytes(width, height, bitDepth, packing) {
    if (packing === "MIPI_RAW10") return bitDepth === 10 ? Math.ceil(width / 4) * 5 * height : 0;
    return width * height * 2;
  }

  function nameHints(name) {
    const dimension = name.match(/(?:^|[_.\-\s])(\d{2,5})[xX×](\d{2,5})(?=$|[_.\-\s])/);
    const bitDepth = name.match(/(?:^|[_.\-\s])(8|10|12|14|16)(?:bit|b)(?=$|[_.\-\s])/i);
    const upper = name.toUpperCase();
    return {
      width: dimension ? Number(dimension[1]) : undefined,
      height: dimension ? Number(dimension[2]) : undefined,
      bitDepth: bitDepth ? Number(bitDepth[1]) : undefined,
      bayer: BAYER_PATTERNS.find((pattern) => upper.includes(pattern))
    };
  }

  function sampleEndian(sample, bitDepth) {
    const maximum = 2 ** bitDepth - 1;
    const words = Math.floor(sample.byteLength / 2);
    let le = 0;
    let be = 0;
    for (let offset = 0; offset + 1 < sample.byteLength; offset += 2) {
      if ((sample[offset] | (sample[offset + 1] << 8)) <= maximum) le += 1;
      if (((sample[offset] << 8) | sample[offset + 1]) <= maximum) be += 1;
    }
    return { le: le / Math.max(1, words), be: be / Math.max(1, words) };
  }

  function detect(sample, totalSize, filename) {
    if (!totalSize) throw new Error("RAW 文件为空");
    const hints = nameHints(filename);
    const bitDepth = hints.bitDepth || 10;
    const dimensions = hints.width && hints.height
      ? [[hints.width, hints.height], ...COMMON_SIZES]
      : COMMON_SIZES;
    for (const [width, height] of dimensions) {
      const packed = frameBytes(width, height, 10, "MIPI_RAW10");
      if (totalSize === packed) {
        return {
          width, height, bitDepth: 10, bayer: hints.bayer || "RGGB",
          packing: "MIPI_RAW10", frameBytes: packed,
          reason: `${hints.width ? "文件名" : "文件大小"}识别 · MIPI RAW10 Packed`
        };
      }
      const unpacked = frameBytes(width, height, bitDepth, "UNPACKED16_LE");
      if (totalSize === unpacked) {
        const endian = sampleEndian(sample, bitDepth);
        const packing = endian.be > endian.le ? "UNPACKED16_BE" : "UNPACKED16_LE";
        return {
          width, height, bitDepth, bayer: hints.bayer || "RGGB", packing,
          frameBytes: unpacked,
          reason: `${hints.width ? "文件名" : "文件大小"}识别 · 16-bit 容器 · ${packing.endsWith("LE") ? "小端" : "大端"}`
        };
      }
    }
    const width = hints.width || 3840;
    const height = hints.height || 2160;
    const packing = "UNPACKED16_LE";
    return {
      width, height, bitDepth, bayer: hints.bayer || "RGGB", packing,
      frameBytes: frameBytes(width, height, bitDepth, packing),
      reason: "无法由文件大小确认，请手动校正参数"
    };
  }

  function decode(data, config) {
    const expected = frameBytes(config.width, config.height, config.bitDepth, config.packing);
    if (!expected || data.byteLength !== expected) {
      throw new Error(
        `RAW 文件大小不匹配：当前 ${data.byteLength.toLocaleString("zh-CN")} B，`
        + `${config.width}×${config.height} ${config.packing} 需要 ${expected.toLocaleString("zh-CN")} B`
      );
    }
    const pixels = config.width * config.height;
    const output = new Uint16Array(pixels);
    const mask = 2 ** config.bitDepth - 1;
    if (config.packing === "MIPI_RAW10") {
      // MIPI RAW10: B0..B3 are P0..P3 bits [9:2], B4 contains four 2-bit tails.
      const rowBytes = Math.ceil(config.width / 4) * 5;
      for (let y = 0; y < config.height; y += 1) {
        let source = y * rowBytes;
        const rowEnd = (y + 1) * config.width;
        for (let target = y * config.width; target < rowEnd; target += 4, source += 5) {
          const low = data[source + 4] || 0;
          for (let index = 0; index < 4 && target + index < rowEnd; index += 1) {
            output[target + index] = (((data[source + index] || 0) << 2) | ((low >> (index * 2)) & 3)) & mask;
          }
        }
      }
    } else {
      const little = config.packing === "UNPACKED16_LE";
      for (let index = 0, offset = 0; index < pixels; index += 1, offset += 2) {
        const word = little
          ? data[offset] | (data[offset + 1] << 8)
          : (data[offset] << 8) | data[offset + 1];
        output[index] = word & mask;
      }
    }
    return output;
  }

  function levels(values, bitDepth) {
    const histogram = new Uint32Array(2 ** bitDepth);
    let min = histogram.length - 1;
    let max = 0;
    for (const value of values) {
      const sample = Math.min(histogram.length - 1, value);
      histogram[sample] += 1;
      min = Math.min(min, sample);
      max = Math.max(max, sample);
    }
    function percentile(fraction) {
      const target = values.length * fraction;
      let count = 0;
      for (let value = 0; value < histogram.length; value += 1) {
        count += histogram[value];
        if (count >= target) return value;
      }
      return max;
    }
    const low = percentile(0.001);
    return { low, high: Math.max(low + 1, percentile(0.999)), min, max };
  }

  function bayerChannel(pattern, x, y) {
    const maps = {
      RGGB: ["R", "Gr", "Gb", "B"], BGGR: ["B", "Gb", "Gr", "R"],
      GRBG: ["Gr", "R", "B", "Gb"], GBRG: ["Gb", "B", "R", "Gr"]
    };
    return maps[pattern][(y & 1) * 2 + (x & 1)];
  }

  function render(values, config, mode, valueLevels, autoStretch, blackLevel, gain) {
    const output = new ImageData(config.width, config.height);
    const maximum = 2 ** config.bitDepth - 1;
    const low = (autoStretch ? valueLevels.low : 0) + blackLevel;
    const high = autoStretch ? valueLevels.high : maximum;
    const scale = (255 * gain) / Math.max(1, high - low);
    const display = (value) => Math.max(0, Math.min(255, Math.round((value - low) * scale)));
    const sample = (x, y) => values[
      Math.max(0, Math.min(config.height - 1, y)) * config.width
      + Math.max(0, Math.min(config.width - 1, x))
    ];
    const average = (points) => points.reduce((sum, point) => sum + sample(point[0], point[1]), 0) / points.length;
    const color = (channel) => channel[0];
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
          let red;
          let green;
          let blue;
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
            if (color(bayerChannel(config.bayer, x ^ 1, y)) === "R") {
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

  window.RawTools = {
    BAYER_PATTERNS, RAW_PACKINGS, frameBytes, detect, decode, levels, bayerChannel, render
  };
})();
