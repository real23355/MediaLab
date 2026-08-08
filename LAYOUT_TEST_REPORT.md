# MediaLab V0.0.5 Viewer 布局测试报告

## 修复结论

- 根因是工作区 `max-width` 与 Viewer `height: min(64vh, 680px/720px)` 同时限制了大屏尺寸。
- Web 与 Windows 图片工作区均已改为全视口三栏布局：文件列表、参数面板固定/有限宽度，Viewer 使用全部剩余空间。
- RAW / YUV / HEIC 默认进入 Fit；Fit 读取 `.zoom-stage` 的真实 `clientWidth/clientHeight` 并扣除实际 padding。
- `ResizeObserver` 只更新缩放与滚动位置，不重新执行 RAW unpack、demosaic 或 YUV 转换。
- 手动 100%/固定倍率/滚轮缩放后，窗口变化不会强制恢复 Fit。

## Windows 实测数据

使用不可见 Electron 窗口加载正式桌面页面和 3840×2160 RAW Viewer，测量结果如下：

| 窗口 | Viewer Width | Viewer Height | Viewer 可用区域 | RAW Fit Scale | 显示图像 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1280×720 | 672 px | 475 px | 640×443 px | 16.667% | 640×360 px |
| 1920×1080 | 1312 px | 835 px | 1280×803 px | 33.333% | 1280×720 px |
| 2560×1440 | 1952 px | 1195 px | 1920×1163 px | 50.000% | 1920×1080 px |
| 3840×2160 | 3232 px | 1915 px | 3200×1883 px | 83.333% | 3200×1800 px |

Windows 手动切换 100% 后由 4K 改为 1920×1080：`fitMode=false`，图像仍为 3840×2160，验证未被 ResizeObserver 改回 Fit。

## Web 实测数据

内置浏览器加载最终静态页面并选择真实 `D65_6086k.raw`：

| 浏览器视口 | Viewer Width | Viewer Height | RAW Fit Scale |
| --- | ---: | ---: | ---: |
| 1280×720 | 643 px | 458 px | 15.911% |
| 1920×1080 | 1283 px | 818 px | 32.578% |
| 2560×1440 | 1923 px | 1178 px | 49.245% |
| 3840×2160 | 3203 px | 1898 px | 82.578% |

Web 手动切换 100% 后改变视口：`fitMode=false`，图像保持 3840×2160；重新点击 Fit 后恢复自动响应。

## 媒体回归

- RAW：真实 `D65_6086k.raw`，识别为 3840×2160、RGGB、RAW10、Unpacked16 LE。
- YUV：`timelapse_20080101_000300_7_28_0.syuv`，识别为 2560×1440 NV21，默认 Fit。
- HEIC：`timelapse_20251207_192721_5_7_1.heic`，解码为 2560×1440，默认 Fit。
- H.265：真实 1920×1080 样本通过 D3D11VA 解码并成功生成播放代理。
- RAW 核心测试 4/4，通过；Web 渲染测试 2/2，通过。

已知问题：None。
