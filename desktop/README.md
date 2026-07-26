# VideoProbe Portable V0.0.2

Windows 64 位免安装的“视频码流与图像诊断工具”。

## 使用方法

直接双击 `VideoProbe-Portable-0.0.2.exe`。程序使用当前用户权限运行，不安装服务、不修改注册表、不需要管理员权限。

## 功能

- YUV / RAW / SYUV 自动识别、手动校正、预览与逐帧播放
- 自动解析样例 SYUV 文件头、2560×1440 分辨率、151 B 数据偏移与 NV21 格式
- HEIC / HEIF 本地解码与预览
- YUV / HEIC 支持一次选择最多 10 个文件，并以左侧标签页切换
- H.264 / H.265 一次解析 1 个文件，内置 FFmpeg / FFprobe 负责分析和播放代理
- 点击帧或播放时显示醒目的当前帧标记
- 帧大小图含纵轴数值、最大帧、最小帧、平均帧及文件偏移
- 原始文件只读，不上传、不修改

播放代理保存在系统临时目录，并在程序正常退出时删除。

## 开发与构建

```powershell
pnpm install
pnpm run start
pnpm run dist
```

便携程序输出到 `release/`。

## 第三方组件

程序随包提供 FFmpeg / FFprobe；HEIC 解码使用 heic2any 0.0.4（MIT）。详见 `THIRD_PARTY_NOTICES.txt` 与程序资源中的 `ffmpeg/LICENSE.txt`。
