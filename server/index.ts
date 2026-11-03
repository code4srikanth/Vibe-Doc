// EyeSim server: holds the API key, runs the agents and keeps each session's eye and patient.
// npm run server  (PORT, default 8787)
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { loadLibrary } from "../tools/lib/library.ts";
import { meta, metaStream, transcribe } from "./gateway.ts";
import { buildFailed, readIntent, runCaseAgent, withVision, type Intent } from "./case-agent.ts";
import { CaseIndex } from "./case-match.ts";
import { cleanSheet, evaluate, type LampEvent } from "./examiner.ts";
import { createPatient, greet, talk, writeFacts, type PatientState } from "./patient.ts";
import { briefFor, caseSession, createSession, getSession, publicEye, type Session } from "./session.ts";
import { allow, clientIp, LIMITS } from "./limits.ts";
import { MAX_SPEECH, speech, voiceConfigured, voiceFor } from "./voice.ts";
import { hasBuild, serveStatic } from "./static.ts";
import { attachListen } from "./listen.ts";

const lib = loadLibrary();
const PORT = Number(process.env.PORT ?? 8787);
const MAX_PROMPT = 1000;
const MAX_AUDIO = 4_000_000;   // bytes: about two minutes of 16 kHz speech
// Without the index (the extension failed to load), every prompt goes to the agent, as it did before matching existed.
const caseIndex = (() => { try { return new CaseIndex(lib); } catch (e) { console.error("Case matching is off:", e); } })();
const FALLBACK_CASE = "ns2";
const SPINNER_MS = 12_000;   // how long opening a session waits for the patient, counted from the request

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const tooMany = (res: ServerResponse) => send(res, 429, { error: "Too many requests. Please wait a moment and try again." });

