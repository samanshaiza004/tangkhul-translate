import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { escapeHtml } from "@kitajs/html";

import { QUALITY_TAGS } from "./schema";
import type { QualityTag } from "./schema";

const CONSENT_NOTICE_TEXT = readFileSync(
  resolve(import.meta.dir, "../docs/consent/contribution-v1.md"),
  "utf8",
);
const CONSENT_PARAGRAPHS = CONSENT_NOTICE_TEXT.split(/\n{2,}/)
  .map((paragraph) => paragraph.trim())
  .filter((paragraph) => paragraph.length > 0);

export const TAG_LABELS: Record<QualityTag, string> = {
  wrong_meaning: "Wrong meaning",
  missing_information: "Missing information",
  added_information: "Added information",
  wrong_tense_person_number: "Wrong tense, person, or number",
  name_number_spelling: "Name, number, or spelling wrong",
  unnatural_english: "Unnatural English",
  source_unclear: "Source text unclear",
  other: "Other",
};

export function Page() {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#143b45" />
        <title>Tangkhul Translate</title>
        <link rel="stylesheet" href="/static/app.css" />
        <meta
          attrs={
            'name="htmx-config" content=\'{"allowEval": false, "allowScriptTags": false, "includeIndicatorStyles": false, "historyCacheSize": 0, "selfRequestsOnly": true}\''
          }
        />
      </head>
      <body>
        <main>
          <header class="page-heading">
            <h1>Write it as you say it.</h1>
            <p class="introduction">
              Tangkhul → English. Enter Tangkhul in the form you use — the marks in Ā, ā, A̱, and a̱
              are preserved.
            </p>
          </header>

          <manner-form>
            <form
              class="translation-form"
              attrs={
                'hx-post="/translate" hx-target="#result" hx-swap="innerHTML" hx-indicator="#translation-status" hx-validate="true"'
              }
            >
              <div class="field-heading">
                <label for="tangkhul-input">Tangkhul text</label>
                <span>Source</span>
              </div>
              <textarea
                id="tangkhul-input"
                name="source"
                rows="8"
                required
                autofocus
                placeholder="Āthum rāra."
              ></textarea>
              <p
                id="tangkhul-input-error"
                class="field-error"
                data-error-for="tangkhul-input"
                hidden
              >
                Enter some Tangkhul text before translating.
              </p>

              <p class="storage-notice">
                Translations are stored to improve this translator. Avoid private or identifying
                text.
              </p>

              <fieldset class="character-tools">
                <legend>Insert a Tangkhul character</legend>
                <div class="character-rail">
                  {[
                    ["Ā", "capital A with macron"],
                    ["ā", "lowercase a with macron"],
                    ["A̱", "capital A with macron below"],
                    ["a̱", "lowercase a with macron below"],
                  ].map(([character, name]) => (
                    <button
                      type="button"
                      class="character-key"
                      data-character={character}
                      aria-label={`Insert ${name}`}
                    >
                      {escapeHtml(character)}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div class="form-actions">
                <button type="submit" class="translate-button">
                  Translate
                </button>
                <p id="translation-status" class="translation-status htmx-indicator" role="status">
                  Translating… the model may need a moment to wake up.
                </p>
              </div>
            </form>
          </manner-form>

          <section id="result" class="result-region" aria-live="polite" aria-atomic="true">
            <div class="result-empty">
              <p class="result-label">English</p>
              <p>Your translation will appear here.</p>
            </div>
          </section>
        </main>

        <footer>
          <p>Standard/common Tangkhul; village forms may differ.</p>
        </footer>
        <script src="/static/htmx-2.0.10.min.js"></script>
        <script src="/static/app.js"></script>
        <script type="module" src="/static/mannerhtml-register.js"></script>
      </body>
    </html>
  );
}

export function TranslationResult({
  inferenceId,
  output,
  consentVersion,
}: {
  inferenceId: string;
  output: string;
  consentVersion: string;
}) {
  return (
    <article class="result-card result-card-success">
      <div class="result-heading">
        <p class="result-label">English translation</p>
        <button type="button" class="copy-button" data-copy-result>
          Copy
        </button>
      </div>
      <p class="translation-output" data-translation-output>
        {escapeHtml(output)}
      </p>
      <p class="copy-status" data-copy-status aria-live="polite"></p>
      <div id="feedback-zone">
        <FeedbackControls
          inferenceId={inferenceId}
          output={output}
          consentVersion={consentVersion}
        />
      </div>
    </article>
  );
}

export function FeedbackControls({
  inferenceId,
  output,
  consentVersion,
}: {
  inferenceId: string;
  output: string;
  consentVersion: string;
}) {
  return (
    <>
      <div class="feedback-controls" role="group" aria-label="Rate this translation">
        <button
          type="button"
          class="feedback-verdict-button"
          attrs={`hx-post="/feedback" hx-target="#feedback-message" hx-swap="innerHTML" hx-vals='${escapeHtml(
            JSON.stringify({
              verdict: "correct",
              inference_id: inferenceId,
              consent_version: consentVersion,
            }),
          )}'`}
        >
          Looks correct
        </button>
        <button
          type="button"
          class="feedback-verdict-button"
          attrs={`hx-post="/feedback" hx-target="#feedback-message" hx-swap="innerHTML" hx-vals='${escapeHtml(
            JSON.stringify({
              verdict: "unclear",
              inference_id: inferenceId,
              consent_version: consentVersion,
            }),
          )}'`}
        >
          Source unclear
        </button>
        <button
          type="button"
          class="feedback-toggle-button"
          data-toggle-correction
          aria-expanded="false"
          aria-controls="correction-form"
        >
          Needs correction
        </button>
      </div>

      <manner-form>
        <form
          id="correction-form"
          class="correction-form"
          hidden
          attrs={
            'hx-post="/feedback" hx-target="#feedback-message" hx-swap="innerHTML" hx-validate="true"'
          }
        >
          <input type="hidden" name="inference_id" value={inferenceId} />
          <input type="hidden" name="consent_version" value={consentVersion} />
          <input type="hidden" name="verdict" value="incorrect" />

          <label for="proposed-translation">Corrected English translation</label>
          <textarea id="proposed-translation" name="proposed_translation" rows="4" required>
            {escapeHtml(output)}
          </textarea>
          <p
            id="proposed-translation-error"
            class="field-error"
            data-error-for="proposed-translation"
            hidden
          >
            Enter the corrected English translation.
          </p>

          <fieldset class="issue-tags">
            <legend>What was wrong? (optional)</legend>
            {QUALITY_TAGS.map((tag) => (
              <label class="issue-tag-option">
                <input type="checkbox" name="tags" value={tag} />
                {escapeHtml(TAG_LABELS[tag])}
              </label>
            ))}
          </fieldset>

          <label for="contributor-note">Anything else? (optional)</label>
          <textarea id="contributor-note" name="contributor_note" rows="2"></textarea>

          <div class="consent-notice">
            {CONSENT_PARAGRAPHS.map((paragraph) => (
              <p>{escapeHtml(paragraph)}</p>
            ))}
          </div>

          <button type="submit" class="correction-submit-button">
            Submit for review
          </button>
        </form>
      </manner-form>

      <div id="feedback-message" aria-live="polite"></div>
    </>
  );
}

export function FeedbackStatus({
  variant,
}: {
  variant: "correct" | "unclear" | "pending_review" | "duplicate";
}) {
  const message =
    variant === "pending_review"
      ? "Submitted for human review. It will not enter training automatically."
      : variant === "duplicate"
        ? "Feedback was already recorded for this translation."
        : variant === "unclear"
          ? "Recorded as unclear."
          : "Recorded as correct.";

  return (
    <p class="feedback-status" role="status">
      {escapeHtml(message)}
    </p>
  );
}

export function FeedbackError({ title, message }: { title: string; message: string }) {
  return (
    <p class="feedback-error" role="alert">
      <strong>{escapeHtml(title)}</strong> {escapeHtml(message)}
    </p>
  );
}

export function TranslationError({
  title,
  message,
  retry = false,
}: {
  title: string;
  message: string;
  retry?: boolean;
}) {
  return (
    <article class="result-card result-card-error" role="alert">
      <p class="result-label">Translation unavailable</p>
      <h2>{escapeHtml(title)}</h2>
      <p>{escapeHtml(message)}</p>
      {retry ? <p class="retry-note">Your text is still in the box. Try Translate again.</p> : null}
    </article>
  );
}
