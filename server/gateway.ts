// The only code that calls the language model. It holds the key (from .env), logs each call's
// purpose, model, time and tokens, and caps the calls per minute.
// Meta Model API (api.meta.ai/v1): OpenAI-style chat completions with tools and JSON schema output,
// streamed for the patient; speech to text through /asr/transcribe. Meta has no text-to-speech model.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../tools/lib/library.ts";

if (existsSync(join(ROOT, ".env"))) process.loadEnvFile(join(ROOT, ".env"));

export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
export type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export interface ToolSpec { type: "function"; function: { name: string; description: string; parameters: object } }

export interface ChatRequest {
  /** What the call is for, for the log: "case.intent", "case.agent", "patient", "examiner". */
  purpose: string;
  model: string;
  messages: Message[];
  tools?: ToolSpec[];
  /** Ask for a JSON object matching this schema. */
  json?: { name: string; schema: object };
  temperature?: number;
  /** The models reason before answering; lower effort answers faster (the patient). */
  reasoning?: "minimal" | "low" | "medium" | "high";
  /** Images for the last user message (the render judge). */
  images?: { mime: string; base64: string }[];
}
export interface ChatReply { message: Extract<Message, { role: "assistant" }>; usage?: { prompt_tokens: number; completion_tokens: number } }

/** Anything that answers a chat request: the Meta Model API, or a scripted model in tests. */
export type Model = (req: ChatRequest) => Promise<ChatReply>;

export const MODELS = {
  case: process.env.META_CASE_MODEL ?? "muse-spark-1.3",
  patient: process.env.META_PATIENT_MODEL ?? "muse-spark-1.3",
  examiner: process.env.META_EXAMINER_MODEL ?? "muse-spark-1.3",
  judge: process.env.META_JUDGE_MODEL ?? "muse-spark-1.3",
  image: process.env.META_IMAGE_MODEL ?? "muse-image-1.0",
  transcribe: process.env.META_TRANSCRIBE_MODEL ?? "muse-voice-transcribe-1.0"
};

const BASE_URL = process.env.META_BASE_URL ?? "https://api.meta.ai/v1";
const MAX_CALLS_PER_MINUTE = Number(process.env.META_MAX_CALLS_PER_MINUTE ?? 60);
const recent: number[] = [];

/** A streamed reply, piece by piece: text as it arrives, then the whole message once the model stops. */
export type StreamPart = { type: "text"; text: string } | { type: "done"; reply: ChatReply; firstTextMs?: number };
/** Anything that streams a chat reply: the Meta Model API, or a scripted model in tests. */
export type StreamModel = (req: ChatRequest) => AsyncIterable<StreamPart>;

function apiKey() {
  const key = process.env.META_API_KEY;
  if (!key) throw new Error("META_API_KEY is not set. Copy .env.example to .env and add the key.");
  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (recent.length >= MAX_CALLS_PER_MINUTE) throw new Error(`Rate limit: more than ${MAX_CALLS_PER_MINUTE} model calls in a minute.`);
  recent.push(now);
  return key;
}

/** The request as the API takes it. The models read images only in user messages, so they join the last one. */
export function requestBody(req: ChatRequest, stream: boolean) {
  const last = req.images?.length ? req.messages.map(m => m.role).lastIndexOf("user") : -1;
  return {
    model: req.model,
    messages: req.messages.map((m, i) => i !== last ? m : {
      role: m.role,
      content: [
        { type: "text", text: m.content },
        ...req.images!.map(({ mime, base64 }) => ({ type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } }))
      ]
    }),
    temperature: req.temperature ?? 0.2,
    ...(stream && { stream: true }),
    ...(req.reasoning && { reasoning_effort: req.reasoning }),
    ...(req.tools && { tools: req.tools, tool_choice: "auto" }),
    ...(req.json && { response_format: { type: "json_schema", json_schema: { name: req.json.name, schema: req.json.schema } } })
  };
}

async function post(req: ChatRequest, stream: boolean) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify(requestBody(req, stream))
  });
  if (!res.ok) throw new Error(`Meta Model API ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return res;
}

const logCall = (req: ChatRequest, ms: number, usage?: ChatReply["usage"], extra = "") =>
  console.log(`[gateway] ${req.purpose} ${req.model} ${ms} ms${extra}${usage ? ` ${usage.prompt_tokens}+${usage.completion_tokens} tokens` : ""}`);

export const meta: Model = async req => {
  const started = Date.now();
  const data = await (await post(req, false)).json() as { choices: { message: ChatReply["message"] }[]; usage?: ChatReply["usage"] };
  logCall(req, Date.now() - started, data.usage);
  return { message: data.choices[0].message, usage: data.usage };
};

/** The same call, streamed (server-sent events). Tool calls arrive in fragments and are joined by index. */
export const metaStream: StreamModel = async function* (req) {
  const started = Date.now();
  const res = await post(req, true);
  let content = "", buffer = "", firstTextMs: number | undefined, usage: ChatReply["usage"];
  const calls: ToolCall[] = [];
  const decoder = new TextDecoder();
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      const event = JSON.parse(data) as {
        choices?: { delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
        usage?: ChatReply["usage"];
      };
      if (event.usage) usage = event.usage;
      const delta = event.choices?.[0]?.delta;
      if (delta?.content) {
        firstTextMs ??= Date.now() - started;
        content += delta.content;
        yield { type: "text", text: delta.content };
      }
      for (const t of delta?.tool_calls ?? []) {
        const c = calls[t.index] ??= { id: "", type: "function", function: { name: "", arguments: "" } };
        if (t.id) c.id = t.id;
        if (t.function?.name) c.function.name += t.function.name;
        if (t.function?.arguments) c.function.arguments += t.function.arguments;
      }
    }
  }
  logCall(req, Date.now() - started, usage, firstTextMs !== undefined ? ` (first text ${firstTextMs} ms)` : "");
  const tool_calls = calls.filter(Boolean);
  yield { type: "done", firstTextMs, reply: { message: { role: "assistant", content: content || null, ...(tool_calls.length && { tool_calls }) }, usage } };
};

/** An image edit as the API takes it: one PNG, directed by the prompt alone, as the API has no mask. Size sets the aspect ratio. Web and image search stay off, so no real photo feeds an image the repo publishes. */
export const imageEditBody = (prompt: string, png: Buffer) => ({
  model: MODELS.image, prompt, n: 1, size: "1792x1024", output_format: "png",
  tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
  images: [{ image_url: `data:image/png;base64,${png.toString("base64")}` }]
});

/** One PNG changed by Muse Image, as PNG bytes. */
export async function editImage(prompt: string, png: Buffer): Promise<Buffer> {
  const started = Date.now();
  const res = await fetch(`${BASE_URL}/images/edits`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify(imageEditBody(prompt, png))
  });
  if (!res.ok) throw new Error(`Meta image ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json() as { data: { b64_json: string }[] };
  console.log(`[gateway] image edit ${MODELS.image} ${Date.now() - started} ms`);
  return Buffer.from(data.data[0].b64_json, "base64");
}

