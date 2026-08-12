import { describe, expect, test } from "bun:test";

import { createRateLimiter, hashClientKey } from "../src/ratelimit";

describe("createRateLimiter", () => {
  test("allows exactly capacity calls before rejecting a key", () => {
    const limiter = createRateLimiter({ capacity: 3, refillPerSec: 1, now: () => 0 });

    expect(limiter.take("client-a")).toBeTrue();
    expect(limiter.take("client-a")).toBeTrue();
    expect(limiter.take("client-a")).toBeTrue();
    expect(limiter.take("client-a")).toBeFalse();
  });

  test("allows a key again after a full refill", () => {
    let currentTime = 0;
    const capacity = 3;
    const refillPerSec = 0.5;
    const limiter = createRateLimiter({
      capacity,
      refillPerSec,
      now: () => currentTime,
    });

    for (let index = 0; index < capacity; index += 1) {
      expect(limiter.take("client-a")).toBeTrue();
    }
    expect(limiter.take("client-a")).toBeFalse();

    currentTime += (capacity / refillPerSec) * 1000;

    expect(limiter.take("client-a")).toBeTrue();
  });

  test("keeps buckets independent by key", () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSec: 1, now: () => 0 });

    expect(limiter.take("client-a")).toBeTrue();
    expect(limiter.take("client-a")).toBeFalse();
    expect(limiter.take("client-b")).toBeTrue();
  });
});

describe("hashClientKey", () => {
  test("is deterministic, fixed-length hexadecimal, and distinct by input", () => {
    const first = hashClientKey("192.0.2.1");
    const repeated = hashClientKey("192.0.2.1");
    const second = hashClientKey("198.51.100.2");

    expect(first).toBe(repeated);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
  });

  test("never returns the raw input", () => {
    const rawKey = "203.0.113.3";

    expect(hashClientKey(rawKey)).not.toBe(rawKey);
  });
});
