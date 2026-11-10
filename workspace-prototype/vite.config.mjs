import { defineConfig, loadEnv } from "vite";
import { createGuestApi } from "./guest-api.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceDirectory, ["POSTCARD_", "STRIPE_"]);
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  return {
    server: {
      watch: {
        ignored: ["**/*.ppm", "**/*.img", "**/*.qcow2", "**/*.log", "**/archive/**"],
      },
    },
    plugins: [
      {
        name: "post-card-guest-api",
        configureServer(server) {
          const guestApi = createGuestApi();
          server.middlewares.use(guestApi);
          server.httpServer?.on("upgrade", (req, socket) => {
            guestApi.handleUpgrade?.(req, socket);
          });
        },
        configurePreviewServer(server) {
          const guestApi = createGuestApi();
          server.middlewares.use(guestApi);
          server.httpServer?.on("upgrade", (req, socket) => {
            guestApi.handleUpgrade?.(req, socket);
          });
        },
      },
    ],
  };
});
