UPDATE "model_versions"
SET "active" = false
WHERE "active" = true;

INSERT INTO "model_versions"
  (id, model_repository, model_revision, space_repository, space_revision,
   prompt_version, prompt_template, generation_config, active)
VALUES (
  '00000000-0000-4000-8000-000000000002',
  'chormi/tangkhul-byt5',
  'f21a5bcd7c358419b9a6d9ce7c68094f4046fcc6',
  'chormi/byt5-tang-eng-frontend-demo',
  'd7d4df9016e6260f243b563b8114d8c8cd3c18b5',
  'p1-translate-tangkhul-en',
  'translate Tangkhul to English: {source}',
  '{"prefix":"translate Tangkhul to English: ","prompt_template":"translate Tangkhul to English: {source}","max_input_length":512,"max_new_tokens":256,"num_beams":4,"early_stopping":true,"runtime_versions":{"python":"3.13.14","torch":"2.13.0+cu130","transformers":"5.14.1","tokenizers":"0.22.2","gradio":"6.20.0"}}'::jsonb,
  true
)
ON CONFLICT (id) DO UPDATE SET
  model_revision = excluded.model_revision,
  space_revision = excluded.space_revision,
  prompt_version = excluded.prompt_version,
  prompt_template = excluded.prompt_template,
  generation_config = excluded.generation_config,
  active = excluded.active;
