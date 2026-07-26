import type { Metadata } from "next";
import MediaLab from "./MediaLab";

export const metadata: Metadata = {
  title: "VideoProbe——视频码流与图像诊断工具",
  description:
    "在浏览器本地解析 YUV、SYUV、HEIC 文件，分析并逐帧查看 H.264/H.265 裸码流。",
};

export default function Home() {
  return <MediaLab />;
}
