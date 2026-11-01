import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defineConfig } from "vite";
import { createGuestApi } from "./guest-api.mjs";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const guestApiPath = path.join(currentDir, "guest-api.mjs");

function createHotReloadingGuestApi() {
  let activeMiddleware = createGuestApi();
  let lastMtimeMs = 0;

  return async (req, res, next) => {
    try {
      const info = await stat(guestApiPath);
      if (lastMtimeMs !== 0 && info.mtimeMs !== lastMtimeMs) {
        const modUrl = `${pathToFileURL(guestApiPath).href}?t=${Math.floor(info.mtimeMs)}`;
        const mod = await import(modUrl);
        activeMiddleware = mod.createGuestApi();
      }
      lastMtimeMs = info.mtimeMs;
    } catch {
      // Keep existing middleware if stat/import fails transiently
    }
    return activeMiddleware(req, res, next);
  };
}

export default defineConfig({
  server: {
    watch: {
      usePolling: true,
      interval: 500,
    },
  },
  plugins: [
    {
      name: "post-card-guest-api",
      configureServer(server) {
        server.middlewares.use(createHotReloadingGuestApi());
      },
      configurePreviewServer(server) {
        server.middlewares.use(createHotReloadingGuestApi());
      },
    },
  ],
});
