/** Host-independent lifecycle primitives used by the application core. */
export interface Disposable { dispose(): void; }
export type Event<T> = (listener: (event: T) => unknown) => Disposable;
export interface CancellationToken {
  readonly isCancellationRequested: boolean;
  readonly onCancellationRequested: Event<unknown>;
}
export class EventEmitter<T> implements Disposable {
  private listeners = new Set<(event: T) => unknown>();
  readonly event: Event<T> = listener => {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  };
  fire(event: T): void { for (const listener of [...this.listeners]) listener(event); }
  dispose(): void { this.listeners.clear(); }
}
