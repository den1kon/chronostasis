// Bound both fetch/body reads and SDK calls that cannot honor an abort signal.
export async function withSyncDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  caller?: AbortSignal,
): Promise<T> {
  caller?.throwIfAborted();
  const timeout = new AbortController();
  const signal = caller
    ? AbortSignal.any([caller, timeout.signal])
    : timeout.signal;
  const timer = setTimeout(() => {
    timeout.abort(new DOMException('Sync timed out.', 'TimeoutError'));
  }, 15_000);
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      onAbort = () => {
        reject(
          new Error('Sync request cancelled.', {
            cause: signal.reason as unknown,
          }),
        );
      };
      signal.addEventListener('abort', onAbort, {once: true});
      void run(signal).then(resolve, reject);
    });
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}
