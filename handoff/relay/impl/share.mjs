// Share links — the front door for people who don't have the app.
//
// A link is a capability URL: 32 random bytes, stored hashed, expired server-side.
// It is deliberately NOT one-time. A one-time link punishes anyone whose download
// failed once, and makes a re-send necessary for no security gain — the TTL is what
// bounds exposure. One-time belongs to guest-fetch transfer tokens, not to a link
// a human clicks in a browser.
//
// Routes:
//   POST /api/planes          upload, returns { url, id, expiresAt }
//   GET  /p/:token            the page (preview + two buttons)
//   GET  /p/:token/file       the bytes, Range + ETag capable
//   GET  /health

import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import fs from "node:fs";

const MIME_BY_EXT = {
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".mp4": "video/mp4",
  ".iso": "application/octet-stream",
  ".qcow2": "application/octet-stream",
};

const guessType = (name = "") =>
  MIME_BY_EXT[path.extname(name).toLowerCase()] ?? "application/octet-stream";

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const bytes = (n) => {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
};

const timeLeft = (ms) => {
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
};

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** One SQLite row per link, hashed. Additive over 001's token table. */
function ensureLinkSchema(db) {
  db.exec(`
    create table if not exists share_links (
      plane_id     text primary key references planes (id) on delete cascade,
      token_sha256 text not null unique,
      created_at   integer not null,
      expires_at   integer not null,
      downloads    integer not null default 0,
      max_downloads integer not null default 0,   -- 0 = bounded by TTL only
      revoked_at   integer
    );
    create index if not exists share_links_token on share_links (token_sha256);
  `);
}

