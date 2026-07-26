import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "VideoProbe——视频码流与图像诊断工具",
    template: "%s · VideoProbe",
  },
  description: "本地优先的 YUV、SYUV、HEIC 与 H.26x 媒体诊断工具。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "VideoProbe——视频码流与图像诊断工具",
    description: "YUV / SYUV / HEIC 图像解析、H.264/H.265 逐帧分析与播放。",
  },
  twitter: {
    card: "summary",
    title: "VideoProbe",
    description: "视频码流与图像诊断工具",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        <script src="/vendor/heic2any.js" defer />
      </head>
      <body>{children}</body>
    </html>
  );
}
