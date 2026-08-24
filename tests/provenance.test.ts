import { expect, test } from "bun:test";

import { assertSpaceRevision, fetchSpaceRevision } from "../src/huggingface";

test("reads the deployed Space revision from Hugging Face metadata", async () => {
  const revision = await fetchSpaceRevision(
    "owner/space",
    async () => new Response(JSON.stringify({ sha: "abc123" }), { status: 200 }),
  );

  expect(revision).toBe("abc123");
});

test("fails closed when the deployed Space revision differs", async () => {
  await expect(
    assertSpaceRevision(
      "owner/space",
      "expected",
      async () => new Response(JSON.stringify({ sha: "deployed" }), { status: 200 }),
    ),
  ).rejects.toThrow("expected active revision expected");
});
