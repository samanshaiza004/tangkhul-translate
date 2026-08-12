ALTER TABLE "model_versions" ADD COLUMN "prompt_template" text;
UPDATE "model_versions"
SET "prompt_template" = 'translate Tangkhul to English: {source}'
WHERE "prompt_template" IS NULL;
ALTER TABLE "model_versions" ALTER COLUMN "prompt_template" SET NOT NULL;
