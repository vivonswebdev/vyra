import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/studio/",
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8787", "/account": "http://127.0.0.1:8787", "/dev": "http://127.0.0.1:8787" } },
  build: { outDir: "../../dist/web/studio", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  worker: { format: "es" },
});
