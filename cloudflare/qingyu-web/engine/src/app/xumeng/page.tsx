import type { Metadata } from "next";
import TavernApp from "@/components/dzmm/tavern-app";

export const metadata: Metadata = {
  title: "晴屿 · 角色与故事",
  description: "与角色相遇，让故事继续。",
  applicationName: "晴屿",
  metadataBase: new URL("https://qingyu.invalid/"),
  robots: { index: true, follow: true },
  alternates: { canonical: "https://qingyu.invalid/" },
  openGraph: {
    title: "晴屿 · 角色与故事",
    description: "与角色相遇，让故事继续。",
    type: "website",
    url: "https://qingyu.invalid/",
    locale: "zh_CN",
    siteName: "晴屿",
    images: [{
      url: "https://qingyu.invalid/assets/qingyu/brand/qingyu-icon-512.png",
      width: 512,
      height: 512,
      alt: "晴屿 XUMENG 标志",
    }],
  },
  twitter: {
    card: "summary",
    title: "晴屿 · 角色与故事",
    description: "与角色相遇，让故事继续。",
    images: [{
      url: "https://qingyu.invalid/assets/qingyu/brand/qingyu-icon-512.png",
      alt: "晴屿 XUMENG 标志",
    }],
  },
  manifest: "/assets/qingyu/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/assets/qingyu/brand/qingyu-favicon.ico", type: "image/x-icon", sizes: "16x16 32x32 48x48" },
      { url: "/assets/qingyu/brand/qingyu-icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/assets/qingyu/brand/qingyu-mark.svg", type: "image/svg+xml", sizes: "any" },
    ],
    apple: "/assets/qingyu/brand/qingyu-icon-192.png",
  },
};

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "晴屿",
  alternateName: "XUMENG",
  url: "https://qingyu.invalid/",
  inLanguage: "zh-CN",
};

export default function XumengPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd).replace(/</g, "\\u003c") }}
      />
      <TavernApp />
    </>
  );
}
