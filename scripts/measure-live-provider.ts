import { GradioTranslationProvider, ProviderError } from "../src/provider";

const space = Bun.env.HF_SPACE ?? "chormi/byt5-tang-eng-frontend-demo";
const source = Bun.env.MEASURE_SOURCE ?? "Āthum rāra.";
const timeoutMs = Number(Bun.env.HF_TIMEOUT_MS ?? 180_000);
const token = Bun.env.HF_TOKEN as `hf_${string}` | undefined;
const provider = new GradioTranslationProvider({ space, token, timeoutMs });

async function timedTranslate() {
  const startedAt = performance.now();
  try {
    const output = await provider.translate(source);
    return {
      ok: true,
      latency_ms: Math.round(performance.now() - startedAt),
      output_sha256: new Bun.CryptoHasher("sha256").update(output).digest("hex"),
    };
  } catch (error) {
    return {
      ok: false,
      latency_ms: Math.round(performance.now() - startedAt),
      error_class: error instanceof Error ? error.constructor.name : typeof error,
      error_code: error instanceof ProviderError ? error.code : undefined,
    };
  }
}

console.log(
  JSON.stringify({
    measured_at: new Date().toISOString(),
    space,
    source_sha256: new Bun.CryptoHasher("sha256").update(source).digest("hex"),
    first_request: await timedTranslate(),
    warm_request: await timedTranslate(),
  }),
);
