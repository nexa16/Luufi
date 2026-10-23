CREATE TABLE `mutation_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_slug` text NOT NULL,
	`issue_number` integer NOT NULL,
	`outcome` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`expected_snapshot_fingerprint` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_mutation_operations_project_issue` ON `mutation_operations` (`project_slug`,`issue_number`);--> statement-breakpoint
CREATE INDEX `idx_mutation_operations_status` ON `mutation_operations` (`status`);--> statement-breakpoint
CREATE TABLE `mutation_steps` (
	`operation_id` text NOT NULL,
	`step_key` text NOT NULL,
	`position` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result_json` text,
	`error_message` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`operation_id`, `step_key`),
	FOREIGN KEY (`operation_id`) REFERENCES `mutation_operations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_mutation_steps_operation_position` ON `mutation_steps` (`operation_id`,`position`);--> statement-breakpoint
CREATE TABLE `project_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_slug` text NOT NULL,
	`fingerprint` text NOT NULL,
	`source_updated_at` text NOT NULL,
	`synced_at` integer NOT NULL,
	`payload_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_project_snapshots_project_synced` ON `project_snapshots` (`project_slug`,`synced_at`);