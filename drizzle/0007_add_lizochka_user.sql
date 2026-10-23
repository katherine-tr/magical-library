INSERT OR IGNORE INTO `users` (`id`, `username`, `password_hash`, `created_at`)
VALUES ('b6970ab1-01c6-456c-82ff-a0c60487442c', 'lizochka', 'pbkdf2-sha256$100000$a325c5213799025535c6c895a667a9fb$839556f2e5b1e49d9516e1d16cc505c04dce86ed13128983947bedf5d4bb6a6f', 1792736285467);
--> statement-breakpoint
INSERT OR IGNORE INTO `library_state` (`user_id`, `order_json`, `order_updated_at`)
SELECT `id`, '[]', 0 FROM `users` WHERE `username` = 'lizochka';
