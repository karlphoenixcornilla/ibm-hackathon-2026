// api/sse.ts — read a text/event-stream body one event at a time (browser-safe).
// Unlike EventSource this works with fetch (so it can send headers such as the runner's
// Authorization) and awaits each handler before reading the next event, which is what
// lets relay requests be processed strictly in order.

/**
 * Call `onData` with each event's data (multi-line data joined with "\n"). Comment lines
 * (": ping") are skipped. Return `false` from the handler to stop reading.
 */
export async function readSse(
  body: ReadableStream<Uint8Array>,
  onData: (data: string) => unknown,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) { return; }
      buf += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, end);
        buf = buf.slice(end + 2);
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n');
        if (data && (await onData(data)) === false) {
          await reader.cancel();
          return;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
