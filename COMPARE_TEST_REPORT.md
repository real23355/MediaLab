# MediaLab V0.0.6 Compare 回归测试

测试日期：2026-08-09

## 图片 Compare

- 双 Viewer、Left/Right 文件指派及普通 RGB 图片路径：通过。
- 1920×1080 隐藏窗口中 Compare 有效高度 922 px：通过。
- Sync View 开启时缩放 2×/2×：通过。
- Sync View 关闭后缩放 3×/2×：通过。
- 4000×2000 与 2000×1000 图像归一化中心同步：目标 (0.62, 0.41)，结果 (0.62008, 0.40992)：通过。
- Zoom/Pan 仅更新 Viewer transform，不重新执行 RAW/YUV 解码：通过代码路径检查。

## 视频 Compare

- H.264 vs H.265 双播放器：通过。
- Play Both / Pause Both：通过。
- 同步 Seek 至 0.800 s：左右均为 0.800 s。
- 同步 Frame Step：左右均从 0.800 s 前进至 0.840 s。
- 两侧 D3D11VA 实际代理转换：均成功，输出均为 320×240、50 帧。
- 单侧软件回退隔离：Left 保持 GPU 硬解，Right 显示软件解码。

## 既有功能

- RAW 核心单元测试：4/4 通过。
- Web 服务端渲染与产品元数据测试：通过。
- Electron 1280×720、1920×1080、2560×1440、3840×2160 Viewer 布局：通过。
- 桌面端 JavaScript 语法检查：通过。
