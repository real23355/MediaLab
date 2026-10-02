# MediaLab

Tools for viewing and analyzing videos and images.

当前仓库保存 **MediaLab V0.0.8** 的两套实现：

- `web/`：本地优先的网页版本。
- `desktop/`：Windows 免安装便携版源码，无需管理员权限。

## 网页版本

需要 Node.js 22.13 或更高版本，并推荐使用 pnpm。

```powershell
cd web
pnpm install
pnpm dev
```

也可以双击 `web/启动本地网页.cmd`。

## Windows 便携版

```powershell
cd desktop
pnpm install
pnpm start
```

生成便携 EXE：

```powershell
pnpm dist
```

安装依赖时会准备固定版本的 FFmpeg 9.0.2（下载后校验构建方 SHA-256）与 FFprobe 5.1.0。Windows 构建使用系统 curl.exe / tar.exe。生成的程序位于 `desktop/release/`，不要求管理员权限。

单文件便携版：`release/MediaLab-Portable-0.0.8.exe`；完整可运行目录：`release/MediaLab-Windows/`，入口为 `MediaLab.exe`。也提供目录版 ZIP，解压后直接运行，启动最快。

便携 EXE 首次将运行组件释放到 `%LOCALAPPDATA%\MediaLab\runtime\<版本-内容指纹>`，后续启动复用。不安装服务、不需要管理员权限；这是程序运行组件缓存，不是用户媒体解析缓存。返回首页会取消解析、清除媒体会话与播放临时文件，同一文件再次打开重新解析；不会删除运行组件导致下次启动再次解压。

## 主要功能

- YUV/SYUV 文件格式识别、YUV/RGB 彩色预览及 Y/U/V 原始分量灰度查看。
- YUV 高倍查看按实际屏幕像素尺寸自动显示原始 Y/U/V 值和像素网格，仅绘制当前可见区域，可切换 Auto/Off。
- Bayer RAW10 Packed/Unpacked16、灰度/Demosaic RGB、像素检查与预览调节。
- YUV、RAW、HEIC 支持鼠标位置缩放、Fit、100% 与拖拽平移。
- H.264/H.265 码流播放、逐帧定位与帧大小统计。
- 视频与 Frame Size 同屏显示，可拖动分隔栏调整高度；双视频各自显示帧图，播放高亮、点击暂停定位。
- 首页中央区域整体可点击/拖入文件；码流详情与帧表按需展开。
- 图片与 H.264/H.265 双栏 Compare、Left/Right 指派、同步 Zoom/Pan 和同步播放。
- 单文件打开后可继续拖入同一媒体大类文件，总文件量上限 4.2 GB。
- HEIC 与 PNG/JPEG/BMP/WebP 普通图片解析。
- 文件在本机处理，不上传媒体内容。
- 视频解析显示阶段进度、约百分比和处理帧数；Web 结构分析在 Worker 中执行。
- NVIDIA 优先 CUDA 解码 → NVENC 编码；按显卡尝试 QSV/AMF，失败逐级回退 D3D11VA / CPU。

Windows Release 仅保留简体中文和英文 Chromium 语言包，Codec、GPU 硬解和 CPU fallback 组件保持完整。V0.0.8 启动器使用标准 NSIS/zlib，优先提高首次解压速度，不使用 UPX；较 V0.0.7 下载体积有所增大。当前实测与回归见 `PERFORMANCE_TEST_REPORT_v0.0.8.md`，历史瘦身结果见 `SIZE_OPTIMIZATION_REPORT.md`。
