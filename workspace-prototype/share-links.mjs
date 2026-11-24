// Share links — the front door for people who do not have the app.
//
// A link is a capability URL: 32 random bytes, stored only as a sha256 digest,
// expired server-side. It is deliberately not one-time. A one-time link punishes
// anyone whose download failed once and buys no security the TTL does not already
// provide. One-time belongs to guest-fetch transfer tokens, not to a link a human
// clicks in a browser.
//
// A link points at a file already in a card's spool directory
// (data/paper-planes/<cardId>/<fileName>). It never copies the bytes: the file
// exists once, on disk, and the link is a permission slip to read it.
//
// Routes (mounted by guest-api.mjs):
//   POST /api/guest/paper-plane/share   issue a link -> { url, token, expiresAt }
//   GET  /s/:token                      the page: preview, size, sender, buttons
//   GET  /s/:token/file                 the bytes, Range + ETag capable

import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  esc,
  renderSharePage,
  shareMetaChips,
  sharePreview,
} from "./share-page.mjs";

const HOUR_MS = 3_600_000;
const MAX_TTL_SEC = 72 * 3600; // 72h ceiling, same as a plane hold
const MIN_TTL_SEC = 60;
const MAX_RECORDS = 256;

const MIME_BY_EXT = {
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json",
  ".csv": "text/csv; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".sh": "text/x-shellscript; charset=utf-8",
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

const sha256Hex = (buf) => createHash("sha256").update(buf).digest("hex");

async function hashFile(absPath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(absPath)) hash.update(chunk);
  return hash.digest("hex");
}

export { guessType, hashFile, sha256Hex };

/**
 * Resolve a spool-relative name to a real path, refusing to escape the spool.
 *
 * Exported because the remote publisher has to apply the identical rules before
 * it uploads anything. A second copy of this check would drift from this one,
 * and the drift would be a file-disclosure bug rather than a cosmetic one.
 */
export async function resolveSpoolFile(paperPlanesDropDir, cardId, fileName) {
  if (typeof cardId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(cardId)) {
    return { error: "cardId must be a lowercase card identifier.", status: 400 };
  }
  if (typeof fileName !== "string" || fileName.trim().length === 0) {
    return { error: "fileName is required.", status: 400 };
  }
  const safeName = path.basename(fileName.trim());
  if (!safeName || safeName.startsWith(".") || safeName !== fileName.trim()) {
    return { error: "fileName must be a plain file name.", status: 400 };
  }
  const cardDir = path.join(paperPlanesDropDir, cardId);
  const candidate = path.join(cardDir, safeName);
  let realDir;
  let realFile;
  try {
    realDir = await realpath(cardDir);
    realFile = await realpath(candidate);
  } catch {
    return { error: "That file is not in this card's spool.", status: 404 };
  }
  if (realFile !== path.join(realDir, safeName)) {
    const normalize = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
    if (normalize(realFile) !== normalize(path.join(realDir, safeName))) {
      return { error: "That file is not in this card's spool.", status: 404 };
    }
  }
  const details = await stat(realFile);
  if (!details.isFile()) return { error: "That path is not a file.", status: 400 };
  return { path: realFile, name: safeName, bytes: details.size };
}

/**
 * @param {object} deps
 * @param {string} deps.dataDirectory       where share-links.json lives
 * @param {string} deps.paperPlanesDropDir  where card spool dirs live
 * @param {() => number} [deps.clock]
 * @param {number} [deps.maxTtlSec]
 */
