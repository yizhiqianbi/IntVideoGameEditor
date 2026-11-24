import { fileURLToPath } from "node:url";

export default {
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  poweredByHeader: false,
  async headers() {
    return [{ source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }, { key: "X-Content-Type-Options", value: "nosniff" }] }];
  },
};
