# MediaLab V0.0.6 Windows Release 体积优化

本次保持版本号 V0.0.6，不移除 Codec、FFmpeg/FFprobe、Electron GPU 组件或 CPU fallback。

| 输出 | 优化前 | 优化后 | 减少 | 比例 |
| --- | ---: | ---: | ---: | ---: |
| 单文件 `MediaLab-Portable-0.0.6.exe` | 123,834,210 B（118.10 MiB） | 116,318,528 B（110.93 MiB） | 7,515,682 B（7.17 MiB） | 6.07% |
| 完整 `MediaLab-Windows` 目录 | 509,857,506 B（486.24 MiB） | 462,095,972 B（440.69 MiB） | 47,761,534 B（45.55 MiB） | 9.37% |

## 主要优化项

- Electron/Chromium 语言包由全语言集合改为仅打包 `zh-CN` 与 `en-US`，语言包由 46.65 MiB 降至 1.09 MiB。
- electron-builder 压缩级别设为 `maximum`，使用原生稳定打包压缩，不使用 UPX 或壳压缩。
- 应用文件继续使用 ASAR，且白名单仅包含 `src/**/*` 与运行时 `package.json`；开发依赖、测试脚本、源码构建目录和 source map 不进入应用 ASAR。
- 保留 Chromium/Electron 主运行时、许可文件、FFmpeg/FFprobe、D3D11VA/GPU DLL、SwiftShader/Vulkan fallback 与软件解码路径。

当前完整目录主要由 Electron 主程序（215.16 MiB）和 FFmpeg/FFprobe 资源（约 138.96 MiB）构成。它们是现有架构与媒体能力的必要组成，因此未做高风险裁剪。
