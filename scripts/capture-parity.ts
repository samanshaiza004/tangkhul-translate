import { Client } from "@gradio/client";
import { mkdir } from "node:fs/promises";

const ORIGINAL_SPACE_URL = "https://chormi-byt5-tang-eng.hf.space";
const ORIGINAL_SPACE_REPOSITORY = "chormi/byt5-tang-eng";
const ORIGINAL_SPACE_REVISION = "ce73094ca249a2a31cff849489b5a2367a8752da";
const CAPTURED_AT = new Date().toISOString();

type FixtureKind = "authentic_non_bible" | "bible_derived" | "transport_probe";

interface FixtureSeed {
  id: string;
  kind: FixtureKind;
  source_raw: string;
  english_gloss?: string;
}

const fixtures: FixtureSeed[] = [
  {
    id: "dual-macron",
    kind: "authentic_non_bible",
    source_raw: "Āthum rāra.",
    english_gloss: "Those two will come.",
  },
  {
    id: "where-are-you",
    kind: "bible_derived",
    source_raw: "Na kali leili?",
    english_gloss: "Where are you?",
  },
  {
    id: "serpent-negation",
    kind: "bible_derived",
    source_raw: "Kha phara̱ china sha̱nao chili hānga, “Nani mathimara.”",
    english_gloss: "But the serpent said to the woman, ‘You will not die.’",
  },
  {
    id: "brush-teeth",
    kind: "authentic_non_bible",
    source_raw: "Aha kashut haolu.",
    english_gloss: "Brush your teeth.",
  },
  {
    id: "come-and-see",
    kind: "bible_derived",
    source_raw: "Rāyanglu.",
    english_gloss: "Come and see.",
  },
  {
    id: "bethlehem-multiclause",
    kind: "bible_derived",
    source_raw:
      "Ithum Bethlehemli vāusa, kala Prohona ithumli chitheikhami shokkahai otshot chi vāyangsa.",
    english_gloss:
      "Let us go to Bethlehem and see what has happened, which the Lord has made known to us.",
  },
  {
    id: "festival-at-twelve",
    kind: "bible_derived",
    source_raw: "Jishuna kum tharāda khani kākashung eina khangachā athishurda phanitli azanga.",
    english_gloss:
      "When Jesus was twelve years old, they attended the festival according to custom.",
  },
  {
    id: "transport-multiline",
    kind: "transport_probe",
    source_raw:
      "Ithum Bethlehemli vāusa,\nkala Prohona ithumli chitheikhami shokkahai otshot chi vāyangsa.",
  },
  {
    id: "transport-four-special-characters",
    kind: "transport_probe",
    source_raw: "Ā ā A̱ a̱",
  },
  {
    id: "transport-whitespace-newline",
    kind: "transport_probe",
    source_raw: "  Āthum   rāra.\n\nNa kali leili?  ",
  },
];

function sha256(value: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest("hex");
}

async function translate(client: Client, source: string): Promise<string> {
  const job = client.submit("/translate", [source]);

  for await (const event of job) {
    if (event.type === "data") {
      const output = event.data?.[0];
      if (typeof output !== "string") {
        throw new Error(`Unexpected translation response: ${JSON.stringify(event.data)}`);
      }
      return output;
    }

    if (event.type === "status" && event.stage === "error") {
      const message =
        typeof event.message === "string" ? event.message : JSON.stringify(event.message);
      throw new Error(message || "The original Space returned an error.");
    }
  }

  throw new Error("The original Space completed without a translation.");
}

const client = await Client.connect(ORIGINAL_SPACE_URL);
const gradioVersion = client.config?.version ?? "6.20.0";
const runtimeVersions = {
  // Python and Gradio are taken from the pre-patch Hugging Face build log.
  // The remaining exact versions are filled after inspecting the rebuilt,
  // pinned copy's /runtime_versions endpoint.
  python: "3.13.14",
  torch: Bun.env.BASELINE_TORCH_VERSION ?? "2.13.0+cu130",
  transformers: Bun.env.BASELINE_TRANSFORMERS_VERSION ?? "5.14.1",
  tokenizers: Bun.env.BASELINE_TOKENIZERS_VERSION ?? "0.22.2",
  gradio: gradioVersion,
};

try {
  const captured = [];

  for (const fixture of fixtures) {
    console.log(`Capturing ${fixture.id}, run 1/2...`);
    // oxlint-disable-next-line no-await-in-loop -- provider jobs are intentionally serialized.
    const first = await translate(client, fixture.source_raw);
    console.log(`Capturing ${fixture.id}, run 2/2...`);
    // oxlint-disable-next-line no-await-in-loop -- stability runs must not overlap.
    const second = await translate(client, fixture.source_raw);

    if (first !== second) {
      throw new Error(
        `Unstable baseline for ${fixture.id}: ${JSON.stringify(first)} != ${JSON.stringify(second)}`,
      );
    }

    captured.push({
      ...fixture,
      stable_runs: 2,
      output: first,
      output_sha256: sha256(first),
      runtime_versions: runtimeVersions,
    });
  }

  await mkdir("tests/fixtures", { recursive: true });
  await Bun.write(
    "tests/fixtures/translation-parity.json",
    `${JSON.stringify(
      {
        captured_at: CAPTURED_AT,
        baseline_space: {
          visibility: "protected",
          repository: ORIGINAL_SPACE_REPOSITORY,
          revision: ORIGINAL_SPACE_REVISION,
          endpoint: "/translate",
        },
        model: {
          repository: "chormi/tangkhul-byt5",
          revision: "f21a5bcd7c358419b9a6d9ce7c68094f4046fcc6",
        },
        prompt: "translate Tangkhul to English: {source}",
        generation: {
          max_input_length: 512,
          max_new_tokens: 256,
          num_beams: 4,
          early_stopping: true,
        },
        fixtures: captured,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  client.close();
}
