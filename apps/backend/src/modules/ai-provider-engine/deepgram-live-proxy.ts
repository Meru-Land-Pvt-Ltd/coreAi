import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { WebSocketServer, WebSocket } from "ws";
import {
  buildDeepgramLiveListenUrl,
  describeDeepgramLiveError,
  isDeepgramLiveSttModel
} from "@coreai/shared";
import { verifyAuthToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import { assertActiveSession } from "../../lib/user-session";

const LIVE_PATHS = new Set([
  "/architect/ai/deepgram/live",
  "/api/architect/ai/deepgram/live",
  "/business/setup/deepgram/live",
  "/api/business/setup/deepgram/live"
]);

async function authenticateUpgrade(req: IncomingMessage): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "/", `http://${host}`);
    const token = url.searchParams.get("token")?.trim() ?? "";
    if (!token) return { ok: false, message: "Missing auth token." };

    const payload = await verifyAuthToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, isSuspended: true }
    });
    if (!user) return { ok: false, message: "User not found." };
    if (user.isSuspended) return { ok: false, message: "Account suspended." };
    const sessionValid = await assertActiveSession(user.id, payload.sid);
    if (!sessionValid) return { ok: false, message: "Session revoked or expired." };
    return { ok: true };
  } catch {
    return { ok: false, message: "Unauthorized." };
  }
}

function readHeader(res: { headers?: Record<string, string | string[] | undefined> }, name: string): string {
  const value = res.headers?.[name] ?? res.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? "";
  return typeof value === "string" ? value : "";
}

/**
 * Attaches a WebSocket upgrade handler that proxies browser PCM audio to Deepgram
 * live listen and forwards interim/final transcripts back to the client.
 */
