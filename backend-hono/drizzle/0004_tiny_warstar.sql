CREATE TABLE IF NOT EXISTS "recovery_admin_login_limits" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL
);
