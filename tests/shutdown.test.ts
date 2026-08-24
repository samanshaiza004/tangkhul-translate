import { expect, test } from "bun:test";

import { createShutdownHandler } from "../src/shutdown";

test("shuts down the server before the database and is idempotent", async () => {
  const events: string[] = [];
  let completeCalls = 0;
  const shutdown = createShutdownHandler({
    stopServer: async () => {
      events.push("server");
    },
    closeDatabase: async () => {
      events.push("database");
    },
    onComplete: (timedOut) => {
      completeCalls += 1;
      expect(timedOut).toBeFalse();
    },
  });

  await Promise.all([shutdown(), shutdown()]);
  expect(events).toEqual(["server", "database"]);
  expect(completeCalls).toBe(1);
});

test("bounds a stuck dependency", async () => {
  let timedOut = false;
  const shutdown = createShutdownHandler({
    stopServer: () => new Promise<void>(() => {}),
    closeDatabase: () => {},
    timeoutMs: 5,
    onComplete: (didTimeOut) => {
      timedOut = didTimeOut;
    },
  });

  await shutdown();
  expect(timedOut).toBeTrue();
});
