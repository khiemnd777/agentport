import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const webHost = process.env.RCD_WEB_HOST || "127.0.0.1";
const webPort = Number(process.env.RCD_WEB_PORT || 5177);
const serverHost = process.env.RCD_SERVER_HOST || "127.0.0.1";
const serverPort = Number(process.env.RCD_SERVER_PORT || 8787);
const allowedHosts = (process.env.RCD_WEB_ALLOWED_HOSTS || "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);
const apiTarget = `http://${serverHost}:${serverPort}`;
const wsTarget = `ws://${serverHost}:${serverPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: webHost,
    port: webPort,
    allowedHosts,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true
      },
      "/ws": {
        target: wsTarget,
        ws: true
      }
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
