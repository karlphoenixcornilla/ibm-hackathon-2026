// util/result.ts — typed Result<T, E> (no exceptions across module boundaries)

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const Result = {
  ok<T>(value: T): Result<T, never> {
    return { ok: true, value };
  },
  err<E>(error: E): Result<never, E> {
    return { ok: false, error };
  },
  isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
    return r.ok;
  },
  isErr<T, E>(r: Result<T, E>): r is { ok: false; error: E } {
    return !r.ok;
  },
  map<T, U, E>(r: Result<T, E>, fn: (v: T) => U): Result<U, E> {
    if (r.ok) return Result.ok(fn(r.value));
    return r;
  },
  mapErr<T, E, F>(r: Result<T, E>, fn: (e: E) => F): Result<T, F> {
    if (!r.ok) return Result.err(fn(r.error));
    return r;
  },
  /** Unwrap value or throw a string error as an Error. */
  unwrap<T>(r: Result<T, string>): T {
    if (r.ok) return r.value;
    throw new Error(r.error);
  },
};
