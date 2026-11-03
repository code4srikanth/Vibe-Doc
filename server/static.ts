// Serves the built app (dist/) so one Node process hosts both the site and /api.
// Hashed files under /assets are cached for a year; index.html is never cached; text is compressed once and kept in memory.
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";

const ROOT = fileURLToPath(new URL("../dist", import.meta.url));

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".mp4": "video/mp4", ".woff2": "font/woff2", ".ico": "image/x-icon", ".glsl": "text/plain; charset=utf-8"
};
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".svg", ".glsl"]);

export const hasBuild = () => existsSync(join(ROOT, "index.html"));

const compressed = new Map<string, Buffer>();
function encode(file: string, enc: "br" | "gzip"): Buffer {
  const key = `${enc}:${file}`;
  let out = compressed.get(key);
  if (!out) {
    const raw = readFileSync(file);
    out = enc === "br" ? brotliCompressSync(raw) : gzipSync(raw);
    compressed.set(key, out);
  }
  return out;
}

/** Finds the file for a URL path inside dist/, or the app shell for a client-side route. Never leaves dist/. */
function resolve(pathname: string): string | undefined {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "");
  if (rel.split(/[/\\]/).some(part => part.startsWith("."))) return;   // dotfiles are never served
  const file = join(ROOT, rel);
  if (file !== ROOT && !file.startsWith(ROOT + sep)) return;
  if (existsSync(file) && statSync(file).isFile()) return file;
  if (extname(rel)) return;   // a missing asset is a 404, not the app shell
  return join(ROOT, "index.html");
}

/** Returns true when the request was answered. */
export function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  let file: string | undefined;
  try { file = resolve(pathname); } catch { return false; }
  if (!file) return false;

  const ext = extname(file);
  const size = statSync(file).size;
  const headers: Record<string, string | number> = {
    "Content-Type": TYPES[ext] ?? "application/octet-stream",
    "Cache-Control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : ext === ".html" ? "no-cache" : "public, max-age=3600",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff"
  };

  if (COMPRESSIBLE.has(ext)) {
    const accept = String(req.headers["accept-encoding"] ?? "");
    const enc = /\bbr\b/.test(accept) ? "br" : /\bgzip\b/.test(accept) ? "gzip" : undefined;
    headers.Vary = "Accept-Encoding";
    if (enc) {
      const body = encode(file, enc);
      res.writeHead(200, { ...headers, "Content-Encoding": enc, "Content-Length": body.length });
      res.end(req.method === "HEAD" ? undefined : body);
      return true;
    }
  }

  // Video seeks with Range requests (Safari requires them), so serve byte ranges for any file.
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(size - Number(range[2]), 0);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      res.end();
      return true;
    }
    res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
    if (req.method === "HEAD") res.end(); else createReadStream(file, { start, end }).pipe(res);
    return true;
  }

  res.writeHead(200, { ...headers, "Content-Length": size });
  if (req.method === "HEAD") res.end(); else createReadStream(file).pipe(res);
  return true;
}
