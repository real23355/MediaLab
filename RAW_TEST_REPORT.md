# MediaLab RAW Test Report

测试日期：2026-08-08
测试目录：`\\192.168.0.112\GPT\data\media_lab\awb&ccm_SC835HAI_RAW_3840x2160_RGGB_10bit`

## 格式判定

- 分辨率：3840 × 2160
- Bayer：RGGB（测试目录标注；查看器默认 RGGB 并允许手动切换）
- Bit Depth：10 bit
- Packing：RAW10 Unpacked16 Little Endian，10-bit 数据位于低位（LSB/right-aligned）
- 单文件大小：16,588,800 bytes
- 文件头：无
- 行 stride：7,680 bytes，等于 `3840 × 2`，未发现行 padding
- MIPI RAW10 Packed 理论大小：10,368,000 bytes（样本并非此格式）

所有样本的文件大小都严格等于 `3840 × 2160 × 2`。对每个文件前 1,048,576 个像素抽样后，小端 16-bit 数值 100% 位于 `0…1023`，大端解释会产生最高 65,280 的异常值，因此判定为小端、低位对齐的 Unpacked RAW10。

## 文件检测结果

| Filename | File Size | Width | Height | Expected RAW10 Packed | Expected RAW10 Unpacked | Detected Packing |
|---|---:|---:|---:|---:|---:|---|
| A_2400k.raw | 16,588,800 | 3840 | 2160 | 10,368,000 | 16,588,800 | RAW10 Unpacked16 LE |
| A_2748k.raw | 16,588,800 | 3840 | 2160 | 10,368,000 | 16,588,800 | RAW10 Unpacked16 LE |
| CWF_4011k.raw | 16,588,800 | 3840 | 2160 | 10,368,000 | 16,588,800 | RAW10 Unpacked16 LE |
| D50_4853k.raw | 16,588,800 | 3840 | 2160 | 10,368,000 | 16,588,800 | RAW10 Unpacked16 LE |
| D65_6086k.raw | 16,588,800 | 3840 | 2160 | 10,368,000 | 16,588,800 | RAW10 Unpacked16 LE |
| D75_7190k.raw | 16,588,800 | 3840 | 2160 | 10,368,000 | 16,588,800 | RAW10 Unpacked16 LE |
| led_10000k.raw | 16,588,800 | 3840 | 2160 | 10,368,000 | 16,588,800 | RAW10 Unpacked16 LE |
| led_2400k.raw | 16,588,800 | 3840 | 2160 | 10,368,000 | 16,588,800 | RAW10 Unpacked16 LE |
| led_2800k.raw | 16,588,800 | 3840 | 2160 | 10,368,000 | 16,588,800 | RAW10 Unpacked16 LE |
| led_4000k.raw | 16,588,800 | 3840 | 2160 | 10,368,000 | 16,588,800 | RAW10 Unpacked16 LE |
| led_5000k.raw | 16,588,800 | 3840 | 2160 | 10,368,000 | 16,588,800 | RAW10 Unpacked16 LE |
| led_6500k.raw | 16,588,800 | 3840 | 2160 | 10,368,000 | 16,588,800 | RAW10 Unpacked16 LE |
| led_7500k.raw | 16,588,800 | 3840 | 2160 | 10,368,000 | 16,588,800 | RAW10 Unpacked16 LE |
| TL84_3862k.raw | 16,588,800 | 3840 | 2160 | 10,368,000 | 16,588,800 | RAW10 Unpacked16 LE |

## 正确性验证

- D65_6086k.raw 已完整解码为 3840×2160 RGGB，并生成 Demosaic RGB 预览。
- 0.1%–99.9% Auto Stretch 范围为 73–542，实际最小/最大值为 69–591。
- 预览未发现错行、固定 4-pixel/5-byte 周期竖条纹、bit shift、高低位反转或大面积解析异常。
- RGB 预览能辨认 ColorChecker 色块；未应用 AWB/CCM，因此照明色偏属于传感器原始数据的正常表现。
- 内部单元测试覆盖 MIPI RAW10 的 4-pixel/5-byte 位精确解包、Unpacked16 LE、四种 Bayer 映射和错误文件大小处理。

## 工具

- `tools/analyze-raw.cjs`：批量输出文件大小、理论帧大小、字节序与 packing 判定。
- `tools/test-raw-preview.cjs`：使用与桌面端相同的 RAW 核心生成完整分辨率 PNG 预览。
- `tools/raw-core.test.cjs`：RAW10/Bayer 单元测试。
