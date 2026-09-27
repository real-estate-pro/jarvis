import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4100",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    // three + postprocessing make one large chunk; it is a single-page app loaded once.
    chunkSizeWarningLimit: 1500,
  },
});
