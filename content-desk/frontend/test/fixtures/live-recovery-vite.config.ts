import { mergeConfig } from "vite";
import base from "../../vite.config.ts";
export default mergeConfig(base, {
  server: { host: "127.0.0.1", port: 21984, strictPort: true, hmr: false,
    proxy: { "/api/live": "http://127.0.0.1:21983", "/fixture/": "http://127.0.0.1:21983" } },
});
