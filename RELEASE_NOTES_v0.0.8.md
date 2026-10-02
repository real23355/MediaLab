# MediaLab V0.0.8

- 加快 Windows 启动：单 EXE 首次准备运行组件，后续按版本/内容指纹复用，不再每次解压。仍免安装、无需管理员权限。
- 新增视频解析进度：阶段、近似百分比、处理帧数；网页版后台 Worker 分析，界面保持响应。
- 修复返回首页后残留“退出 Compare”。返回首页取消正在进行的解析、清理媒体会话与播放临时文件；相同文件重新加入会重新解析。
- 固定升级 FFmpeg 9.0.2，启用 NVIDIA CUDA + NVENC，按显卡尝试 QSV/AMF；保留 D3D11VA 及 CPU 回退。原始帧统计数据不变。
- 保留视频/帧图同屏、双视频 Compare、Play Both、Y/U/V 分量、高倍像素值、RAW、HEIC、缩放/平移等功能。

## 下载选择

- **MediaLab-Windows-V0.0.8.zip**：推荐追求最快启动。解压整个目录后运行 `MediaLab-Windows/MediaLab.exe`，不要只拷贝主 EXE。
- **MediaLab-Portable-0.0.8.exe**：单文件便携版。首次将组件释放到 `%LOCALAPPDATA%\MediaLab\runtime\<版本-内容指纹>`，后续直接复用。首次准备有进度显示，无管理员权限要求。
- **MediaLab-Web-V0.0.8.zip**：本地网页版。解压后双击 `启动本地网页版.cmd`，媒体不上传服务器。

本机实测便携版首次约 3.76 秒、后续约 0.61 秒，目录版约 0.50 秒；两个 RTOS H.265 样例处理约 2.13–3.16 秒 / 1.52–1.54 秒。时间取决于机器、驱动、系统缓存与杀毒软件。

说明：为兼容新 GPU 驱动并加快首次解压，本版 Windows 下载包比上一版更大。返回首页清理媒体缓存，但保留运行组件，避免损失下次启动速度。Web HEVC 仍受浏览器支持限制；Intel/AMD 编码路径尚未在独立机器实测。详细测试见仓库 `PERFORMANCE_TEST_REPORT_v0.0.8.md`。
