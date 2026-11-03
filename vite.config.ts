import { defineConfig } from "vite";

// The browser talks to the EyeSim server (npm run server) through /api; the key never reaches the browser.
export default defineConfig({
  server: {
    fs: { allow: ["."] },
    proxy: { "/api": { target: `http://localhost:${process.env.PORT ?? 8787}`, changeOrigin: true } }
  }
});
