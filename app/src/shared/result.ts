/** A successful {@link Result}. */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/** A failed {@link Result}. */
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/**
 * The outcome of an operation that can fail in an expected way.
 *
 * Expected failures (invalid input, a missing file) are returned as values; exceptions
 * are reserved for programming errors.
 */
export type Result<T, E = Error> = Ok<T> | Err<E>;

/**
 * Creates a successful result.
 * @param value - The value of the result.
 */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/**
 * Creates a failed result.
 * @param error - The reason for the failure.
 */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}