const PAGE = ({ title, meta, preview, fileUrl, planeId, bad }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    background: radial-gradient(1200px 600px at 50% -10%, #1b2230 0%, #0b0d12 60%);
    color: #e8ecf4; font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .card {
    width: 100%; max-width: 660px; background: #12161f; border: 1px solid #232a38;
    border-radius: 14px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,.55);
  }
  header { padding: 22px 24px 18px; border-bottom: 1px solid #1d2432; }
  .eyebrow { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #7c8aa5; }
  h1 { margin: 8px 0 0; font-size: 22px; font-weight: 600; word-break: break-word; }
  .meta { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { font: 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: #a9b6cc;
          background: #1a2130; border: 1px solid #283248; border-radius: 999px; padding: 6px 10px; }
  .chip.warn { color: #ffd08a; border-color: #4a3a1c; background: #221a0d; }
  section { padding: 18px 24px; }
  pre.preview {
    margin: 0; padding: 14px 16px; max-height: 260px; overflow: auto; border-radius: 10px;
    background: #0c1017; border: 1px solid #1d2432; color: #b9c6dc;
    font: 12.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap;
  }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; padding: 0 24px 24px; }
  a.btn, button.btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    padding: 12px 18px; border-radius: 10px; text-decoration: none; font-weight: 600;
    border: 1px solid transparent; cursor: pointer; font-size: 14px;
  }
  .primary { background: #e8ecf4; color: #0b0d12; }
  .primary:hover { background: #fff; }
  .secondary { background: #1a2130; color: #dbe4f4; border-color: #2d3a52; }
  .secondary:hover { border-color: #46587c; }
  footer { padding: 14px 24px; border-top: 1px solid #1d2432; color: #6d7b95; font-size: 12px; }
  .bad { color: #ff9a9a; }
  code { font: 12px ui-monospace, monospace; color: #93a4c0; }
</style></head>
<body><main class="card">
  <header>
    <div class="eyebrow">post card &middot; paper plane</div>
    <h1>${esc(title)}</h1>
    <div class="meta">${meta}</div>
  </header>
  ${preview ? `<section>${preview}</section>` : ""}
  <div class="actions">
    <a class="btn primary" href="${esc(fileUrl)}" download>Download</a>
    <a class="btn secondary" href="postcard://plane/${esc(planeId)}">Open in Post Card</a>
  </div>
  <footer>
    ${bad ? '<span class="bad">This link cannot be opened.</span>' : `Expires automatically. No account needed on either side.`}
  </footer>
</main></body></html>`;

export function createShareServer({ mailbox, blobs, clock = Date.now, baseUrl, maxUploadBytes = 100 * 1024 * 1024 }) {
  ensureLinkSchema(mailbox.db);
  const db = mailbox.db;

  function issue({ planeId, ttlSec = 72 * 3600, maxDownloads = 0 }) {
    if (ttlSec < 60 || ttlSec > 72 * 3600) throw new Error("ttlSec must be 60..259200");
    const token = randomBytes(32).toString("base64url");
    const t = clock();
    db.prepare(
      `insert into share_links (plane_id, token_sha256, created_at, expires_at, max_downloads)
       values (?, ?, ?, ?, ?)`,
    ).run(planeId, sha256(Buffer.from(token)), t, t + ttlSec * 1000, maxDownloads);
    return { token, url: `${baseUrl}/p/${token}`, expiresAt: t + ttlSec * 1000 };
  }

  /** Resolve a token to a plane, or a reason it failed. Server-side only. */
  function resolve(token) {
    if (!token || token.length > 128) return { error: "bad_token" };
    const link = db
      .prepare(`select * from share_links where token_sha256 = ?`)
      .get(sha256(Buffer.from(token)));
    if (!link) return { error: "unknown" };
    if (link.revoked_at) return { error: "revoked" };
    if (link.expires_at < clock()) return { error: "expired" };
    if (link.max_downloads > 0 && link.downloads >= link.max_downloads) return { error: "used_up" };
    const plane = mailbox.row(link.plane_id);
    if (!plane) return { error: "gone" };
    return { link, plane };
  }

  function page(plane, link, token) {
    const left = link.expires_at - clock();
    const digest = plane.sha256.slice(0, 16);
    const meta = [
      `<span class="chip">${bytes(plane.bytes)}</span>`,
      `<span class="chip">from ${esc(plane.from_card)}</span>`,
      `<span class="chip${left < 3_600_000 ? " warn" : ""}">${esc(timeLeft(left))}</span>`,
      `<span class="chip">sha ${esc(digest)}</span>`,
    ].join("");

    let preview = "";
    const isText =
      (plane.content_type ?? "").startsWith("text/") ||
      /\.(txt|md|json|csv|log|sh|js|mjs|ts|css|html)$/i.test(plane.name ?? "");
    if (isText && blobs.has(plane.object_path)) {
      const raw = blobs.get(plane.object_path).subarray(0, 800).toString("utf8");
      preview = `<pre class="preview">${esc(raw)}${plane.bytes > 800 ? "\n\n..." : ""}</pre>`;
    } else if ((plane.content_type ?? "").startsWith("image/") && blobs.has(plane.object_path)) {
      preview = `<img src="/p/${encodeURIComponent(token)}/file" alt="" style="max-width:100%;border-radius:10px">`;
    }

    return PAGE({
      title: plane.name || `${plane.id.slice(0, 8)}.plane`,
      meta,
      preview,
      fileUrl: `/p/${encodeURIComponent(token)}/file`,
      planeId: plane.id,
    });
  }

  function send(res, status, body, headers = {}) {
    res.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...headers });
    res.end(body);
  }

  function serveFile(req, res, plane, link) {
    const abs = path.join(blobs.dir, plane.object_path);
    if (!fs.existsSync(abs)) return send(res, 410, "bytes are gone");

    const total = fs.statSync(abs).size;
    const etag = `"${plane.sha256}"`;
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { etag });
      return res.end();
    }

    const filename = plane.name || `${plane.id.slice(0, 8)}.plane`;
    const baseHeaders = {
      "content-type": plane.content_type || "application/octet-stream",
      "content-disposition": `attachment; filename="${filename.replace(/["\\\r\n]/g, "_")}"`,
      "accept-ranges": "bytes",
      etag,
      "cache-control": "private, no-store",
    };

    const range = req.headers.range;
    if (!range) {
      db.prepare(`update share_links set downloads = downloads + 1 where plane_id = ?`).run(plane.id);
      res.writeHead(200, { ...baseHeaders, "content-length": total });
      return fs.createReadStream(abs).pipe(res);
    }

    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m) {
      return send(res, 416, "unsupported range", { "content-range": `bytes */${total}` });
    }
    let start = m[1] === "" ? null : Number(m[1]);
    let end = m[2] === "" ? null : Number(m[2]);
    if (start === null && end === null) {
      return send(res, 416, "bad range", { "content-range": `bytes */${total}` });
    }
    if (start === null) { start = Math.max(0, total - end); end = total - 1; }  // suffix
    else if (end === null) { end = total - 1; }

    if (start > end || start >= total) {
      return send(res, 416, "range not satisfiable", { "content-range": `bytes */${total}` });
    }
    end = Math.min(end, total - 1);

    db.prepare(`update share_links set downloads = downloads + 1 where plane_id = ?`).run(plane.id);
    res.writeHead(206, {
      ...baseHeaders,
      "content-length": end - start + 1,
      "content-range": `bytes ${start}-${end}/${total}`,
    });
    return fs.createReadStream(abs, { start, end }).pipe(res);
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/health") return send(res, 200, "ok");

    if (req.method === "POST" && url.pathname === "/api/planes") {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > maxUploadBytes) { send(res, 413, "too large"); req.destroy(); return; }
        chunks.push(c);
      });
      req.on("end", () => {
        try {
          const payload = Buffer.concat(chunks);
          const name = decodeURIComponent(req.headers["x-plane-name"] ?? "") || undefined;
          const ttlSec = Number(req.headers["x-plane-ttl"] ?? 72 * 3600);
          const from = decodeURIComponent(req.headers["x-plane-from"] ?? "unknown");
          const to = decodeURIComponent(req.headers["x-plane-to"] ?? "link");

          const plane = mailbox.send({
            from, to, payload, name,
            contentType: guessType(name),
            ttlSec,
          });
          const link = issue({ planeId: plane.id, ttlSec });
          res.writeHead(201, { "content-type": "application/json" });
          res.end(JSON.stringify({ id: plane.id, url: link.url, expiresAt: link.expiresAt, bytes: plane.bytes, sha256: plane.sha256 }));
        } catch (err) {
          send(res, 400, `bad request: ${err.message}`);
        }
      });
      return;
    }

    const fileMatch = /^\/p\/([A-Za-z0-9_-]+)\/file$/.exec(url.pathname);
    const pageMatch = /^\/p\/([A-Za-z0-9_-]+)$/.exec(url.pathname);

    if (fileMatch) {
      const r = resolve(fileMatch[1]);
      if (r.error) {
        const gone = ["expired", "gone", "used_up"].includes(r.error);
        return send(res, gone ? 410 : 404, r.error);
      }
      return serveFile(req, res, r.plane, r.link);
    }

    if (pageMatch) {
      const r = resolve(pageMatch[1]);
      if (r.error) {
        const code = r.error === "expired" || r.error === "gone" || r.error === "used_up" ? 410 : 404;
        return send(res, code, PAGE({
          title: r.error === "expired" ? "This link expired" : "This link cannot be opened",
          meta: `<span class="chip">${esc(r.error)}</span>`,
          preview: "",
          fileUrl: "#",
          planeId: "",
          bad: true,
        }), { "content-type": "text/html; charset=utf-8" });
      }
      const html = page(r.plane, r.link, pageMatch[1]);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(html);
    }

    send(res, 404, "not found");
  });

  return { server, issue, resolve, ensureLinkSchema };
}
