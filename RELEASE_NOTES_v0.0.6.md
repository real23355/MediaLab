# MediaLab V0.0.6

- 新增 YUV、RAW、HEIC、PNG/JPEG/BMP/WebP 图片与 H.264/H.265 左右双栏 Compare 模式，可从文件列表任意指定 Left/Right。
- 单文件工作区支持继续拖放或选择追加文件；图片与视频按媒体大类隔离，总文件量继续限制为 4.2 GB。
- 图片 Compare 默认开启 Sync View，同步 Zoom、鼠标锚点缩放、Pan、Fit 与 100%。
- 不同分辨率图片按归一化图像中心坐标同步位置，Zoom/Pan 不重复执行 YUV/RAW 解码或 Demosaic。
- 视频 Compare 提供独立播放、Seek、Frame Step、Play Both、Pause Both 与 Sync Playback。
- 同步播放按时间轴工作，偏差超过 100 ms 时轻量纠偏；同帧率视频支持同步逐帧步进。
- Windows 两侧播放代理独立采用 D3D11VA 硬件解码优先，单侧失败只回退该侧软件解码。
- Web、Windows 应用及可执行文件元数据升级为 V0.0.6。
