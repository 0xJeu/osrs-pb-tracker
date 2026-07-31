CREATE TABLE IF NOT EXISTS "install_recovery_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"incumbent_secret_hash" text NOT NULL,
	"candidate_secret_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"display_name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_digest" text NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"received_count" integer NOT NULL,
	"eligible_count" integer NOT NULL,
	"equal_count" integer NOT NULL,
	"improved_count" integer NOT NULL,
	"new_count" integer NOT NULL,
	"slower_count" integer NOT NULL,
	"missing_count" integer NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"promoted_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	CONSTRAINT "install_recovery_candidates_player_id_candidate_secret_hash_unique" UNIQUE("player_id","candidate_secret_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "install_recovery_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"actor" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_attempts" ADD COLUMN "recovery_candidate_id" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "install_recovery_candidates" ADD CONSTRAINT "install_recovery_candidates_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "install_recovery_events" ADD CONSTRAINT "install_recovery_events_candidate_id_install_recovery_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."install_recovery_candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "install_recovery_events" ADD CONSTRAINT "install_recovery_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_install_recovery_player_status" ON "install_recovery_candidates" USING btree ("player_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_install_recovery_last_seen_at" ON "install_recovery_candidates" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_install_recovery_events_candidate_created_at" ON "install_recovery_events" USING btree ("candidate_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_install_recovery_events_player_created_at" ON "install_recovery_events" USING btree ("player_id","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sync_attempts" ADD CONSTRAINT "sync_attempts_recovery_candidate_id_install_recovery_candidates_id_fk" FOREIGN KEY ("recovery_candidate_id") REFERENCES "public"."install_recovery_candidates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
