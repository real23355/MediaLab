# MediaLab Portable V0.0.6

Windows 64 位免安装的“视频码流与图像分析工具”。

## 使用方法

直接双击 `release/MediaLab-Windows/MediaLab.exe`。程序使用当前用户权限运行，不安装服务、不修改注册表、不需要管理员权限。

## 功能

- YUV / RAW / SYUV 自动识别、手动校正、预览与逐帧播放
- 自动解析样例 SYUV 文件头、2560×1440 分辨率、151 B 数据偏移与 NV21 格式
- HEIC / HEIF 本地解码、缩放与全屏预览
- PNG / JPEG / BMP / WebP 普通图片本地预览与 Compare
- YUV / RAW / HEIC 支持一次选择最多 10 个文件，并以左侧标签页切换
- Bayer RAW10 Packed/Unpacked16、四种 Bayer、灰度/RGB、Auto Stretch、Black/Gain 与像素检查
- YUV / RAW / HEIC 支持鼠标位置缩放、拖拽平移、Fit、100% 和全屏
- H.264 / H.265 可追加多个文件并任意指定 Left/Right，内置 FFmpeg / FFprobe 负责独立分析和播放代理
- 图片 Compare 支持同步 Zoom/Pan/Fit/100%，不同分辨率按归一化图像坐标联动
- 视频 Compare 支持 Play Both、Pause Both、同步 Seek/Step 与 100 ms 轻量纠偏
- 每个视频独立使用 D3D11VA 优先解码，单侧失败只回退该侧软件解码
- 点击或定位帧时暂停播放，并显示醒目的当前帧标记
- 返回首页旁提供“重启应用”按钮
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

程序随包提供 FFmpeg / FFprobe；HEIC 容器在本地提取后由内置 FFmpeg 解码。详见 `THIRD_PARTY_NOTICES.txt` 与程序资源中的 `ffmpeg/LICENSE.txt`。
