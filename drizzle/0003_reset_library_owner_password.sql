UPDATE `users`
SET `password_hash` = 'pbkdf2-sha256$50000$c19ad5c4ba2e01eaaef35c5c0ce306a7$2a2f75669702c87af9c12bb10913e927a720b5b9af35697801945725ccb800d1'
WHERE `username` = 'katherine';
--> statement-breakpoint
DELETE FROM `login_attempts`;
