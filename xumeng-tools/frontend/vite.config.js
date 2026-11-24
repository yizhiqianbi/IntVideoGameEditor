import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backend = "http://127.0.0.1:3490";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 3491,
    strictPort: true,
    proxy: { "/api": { target: backend } },
  },
  preview: {
    host: "127.0.0.1",
    port: 3491,
    strictPort: true,
    proxy: { "/api": { target: backend } },
  },
});
