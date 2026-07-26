# VideoProbe Web V0.0.2

本地优先的“视频码流与图像诊断工具”。文件只在浏览器内存中处理，不上传到服务器。

## 功能

- YUV / RAW / SYUV 自动识别、手动校正、预览与逐帧播放
- 自动读取本项目样例 SYUV 的文件头、分辨率、151 B 数据偏移并优先识别 NV21
- HEIC / HEIF 本地解码与预览
- YUV / HEIC 支持一次选择最多 10 个文件，逐文件选择解析类型
- 解析后的 YUV / HEIC 文件以左侧标签页切换
- H.264 / H.265 Annex-B 裸码流一次解析 1 个文件
- 播放或点击帧时显示醒目的当前帧标记
- 帧大小图含纵轴数值、最大帧、最小帧和平均帧统计

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
pnpm install
pnpm run dev
```

生产构建：

```bash
pnpm run build
pnpm run start
```

H.264 / H.265 的画面播放依赖当前浏览器是否提供相应 WebCodecs 解码器；即使浏览器不能解码，码流结构与逐帧统计仍可使用。

## 第三方组件

HEIC 解码使用 heic2any 0.0.4（MIT），浏览器端本地运行。详见 `THIRD_PARTY_NOTICES.txt`。
