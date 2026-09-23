import { env } from "./env";
import { getIdToken } from "./auth";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

type ApiOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  requireAuth?: boolean;
};

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const url = `${env.apiUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (opts.requireAuth !== false) {
    const token = await getIdToken();
    if (!token) throw new ApiError(401, "not-signed-in", null);
    headers["authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(url, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  });
  const text = await res.text();
  const parsed: unknown = text ? safeParse(text) : null;
  if (!res.ok) {
    const message = extractMessage(parsed) ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, message, parsed);
  }
  return parsed as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractMessage(body: unknown): string | null {
  if (body && typeof body === "object") {
    const b = body as { error?: string; message?: string };
    return b.error ?? b.message ?? null;
  }
  return null;
}
