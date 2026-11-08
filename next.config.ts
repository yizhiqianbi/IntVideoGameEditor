import type { NextConfig } from "next";

const COOP_COEP_HEADERS = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
];

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/assets/xumeng/:path*",
        destination: "/dzmm/:path*",
      },
      {
        source: "/api/chat",
        destination: "/api/dzmm/chat",
      },
      {
        source: "/api/memory",
        destination: "/api/dzmm/memory",
      },
      {
        source: "/api/backend/:path*",
        destination: "/api/dzmm/backend/:path*",
      },
    ];
  },
  async headers() {
    return [
      {
        // Apply COOP/COEP only to the drama studio page where ffmpeg.wasm is used.
        // Applying site-wide can break third-party iframes (e.g. OAuth popups).
        source: "/drama",
        headers: COOP_COEP_HEADERS,
      },
      {
        source: "/video-studio",
        headers: COOP_COEP_HEADERS,
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
