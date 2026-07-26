import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "MediaLab——视频码流与图像分析工具",
    template: "%s · MediaLab",
  },
  description: "本地优先的 YUV、SYUV、HEIC 与 H.26x 媒体分析工具。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "MediaLab——视频码流与图像分析工具",
    description: "YUV / SYUV / HEIC 图像解析、H.264/H.265 逐帧分析与播放。",
  },
  twitter: {
    card: "summary",
    title: "MediaLab",
    description: "视频码流与图像分析工具",
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
