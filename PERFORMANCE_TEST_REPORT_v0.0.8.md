# MediaLab V0.0.8 性能与回归记录

测试日期：2026-10-02。Windows x64，本机 NVIDIA GeForce RTX 4070 Ti SUPER；Intel 核显同时存在。数值为本机实测，不保证其他硬盘、杀毒软件、驱动或网络盘环境得到相同结果。

## 启动

测量进程启动至首页 DOM 与 IPC 就绪，每 100 ms 检查一次。没有清空操作系统文件缓存，因此“首次”指该版运行组件尚未释放的首次启动，不是重启 Windows 后的绝对冷启动。

| 路径 | V0.0.7 | V0.0.8 |
| --- | ---: | ---: |
| 单 EXE 首次运行 / 释放组件 | 5.19 秒 | 3.76 秒 |
| 单 EXE 后续启动 | 4.67 秒 | 0.61 秒 |
| 完整目录直接运行 | 未单独测量 | 0.50 秒 |

原便携启动器每次都释放并清除整套运行时。新版标准 NSIS/zlib 启动器按版本及所有运行文件内容的 SHA-256 指纹缓存组件；同用户并发首次启动用 mutex 防止同时释放，不写系统安装位置，不请求管理员权限。首次显示准备进度，后续复用。关键程序/媒体工具缺失时重新释放。

返回首页清除的是媒体解析/代理缓存，不是运行组件。旧版运行组件目录不自动删除，以免干扰仍在运行的实例；关闭应用后可手动清理 `%LOCALAPPDATA%\MediaLab\runtime`。

## 视频处理

同一组本地测试文件，端到端包括 FFprobe 结构分析及 FFmpeg 播放代理生成。

| 文件 | 帧数 | V0.0.7 | V0.0.8 首测 / 复测 |
| --- | ---: | ---: | ---: |
| rtos_ch0_before.h265 | 297 | 4.24 秒 | 3.16 / 2.13 秒 |
| rtos_ch0.h265 | 224 | 2.32 秒 | 1.54 / 1.52 秒 |
| left.h264 测试片 | 50 | 0.28 秒 | 0.20 / 0.20 秒 |

旧 FFmpeg 的 NVENC 在本机新驱动上失败，原来是 D3D11VA 解码 + CPU 编码。新版固定 FFmpeg 9.0.2，带构建方 SHA-256 校验；实测两种码流均使用 CUDA 解码 + NVENC 编码，视频画面仍正确。FFprobe 保持原版本及统计字段，只跳过对帧元数据无影响的 IDCT/loop filter 工作；四个样例的完整流信息、帧类型/大小/偏移/时间戳与旧参数输出逐字段完全一致。

支持 NVIDIA CUDA/NVENC 优先、D3D11VA+显卡编码器、D3D11VA+libx264、CPU+libx264 逐级回退。通过强制所有硬件尝试失败，验证 CPU 回退成功生成可播放文件。Intel QSV / AMD AMF 分支已实现，但没有在独立 Intel/AMD 机器上做硬件实测，不承诺所有硬件或驱动支持。

## 进度与会话

- EXE：按 FFprobe 输入字节位置估算前 45%，按 FFmpeg 实际处理帧数估算后 54%，工具成功后才到 100%。不伪造预计完成时间；失败回退时保留已达到的近似进度并标注阶段。
- Web：文件读取进度及 Annex-B / 帧结构扫描进度由 Worker 传回；ArrayBuffer 使用 transferable，避免来回复制整个文件。主界面不卡在同步结构分析中。
- 返回首页：终止进程/Worker、清空 Compare/当前文件/图像/帧数据、移除播放代理；取消旧任务不能再次填回新会话。
- 验证了正在 FFprobe、正在生成播放代理时取消，以及同一文件再次加入重新生成新代理、Compare 文案恢复、进度消失、解析按钮可用。

## 回归

- `tools/probe-equivalence.cjs`：4 个 H.264/H.265 样例的元数据完全一致。
- `tools/session-progress-v008.cjs`：阶段进度、单任务进度单调、Compare 重置、临时文件删除、重复解析、取消、CPU fallback 通过。
- `tools/web-session-progress-v008.cjs`：实际 Web Release Worker 进度、释放、同文件重解析和取消通过。
- `tools/video-layout-v007.cjs`：实际两个 RTOS H.265 文件、单/双视频同屏帧图、Play Both、单独播放、点击暂停定位、分隔栏通过。
- `tools/web-video-layout-v007.cjs`：静态发布包实际双 H.265 解码/播放/定位、1920/1366/1100 宽度布局通过。
- `tools/yuv-components.test.cjs` / `tools/raw-core.test.cjs`：10 项单元测试通过。
- `tools/yuv-viewer-smoke.cjs` / `compare-smoke.cjs` / `video-compare-smoke.cjs`：Y/U/V、像素值 overlay、同步 Zoom/Pan、Compare 通过。
- `tools/heic-regression.cjs`：用户 HEIC 正常解码为 2560×1440。
- Web 定向 TypeScript 检查、4 项渲染检查、生产构建通过。
- `tools/packaged-smoke.cjs`：实际 Windows Release 显示 V0.0.8，首页和 IPC 就绪。

## 体积与限制

完整 Windows 目录：503,119,827 字节（约 479.81 MiB），相比 V0.0.7 的 462,110,560 字节增加约 39.11 MiB，主要为现代 GPU 编码支持所需的 FFmpeg。单 EXE 约 190.45 MiB：标准 zlib 优先解压速度，下载体积比旧 LZMA 包大。不使用高误报可执行文件压缩工具，不删除 Codec/CPU fallback。

保留原有限制：Web HEVC 播放取决于浏览器 WebCodecs；非关键帧开头的原始流，在浏览器中只能从首个有效关键帧开始解码，但此前帧统计仍保留。原生进程崩溃或强制结束时，系统临时文件可能无法立即删除。未发现本轮回归新增功能问题。