export function createShareLinks({
  dataDirectory,
  paperPlanesDropDir,
  clock = Date.now,
  maxTtlSec = Math.min(
    MAX_TTL_SEC,
    Number(process.env.POSTCARD_SHARE_MAX_TTL) > 0
      ? Number(process.env.POSTCARD_SHARE_MAX_TTL)
      : MAX_TTL_SEC,
  ),
}) {
  const storePath = path.join(dataDirectory, "share-links.json");
  let queue = Promise.resolve();

  function withStore(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => undefined);
    return result;
  }

  async function readStore() {
    try {
      const parsed = JSON.parse(await readFile(storePath, "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async function writeStore(records) {
    await mkdir(dataDirectory, { recursive: true });
    const now = clock();
    const kept = records
      .filter((record) => record.expiresAt > now || record.downloads > 0)
      .slice(-MAX_RECORDS);
    await writeFile(storePath, JSON.stringify(kept, null, 2), "utf8");
  }

  const spoolFile = (cardId, fileName) => resolveSpoolFile(paperPlanesDropDir, cardId, fileName);

  /** Issue a link for a file already sitting in a card's spool directory. */
  async function issue({ cardId, fileName, fromCardId = "unknown", origin = "", ttlSec, maxDownloads = 0 }) {
    const ttl = Number(ttlSec ?? maxTtlSec);
    if (!Number.isInteger(ttl) || ttl < MIN_TTL_SEC || ttl > maxTtlSec) {
      throw Object.assign(new Error(`ttlSec must be an integer between ${MIN_TTL_SEC} and ${maxTtlSec}.`), {
        status: 400,
      });
    }
    const limit = Number(maxDownloads ?? 0);
    if (!Number.isInteger(limit) || limit < 0 || limit > 10_000) {
      throw Object.assign(new Error("maxDownloads must be an integer between 0 and 10000."), { status: 400 });
    }

    const target = await spoolFile(cardId, fileName);
    if (target.error) throw Object.assign(new Error(target.error), { status: target.status });

    const token = randomBytes(32).toString("base64url");
    const digest = await hashFile(target.path);
    const now = clock();
    const base = String(origin || "").replace(/\/+$/, "");
    if (!/^https?:\/\/[^/\s]+$/i.test(base)) {
      throw Object.assign(new Error("origin must be an http(s) URL, e.g. http://192.168.1.20:8787."), { status: 400 });
    }

    const record = {
      tokenSha256: sha256Hex(Buffer.from(token)),
      cardId,
      fileName: target.name,
      fromCardId: typeof fromCardId === "string" && fromCardId ? fromCardId.slice(0, 64) : "unknown",
      bytes: target.bytes,
      sha256: digest,
      contentType: guessType(target.name),
      createdAt: now,
      expiresAt: now + ttl * 1000,
      downloads: 0,
      maxDownloads: limit,
      revokedAt: null,
    };

    await withStore(async () => {
      const records = await readStore();
      records.push(record);
      await writeStore(records);
    });

    return {
      token,
      url: `${base}/s/${token}`,
      expiresAt: record.expiresAt,
      bytes: record.bytes,
      sha256: record.sha256,
      fileName: record.fileName,
    };
  }

  /** Look a token up server-side. Never returns the token itself. */
  async function resolve(token) {
    if (typeof token !== "string" || !token || token.length > 128) return { error: "bad_token" };
    const wanted = sha256Hex(Buffer.from(token));
    const records = await readStore();
    const record = records.find((entry) => entry.tokenSha256 === wanted);
    if (!record) return { error: "unknown" };
    if (record.revokedAt) return { error: "revoked" };
    if (record.expiresAt <= clock()) return { error: "expired" };
    if (record.maxDownloads > 0 && record.downloads >= record.maxDownloads) return { error: "used_up" };

    const target = await spoolFile(record.cardId, record.fileName);
    if (target.error) return { error: "gone" };
    return { record, target };
  }

  async function revoke(token) {
    const wanted = sha256Hex(Buffer.from(String(token ?? "")));
    return withStore(async () => {
      const records = await readStore();
      const record = records.find((entry) => entry.tokenSha256 === wanted);
      if (!record) return { revoked: false };
      record.revokedAt = clock();
      await writeStore(records);
      return { revoked: true };
    });
  }

  async function countDownload(token) {
    const wanted = sha256Hex(Buffer.from(String(token ?? "")));
    return withStore(async () => {
      const records = await readStore();
      const record = records.find((entry) => entry.tokenSha256 === wanted);
      if (!record) return;
      record.downloads += 1;
      await writeStore(records);
    });
  }

  function renderPage(record, token, host) {
    return renderSharePage({
      title: record.fileName,
      meta: shareMetaChips(record, clock()),
      preview: sharePreview(record, token),
      fileUrl: `/s/${encodeURIComponent(token)}/file`,
      token,
      host,
    });
  }

  function sendText(response, status, body, headers = {}) {
    response.writeHead(status, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    });
    response.end(body);
  }

  async function serveFile(request, response, token, record, target, { count = true } = {}) {
    const etag = `"${record.sha256}"`;
    if (request.headers["if-none-match"] === etag) {
      response.writeHead(304, { etag, "cache-control": "private, no-store" });
      response.end();
      return true;
    }

    const total = target.bytes;
    const headers = {
      "content-type": record.contentType || "application/octet-stream",
      "content-disposition": `attachment; filename="${String(record.fileName).replace(/["\\\r\n]/g, "_")}"`,
      "accept-ranges": "bytes",
      etag,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    };

    const range = request.headers.range;
    if (!range) {
      if (count) await countDownload(token);
      response.writeHead(200, { ...headers, "content-length": total });
      createReadStream(target.path).pipe(response);
      return true;
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (!match) {
      sendText(response, 416, "unsupported range", { "content-range": `bytes */${total}` });
      return true;
    }
    let start = match[1] === "" ? null : Number(match[1]);
    let end = match[2] === "" ? null : Number(match[2]);
    if (start === null && end === null) {
      sendText(response, 416, "bad range", { "content-range": `bytes */${total}` });
      return true;
    }
    if (start === null) {
      start = Math.max(0, total - end);
      end = total - 1;
    } else if (end === null) {
      end = total - 1;
    }
    if (start > end || start >= total) {
      sendText(response, 416, "range not satisfiable", { "content-range": `bytes */${total}` });
      return true;
    }
    end = Math.min(end, total - 1);

    if (count) await countDownload(token);
    response.writeHead(206, {
      ...headers,
      "content-length": end - start + 1,
      "content-range": `bytes ${start}-${end}/${total}`,
    });
    createReadStream(target.path, { start, end }).pipe(response);
    return true;
  }

  /**
   * Serve /s/... if the request is one. Returns true when handled, so the caller
   * can fall through to its own routes otherwise.
   */
  async function handle(request, response, url) {
    const fileMatch = /^\/s\/([A-Za-z0-9_-]+)\/file$/.exec(url.pathname);
    const pageMatch = /^\/s\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (!fileMatch && !pageMatch) return false;

    const token = (fileMatch ?? pageMatch)[1];
    const resolved = await resolve(token);

    if (resolved.error) {
      const status = resolved.error === "expired" || resolved.error === "gone" || resolved.error === "used_up" ? 410 : 404;
      if (fileMatch) {
        sendText(response, status, resolved.error);
        return true;
      }
      response.writeHead(status, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end(renderSharePage({ title: "", meta: "", preview: "", fileUrl: "#", error: resolved.error, note: "" }));
      return true;
    }

    if (fileMatch) {
      return serveFile(request, response, token, resolved.record, resolved.target, {
        count: !url.searchParams.has("preview"),
      });
    }

    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    response.end(renderPage(resolved.record, token, request.headers.host ?? ""));
    return true;
  }

  return { issue, resolve, revoke, handle, storePath };
}
