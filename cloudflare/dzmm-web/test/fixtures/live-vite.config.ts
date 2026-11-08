import { mergeConfig } from "vite";
import base from "../../vite.config.ts";
export default mergeConfig(base, { server: { hmr: false, proxy: { "/api/live": "http://127.0.0.1:8910", "/fixture/": "http://127.0.0.1:8910", "/assets/xumeng/live/": "http://127.0.0.1:8910" } } });
