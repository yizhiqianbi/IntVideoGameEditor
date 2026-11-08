import type { Metadata } from "next";
import TavernApp from "@/components/dzmm/tavern-app";

export const metadata: Metadata = {
  title: "叙梦 · 角色与故事",
  description: "与角色相遇，让故事继续。",
  applicationName: "叙梦",
  metadataBase: new URL("https://xumengchat.top/"),
  robots: { index: true, follow: true },
  alternates: { canonical: "https://xumengchat.top/" },
  openGraph: {
    title: "叙梦 · 角色与故事",
    description: "与角色相遇，让故事继续。",
    type: "website",
    url: "https://xumengchat.top/",
    locale: "zh_CN",
    siteName: "叙梦",
    images: [{
      url: "https://xumengchat.top/assets/xumeng/brand/xumeng-icon-512.png",
      width: 512,
      height: 512,
      alt: "叙梦 XUMENG 标志",
    }],
  },
  twitter: {
    card: "summary",
    title: "叙梦 · 角色与故事",
    description: "与角色相遇，让故事继续。",
    images: [{
      url: "https://xumengchat.top/assets/xumeng/brand/xumeng-icon-512.png",
      alt: "叙梦 XUMENG 标志",
    }],
  },
  manifest: "/assets/xumeng/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/assets/xumeng/brand/xumeng-favicon.ico", type: "image/x-icon", sizes: "16x16 32x32 48x48" },
      { url: "/assets/xumeng/brand/xumeng-icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/assets/xumeng/brand/xumeng-mark.svg", type: "image/svg+xml", sizes: "any" },
    ],
    apple: "/assets/xumeng/brand/xumeng-icon-192.png",
  },
};

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "叙梦",
  alternateName: "XUMENG",
  url: "https://xumengchat.top/",
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
