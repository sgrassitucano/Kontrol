type ErrorPayload = {
  error?: unknown;
  message?: unknown;
};

export async function readJsonSafely<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function extractResponseError(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;

  const { error, message } = body as ErrorPayload;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (typeof message === "string" && message.trim()) return message.trim();
  return null;
}

export function buildHttpErrorMessage(response: Response, body: unknown, fallback: string) {
  return extractResponseError(body) ?? `${fallback} (${response.status}).`;
}
