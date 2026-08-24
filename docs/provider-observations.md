# Hugging Face provider observations

These observations are operational measurements, not model fixtures. They do not change the
recorded model or decoding configuration.

## 2026-08-24

- Space: `chormi/byt5-tang-eng-frontend-demo`
- Space revision: `d7d4df9016e6260f243b563b8114d8c8cd3c18b5`
- Metadata state at measurement: `PAUSED`; requested hardware `cpu-basic`
- Public app probe: HTTP 503
- First provider request: unavailable after 391 ms
- Second provider request: unavailable after 80 ms
- Repeated measurement: unavailable after 292 ms, then 77 ms

The free Space did not wake during this observation, so there is no valid warm/cold translation
latency to use for a hardware decision. Do not purchase upgraded Hugging Face hardware based on
this result. After an operator resumes the Space, run:

```sh
bun run measure:provider
```

and append the first-request latency, warm-request latency, timeout behavior, and availability
result here. The production process remains configured to fail closed on a Space provenance or
availability failure.

