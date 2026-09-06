# MediaLab Web V0.0.7

本地优先的“视频码流与图像分析工具”。文件只在浏览器内存中处理，不上传到服务器。

## 功能

- YUV / RAW / SYUV 自动识别、手动校正、预览与逐帧播放
- YUV 支持 YUV/RGB、Y、U、V 显示；4:2:0 色度分量按原生半宽半高查看，保留原始采样值
- YUV 高倍查看在每个 Y 像素格中叠加原始 Buffer 的 Y/U/V 值；按实际屏幕像素尺寸自动触发，只绘制可见范围，支持 Auto/Off 与 Compare
- 自动读取本项目样例 SYUV 的文件头、分辨率、151 B 数据偏移并优先识别 NV21
- HEIC / HEIF 本地解码与预览
- PNG / JPEG / BMP / WebP 普通图片本地预览与 Compare
- YUV / RAW / HEIC 支持一次选择最多 10 个文件，逐文件选择解析类型
- 解析后的 YUV / RAW / HEIC 文件以左侧标签页切换
- Bayer RAW10 Packed/Unpacked16、四种 Bayer、灰度/RGB、Auto Stretch、Black/Gain 与像素检查
- YUV / RAW / HEIC 支持鼠标位置缩放、拖拽平移、Fit、100% 和全屏
- H.264 / H.265 Annex-B 裸码流可追加多个文件并任意指定 Left/Right
- 图片 Compare 支持同步 Zoom/Pan/Fit/100%，不同分辨率按归一化图像坐标联动
- 视频 Compare 支持 Play Both、Pause Both、同步 Seek/Step 与轻量时间纠偏
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
