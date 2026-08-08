# MediaLab V0.0.5

- 移除图片工作区的 1360/1380 px 最大宽度限制和 64vh/680/720 px Viewer 高度上限。
- RAW、YUV、HEIC Viewer 改为占满视口剩余空间的响应式三栏布局。
- 新增 ResizeObserver 驱动的 Fit 重算，最大化、恢复和拖动窗口时自动适配。
- Fit 使用 Viewer 真实绘图区尺寸；手动缩放后保持用户倍率。
- 保留缩放光标锚点、平移、全屏、像素信息及所有 RAW/YUV 参数。
- Windows H.264/H.265 使用 D3D11VA 硬件解码优先，失败时自动软件解码，并显示实际解码器。
- Web、Windows 应用和可执行文件元数据更新为 V0.0.5。
