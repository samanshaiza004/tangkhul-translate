CREATE TYPE "public"."feedback_status" AS ENUM('recorded', 'pending_review', 'accepted', 'rejected', 'invalid_source');--> statement-breakpoint
CREATE TYPE "public"."feedback_verdict" AS ENUM('correct', 'incorrect', 'unclear');--> statement-breakpoint
CREATE TYPE "public"."review_decision" AS ENUM('accept', 'edit_accept', 'reject', 'invalid_source');--> statement-breakpoint
CREATE TYPE "public"."review_severity" AS ENUM('minor', 'major', 'critical');--> statement-breakpoint
CREATE TABLE "dataset_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"reviewer_ref" text NOT NULL,
	"selection_rules" jsonb NOT NULL,
	"record_count" integer NOT NULL,
	"manifest" jsonb NOT NULL,
	"checksum" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dataset_exports_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inference_id" uuid NOT NULL,
	"verdict" "feedback_verdict" NOT NULL,
	"proposed_translation" text,
	"contributor_note" text,
	"consent_version" text NOT NULL,
	"status" "feedback_status" DEFAULT 'recorded' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "feedback_inference_id_key" UNIQUE("inference_id"),
	CONSTRAINT "feedback_proposed_when_incorrect" CHECK ("feedback"."verdict" <> 'incorrect' OR ("feedback"."proposed_translation" IS NOT NULL AND length(btrim("feedback"."proposed_translation")) > 0))
);
--> statement-breakpoint
CREATE TABLE "feedback_tags" (
	"feedback_id" uuid NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "feedback_tags_feedback_id_tag_pk" PRIMARY KEY("feedback_id","tag"),
	CONSTRAINT "feedback_tags_tag_check" CHECK ("feedback_tags"."tag" in ('wrong_meaning', 'missing_information', 'added_information', 'wrong_tense_person_number', 'name_number_spelling', 'unnatural_english', 'source_unclear', 'other'))
);
--> statement-breakpoint
CREATE TABLE "inferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_raw" text NOT NULL,
	"source_normalized" text NOT NULL,
	"source_hash" text NOT NULL,
	"normalization_version" text NOT NULL,
	"model_output" text NOT NULL,
	"model_version_id" uuid NOT NULL,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_repository" text NOT NULL,
	"model_revision" text NOT NULL,
	"space_repository" text NOT NULL,
	"space_revision" text NOT NULL,
	"prompt_version" text NOT NULL,
	"generation_config" jsonb NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_versions_natural_key" UNIQUE("model_repository","model_revision","space_repository","space_revision","prompt_version")
);
--> statement-breakpoint
CREATE TABLE "review_tags" (
	"review_id" uuid NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "review_tags_review_id_tag_pk" PRIMARY KEY("review_id","tag"),
	CONSTRAINT "review_tags_tag_check" CHECK ("review_tags"."tag" in ('wrong_meaning', 'missing_information', 'added_information', 'wrong_tense_person_number', 'name_number_spelling', 'unnatural_english', 'source_unclear', 'other'))
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feedback_id" uuid NOT NULL,
	"reviewer_ref" text NOT NULL,
	"decision" "review_decision" NOT NULL,
	"final_translation" text,
	"domain" text,
	"severity" "review_severity",
	"reviewer_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_final_when_accepted" CHECK ("reviews"."decision" NOT IN ('accept','edit_accept') OR ("reviews"."final_translation" IS NOT NULL AND length(btrim("reviews"."final_translation")) > 0))
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_inference_id_inferences_id_fk" FOREIGN KEY ("inference_id") REFERENCES "public"."inferences"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_tags" ADD CONSTRAINT "feedback_tags_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inferences" ADD CONSTRAINT "inferences_model_version_id_model_versions_id_fk" FOREIGN KEY ("model_version_id") REFERENCES "public"."model_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tags" ADD CONSTRAINT "review_tags_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_status_created_idx" ON "feedback" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "inferences_source_hash_idx" ON "inferences" USING btree ("source_hash");--> statement-breakpoint
CREATE INDEX "inferences_model_version_created_idx" ON "inferences" USING btree ("model_version_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "model_versions_single_active_idx" ON "model_versions" USING btree ("active") WHERE "model_versions"."active";--> statement-breakpoint
CREATE INDEX "reviews_feedback_created_idx" ON "reviews" USING btree ("feedback_id","created_at");