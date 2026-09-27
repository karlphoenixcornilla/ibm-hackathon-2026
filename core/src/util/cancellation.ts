// util/cancellation.ts — AbortSignal-backed CancellationToken helpers

import type { CancellationToken, Disposable } from '../contracts/events';
import { noopEvent } from './events';

/** A token that is never cancelled. */
export const neverCancelled: CancellationToken = Object.freeze({
  isCancellationRequested: false,
  onCancellationRequested: noopEvent,
});

/** Adapt a standard AbortSignal (e.g. from an HTTP request) into a CancellationToken. */
export function fromAbortSignal(signal: AbortSignal): CancellationToken {
  return {
    get isCancellationRequested() { return signal.aborted; },
    onCancellationRequested: (listener): Disposable => {
      if (signal.aborted) {
        queueMicrotask(() => listener(undefined));
        return { dispose: () => undefined };
      }
      const handler = () => listener(undefined);
      signal.addEventListener('abort', handler, { once: true });
      return { dispose: () => signal.removeEventListener('abort', handler) };
    },
  };
}

/** Owns an AbortController and exposes it as a CancellationToken. */
export class CancellationTokenSource {
  private readonly controller = new AbortController();
  readonly token: CancellationToken = fromAbortSignal(this.controller.signal);

  get signal(): AbortSignal { return this.controller.signal; }

  cancel(): void { this.controller.abort(); }
}
