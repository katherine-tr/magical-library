INSERT OR IGNORE INTO `users` (`id`, `username`, `password_hash`, `created_at`)
VALUES ('c8356823-8e7d-46d7-a5a9-ae2cb660a2f9', 'katherine', 'pbkdf2-sha256$310000$af6a435703e5e7aeea586d56f4fb8250$3a74bc7fa4368b6ae9cf172a35d2755e73afbc9474b1d8c575a63a291213a311', 1786830600000);
--> statement-breakpoint
INSERT OR IGNORE INTO `library_state` (`user_id`, `order_json`, `order_updated_at`)
VALUES ('c8356823-8e7d-46d7-a5a9-ae2cb660a2f9', '[]', 0);
--> statement-breakpoint
DELETE FROM `login_attempts`;
