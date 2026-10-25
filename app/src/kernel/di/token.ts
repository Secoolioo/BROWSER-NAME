/**
 * Identifies a service in the `Container`. The type parameter carries the type of
 * the service, so `resolve(token)` is typed without casts.
 */
export interface Token<T> {
  /** Unique identity of the token. */
  readonly id: symbol;
  /** Human-readable name used in error messages and diagnostics. */
  readonly name: string;
  /**
   * Never set at runtime; only binds the service type to the token.
   * @internal
   */
  readonly type?: T;
}

/** The service type a {@link Token} stands for. */
export type TokenType<K> = K extends Token<infer T> ? T : never;

/** Maps a tuple of tokens to the tuple of their service types. */
export type TokenTypes<K extends readonly Token<unknown>[]> = {
  readonly [I in keyof K]: TokenType<K[I]>;
};

/**
 * Creates a new token. Two calls with the same name create two different tokens.
 * @param name - Name for diagnostics, conventionally the interface name.
 * @returns A frozen token.
 */
export function token<T>(name: string): Token<T> {
  return Object.freeze({ id: Symbol(name), name });
}
