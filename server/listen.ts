// Live listening: the browser streams microphone audio here and gets the words back as they are spoken.
// The socket to the transcription service stays on the server, because the key must never reach the browser.
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { liveTranscribe } from "./gateway.ts";
import { allow, clientIp, LIMITS } from "./limits.ts";
import { getSession } from "./session.ts";

const MAX_FRAME = 16_000;   // bytes: half a second of audio, far more than the browser sends at once
const open = new Map<string, WebSocket>();   // one microphone per session

export function attachListen(server: Server) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const id = new URL(req.url ?? "/", "http://localhost").pathname.match(/^\/api\/sessions\/([\w-]+)\/listen$/)?.[1];
    if (!id || !getSession(id) || !allow(clientIp(req), "listen", LIMITS.listenPerMinute, 60_000)) { socket.destroy(); return; }
    sockets.handleUpgrade(req, socket, head, client => {
      open.get(id)?.close();
      open.set(id, client);
      const tell = (message: object) => { if (client.readyState === client.OPEN) client.send(JSON.stringify(message)); };
      let live: ReturnType<typeof liveTranscribe>;
      try {
        live = liveTranscribe({ ready: () => tell({ type: "ready" }), event: tell, closed: () => client.close() });
      } catch (e) {
        console.error(e);
        client.close();
        return;
      }
      client.on("message", (data, binary) => { if (binary) live.send(new Uint8Array(data as Buffer)); });
      client.on("error", e => console.error("Listening socket:", e.message));
      client.on("close", () => {
        if (open.get(id) === client) open.delete(id);
        live.close();
      });
    });
  });
}
