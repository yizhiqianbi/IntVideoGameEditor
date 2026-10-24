import { mergeConfig } from "vite";
import base from "../../vite.config";

export default mergeConfig(base, { server: { hmr: false, host: "127.0.0.1", port: 21426, strictPort: true } });
