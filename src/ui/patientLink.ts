// The exam screen's line to the voice patient (server/index.ts): chat as streamed events, push-to-talk
// recordings sent for transcription, and the patient's replies spoken with the server's ElevenLabs voice, or the browser's standard voice when that is unavailable.
// The server holds the key and the patient; the browser sends only the trainee's words.

export type EyeAction = "look_up" | "look_down" | "look_left" | "look_right" | "look_ahead" | "blink" | "open_wide" | "relax";
export type PatientEvent = { type: "say"; text: string } | { type: "action"; action: EyeAction } | { type: "done" };

import type { CaseSheet, LampEvent, Report } from "../../server/examiner.ts";

const API = "/api/sessions";

export async function openSession(body: { prompt: string; sex?: string; age?: number } | { caseId: string }): Promise<string> {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Server answered ${res.status}`);
  return data.id as string;
}

export class PatientLink {
  constructor(readonly sessionId: string, private persona: { age: number; sex?: string }) {}

  /** The patient's reply to something the trainee said or typed, as it arrives. */
  async *chat(text: string, signal?: AbortSignal): AsyncGenerator<PatientEvent> {
    const res = await fetch(`${API}/${this.sessionId}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal });
    if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? `Server answered ${res.status}`);
    const reader = res.body.getReader(), decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = /^event: (.+)$/m.exec(block)?.[1], data = /^data: (.+)$/m.exec(block)?.[1];
        if (!event || !data) continue;
        if (event === "error") throw new Error(JSON.parse(data).error);
        yield JSON.parse(data) as PatientEvent;
      }
    }
  }

  /** What the patient says first, once seated. The server waits until the patient's history is written. */
  async greet(signal?: AbortSignal): Promise<string> {
    const res = await fetch(`${API}/${this.sessionId}/greet`, { method: "POST", signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Server answered ${res.status}`);
    return data.text as string;
  }

  /** The case sheet and the lamp log to the Examiner; resolves with the scored report. */
  async evaluate(sheet: CaseSheet, log: LampEvent[]): Promise<Report> {
    const res = await fetch(`${API}/${this.sessionId}/evaluate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sheet, log }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Server answered ${res.status}`);
    return data as Report;
  }

  /** A recording (any format the browser records) to words. */
  async transcribe(recording: Blob): Promise<string> {
    const wav = await toWav(recording);
    const res = await fetch(`${API}/${this.sessionId}/transcribe`, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Server answered ${res.status}`);
    return data.text as string;
  }

  private queue: Promise<void> = Promise.resolve();
  private generation = 0;
  private waiting = 0;
  private audio: HTMLAudioElement | null = null;
  private clips = new AbortController();   // cancels the sentences still downloading when the patient is interrupted
  private serverVoice = true;   // false once the server says it has no voice key: the browser's voice takes over

  /** True while a sentence is playing or waiting its turn. */
  get speaking(): boolean {
    return this.waiting > 0 || ("speechSynthesis" in window && (speechSynthesis.speaking || speechSynthesis.pending));
  }

  /** Speaks a sentence, queued after the ones before it. The server's voice follows the patient's sex and age; the browser's voice is the fallback. */
  speak(text: string) {
    const generation = this.generation;
    const clip = this.serverVoice ? this.fetchClip(text) : Promise.resolve(null);   // requested now, so the next sentence is ready when its turn comes
    this.waiting++;
    this.queue = this.queue.then(async () => {
      try {
        const res = await clip;
        if (generation !== this.generation) return;
        if (res) await this.play(res, generation); else await this.browserSpeak(text);
      } finally { this.waiting--; }
    });
  }

  private async fetchClip(text: string): Promise<Response | null> {
    try {
      const res = await fetch(`${API}/${this.sessionId}/speak`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, sex: this.persona.sex, age: this.persona.age }), signal: this.clips.signal });
      if (res.status === 503) this.serverVoice = false;
      return res.ok ? res : null;
    } catch { return null; }
  }

  /** Plays while the audio is still arriving where the browser can (MediaSource); otherwise once all of it is here (iOS Safari). */
  private async play(res: Response, generation: number): Promise<void> {
    const streams = "MediaSource" in window && MediaSource.isTypeSupported("audio/mpeg") && res.body;
    const source = streams ? new MediaSource() : null;
    let url: string;
    try { url = URL.createObjectURL(source ?? await res.blob()); } catch { return; }
    return new Promise(resolve => {
      const audio = new Audio(url);
      const done = () => { URL.revokeObjectURL(url); if (this.audio === audio) this.audio = null; resolve(); };
      audio.onended = audio.onerror = done;
      if (generation !== this.generation) return done();
      this.audio = audio;
      if (source) source.addEventListener("sourceopen", () => void feed(source, res.body!), { once: true });
      audio.play().catch(done);
    });
  }

  private browserSpeak(text: string): Promise<void> {
    if (!("speechSynthesis" in window)) return Promise.resolve();
    return new Promise(resolve => {
      const u = new SpeechSynthesisUtterance(text);   // the browser's standard voice
      u.onend = u.onerror = () => resolve();
      speechSynthesis.speak(u);
    });
  }

  stopSpeaking() {
    this.generation++;
    this.clips.abort();
    this.clips = new AbortController();
    this.audio?.pause();
    this.audio?.dispatchEvent(new Event("ended"));
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }
}