async function readRaw(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) { size += chunk.length; if (size > limit) throw new Error("Request too large."); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = (await readRaw(req, 128_000)).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

/** A typed prompt's session: the stored case it matches, or the agent's build, or a stored case standing in if the build fails. */
async function promptSession(prompt: string, subject?: Pick<Intent, "age" | "sex">): Promise<{ session: Session; eye?: string }> {
  let intent: Intent | undefined;
  try {
    intent = { ...await readIntent(prompt, meta), ...subject };
    const match = caseIndex?.find(intent);
    const who = { ...subject, eye: intent.eye };
    if (match) {
      console.log(`[match] ${match.caseId} at ${match.distance.toFixed(2)} for "${intent.condition}"`);
      return { session: caseSession(lib, match.caseId, { origin: "matched", prompt, subject: who })!, eye: intent.eye };
    }
    console.log(`[match] none for "${intent.condition}": the agent builds it`);
    const result = await runCaseAgent(lib, prompt, { model: meta, intent });
    if (!buildFailed(result)) return { session: createSession(lib, prompt, result), eye: intent.eye };
    console.error(`[fallback] weak build after ${result.steps} steps, ${result.edits.length} edits`);
  } catch (e) {
    console.error("[fallback]", e);
  }
  const caseId = caseIndex?.nearest(intent?.signs).caseId ?? FALLBACK_CASE;
  return { session: caseSession(lib, caseId, { origin: "fallback", subject: subject && { ...subject, eye: intent?.eye } })!, eye: intent?.eye };
}

/** Gives the patient a head start: waits for it until SPINNER_MS after the request began, and the writing carries on behind if it needs longer. */
async function headStart(patient: Promise<unknown>, started: number) {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([patient.catch(e => console.error(e)), new Promise(done => { timer = setTimeout(done, Math.max(0, started + SPINNER_MS - Date.now())); })]);
  clearTimeout(timer);
}

/** The patient is written in the background once a session opens, so the spinner waits for it only briefly (headStart). A first question asked before it is ready waits for it here; a failed write is retried by the next chat. */
const writing = new WeakMap<Session, Promise<PatientState>>();
function patientOf(s: Session, eye?: string): Promise<PatientState> {
  if (s.patient) return Promise.resolve(s.patient);
  let p = writing.get(s);
  if (!p) {
    const brief = briefFor(s, eye);
    p = writeFacts(brief, meta).then(facts => (s.patient = createPatient(facts, brief)));
    p.catch(() => writing.delete(s));   // a failed write is retried by the next chat
    writing.set(s, p);
  }
  return p;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/api/health") return send(res, 200, { ok: true, components: lib.components.length });

    // {prompt, vision?}: the Case agent builds the eye, with severity read from the vision; {caseId}: a stored case (validated scenarios, fallback)
    if (req.method === "POST" && url.pathname === "/api/sessions") {
      if (!allow(clientIp(req), "sessions", LIMITS.sessionsPerHour, 3_600_000)) return tooMany(res);
      const started = Date.now();
      const body = await readBody(req);
      if (typeof body.caseId === "string") {
        const s = caseSession(lib, body.caseId);
        if (!s) return send(res, 404, { error: `No case ${body.caseId}.` });
        await headStart(patientOf(s), started);
        return send(res, 201, { id: s.id, valid: true, origin: s.origin, subject: s.base.subject });
      }
      const prompt = String(body.prompt ?? "").trim();
      if (!prompt || prompt.length > MAX_PROMPT) return send(res, 400, { error: `A prompt of 1-${MAX_PROMPT} characters is required.` });
      const age = Number(body.age), chosen = body.sex === "male" || body.sex === "female" ? { sex: body.sex as "male" | "female", age: Math.min(100, Math.max(18, Math.round(age) || 60)) } : undefined;
      const { session: s, eye } = await promptSession(withVision(prompt, body.vision), chosen);
      await headStart(patientOf(s, eye), started);
      return send(res, 201, { id: s.id, valid: s.result.valid, origin: s.origin, subject: s.base.subject });
    }

    const route = url.pathname.match(/^\/api\/sessions\/([\w-]+)\/(eye|chat|greet|transcribe|speak|evaluate)$/);
    const s = route && getSession(route[1]);
    if (route && !s) return send(res, 404, { error: "No such session." });

    if (req.method === "GET" && route?.[2] === "eye") return send(res, 200, publicEye(s!));

    // The patient's first words once seated, as soon as the history is written
    if (req.method === "POST" && route?.[2] === "greet") {
      if (!allow(clientIp(req), "chat", LIMITS.chatPerMinute, 60_000)) return tooMany(res);
      return send(res, 200, { text: greet(await patientOf(s!)) });
    }

    // The trainee speaks or types; the reply streams back as server-sent events: say, action, done
    if (req.method === "POST" && route?.[2] === "chat") {
      if (!allow(clientIp(req), "chat", LIMITS.chatPerMinute, 60_000)) return tooMany(res);
      const text = String((await readBody(req)).text ?? "").trim();
      if (!text) return send(res, 400, { error: "Say something to the patient." });
      const patient = await patientOf(s!);
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      try {
        for await (const ev of talk(patient, text, metaStream)) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
      } catch (e) {
        console.error(e);
        res.write(`event: error\ndata: ${JSON.stringify({ error: (e as Error).message })}\n\n`);
      }
      return res.end();
    }

    // One push-to-talk utterance: a mono 16-bit WAV (16 or 24 kHz) in, the words out
    if (req.method === "POST" && route?.[2] === "transcribe") {
      if (!allow(clientIp(req), "transcribe", LIMITS.transcribePerMinute, 60_000)) return tooMany(res);
      const wav = new Uint8Array(await readRaw(req, MAX_AUDIO));
      if (wav.length < 44 || new TextDecoder().decode(wav.subarray(0, 4)) !== "RIFF") return send(res, 400, { error: "Send a WAV recording." });
      return send(res, 200, { text: await transcribe(wav) });
    }
    // One sentence of the patient's reply as spoken audio (MP3). 503 when no voice key is set: the browser then uses its own voice.
    if (req.method === "POST" && route?.[2] === "speak") {
      if (!voiceConfigured()) return send(res, 503, { error: "No voice service configured." });
      if (!allow(clientIp(req), "speak", LIMITS.speakPerMinute, 60_000)) return tooMany(res);
      const body = await readBody(req);
      const text = String(body.text ?? "").trim();
      if (!text || text.length > MAX_SPEECH) return send(res, 400, { error: `Text of 1-${MAX_SPEECH} characters is required.` });
      const age = Number(body.age) || 40;
      const started = Date.now(), gone = new AbortController();
      res.on("close", () => gone.abort());   // the trainee interrupted: stop making audio nobody will hear
      const audio = await speech(text, voiceFor(route[1], typeof body.sex === "string" ? body.sex : undefined, age), age, gone.signal);
      console.log(`Voice: ${Date.now() - started} ms to first audio, ${text.length} characters`);
      res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" });
      return await pipeline(Readable.fromWeb(audio as NodeReadableStream), res).catch(() => { res.destroy(); });   // a closed connection is not an error here
    }
    // Everything else is the built app (npm run build); /api paths that matched nothing stay a JSON 404.
    if (!url.pathname.startsWith("/api/") && serveStatic(req, res, url.pathname)) return;
    // The case sheet and the lamp log in; the scored report out. Takes the model about 15-30 s.
    if (req.method === "POST" && route?.[2] === "evaluate") {
      const body = await readBody(req);
      const log = (Array.isArray(body.log) ? body.log : []).slice(0, 400) as LampEvent[];
      return send(res, 200, await evaluate(s!, lib, cleanSheet(body.sheet), log, meta));
    }
    send(res, 404, { error: "Not found." });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: (e as Error).message }); else res.end();
  }
});

attachListen(server);

server.listen(PORT, () => {
  console.log(`EyeSim server on http://localhost:${PORT} (${lib.components.length} components)`);
  if (!hasBuild()) console.log("No dist/ found: run npm run build to serve the app from here (npm run dev serves it in development).");
  if (!voiceConfigured()) console.log("ELEVEN_LABS is not set: the patient will speak with the browser's voice.");
  if (!process.env.META_API_KEY) console.warn("META_API_KEY is not set: the patient and case agent will fail until it is.");
});
