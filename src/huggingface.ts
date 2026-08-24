export interface SpaceMetadata {
  sha?: unknown;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function fetchSpaceRevision(
  repository: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 5_000,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`https://huggingface.co/api/spaces/${repository}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Hugging Face Space metadata request failed (${response.status}).`);
    }
    const metadata = (await response.json()) as SpaceMetadata;
    if (typeof metadata.sha !== "string" || metadata.sha.length === 0) {
      throw new Error("Hugging Face Space metadata did not include a revision SHA.");
    }
    return metadata.sha;
  } finally {
    clearTimeout(timeout);
  }
}

export async function assertSpaceRevision(
  repository: string,
  expectedRevision: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 5_000,
): Promise<void> {
  const currentRevision = await fetchSpaceRevision(repository, fetchImpl, timeoutMs);
  if (currentRevision !== expectedRevision) {
    throw new Error(
      `Configured HF Space ${repository} is at ${currentRevision}, expected active revision ${expectedRevision}.`,
    );
  }
}
