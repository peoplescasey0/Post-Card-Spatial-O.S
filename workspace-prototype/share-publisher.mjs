// Publishing a plane to a host that isn't this machine.
//
// The local link mode reads a spool file in place and serves it from the studio
// process. That is the right shape for two machines on one desk and the wrong
// shape for anything else: the link dies the moment the lid closes.
//
// This module keeps the same inputs and the same rules, and changes one thing:
// the bytes are uploaded once, to a host that is awake on its own schedule.
//
// What does NOT change, and must not:
//   - the token is generated here, and only its sha256 leaves this machine
//   - the spool resolver is the same function the local mode uses
//   - the TTL ceiling and download cap are the same numbers
//
// What does change:
//   - the sender can be offline afterwards. That is the entire point.
//   - the hash is verified twice: once locally before upload, once by the host
//     over the bytes it actually stored. A mismatch fails the publish.

import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";

import { guessType, hashFile, resolveSpoolFile, sha256Hex } from "./share-links.mjs";

const MIN_TTL_SEC = 60;
const MAX_TTL_SEC = 72 * 3600;

/** The host rejects anything larger; refuse here so the error names the file. */
const DEFAULT_MAX_BYTES = 95 * 1024 * 1024;

export function createSharePublisher({
  baseUrl,
  secret,
  paperPlanesDropDir,
  clock = Date.now,
  maxTtlSec = MAX_TTL_SEC,
  maxBytes = Number(process.env.POSTCARD_SHARE_MAX_BYTES) > 0
    ? Number(process.env.POSTCARD_SHARE_MAX_BYTES)
    : DEFAULT_MAX_BYTES,
  fetchImpl = globalThis.fetch,
}) {
  const base = String(baseUrl ?? "").replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+$/i.test(base)) {
    throw new Error("SHARE_REMOTE_URL must be an http(s) origin, e.g. https://share.example.workers.dev");
  }
  if (typeof secret !== "string" || secret.length < 16) {
    throw new Error("SHARE_REMOTE_SECRET must be at least 16 characters.");
  }

  async function issue({ cardId, fileName, fromCardId = "unknown", ttlSec, maxDownloads = 0 }) {
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

    const target = await resolveSpoolFile(paperPlanesDropDir, cardId, fileName);
    if (target.error) throw Object.assign(new Error(target.error), { status: target.status });
    if (target.bytes > maxBytes) {
      throw Object.assign(
        new Error(
          `${target.name} is ${target.bytes} bytes; this host takes up to ${maxBytes} per link. ` +
            "Split it, or raise POSTCARD_SHARE_MAX_BYTES to match the host's limit.",
        ),
        { status: 413 },
      );
    }

    const token = randomBytes(32).toString("base64url");
    const digest = sha256Hex(Buffer.from(token));
    const localHash = await hashFile(target.path);

    const response = await fetchImpl(`${base}/api/share/${digest}`, {
      method: "PUT",
      headers: {
        "x-publish-secret": secret,
        "x-file-name": encodeURIComponent(target.name),
        "x-from-card": encodeURIComponent(String(fromCardId || "unknown").slice(0, 64)),
        "x-ttl": String(ttl),
        "x-max-downloads": String(limit),
        "x-sha256": localHash,
        "x-size": String(target.bytes),
        "content-type": guessType(target.name),
        "content-length": String(target.bytes),
      },
      body: createReadStream(target.path),
      duplex: "half",
    });

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text.slice(0, 300) };
    }
    if (!response.ok) {
      throw Object.assign(new Error(`Host refused the upload: ${payload.error ?? response.status}`), {
        status: response.status,
      });
    }
    // When the host streamed a hash of what it stored, that is an independent
    // check: a mismatch means the bytes in flight were not the bytes on disk, and
    // no link should exist. When the host is in size-only mode it echoes the
    // sender's claim back, which is not evidence and is not treated as such.
    const verified = payload.verified === true;
    if (verified && payload.sha256 !== localHash) {
      throw new Error(
        `Host stored a different file (sent ${localHash.slice(0, 12)}, stored ${String(payload.sha256).slice(0, 12)}). Link not issued.`,
      );
    }

    return {
      token,
      url: `${base}/s/${token}`,
      expiresAt: Number(payload.expiresAt) || clock() + ttl * 1000,
      bytes: target.bytes,
      sha256: localHash,
      sha256Verified: verified,
      fileName: target.name,
      hosted: true,
    };
  }

  async function revoke(token) {
    const digest = sha256Hex(Buffer.from(String(token ?? "")));
    const response = await fetchImpl(`${base}/api/share/${digest}/revoke`, {
      method: "POST",
      headers: { "x-publish-secret": secret },
    });
    if (!response.ok) {
      throw Object.assign(new Error(`Host refused the revoke: ${response.status}`), { status: response.status });
    }
    return response.json();
  }

  return { issue, revoke, baseUrl: base };
}
