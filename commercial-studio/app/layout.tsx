import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pencil Studio — 从故事到分镜",
  description: "面向影视团队的 AI 分镜与短剧制作工作台。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