/** What live transcription reports: someone began talking, the words so far, and the finished turn. */
export type LiveEvent = { type: "start" } | { type: "partial"; text: string } | { type: "final"; text: string };

/** One message from the realtime service in our terms; null for those the browser does not need. */
export function readLiveEvent(data: { type?: string; transcript?: string; final?: boolean }): LiveEvent | null {
  if (data.type === "speechStart") return { type: "start" };
  if (data.type === "transcript" && !data.final) return { type: "partial", text: data.transcript ?? "" };
  if (data.type === "speechComplete") return { type: "final", text: (data.transcript ?? "").trim() };
  return null;
}

export interface LiveTranscription { send(pcm: Uint8Array<ArrayBuffer>): void; close(): void }

const LIVE_URL = process.env.META_LIVE_URL ?? "wss://api.meta.ai/v1/asr/realtime";
const MAX_LIVE_BACKLOG = 125;   // frames held while connecting, 10 s at 80 ms each; the service takes at most 5 s ahead, so older ones go first

/**
 * Live speech to text: 16 kHz mono 16-bit PCM in, words out while the person talks, and the service finds where each
 * turn ends. The session stays open between turns, as opening one takes about a second. Audio sent while it opens is
 * held, so the first words are not lost.
 */
export function liveTranscribe(on: { ready(): void; event(e: LiveEvent): void; closed(): void }): LiveTranscription {
  const ws = new WebSocket(LIVE_URL), started = Date.now();
  ws.binaryType = "arraybuffer";
  let held: Uint8Array<ArrayBuffer>[] | null = [];
  ws.onopen = () => ws.send(JSON.stringify({
    authorization: { accessToken: `Bearer ${apiKey()}` },
    audioEncoding: "PCM_16KHZ", model: MODELS.transcribe, mode: "ENDPOINTING", languageBias: ["English"], emitAudioProgress: false
  }));
  ws.onmessage = m => {
    const data = JSON.parse(String(m.data)) as { type?: string; sessionId?: string; message?: string; transcript?: string; final?: boolean };
    if (!data.type && data.sessionId) {
      console.log(`[gateway] live transcribe ${MODELS.transcribe} open in ${Date.now() - started} ms`);
      for (const frame of held ?? []) ws.send(frame);
      held = null;
      on.ready();
      return;
    }
    if (data.type === "error") console.error(`Live transcription: ${data.message}`);
    const event = readLiveEvent(data);
    if (event) on.event(event);
  };
  let closing = false;
  ws.onerror = () => { if (!closing) console.error("Live transcription: connection failed."); };
  ws.onclose = e => { console.log(`[gateway] live transcribe closed ${e.code} after ${Date.now() - started} ms`); on.closed(); };
  return {
    send(pcm) {
      if (!held) { if (ws.readyState === WebSocket.OPEN) ws.send(pcm); return; }
      held.push(pcm);
      if (held.length > MAX_LIVE_BACKLOG) held.shift();
    },
    close() {
      closing = true;
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "endStream" }));
      ws.close();
    }
  };
}

/** Speech to text (Muse Voice Transcribe): one recorded utterance, a mono 16-bit WAV at 16 or 24 kHz. */
export async function transcribe(wav: Uint8Array<ArrayBuffer>): Promise<string> {
  const form = new FormData();
  form.append("request", new Blob([JSON.stringify({ model: MODELS.transcribe, audioEncoding: "WAV" })], { type: "application/json" }));
  form.append("audio", new Blob([wav], { type: "audio/wav" }), "speech.wav");
  const started = Date.now();
  const res = await fetch(`${BASE_URL}/asr/transcribe`, { method: "POST", headers: { Authorization: `Bearer ${apiKey()}`, Accept: "application/json" }, body: form });
  if (!res.ok) throw new Error(`Meta transcription ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json() as { transcript?: string; audioDurationMs?: number };
  console.log(`[gateway] transcribe ${MODELS.transcribe} ${Date.now() - started} ms for ${data.audioDurationMs ?? "?"} ms of audio`);
  return (data.transcript ?? "").trim();
}
