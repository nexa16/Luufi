CREATE TABLE `oauth_sessions` (
	`session_hash` text PRIMARY KEY NOT NULL,
	`encrypted_tokens` text NOT NULL,
	`scopes` text NOT NULL,
	`owner_login` text NOT NULL,
	`expires_at` integer NOT NULL,
	`token_expires_at` integer,
	`refresh_expires_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_oauth_sessions_expires` ON `oauth_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`encrypted_verifier` text NOT NULL,
	`return_to` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_oauth_states_expires` ON `oauth_states` (`expires_at`);--> statement-breakpoint
ALTER TABLE `mutation_operations` ADD `owner_session_hash` text;--> statement-breakpoint
CREATE INDEX `idx_mutation_operations_owner` ON `mutation_operations` (`owner_session_hash`);