import { describe, expect, test } from "bun:test";

import { GradioTranslationProvider, ProviderError } from "../src/provider";

type Event = {
  type: "data" | "status";
  data?: unknown[];
  stage?: "error" | "complete";
  message?: string;
};

function createJob(
  events: Event[],
  options: { delayMs?: number; onCancel?: () => void; onReturn?: () => void } = {},
) {
  let stopped = false;
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        // oxlint-disable-next-line no-await-in-loop -- this fake models an ordered event stream.
        if (options.delayMs) await Bun.sleep(options.delayMs);
        if (stopped) return;
        yield event;
      }
    },
    async cancel() {
      options.onCancel?.();
      stopped = true;
    },
    async return() {
      options.onReturn?.();
      stopped = true;
      return { done: true as const, value: undefined };
    },
  };
}

describe("GradioTranslationProvider", () => {
  test("submits to the named endpoint and preserves exact output", async () => {
    let submitted: { endpoint: string; data: unknown[] } | undefined;
    const provider = new GradioTranslationProvider({
      space: "owner/space",
      timeoutMs: 1_000,
      connect: async (reference) => {
        expect(reference).toBe("https://owner-space.hf.space");
        return {
          submit(endpoint, data) {
            submitted = { endpoint, data };
            return createJob([{ type: "data", data: ["  exact output\n"] }]);
          },
          close() {},
        };
      },
    });

    expect(await provider.translate("Āthum rāra.")).toBe("  exact output\n");
    expect(submitted).toEqual({ endpoint: "/translate", data: ["Āthum rāra."] });
  });

  test("cancels and stops consuming the job on timeout", async () => {
    let cancelled = false;
    let returned = false;
    const provider = new GradioTranslationProvider({
      space: "owner/space",
      timeoutMs: 5,
      connect: async () => ({
        submit: () =>
          createJob([{ type: "data", data: ["late"] }], {
            delayMs: 50,
            onCancel: () => (cancelled = true),
            onReturn: () => (returned = true),
          }),
        close() {},
      }),
    });

    await expect(provider.translate("source")).rejects.toMatchObject({ code: "timeout" });
    expect(cancelled).toBe(true);
    expect(returned).toBe(true);
  });

  test("invalidates and reconnects once after a schema failure", async () => {
    let connections = 0;
    const provider = new GradioTranslationProvider({
      space: "owner/private-space",
      token: "hf_test",
      timeoutMs: 1_000,
      connect: async (reference, token) => {
        connections += 1;
        expect(reference).toBe("owner/private-space");
        expect(token).toBe("hf_test");
        if (connections === 1) throw new Error("No API found");
        return {
          submit: () => createJob([{ type: "data", data: ["ready"] }]),
          close() {},
        };
      },
    });

    expect(await provider.translate("source")).toBe("ready");
    expect(connections).toBe(2);
  });

  test("maps the Space token limit signal", async () => {
    const provider = new GradioTranslationProvider({
      space: "owner/space",
      timeoutMs: 1_000,
      connect: async () => ({
        submit: () => createJob([{ type: "status", stage: "error", message: "INPUT_TOO_LONG" }]),
        close() {},
      }),
    });

    try {
      await provider.translate("source");
      throw new Error("Expected provider error");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).code).toBe("input_too_long");
    }
  });
});
