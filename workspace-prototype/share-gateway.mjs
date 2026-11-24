#!/usr/bin/env node
// The public front door, path-scoped.
//
// cloudflared points at THIS process, never at start-studio.mjs directly. The
// studio's gate decides "is this request local?" by looking at the socket's
// remote address, and a tunnel connects from 127.0.0.1 -- so a tunnel straight
// to the studio would publish every /api/guest route: boot VMs, delete cards,
// read status. Here only the share surface is forwarded; everything else 404s.

import { createServer, request as httpRequest } from "node:http";
import { pathToFileURL } from "node:url";

const ALLOWED = [/^\/s\/[A-Za-z0-9_-]{1,128}$/, /^\/s\/[A-Za-z0-9_-]{1,128}\/file$/];
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function isAllowed(pathname) {
  return ALLOWED.some((re) => re.test(pathname));
}

export function createShareGateway({ upstream = "http://127.0.0.1:5173" } = {}) {
  const target = new URL(upstream);

  return createServer((incoming, response) => {
    let url;
    try {
      url = new URL(incoming.url ?? "/", "http://gateway.invalid");
    } catch {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Bad request\n");
      return;
    }

    const method = incoming.method ?? "GET";
    if ((method !== "GET" && method !== "HEAD") || !isAllowed(url.pathname)) {
      response.writeHead(404, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end("Not found\n");
      return;
    }

    const headers = {};
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (!HOP_BY_HOP.has(key)) headers[key] = value;
    }
    // Keep the public hostname so the app builds the link it is actually served on.
    headers["x-forwarded-proto"] = "https";
    if (incoming.headers.host) headers["x-forwarded-host"] = incoming.headers.host;
    // The visitor's address is not the app's business, and the Vault is not here.
    delete headers["x-forwarded-for"];
    delete headers["forwarded"];
    delete headers["cookie"];

    const proxied = httpRequest(
      {
        host: target.hostname,
        port: target.port || 80,
        method,
        path: url.pathname + url.search,
        headers,
      },
      (upstreamResponse) => {
        const out = {};
        for (const [key, value] of Object.entries(upstreamResponse.headers)) {
          if (!HOP_BY_HOP.has(key)) out[key] = value;
        }
        response.writeHead(upstreamResponse.statusCode ?? 502, out);
        if (method === "HEAD") {
          upstreamResponse.resume();
          response.end();
          return;
        }
        upstreamResponse.pipe(response);
      },
    );

    proxied.on("error", () => {
      if (!response.headersSent) {
        response.writeHead(502, {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        });
      }
      response.end("Share link service is not running.\n");
    });

    incoming.pipe(proxied);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8791);
  const host = process.env.HOST ?? "127.0.0.1";
  const upstream = process.env.SHARE_UPSTREAM ?? "http://127.0.0.1:5173";
  createShareGateway({ upstream }).listen(port, host, () => {
    console.log(`share gateway http://${host}:${port} -> ${upstream} (only /s/ forwarded)`);
  });
}
