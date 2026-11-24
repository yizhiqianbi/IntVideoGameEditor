import type { Metadata } from "next";
import "./globals.css";
import "./modules.css";

export const metadata: Metadata = {
  title: "叙梦",
  description: "虚构的成年角色。换脸、去外套、图生视频、文生图、小说。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
