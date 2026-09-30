CREATE TABLE IF NOT EXISTS "public_read_model_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"revision" bigint NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
INSERT INTO "public_read_model_state" ("id", "revision", "updated_at")
VALUES (1, 1, NOW())
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "bump_public_read_model_revision"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "public_read_model_state"
  SET "revision" = "revision" + 1, "updated_at" = NOW()
  WHERE "id" = 1;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "players_public_read_model_revision" ON "players";
--> statement-breakpoint
CREATE TRIGGER "players_public_read_model_revision"
AFTER INSERT OR UPDATE OR DELETE ON "players"
FOR EACH STATEMENT EXECUTE FUNCTION "bump_public_read_model_revision"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "player_name_history_public_read_model_revision" ON "player_name_history";
--> statement-breakpoint
CREATE TRIGGER "player_name_history_public_read_model_revision"
AFTER INSERT OR UPDATE OR DELETE ON "player_name_history"
FOR EACH STATEMENT EXECUTE FUNCTION "bump_public_read_model_revision"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "personal_bests_public_read_model_revision" ON "personal_bests";
--> statement-breakpoint
CREATE TRIGGER "personal_bests_public_read_model_revision"
AFTER INSERT OR UPDATE OR DELETE ON "personal_bests"
FOR EACH STATEMENT EXECUTE FUNCTION "bump_public_read_model_revision"();
