# MediaLab

Tools for viewing and analyzing videos and images.

当前仓库保存 **VideoProbe V0.0.2** 的两套实现：

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

安装依赖时会从已锁定的 FFmpeg/FFprobe 安装器包中自动准备本地二进制文件。生成的程序位于 `desktop/release/`，运行权限为 `asInvoker`，不要求管理员权限。

已构建的 `VideoProbe-Portable-0.0.2.exe` 请从仓库的 **Releases** 页面下载。

## 主要功能

- YUV/SYUV 文件格式识别与图像预览。
- H.264/H.265 码流播放、逐帧定位与帧大小统计。
- HEIC 图片解析。
- 文件在本机处理，不上传媒体内容。

