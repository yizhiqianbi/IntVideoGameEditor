import type { Metadata } from "next";
import "./globals.css";
import "./modules.css";

export const metadata: Metadata = {
  title: "叙梦 · AI 生成",
  description: "叙梦 AI 生成工作台：角色封面生成视频、文生图、换脸、换造型与小说。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
