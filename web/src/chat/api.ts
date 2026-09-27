import type { ChatEvent } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function fail(res: Response): Promise<never> {
  const body = await res.json().catch(() => null);
  throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status);
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) await fail(res);
  return res.json();
}

export async function postJson<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await fail(res);
  return res.json();
}

/**
 * Reads the server's SSE stream (fetch, since EventSource can't POST). Resolves when the
 * stream ends; returns false if there was nothing to stream (204).
 */
export async function streamEvents(
  path: string,
  init: RequestInit,
  onEvent: (e: ChatEvent) => void,
): Promise<boolean> {
  const res = await fetch(path, { ...init, headers: { Accept: "text/event-stream", ...init.headers } });
  if (res.status === 204) return false;
  if (!res.ok || !res.body) await fail(res);
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as ChatEvent);
      } catch {
        // ignore malformed frame
      }
    }
  }
  return true;
}
