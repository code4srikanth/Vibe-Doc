// Per-visitor rate limits, so one visitor cannot use up the shared model budget (gateway.ts holds the global cap).
import type { IncomingMessage } from "node:http";

/** Proxies in front of the server (Render adds one; Cloudflare in front of Render makes two). */
const HOPS = Number(process.env.TRUST_PROXY_HOPS ?? 1);

/** The visitor's address: the entry the nearest trusted proxy appended, which the visitor cannot forge. */
export function clientIp(req: IncomingMessage): string {
  const hops = String(req.headers["x-forwarded-for"] ?? "").split(",").map(s => s.trim()).filter(Boolean);
  return hops[hops.length - HOPS] ?? req.socket.remoteAddress ?? "unknown";
}

const hits = new Map<string, number[]>();

/** True when this visitor may proceed. A sliding window of `max` calls per `windowMs` for each bucket and address. */
export function allow(ip: string, bucket: string, max: number, windowMs: number): boolean {
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter(t => now - t < windowMs);
  if (recent.length >= max) { hits.set(key, recent); return false; }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

// Forget visitors who have gone quiet, so the table cannot grow without bound.
setInterval(() => {
  const cutoff = Date.now() - 3_600_000;
  for (const [key, times] of hits) if (!times.length || times[times.length - 1] < cutoff) hits.delete(key);
}, 600_000).unref();

export const LIMITS = {
  sessionsPerHour: Number(process.env.LIMIT_SESSIONS_PER_HOUR ?? 20),
  chatPerMinute: Number(process.env.LIMIT_CHAT_PER_MINUTE ?? 30),
  transcribePerMinute: Number(process.env.LIMIT_TRANSCRIBE_PER_MINUTE ?? 30),
  listenPerMinute: Number(process.env.LIMIT_LISTEN_PER_MINUTE ?? 10),
  speakPerMinute: Number(process.env.LIMIT_SPEAK_PER_MINUTE ?? 40)
};
