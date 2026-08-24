import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import postgres from "postgres";

import { parseEnv } from "../src/config";
import { postgresOptions } from "../src/db";
import {
  BENCHMARK_EXCLUSION_PATH,
  normalizeTargetForDedup,
  readExclusionList,
} from "../src/export";

interface Candidate {
  id: string;
  source: string;
  sourceNormalized: string;
  sourceHash: string;
  target: string;
  modelOutput: string;
  modelRepository: string;
  modelRevision: string;
  spaceRepository: string;
  spaceRevision: string;
  promptVersion: string;
  promptTemplate: string;
  generationConfig: unknown;
  provenance: "public_correction";
  domain: string | null;
  contributorTags: string[];
  reviewTags: string[];
  severity: string | null;
  qualityTier: "single_review";
  consentVersion: string;
  createdAt: string;
}

interface RawCandidate {
  id: string;
  source_raw: string;
  source_normalized: string;
  source_hash: string;
  target: string;
  model_output: string;
  model_repository: string;
  model_revision: string;
  space_repository: string;
  space_revision: string;
  prompt_version: string;
  prompt_template: string;
  generation_config: unknown;
  domain: string | null;
  contributor_tags: string[];
  review_tags: string[];
  severity: string | null;
  consent_version: string;
  created_at: Date | string;
}

function decodeCandidate(row: RawCandidate): Candidate {
  return {
    id: row.id,
    source: row.source_raw,
    sourceNormalized: row.source_normalized,
    sourceHash: row.source_hash,
    target: row.target,
    modelOutput: row.model_output,
    modelRepository: row.model_repository,
    modelRevision: row.model_revision,
    spaceRepository: row.space_repository,
    spaceRevision: row.space_revision,
    promptVersion: row.prompt_version,
    promptTemplate: row.prompt_template,
    generationConfig: row.generation_config,
    provenance: "public_correction",
    domain: row.domain,
    contributorTags: row.contributor_tags,
    reviewTags: row.review_tags,
    severity: row.severity,
    qualityTier: "single_review",
    consentVersion: row.consent_version,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

function arg(name: string): string | undefined {
  const index = Bun.argv.indexOf(name);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

function canonicalRecord(candidate: Candidate): Record<string, unknown> {
  return {
    id: candidate.id,
    source: candidate.source,
    target: candidate.target,
    model_output: candidate.modelOutput,
    model_repository: candidate.modelRepository,
    model_revision: candidate.modelRevision,
    space_repository: candidate.spaceRepository,
    space_revision: candidate.spaceRevision,
    prompt_version: candidate.promptVersion,
    prompt_template: candidate.promptTemplate,
    generation_config: candidate.generationConfig,
    provenance: candidate.provenance,
    domain: candidate.domain,
    contributor_tags: [...candidate.contributorTags].toSorted(),
    review_tags: [...candidate.reviewTags].toSorted(),
    severity: candidate.severity,
    quality_tier: candidate.qualityTier,
    consent_version: candidate.consentVersion,
    created_at: candidate.createdAt,
  };
}

function normalizeJson(input: unknown, depth: number): unknown {
  if (Array.isArray(input)) return input.map((item) => normalizeJson(item, depth + 1));
  if (input instanceof Date) return input.toISOString();
  if (input && typeof input === "object") {
    const object = input as Record<string, unknown>;
    const keys = Object.keys(object);
    const orderedKeys = depth === 0 ? keys : keys.toSorted();
    return Object.fromEntries(
      orderedKeys.map((key) => [key, normalizeJson(object[key], depth + 1)]),
    );
  }
  return input;
}

function stableJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value, 0));
}

function countValues(values: Array<string | null>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = value ?? "(none)";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).toSorted(([a], [b]) => a.localeCompare(b)));
}

function countTags(values: string[][]): Record<string, number> {
  return countValues(values.flat());
}

