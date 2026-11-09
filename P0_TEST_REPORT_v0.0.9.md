# V0.0.9 P0 验证记录

日期：2026-11-09。基于 V0.0.8 增量开发，Windows x64 / NVIDIA GPU。本轮不新增 P1/P2 分析功能。

## 五项 P0

1. **原始解码帧**：EXE 独立从原码流解码 PNG 预览和原生像素格式的 raw Plane，Inspector 直接读取原生 Buffer，包括 4:2:0 的共享色度采样与 10-bit little-endian。快速播放仍用原代理。Web 优先保留当前 VideoFrame 的 clone，独立定位时使用最近关键帧和对应参数集，结束后释放解码器/VideoFrame。PNG 是无损编码的 8-bit RGB 预览，不宣称保留所有原始位深信息。
2. **Compare 对齐**：时间与帧号模式、右侧帧偏移、双向定位、Play Both 与同步纠偏。帧号模式公式：rightFrame = leftFrame + offset；时间模式的 offset 按右侧帧率换算秒。
3. **YUV 色彩参数**：BT.601 / BT.709 / BT.2020，Full / Limited；默认 BT.601 Limited 保持旧预览一致。单图与左右 Compare 分别可设置。Y/U/V 分量和 Inspector 均读取原采样，不随色彩转换改变。
4. **局部帧图**：保留全局区间峰值概览，增加局部 Canvas 图、放大缩小、起始帧、范围滑块、滚轮平移/Ctrl+滚轮缩放与点击逐帧定位。仅绘制选定区间，不创建整段视频的像素或帧 DOM。
5. **尽早显示统计**：EXE 在 FFprobe 完成即挂入工作区并显示帧统计，随后生成代理；Web 每个文件解析完成即显示该文件，不等待整批完成。尚未引入分段播放代理。

## 进度与响应

- 视频保留读取位置/实际生成帧数进度。
- EXE RAW/YUV 分块读取显示实际字节百分比，解包/颜色渲染由 Worker 上报处理行数/像素百分比；Web FileReader 与 Worker 同样按工作量上报。
- 参数更改和 Compare 重绘也走 Worker。YUV 渲染只向 Worker 提交当前帧，不重新读取整份 YUV 文件。
- 解析进度按阶段标注，阶段切换重新从该阶段的 0% 开始；不把阶段百分比当成精确剩余时间。HEIC 不可细分的解码阶段显示阶段比例。
- 返回首页终止图像 Worker、作废旧任务、清理媒体会话；原始帧窗口关闭可取消其独立 FFmpeg 任务。

## 实测

- `tools/p0-v009.cjs`：H.264 #20、两个 RTOS H.265 #120，以及生成的 yuv420p10le HEVC #4，原始 Plane 与单独 FFmpeg 解码逐字节相等。8-bit 1440P 每帧 5,529,600 B，10-bit 64×64 每帧 12,288 B。
- 30 fps 左文件与 24 fps 右文件、偏移 +3：左 1 秒 / #30 对应右 #33 / 1.375 秒；反向映射回 1 秒。
- 实际 3840×2160 RAW，8,294,400 个原始值；读取、解包、渲染过程中观察到多个 0–100 间百分比。
- YUV 更改矩阵/范围后 RGB 预览改变，原始 Y=16/U=90/V=240 保持不变。
- 原始帧窗口实际加载 2560×1440 图片，并截图检查布局。
- `tools/web-p0-v009.cjs`：H.264 的 #20/#23 偏移及原始帧查看通过；HEVC 正常播放后原生帧查看通过；#133/#136 偏移标签通过；4K RAW 观察到 197 次进度更新，YUV 色彩切换通过。独立 HEVC 定位的限制见下。
- `tools/web-hevc-check.cjs`：旧 V0.0.8 与新 V0.0.9 两个实际 HEVC 文件同步播放输出像素相同，均到达 #119，未产生播放错误。
- 原有 RAW/YUV 10 项单元测试、YUV 高倍 Overlay、图片 Compare 同步缩放、实际视频布局与同步定位、Play Both / 单独播放、CPU fallback 会话测试通过。
- 用户 HEIC 样例解码为 2560×1440；Web TypeScript 定向检查、4 项渲染检查和生产构建通过。
- `tools/color-v009.test.cjs`：三种矩阵与两种范围的 Web/EXE 结果一致、原始样本未改变；Full/Limited 黑白端点及 BT.2020 已知向量通过。连同原有核心测试共 12 项通过。
- `tools/packaged-smoke.cjs`：实际最终目录版和单文件便携 EXE 均显示 V0.0.9，首页、原始帧 IPC 和 Worker 接口就绪。

## 已知限制

- `rtos_ch0_before.h265` 在本机浏览器可正常播放，但某些帧独立定位会出现 WebCodecs Decoding error。已提供恢复说明；正常播放到目标帧后直接复用原生帧可查看，EXE 原始帧提取正常。不能把界面选中帧号当作浏览器已成功解码该帧。
- Web 原始 Plane 的格式与可读性取决于浏览器，当前 Inspector 处理 I420/I422/I444/NV12 8-bit Plane，其他情况标记为 RGB 预览，不反推 YUV。EXE 独立原始帧 Inspector 支持 planar YUV 8/10/12/16-bit。
- 本次未扩展裸 YUV 文件格式到 P010/RAW12 Packed 等 P1 项，也未引入 PSNR/差分分析。
- GPU 速度仍取决于驱动；原有 CPU fallback 保留。原始帧提取优先精确，长文件靠后位置可能仍需等待。
