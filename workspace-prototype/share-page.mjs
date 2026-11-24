// The page a stranger sees. One template, two servers.
//
// This module is deliberately free of `node:` imports so the exact same page is
// rendered by the local studio (share-links.mjs) and by the Cloudflare Worker
// (cloudflare/share/worker.mjs). Two copies of this HTML would drift within a
// week, and the front door is the product.

const HOUR_MS = 3_600_000;

export const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

export const humanBytes = (n) => {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(n) || 0;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value < 10 && i > 0 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
};

export const timeLeft = (ms) => {
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / HOUR_MS);
  const m = Math.floor((ms % HOUR_MS) / 60_000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
};

export const ERROR_COPY = {
  unknown: ["This link cannot be opened", "It may have been typed wrong, or it belongs to a different workspace."],
  revoked: ["This link was revoked", "The sender pulled it back."],
  expired: ["This link expired", "Ask the sender for a fresh one."],
  used_up: ["This link hit its download limit", "Ask the sender for a fresh one."],
  gone: ["This link has nothing left to give", "The file is no longer on this machine."],
  bad_token: ["This link cannot be opened", "It is not in a format this server recognises."],
};

/**
 * The deep link carries the *token*, not the file name.
 *
 * The previous form was `postcard://plane/<fileName>`, which handed the room a
 * string it could not redeem. A file name is not a capability; the token is.
 * If no handler is installed the button does nothing visible, so the page says
 * so after a moment instead of leaving the visitor clicking a dead control.
 */
export function deepLink(token, host) {
  const params = new URLSearchParams();
  if (token) params.set("t", token);
  if (host) params.set("host", host);
  return `postcard://plane?${params.toString()}`;
}

export function renderSharePage({
  title,
  meta,
  preview = "",
  fileUrl,
  token = "",
  host = "",
  error,
  note,
}) {
  const [heading, detail] = error ? ERROR_COPY[error] ?? ERROR_COPY.unknown : [title, ""];
  const openInRoom = token ? deepLink(token, host) : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(heading)}</title>
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
  .preview {
    margin: 0; padding: 14px 16px; max-height: 260px; overflow: auto; border-radius: 10px;
    background: #0c1017; border: 1px solid #1d2432; color: #b9c6dc;
    font: 12.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap;
  }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; padding: 0 24px 24px; }
  a.btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    padding: 12px 18px; border-radius: 10px; text-decoration: none; font-weight: 600;
    border: 1px solid transparent; font-size: 14px;
  }
  .primary { background: #e8ecf4; color: #0b0d12; }
  .primary:hover { background: #fff; }
  .secondary { background: #1a2130; color: #dbe4f4; border-color: #2d3a52; }
  .secondary:hover { border-color: #46587c; }
  footer { padding: 14px 24px; border-top: 1px solid #1d2432; color: #6d7b95; font-size: 12px; }
  .detail { margin: 10px 0 0; color: #93a4c0; font-size: 13px; }
  .hint { padding: 0 24px 20px; margin: 0; color: #7c8aa5; font-size: 12px; }
</style></head>
<body><main class="card">
  <header>
    <div class="eyebrow">post card &middot; paper plane</div>
    <h1>${esc(heading)}</h1>
    ${detail ? `<p class="detail">${esc(detail)}</p>` : ""}
    <div class="meta">${meta}</div>
  </header>
  ${preview ? `<section>${preview}</section>` : ""}
  ${error
    ? ""
    : `<div class="actions">
    <a class="btn primary" href="${esc(fileUrl)}" download>Download</a>
    ${openInRoom ? `<a class="btn secondary" href="${esc(openInRoom)}" data-open>Open in Post Card</a>` : ""}
  </div>
  <p class="hint" data-hint hidden>No Post Card app on this machine? Use Download &mdash; it is the same file.</p>
  <script>
  (() => {
    const link = document.querySelector("a[data-open]");
    if (!link) return;
    // A custom scheme gives no load event, so the only honest signal is that the
    // page is still here and focused a moment later.
    link.addEventListener("click", () => {
      setTimeout(() => {
        if (document.visibilityState === "visible") {
          const hint = document.querySelector("[data-hint]");
          if (hint) hint.hidden = false;
        }
      }, 1200);
    });
  })();
  </script>`}
  <footer>${esc(note || "Expires automatically. No account needed on either side.")}</footer>
</main></body></html>`;
}

/** The chips row under the heading, shared so both servers show the same facts. */
export function shareMetaChips(record, now = Date.now()) {
  const left = record.expiresAt - now;
  return [
    `<span class="chip">${esc(humanBytes(record.bytes))}</span>`,
    `<span class="chip">from ${esc(record.fromCardId)}</span>`,
    `<span class="chip${left < HOUR_MS ? " warn" : ""}">${esc(timeLeft(left))}</span>`,
    `<span class="chip">sha ${esc(String(record.sha256).slice(0, 16))}</span>`,
  ].join("");
}

/** Text/image preview body, identical on both servers. */
export function sharePreview(record, token) {
  const isText =
    String(record.contentType).startsWith("text/") ||
    /\.(txt|md|json|csv|log|sh|js|mjs|ts|css|html)$/i.test(record.fileName);
  if (isText) {
    return `<pre class="preview">loading preview…</pre>
<script>
(async () => {
  const el = document.querySelector("pre.preview");
  try {
    const res = await fetch("/s/${esc(encodeURIComponent(token))}/file?preview=1", { headers: { range: "bytes=0-800" } });
    if (!res.ok && res.status !== 206) throw new Error();
    el.textContent = await res.text();
  } catch { el.remove(); }
})();
</script>`;
  }
  if (String(record.contentType).startsWith("image/")) {
    return `<img src="/s/${encodeURIComponent(token)}/file" alt="" style="max-width:100%;border-radius:10px">`;
  }
  return "";
}
