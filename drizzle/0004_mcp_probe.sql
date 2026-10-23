CREATE TABLE `luufi_mcp_probe_records` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `luufi_mcp_probe_writes` (
	`owner_id` text NOT NULL,
	`request_key` text NOT NULL,
	`expected_revision` integer NOT NULL,
	`revision` integer NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`owner_id`, `request_key`)
);
