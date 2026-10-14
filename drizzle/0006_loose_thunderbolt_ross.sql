CREATE TABLE `catalog_book_sources` (
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`catalog_book_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `book_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`catalog_book_id`) REFERENCES `catalog_books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_catalog_book_sources_catalog` ON `catalog_book_sources` (`catalog_book_id`);