export function attachDeepgramLiveProxy(server: {
  on: (event: "upgrade", listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void) => void;
}): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const host = req.headers.host ?? "localhost";
    let pathname = "/";
    let search = "";
    try {
      const url = new URL(req.url ?? "/", `http://${host}`);
      pathname = url.pathname;
      search = url.search;
    } catch {
      socket.destroy();
      return;
    }

    if (!LIVE_PATHS.has(pathname)) {
      return;
    }

    void (async () => {
      const auth = await authenticateUpgrade(req);
      if (!auth.ok) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      const apiKey = process.env["DEEPGRAM_API_KEY"]?.trim();
      if (!apiKey) {
        socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (clientWs) => {
        const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
        const model = query.get("model")?.trim() || "nova-3";
        const language = query.get("language")?.trim() || "en";

        if (!isDeepgramLiveSttModel(model)) {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(
              JSON.stringify({
                type: "error",
                error: describeDeepgramLiveError("whisper", model)
              })
            );
          }
          try {
            clientWs.close();
          } catch {
            // ignore
          }
          return;
        }

        const deepgramUrl = buildDeepgramLiveListenUrl(model, language);
        const deepgramWs = new WebSocket(deepgramUrl, {
          headers: { Authorization: `Token ${apiKey}` }
        });

        let closed = false;
        let deepgramRejectReason = "";
        const sendClientError = (raw: string) => {
          if (clientWs.readyState !== WebSocket.OPEN) return;
          clientWs.send(
            JSON.stringify({
              type: "error",
              error: describeDeepgramLiveError(raw || deepgramRejectReason, model)
            })
          );
        };
        const closeBoth = () => {
          if (closed) return;
          closed = true;
          try {
            if (deepgramWs.readyState === WebSocket.OPEN) {
              deepgramWs.send(JSON.stringify({ type: "CloseStream" }));
            }
          } catch {
            // ignore
          }
          try {
            clientWs.close();
          } catch {
            // ignore
          }
          try {
            deepgramWs.close();
          } catch {
            // ignore
          }
        };

        deepgramWs.on("open", () => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: "ready" }));
          }
        });

        deepgramWs.on("unexpected-response", (_req, res) => {
          const dgError = readHeader(res, "dg-error") || readHeader(res, "DG-Error");
          const statusCode = typeof res.statusCode === "number" ? res.statusCode : 400;
          deepgramRejectReason =
            dgError.trim() || `Unexpected server response: ${statusCode}`;
          sendClientError(deepgramRejectReason);
          try {
            res.resume();
          } catch {
            // ignore
          }
          closeBoth();
        });

        deepgramWs.on("message", (data) => {
          if (clientWs.readyState !== WebSocket.OPEN) return;
          try {
            const raw = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
            const parsed = JSON.parse(raw) as {
              type?: string;
              event?: string;
              transcript?: string;
              channel?: {
                alternatives?: Array<{ transcript?: string; confidence?: number }>;
              };
              alternatives?: Array<{ transcript?: string; confidence?: number }>;
              is_final?: boolean;
              speech_final?: boolean;
              message?: string;
              description?: string;
              error?: string;
            };
            if (parsed.type === "Error" || parsed.type === "FatalError" || parsed.error) {
              sendClientError(
                parsed.message ||
                  parsed.description ||
                  parsed.error ||
                  "Deepgram live connection failed."
              );
              closeBoth();
              return;
            }

            // Gap detected — client should commit any pending interim text.
            if (parsed.type === "UtteranceEnd") {
              clientWs.send(JSON.stringify({ type: "utterance_end" }));
              return;
            }

            // Flux (/v2/listen) emits TurnInfo with cumulative turn transcript.
            if (parsed.type === "TurnInfo") {
              const transcript = (parsed.transcript ?? "").trim();
              if (!transcript) return;
              const eventName = (parsed.event ?? "").trim();
              // Only EndOfTurn is committed; EagerEndOfTurn / Update stay interim.
              const isFinal = eventName === "EndOfTurn";
              clientWs.send(
                JSON.stringify({
                  type: "transcript",
                  transcript,
                  isFinal,
                  replace: true,
                  event: eventName || undefined,
                  confidence: null
                })
              );
              return;
            }

            // Nova / enhanced / base live listen (/v1/listen) emits Results.
            if (parsed.type === "Results" || parsed.channel || parsed.alternatives) {
              const alt =
                parsed.channel?.alternatives?.[0] ?? parsed.alternatives?.[0] ?? null;
              const transcript = (alt?.transcript ?? "").trim();
              const confidence = alt?.confidence ?? null;
              if (!transcript) return;
              // Commit only on is_final. speech_final is turn-taking only and can
              // truncate phrases if treated as a transcript commit.
              clientWs.send(
                JSON.stringify({
                  type: "transcript",
                  transcript,
                  isFinal: Boolean(parsed.is_final),
                  speechFinal: Boolean(parsed.speech_final),
                  replace: false,
                  confidence
                })
              );
              return;
            }
          } catch {
            // ignore malformed Deepgram payloads
          }
        });

        deepgramWs.on("error", (err) => {
          sendClientError(err instanceof Error ? err.message : "Deepgram live connection failed.");
          closeBoth();
        });

        deepgramWs.on("close", () => closeBoth());

        clientWs.on("message", (data, isBinary) => {
          if (deepgramWs.readyState !== WebSocket.OPEN) return;
          const isAudioChunk =
            isBinary ||
            Buffer.isBuffer(data) ||
            data instanceof ArrayBuffer ||
            ArrayBuffer.isView(data);
          if (isAudioChunk) {
            deepgramWs.send(data, { binary: true });
            return;
          }
          const text = String(data);
          if (text === "close" || text.includes("CloseStream")) {
            closeBoth();
            return;
          }
          // Forward KeepAlive / control JSON to Deepgram.
          if (text.includes("KeepAlive")) {
            deepgramWs.send(text);
          }
        });

        clientWs.on("close", () => closeBoth());
        clientWs.on("error", () => closeBoth());
      });
    })();
  });
}
