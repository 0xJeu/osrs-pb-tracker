CREATE TABLE IF NOT EXISTS "feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"message" text NOT NULL,
	"context" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "personal_bests" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"boss" text NOT NULL,
	"time_seconds" real NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "personal_bests_player_id_boss_unique" UNIQUE("player_id","boss")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "player_name_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"display_name" text NOT NULL,
	"display_name_lower" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "player_name_history_player_id_display_name_lower_unique" UNIQUE("player_id","display_name_lower")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"display_name_lower" text NOT NULL,
	"install_secret_hash" text,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "players_account_hash_unique" UNIQUE("account_hash")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "personal_bests" ADD CONSTRAINT "personal_bests_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "player_name_history" ADD CONSTRAINT "player_name_history_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_feedback_created_at" ON "feedback" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pb_boss" ON "personal_bests" USING btree ("boss");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_player_name_history_lower" ON "player_name_history" USING btree ("display_name_lower");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_players_name_lower" ON "players" USING btree ("display_name_lower");