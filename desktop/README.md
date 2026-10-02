# MediaLab Portable V0.0.8

Windows 64 位免安装的“视频码流与图像分析工具”。

## 使用方法

直接双击 `release/MediaLab-Windows/MediaLab.exe`。程序使用当前用户权限运行，不安装服务、不修改注册表、不需要管理员权限。

## 功能

- YUV / RAW / SYUV 自动识别、手动校正、预览与逐帧播放
- YUV 支持 YUV/RGB、Y、U、V 显示；4:2:0 色度分量按原生半宽半高查看，保留原始采样值
- YUV 高倍查看在每个 Y 像素格中叠加原始 Buffer 的 Y/U/V 值；按实际屏幕像素尺寸自动触发，只绘制可见范围，支持 Auto/Off 与 Compare
- 自动解析样例 SYUV 文件头、2560×1440 分辨率、151 B 数据偏移与 NV21 格式
- HEIC / HEIF 本地解码、缩放与全屏预览
- PNG / JPEG / BMP / WebP 普通图片本地预览与 Compare
- YUV / RAW / HEIC 支持一次选择最多 10 个文件，并以左侧标签页切换
- Bayer RAW10 Packed/Unpacked16、四种 Bayer、灰度/RGB、Auto Stretch、Black/Gain 与像素检查
- YUV / RAW / HEIC 支持鼠标位置缩放、拖拽平移、Fit、100% 和全屏
- H.264 / H.265 可追加多个文件并任意指定 Left/Right，内置 FFmpeg / FFprobe 负责独立分析和播放代理
- 图片 Compare 支持同步 Zoom/Pan/Fit/100%，不同分辨率按归一化图像坐标联动
- 视频 Compare 支持 Play Both、Pause Both、同步 Seek/Step 与 100 ms 轻量纠偏
- NVIDIA 优先 CUDA → NVENC，按显卡尝试 QSV/AMF，失败逐级回退 D3D11VA → libx264、CPU → libx264；单侧失败不会阻塞另一侧
- 解析显示阶段、近似进度和已处理帧数，返回首页可取消正在执行的解析
- 点击或定位帧时暂停播放，并显示醒目的当前帧标记
- 返回首页旁提供“重启应用”按钮
- 帧大小图含纵轴数值、最大帧、最小帧、平均帧及文件偏移
- 原始文件只读，不上传、不修改

播放代理保存在系统临时目录，返回首页或程序正常退出时删除。返回首页会清空 Compare/图像/帧数据状态；再次打开同一文件会重新解析。

单 EXE 首次在 `%LOCALAPPDATA%\MediaLab\runtime\<版本-内容指纹>` 释放运行组件，后续直接复用。返回首页只清媒体会话，不清运行组件；退出所有 MediaLab 实例后可以手动删除该目录，下次自动重新准备。目录版无需这一启动解压步骤。

## 开发与构建

```powershell
pnpm install
pnpm run start
pnpm run dist
```

便携程序输出到 `release/`。

Release 使用简体中文/英文语言包白名单，单文件启动器使用标准 NSIS/zlib 快速解压，不使用 UPX。Electron、FFmpeg/FFprobe、GPU 和软件解码依赖不裁剪。

FFmpeg 固定为 9.0.2，下载及 SHA-256 记录在 `ffmpeg/build.json`；FFprobe 保持 5.1.0，保证帧统计字段兼容。构建需联网下载一次依赖，发布程序不需要联网。

## 第三方组件

程序随包提供 FFmpeg / FFprobe；HEIC 容器在本地提取后由内置 FFmpeg 解码。详见 `THIRD_PARTY_NOTICES.txt` 与程序资源中的 `ffmpeg/LICENSE.txt`。
