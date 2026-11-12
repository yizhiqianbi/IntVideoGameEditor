import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { removeOuterwearApi } from "./server/vite-plugin-remove-outerwear.js";
import { novelApi } from "./server/vite-plugin-novel.js";
import { studioApi } from "./server/vite-plugin-studio.js";

export default defineConfig({
  plugins: [react(), removeOuterwearApi(), novelApi(), studioApi()],
  server: { host: "127.0.0.1", port: 3488, strictPort: true },
  preview: { host: "127.0.0.1", port: 3488, strictPort: true },
});
