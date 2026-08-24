export interface ShutdownOptions {
  stopServer: () => Promise<void> | void;
  closeDatabase: () => Promise<void> | void;
  timeoutMs?: number;
  onComplete?: (timedOut: boolean) => void;
}

export function createShutdownHandler({
  stopServer,
  closeDatabase,
  timeoutMs = 10_000,
  onComplete,
}: ShutdownOptions): () => Promise<void> {
  let shutdownPromise: Promise<void> | undefined;

  return () => {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      try {
        const cleanup = (async () => {
          await stopServer();
          await closeDatabase();
        })();
        await Promise.race([
          cleanup,
          new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              timedOut = true;
              resolve();
            }, timeoutMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
        onComplete?.(timedOut);
      }
    })();

    return shutdownPromise;
  };
}
