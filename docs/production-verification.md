# Production verification checklist

Run this against the deployed HTTPS host, not only `app.handle()` or localhost.

## HTTP and persistence

- [ ] `/healthz` returns 200 without external dependency work.
- [ ] `/readyz` returns 200 only after database and HF provenance checks pass.
- [ ] HTTPS certificate and redirect are valid.
- [ ] CSP and security headers are present.
- [ ] Static assets load; no secret appears in HTML or JavaScript.
- [ ] `X-Request-ID` is present and changes per request.
- [ ] One locked phrase persists exact raw source, normalized source, normalization version, source
      hash, exact model output, active model ID, and latency in canonical Supabase.
- [ ] Correct, unclear, and correction feedback produce their expected statuses.
- [ ] Controlled smoke rows are excluded from training exports or removed by the documented
      operator procedure.

## Mobile and accessibility

Verify at widths 320, 375, 390, 430, and desktop in Chromium, Firefox, and Safari/WebKit where
available:

- [ ] No horizontal scroll; combining marks remain intact.
- [ ] Character insertion replaces the current selection.
- [ ] Controls are at least 44px; text inputs are at least 16px.
- [ ] Keyboard order, visible focus, and translation/feedback announcements are usable.
- [ ] Feedback announcements do not repeat the full result card.
- [ ] Correction form survives 422/429 responses.
- [ ] Dirty warning appears only after an actual correction edit.
- [ ] Copy, cold-start, retry, and reduced-motion behavior work.

An automated accessibility scan is useful evidence but does not replace keyboard and
screen-reader-oriented inspection.

