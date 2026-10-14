CREATE TABLE `catalog_books` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`author` text DEFAULT '' NOT NULL,
	`title_key` text NOT NULL,
	`author_key` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`cover` text,
	`genre` text DEFAULT '' NOT NULL,
	`year` text DEFAULT '' NOT NULL,
	`language` text,
	`source` text DEFAULT 'Пользователь' NOT NULL,
	`external_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_catalog_books_title_author` ON `catalog_books` (`title_key`,`author_key`);--> statement-breakpoint
CREATE INDEX `idx_catalog_books_title_key` ON `catalog_books` (`title_key`);--> statement-breakpoint
CREATE INDEX `idx_catalog_books_author_key` ON `catalog_books` (`author_key`);