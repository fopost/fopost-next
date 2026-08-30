import { FoPostError } from '@fopost/sdk';

/**
 * A plain-object error. Server Action return values cross the RSC boundary and are
 * serialized, so an SDK `FoPostError` instance must never be returned or thrown
 * through one — its class identity and prototype do not survive the trip.
 */
export interface FoPostSerializableError {
  message: string;
  /** HTTP status, or `null` for a transport or configuration failure. */
  status: number | null;
  /** Machine-readable code from the API error envelope, when present. */
  code: string | null;
}

export type FoPostActionResult<T> =
  { ok: true; data: T } | { ok: false; error: FoPostSerializableError };

/** Narrows an unknown thrown value into a structured-cloneable error object. */
export function toSerializableError(err: unknown): FoPostSerializableError {
  if (err instanceof FoPostError) {
    return {
      message: err.message,
      status: typeof err.status === 'number' ? err.status : null,
      code: err.code ?? null,
    };
  }
  if (err instanceof Error) {
    return { message: err.message, status: null, code: err.name };
  }
  return { message: String(err), status: null, code: null };
}
