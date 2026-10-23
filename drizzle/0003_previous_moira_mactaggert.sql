CREATE TABLE `project_change_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_slug` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`kind` text NOT NULL,
	`issue_id` text,
	`detected_at` integer NOT NULL,
	`first_seen_at` integer,
	`position` integer NOT NULL,
	`payload_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_change_events_dedupe_key_unique` ON `project_change_events` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `idx_project_change_events_visible` ON `project_change_events` (`project_slug`,`first_seen_at`,`detected_at`);--> statement-breakpoint
CREATE INDEX `idx_project_change_events_coalesce` ON `project_change_events` (`project_slug`,`kind`,`issue_id`,`first_seen_at`);