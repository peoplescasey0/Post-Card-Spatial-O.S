#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGuestApi } from "./guest-api.mjs";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(appDir, "dist");
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "127.0.0.1";
const guestApi = createGuestApi();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

const server = createServer((req, res) => {
  guestApi(req, res, async () => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);
      const cleanPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const targetPath = path.resolve(distDir, `.${cleanPath}`);
      if (!targetPath.startsWith(distDir)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      const info = await stat(targetPath);
      if (!info.isFile()) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }
      const ext = path.extname(targetPath).toLowerCase();
      const body = await readFile(targetPath);
      res.writeHead(200, {
        "content-type": MIME_TYPES[ext] ?? "application/octet-stream",
        "cache-control": "no-cache",
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("Not Found");
    }
  });
});

server.listen(port, host, () => {
  console.log(`Post Card Spatial OS Studio running at http://${host}:${port}`);
});
