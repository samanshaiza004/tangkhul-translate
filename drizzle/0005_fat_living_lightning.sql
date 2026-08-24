CREATE TYPE "public"."legacy_verification_status" AS ENUM('unverified', 'review_required');--> statement-breakpoint
CREATE TABLE "legacy_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"row_fingerprint" text NOT NULL,
	"source_raw" text NOT NULL,
	"correction" text,
	"provenance" text DEFAULT 'legacy_google_sheet' NOT NULL,
	"consent_version" text DEFAULT 'legacy_or_unknown' NOT NULL,
	"verification_status" "legacy_verification_status" DEFAULT 'unverified' NOT NULL,
	"source_row_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_records_row_fingerprint_unique" UNIQUE("row_fingerprint"),
	CONSTRAINT "legacy_records_provenance_check" CHECK ("legacy_records"."provenance" = 'legacy_google_sheet'),
	CONSTRAINT "legacy_records_consent_check" CHECK ("legacy_records"."consent_version" = 'legacy_or_unknown')
);
--> statement-breakpoint
CREATE INDEX "legacy_records_status_created_idx" ON "legacy_records" USING btree ("verification_status","created_at");
--> statement-breakpoint
ALTER TABLE legacy_records ENABLE ROW LEVEL SECURITY;
