CREATE TABLE IF NOT EXISTS "player_install_credential_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"credential_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"actor" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "player_install_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"secret_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'legacy' NOT NULL,
	"authorized_from_candidate_id" integer,
	"authorized_by" text,
	"revoked_by" text,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"authorized_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "player_install_credentials_player_id_secret_hash_unique" UNIQUE("player_id","secret_hash")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "player_install_credential_events" ADD CONSTRAINT "player_install_credential_events_credential_id_player_install_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."player_install_credentials"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "player_install_credential_events" ADD CONSTRAINT "player_install_credential_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "player_install_credentials" ADD CONSTRAINT "player_install_credentials_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "player_install_credentials" ADD CONSTRAINT "player_install_credentials_authorized_from_candidate_id_install_recovery_candidates_id_fk" FOREIGN KEY ("authorized_from_candidate_id") REFERENCES "public"."install_recovery_candidates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_player_install_events_credential_created_at" ON "player_install_credential_events" USING btree ("credential_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_player_install_events_player_created_at" ON "player_install_credential_events" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_player_install_credentials_player_status" ON "player_install_credentials" USING btree ("player_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_player_install_credentials_candidate" ON "player_install_credentials" USING btree ("authorized_from_candidate_id");
--> statement-breakpoint
INSERT INTO "player_install_credentials" (
	"player_id", "secret_hash", "status", "source",
	"first_seen_at", "last_seen_at", "authorized_at"
)
SELECT "id", "install_secret_hash", 'active', 'legacy', "updated_at", "updated_at", "updated_at"
FROM "players"
WHERE "install_secret_hash" IS NOT NULL
ON CONFLICT ("player_id", "secret_hash") DO NOTHING;
