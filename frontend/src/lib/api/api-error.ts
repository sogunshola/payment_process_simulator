export class ApiError extends Error {
  status: number;
  fieldErrors: Record<string, string>;
  details: unknown;
  requestId?: string;

  constructor(
    status: number,
    message: string,
    opts: { fieldErrors?: Record<string, string>; details?: unknown; requestId?: string } = {},
  ) {
    super(message);
    // Restores the prototype chain so `instanceof ApiError` works however the code is compiled.
    Object.setPrototypeOf(this, ApiError.prototype);
    this.name = 'ApiError';
    this.status = status;
    this.fieldErrors = opts.fieldErrors ?? {};
    this.details = opts.details ?? null;
    this.requestId = opts.requestId;
  }
}

function fallbackMessage(status: number): string {
  if (status === 0) return 'Cannot reach the API';
  if (status === 401) return 'Missing or invalid API key';
  if (status === 429) return 'Too many requests, try again shortly';
  if (status >= 500) return 'The server had a problem. Try again shortly';
  return `Request failed (${status})`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Maps any response body to an ApiError. Never throws: error handling code that
 * itself crashes (e.g. on a proxy's HTML 502 page) would hide the real failure.
 */
export function toApiError(status: number, body: unknown): ApiError {
  if (!isRecord(body)) return new ApiError(status, fallbackMessage(status));

  const message =
    typeof body.message === 'string' && body.message.trim() ? body.message : fallbackMessage(status);
  const requestId = typeof body.requestId === 'string' ? body.requestId : undefined;
  const details = body.details ?? null;

  const grouped: Record<string, string[]> = {};
  if (Array.isArray(details)) {
    for (const item of details) {
      if (isRecord(item) && typeof item.field === 'string' && typeof item.message === 'string') {
        (grouped[item.field] ??= []).push(item.message);
      }
    }
  }
  const fieldErrors: Record<string, string> = {};
  for (const [field, messages] of Object.entries(grouped)) fieldErrors[field] = messages.join('; ');

  return new ApiError(status, message, { fieldErrors, details, requestId });
}
