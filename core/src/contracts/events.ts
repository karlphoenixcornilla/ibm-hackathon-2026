// contracts/events.ts — Event, Disposable, CancellationToken
// Local replacements for the VS Code API types of the same name, so core has no editor dependency.
// The shapes match VS Code's, so an editor host could pass its own tokens/events straight through.

export interface Disposable {
  dispose(): void;
}

/** Subscribe a listener; dispose the result to unsubscribe. */
export type Event<T> = (listener: (e: T) => unknown) => Disposable;

/**
 * Cooperative cancellation signal passed down the pipeline.
 * Create one from an AbortSignal with `fromAbortSignal` (util/cancellation).
 */
export interface CancellationToken {
  readonly isCancellationRequested: boolean;
  readonly onCancellationRequested: Event<void>;
}
