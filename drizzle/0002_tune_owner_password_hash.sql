UPDATE `users`
SET `password_hash` = 'pbkdf2-sha256$50000$f86a51707489b8329b223d20e31866e1$708729bf7880a43a7442ad551db8b10ee2a46f977b559ea8b276a430b4c99a2f'
WHERE `username` = 'katherine';
--> statement-breakpoint
DELETE FROM `login_attempts`;
