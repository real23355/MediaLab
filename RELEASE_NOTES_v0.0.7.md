# MediaLab V0.0.7

- H.264/H.265 视频和逐帧大小图在同一屏显示，支持拖动或键盘调整分隔栏。
- Compare 左右各自显示独立帧图、当前帧编号/类型/大小以及最大/最小值；播放跟随高亮，点击暂停定位。
- 紧凑文件栏和统计摘要；码流信息、完整帧明细按需展开，保留原有数据。
- 首页中央整体支持点击选择和拖放，拖入高亮；移除指定副标题和三条功能宣传文字。
- 修正 Compare 隐藏播放器继续占空间、返回首页残留对比状态、视频追加提示过时的问题。
- Web 对非关键帧起始的视频隔离解码异常，从首个关键帧播放，缺少参考帧的帧仍可查看统计。播放同步纠偏复用当前解码器，不再因纠偏而暂停。
- 包含此前尚未提交的 Y/U/V 原始分量查看、高倍像素值 Overlay 和安全体积优化。

构建输出：`release/MediaLab-Web/`、`release/MediaLab-Windows/`、`release/MediaLab-Portable-0.0.7.exe`。
可运行 `powershell -File tools/package-release.ps1` 构建并整理两套输出；已有输出目录保留为带日期的备份。

本次没有修改原始 YUV/RAW/HEIC 或 Annex-B 解析算法、FFmpeg Decoder、GPU/CPU fallback 配置。测试记录见 `UI_TEST_REPORT_v0.0.7.md`。
