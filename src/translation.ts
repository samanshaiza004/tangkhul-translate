import { eq } from "drizzle-orm";

import type { createDbClient } from "./db";
import { NORMALIZATION_VERSION, normalizeSource, sourceHash } from "./normalization";
import type { TranslationProvider } from "./provider";
import { inferences, modelVersions } from "./schema";

type Database = ReturnType<typeof createDbClient>["db"];

export interface TranslationResult {
  inferenceId: string;
  output: string;
}

export class TranslationInputError extends Error {
  constructor(readonly code: "empty_source") {
    super("Enter Tangkhul text to translate.");
    this.name = "TranslationInputError";
  }
}

export interface Translator {
  translate(sourceRaw: string): Promise<TranslationResult>;
}

export function createTranslator(
  db: Database,
  provider: TranslationProvider,
  options: { expectedSpaceRepository?: string } = {},
): Translator {
  return {
    async translate(sourceRaw) {
      const sourceNormalized = normalizeSource(sourceRaw);
      if (sourceNormalized.length === 0) {
        throw new TranslationInputError("empty_source");
      }

      const activeVersions = await db
        .select({ id: modelVersions.id, spaceRepository: modelVersions.spaceRepository })
        .from(modelVersions)
        .where(eq(modelVersions.active, true))
        .limit(2);

      if (activeVersions.length !== 1) {
        throw new Error(
          `Expected exactly one active model version, found ${activeVersions.length}.`,
        );
      }

      if (options.expectedSpaceRepository !== undefined) {
        if (activeVersions[0]!.spaceRepository !== options.expectedSpaceRepository) {
          throw new Error(
            `Configured HF_SPACE ${options.expectedSpaceRepository} does not match active model Space ${activeVersions[0]!.spaceRepository}.`,
          );
        }
      }

      const startedAt = performance.now();
      const output = await provider.translate(sourceNormalized);
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));

      const [stored] = await db
        .insert(inferences)
        .values({
          sourceRaw,
          sourceNormalized,
          sourceHash: sourceHash(sourceRaw),
          normalizationVersion: NORMALIZATION_VERSION,
          modelOutput: output,
          modelVersionId: activeVersions[0]!.id,
          latencyMs,
        })
        .returning({ id: inferences.id });

      if (!stored) throw new Error("The inference was not persisted.");
      return { inferenceId: stored.id, output };
    },
  };
}
