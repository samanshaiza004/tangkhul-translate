INSERT INTO "model_versions"
  (id, model_repository, model_revision, space_repository, space_revision,
   prompt_version, generation_config, active)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'chormi/tangkhul-byt5',
  'f21a5bcd7c358419b9a6d9ce7c68094f4046fcc6',
  'chormi/byt5-tang-eng',
  'unknown',
  'p0-placeholder',
  '{"prefix":"translate Tangkhul to English: ","max_input_length":512,"max_new_tokens":256,"num_beams":4,"early_stopping":true}'::jsonb,
  false
)
ON CONFLICT (id) DO NOTHING;