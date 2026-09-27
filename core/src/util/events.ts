// util/events.ts — minimal typed event emitter (replaces the VS Code EventEmitter)

import type { Disposable, Event } from '../contracts/events';

export class Emitter<T> {
  private listeners = new Set<(e: T) => unknown>();

  readonly event: Event<T> = (listener) => {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  };

  fire(e: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(e);
      } catch (err) {
        console.error('[Reprise] event listener threw:', err);
      }
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}

/** An event that never fires. */
export const noopEvent: Event<never> = () => NOOP_DISPOSABLE;

const NOOP_DISPOSABLE: Disposable = { dispose: () => undefined };
