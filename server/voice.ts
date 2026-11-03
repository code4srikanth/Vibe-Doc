// The patient's voice: ElevenLabs text-to-speech. The key stays on the server; the browser gets MP3 audio back.
const KEY_NAME = "ELEVEN_LABS";
const BASE_URL = process.env.ELEVEN_LABS_BASE_URL ?? "https://api.elevenlabs.io/v1";
const MODEL = process.env.ELEVEN_LABS_MODEL ?? "eleven_flash_v2_5";   // low latency, so the patient answers quickly

/** Voice IDs by sex and age band. A session keeps one voice for the whole conversation, chosen from its band's pool. */
const OLDER_FROM = 65;
const POOLS = {
  female: {
    older: ["5u41aNhyCU6hXOcjPPv0", "xIzR6egd3S3LJZbVW0c1", "q1Hhtkt94vkD6q7p50hW"],                           // Carol, Nana Margaret, Alese Johnston
    adult: ["XrExE9yKIg1WjnnlVkGX", "hpp4J3VqNfWAUOO0d1Us", "3liN8q8YoeB9Hk6AboKe", "g6xIsTj2HwM6VR4iXFCw", "MnUw1cSnpiLoLhpd3Hqp"]   // Matilda, Bella, Lauren, Jessica Anne, Heather Rey
  },
  male: {
    older: ["TTyZrDYo6LQowrH8mixJ", "TqOasn6BO225ydKxXhaK", "0lp4RIz96WD1RUtvEu3Q"],                           // Joseph Ortman, David, Grandfather Joe
    adult: ["iP95p4xoKVk53GoZ742B", "cjVigY5qzO86Huf0OWal", "1SM7GgM6IMuvQlz2BwM3", "SF9uvIlY93SJRMdV5jeP"]    // Chris, Eric, Mark, Andrew
  }
};

export const MAX_SPEECH = 600;   // characters per sentence sent to the voice

export const voiceConfigured = () => !!process.env[KEY_NAME];

/** The voice for this patient: the same session id always gets the same voice, different sessions spread across the pool. */
export function voiceFor(sessionId: string, sex: string | undefined, age: number): string {
  const pool = POOLS[sex === "male" ? "male" : "female"][age >= OLDER_FROM ? "older" : "adult"];
  let hash = 0;
  for (const ch of sessionId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[hash % pool.length];
}

/** One sentence as an MP3 stream, so it can play while it is still being made. Throws when the key is missing or the service refuses. */
export async function speech(text: string, voice: string, age: number, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const key = process.env[KEY_NAME];
  if (!key) throw new Error(`${KEY_NAME} is not set.`);
  const res = await fetch(`${BASE_URL}/text-to-speech/${voice}/stream?output_format=mp3_44100_64`, {
    method: "POST",
    signal,
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: text.slice(0, MAX_SPEECH),
      model_id: MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: age >= OLDER_FROM ? 0.95 : 1 }
    })
  });
  if (!res.ok || !res.body) throw new Error(`Voice service answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.body;
}
