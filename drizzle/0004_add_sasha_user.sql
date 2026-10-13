INSERT OR IGNORE INTO `users` (`id`, `username`, `password_hash`, `created_at`)
VALUES ('1c9f178f-f57f-4a8a-b855-7e38d7164ea2', 'sasha', 'pbkdf2-sha256$100000$a8ebbc8ecabc56d3f61d26755c211f64$945db47d6527df3f7485f18dda9035a20485e97cd70b360a826e51df00c18586', 1791838800000);
--> statement-breakpoint
INSERT OR IGNORE INTO `library_state` (`user_id`, `order_json`, `order_updated_at`)
SELECT `id`, '[]', 0 FROM `users` WHERE `username` = 'sasha';
