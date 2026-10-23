CREATE TABLE `project_ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`idea_text` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_project_ideas_created` ON `project_ideas` (`created_at`);