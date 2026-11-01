import { defineConfig } from "vite";
import { createGuestApi } from "./guest-api.mjs";

export default defineConfig({
  plugins: [
    {
      name: "post-card-guest-api",
      configureServer(server) {
        server.middlewares.use(createGuestApi());
      },
      configurePreviewServer(server) {
        server.middlewares.use(createGuestApi());
      },
    },
  ],
});
