CREATE TABLE IF NOT EXISTS "sync_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"outcome" text NOT NULL,
	"http_status" integer NOT NULL,
	"received_count" integer NOT NULL,
	"eligible_count" integer,
	"updated_count" integer,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sync_attempts" ADD CONSTRAINT "sync_attempts_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sync_attempts_player_created_at" ON "sync_attempts" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sync_attempts_created_at" ON "sync_attempts" USING btree ("created_at");