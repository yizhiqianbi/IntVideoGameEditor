import { mergeConfig } from "vite";
import base from "../../vite.config.ts";

// Recovery acceptance must observe an actual user reload or retry, never a
// development hot reload caused by an independent agent editing the source.
export default mergeConfig(base, { server: { hmr: false } });
