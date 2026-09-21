/** Thrown by `api()`. `message` is always fit to show to the user; `status` is 0 when the server was unreachable. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Dispatched on window when any request finds the session gone (expired, signed out elsewhere, server restarted). */
export const UNAUTHORIZED_EVENT = "prelegal:unauthorized";

const GENERIC = "Something went wrong. Please try again.";

/**
 * A JSON request to the backend (same origin, so the session cookie goes along). Resolves to the parsed body,
 * or to undefined for 204. Rejects with an ApiError whose message comes from the server when it gave one.
 */
export async function api<T = void>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const hasBody = options.body !== undefined;
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers: hasBody ? { "Content-Type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Could not reach the server. Check your connection and try again.");
  }

  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    throw new ApiError(
      response.status,
      typeof body?.detail === "string"
        ? body.detail
        : response.status === 422
          ? "Please check the details and try again."
          : GENERIC,
    );
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}