/** Hands the audio to the player as it arrives, and marks its end so the player's "ended" fires. */
async function feed(source: MediaSource, body: ReadableStream<Uint8Array<ArrayBuffer>>): Promise<void> {
  try {
    const buffer = source.addSourceBuffer("audio/mpeg"), reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer.appendBuffer(value);
      await new Promise(next => buffer.addEventListener("updateend", next, { once: true }));
    }
  } catch { /* interrupted, or the connection dropped: play what arrived */ }
  if (source.readyState === "open") source.endOfStream();
}

// Hands-free listening: the microphone stays open and the level decides where each utterance starts and ends.
const TICK_MS = 50, END_SILENCE_MS = 1000, MIN_VOICED_MS = 350, MAX_UTTERANCE_MS = 30000, AFTER_PATIENT_MS = 500;

/**
 * Keeps the microphone open and calls onUtterance with one recording per spoken phrase. A phrase ends after a second of
 * silence. Nothing is recorded while `paused()` is true (the patient is speaking), so the patient's voice from the
 * speakers is not mistaken for the trainee. The speech threshold follows the room's background noise.
 */
export async function listenHandsFree(opts: { onUtterance(recording: Blob): void; onState(state: "idle" | "hearing"): void; paused(): boolean }): Promise<{ stop(): void }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const ctx = new AudioContext(), analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let floor = 0.01, rec: MediaRecorder | null = null, parts: Blob[] = [], voicedMs = 0, silentMs = 0, lengthMs = 0, resumeAt = 0, hearing = false;

  const finish = (keep: boolean) => {
    const r = rec, got = parts, voiced = voicedMs;
    rec = null; parts = []; voicedMs = silentMs = lengthMs = 0;
    if (!r) return;
    r.onstop = () => { if (keep && voiced >= MIN_VOICED_MS) opts.onUtterance(new Blob(got, { type: r.mimeType })); };
    r.ondataavailable = e => { if (e.data.size) got.push(e.data); };
    r.stop();
  };
  const setHearing = (on: boolean) => { if (on !== hearing) { hearing = on; opts.onState(on ? "hearing" : "idle"); } };

  const timer = setInterval(() => {
    if (ctx.state === "suspended") void ctx.resume();
    if (opts.paused()) { resumeAt = Date.now() + AFTER_PATIENT_MS; finish(false); setHearing(false); return; }
    if (Date.now() < resumeAt) return;
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const s of samples) sum += s * s;
    const level = Math.sqrt(sum / samples.length);
    const loud = level > Math.max(0.02, floor * 3);
    if (!loud) floor = floor * 0.95 + level * 0.05;   // learn the room's noise from the quiet moments only

    if (loud) {
      silentMs = 0; voicedMs += TICK_MS;
      if (!rec) {
        rec = new MediaRecorder(stream);
        rec.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
        rec.start();
      }
      setHearing(true);
    } else if (rec) {
      silentMs += TICK_MS;
      if (silentMs >= END_SILENCE_MS) { finish(true); setHearing(false); }
    }
    if (rec && (lengthMs += TICK_MS) >= MAX_UTTERANCE_MS) { finish(true); setHearing(false); }
  }, TICK_MS);

  return {
    stop() {
      clearInterval(timer); finish(false); setHearing(false);
      stream.getTracks().forEach(t => t.stop()); void ctx.close();
    }
  };
}

/** Any recording to the 16 kHz mono 16-bit WAV the transcription service takes. */
async function toWav(recording: Blob): Promise<ArrayBuffer> {
  const ctx = new AudioContext();
  const audio = await ctx.decodeAudioData(await recording.arrayBuffer());
  void ctx.close();
  const RATE = 16000;
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(audio.duration * RATE)), RATE);
  const src = off.createBufferSource();
  src.buffer = audio; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); out.setUint32(4, 36 + pcm.length * 2, true); str(8, "WAVEfmt ");
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, RATE, true); out.setUint32(28, RATE * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  str(36, "data"); out.setUint32(40, pcm.length * 2, true);
  pcm.forEach((s, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return out.buffer;
}
