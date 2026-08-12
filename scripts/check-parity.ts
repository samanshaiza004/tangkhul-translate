import { GradioTranslationProvider } from "../src/provider";

interface ParityFixture {
  id: string;
  source_raw: string;
  output: string;
  output_sha256: string;
}

interface ParityFile {
  fixtures: ParityFixture[];
}

function sha256(value: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest("hex");
}

const fixture = (await Bun.file("tests/fixtures/translation-parity.json").json()) as ParityFile;
const space = Bun.env.HF_SPACE ?? "chormi/byt5-tang-eng-frontend-demo";
const rawToken = Bun.env.HF_TOKEN;
if (rawToken && !rawToken.startsWith("hf_")) throw new Error("HF_TOKEN must start with hf_.");

const provider = new GradioTranslationProvider({
  space,
  token: rawToken as `hf_${string}` | undefined,
  timeoutMs: Number(Bun.env.HF_TIMEOUT_MS ?? 180_000),
});

let failed = false;
for (const testCase of fixture.fixtures) {
  // oxlint-disable-next-line no-await-in-loop -- keep load deterministic on the free Space queue.
  const output = await provider.translate(testCase.source_raw);
  const checksum = sha256(output);
  if (output !== testCase.output || checksum !== testCase.output_sha256) {
    failed = true;
    console.error(
      `${testCase.id}: parity mismatch\nexpected ${JSON.stringify(testCase.output)}\nactual   ${JSON.stringify(output)}`,
    );
  } else {
    console.log(`${testCase.id}: OK`);
  }
}

if (failed) process.exitCode = 1;