async function git(...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`);
  return stdout.trim();
}

async function main(): Promise<void> {
  const version = arg("--version");
  if (!version || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version)) {
    throw new Error("Usage: bun run dataset:export --version <version> [--allow-dirty]");
  }
  const allowDirty = Bun.argv.includes("--allow-dirty");
  const reviewerRef = Bun.env.REVIEWER_ID?.trim();
  if (!reviewerRef) throw new Error("REVIEWER_ID is required for dataset exports.");
  const root = resolve(import.meta.dir, "..");
  const outputRoot = join(root, "exports");
  const finalDir = join(outputRoot, version);
  try {
    await access(finalDir);
    throw new Error(`Export directory already exists: ${finalDir}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const gitCommit = await git("rev-parse", "HEAD");
  const dirty = (await git("status", "--porcelain")).length > 0;
  if (dirty && !allowDirty)
    throw new Error("Refusing export from a dirty worktree; use --allow-dirty for development.");
  const journalBytes = await readFile(join(root, "drizzle/meta/_journal.json"));
  const journalSha256 = createHash("sha256").update(journalBytes).digest("hex");
  const exclusions = await readExclusionList(root);
  const config = parseEnv(Bun.env);
  const sql = postgres(
    config.databaseUrl,
    postgresOptions(config.databaseUrl, config.nodeEnv, { max: 1 }),
  );
  const tempDir = join(outputRoot, `.${version}.tmp-${process.pid}-${crypto.randomUUID()}`);
  const exportedAt = Bun.env.EXPORT_TIMESTAMP ?? new Date().toISOString();

  try {
    await mkdir(outputRoot, { recursive: true });
    await sql.begin(async (tx) => {
      await tx`set transaction isolation level repeatable read`;
      const existing = await tx`select 1 from dataset_exports where version = ${version} limit 1`;
      if (existing.length > 0)
        throw new Error(`Export version already exists in database: ${version}`);

      const migrations = await tx`
        select hash, created_at
        from drizzle.__drizzle_migrations
        order by created_at asc, hash asc
      `;
      const acceptedRows = await tx<RawCandidate[]>`
        select
          f.id,
          i.source_raw,
          i.source_normalized,
          i.source_hash,
          r.final_translation as target,
          i.model_output,
          mv.model_repository,
          mv.model_revision,
          mv.space_repository,
          mv.space_revision,
          mv.prompt_version,
          mv.prompt_template,
          mv.generation_config,
          r.domain,
          r.severity,
          f.consent_version,
          f.created_at,
          (select coalesce(jsonb_agg(ft.tag order by ft.tag), '[]'::jsonb) from feedback_tags ft where ft.feedback_id = f.id) as contributor_tags,
          (select coalesce(jsonb_agg(rt.tag order by rt.tag), '[]'::jsonb) from review_tags rt where rt.review_id = r.id) as review_tags
        from feedback f
        join inferences i on i.id = f.inference_id
        join model_versions mv on mv.id = i.model_version_id
        join reviews r on r.feedback_id = f.id and r.decision in ('accept', 'edit_accept')
        where f.verdict = 'incorrect' and f.status = 'accepted'
          and r.final_translation is not null and length(btrim(r.final_translation)) > 0
          and f.consent_version = 'contribution-v1'
          and (select count(*) from reviews rx where rx.feedback_id = f.id and rx.decision in ('accept', 'edit_accept')) = 1
        order by i.source_normalized asc, f.id asc
      `;
      const accepted = acceptedRows.map(decodeCandidate);
      const cardinalityViolations = await tx`
        select f.id, count(r.id)::int as terminal_count
        from feedback f
        left join reviews r on r.feedback_id = f.id and r.decision in ('accept', 'edit_accept')
        where f.status = 'accepted'
        group by f.id
        having count(r.id) <> 1
      `;
      if (cardinalityViolations.length > 0) {
        throw new Error(
          `Accepted feedback has invalid terminal review cardinality: ${JSON.stringify(cardinalityViolations)}`,
        );
      }

      const candidates = accepted
        .toSorted((a, b) => {
          const source = a.sourceNormalized.localeCompare(b.sourceNormalized);
          if (source !== 0) return source;
          const target = normalizeTargetForDedup(a.target).localeCompare(
            normalizeTargetForDedup(b.target),
          );
          return target !== 0 ? target : a.id.localeCompare(b.id);
        })
        .filter((candidate) => !exclusions.hashes.has(candidate.sourceHash));
      const deduped: Candidate[] = [];
      const seen = new Set<string>();
      for (const candidate of candidates) {
        const key = JSON.stringify([
          candidate.sourceNormalized,
          normalizeTargetForDedup(candidate.target),
        ]);
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(candidate);
      }
      const records = deduped.map(canonicalRecord);
      const jsonl = records.map((record) => `${stableJson(record)}\n`).join("");
      const jsonlSha256 = createHash("sha256").update(jsonl).digest("hex");
      const manifest = {
        version,
        exported_at: exportedAt,
        record_count: records.length,
        selection: {
          verdict: "incorrect",
          status: "accepted",
          terminal_review_count: 1,
          consent_versions: ["contribution-v1"],
        },
        deduplication: {
          key: "[source_normalized, target_dedup_normalized]",
          target_dedup_normalization: "NFC; CRLF/CR to LF; outer trim; no lowercase",
          removed_count: candidates.length - deduped.length,
        },
        benchmark_exclusions: {
          version: exclusions.version,
          path: BENCHMARK_EXCLUSION_PATH,
          sha256: exclusions.sha256,
          count: exclusions.hashes.size,
          removed_count: accepted.length - candidates.length,
        },
        distributions: {
          domains: countValues(deduped.map((candidate) => candidate.domain)),
          severities: countValues(deduped.map((candidate) => candidate.severity)),
          contributor_tags: countTags(deduped.map((candidate) => candidate.contributorTags)),
          review_tags: countTags(deduped.map((candidate) => candidate.reviewTags)),
          model_revisions: countValues(deduped.map((candidate) => candidate.modelRevision)),
          space_revisions: countValues(deduped.map((candidate) => candidate.spaceRevision)),
          consent_versions: countValues(deduped.map((candidate) => candidate.consentVersion)),
        },
        provenance: {
          git_commit: gitCommit,
          git_dirty: dirty,
          migration_journal_sha256: journalSha256,
          applied_migrations: migrations,
        },
        jsonl_sha256: jsonlSha256,
      };
      const manifestText = `${stableJson(manifest)}\n`;
      const checksums = `${jsonlSha256}  accepted.jsonl\n${createHash("sha256").update(manifestText).digest("hex")}  manifest.json\n`;
      await mkdir(tempDir, { recursive: true });
      await writeFile(join(tempDir, "accepted.jsonl"), jsonl);
      await writeFile(join(tempDir, "manifest.json"), manifestText);
      await writeFile(join(tempDir, "checksums.txt"), checksums);
      await rename(tempDir, finalDir);
      try {
        await tx`
          insert into dataset_exports (version, reviewer_ref, selection_rules, record_count, manifest, checksum)
          values (${version}, ${reviewerRef}, ${JSON.stringify(manifest.selection)}::jsonb, ${records.length}, ${JSON.stringify(manifest)}::jsonb, ${jsonlSha256})
        `;
      } catch (error) {
        throw new Error(
          `ORPHANED_EXPORT:${finalDir}: database insert failed after artifact rename: ${String(error)}`,
          { cause: error },
        );
      }
    });
    console.log(`Exported ${version} (${finalDir}).`);
  } catch (error) {
    if (String(error).includes("ORPHANED_EXPORT:")) throw error;
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  } finally {
    await sql.end();
  }
}

await main();
