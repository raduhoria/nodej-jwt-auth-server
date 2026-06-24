const db = require("../src/db");

const main = async () => {
	const user = await db.seedTestUser({
		email: process.env.TEST_USER_EMAIL || "demo@example.com",
		name: process.env.TEST_USER_NAME || "Demo User",
		password: process.env.TEST_USER_PASSWORD || "DemoPass123!",
		language: process.env.TEST_USER_LANGUAGE || "en",
		role: process.env.TEST_USER_ROLE || "user"
	});

	console.log("Seeded test user:");
	console.log(`  email: ${user.email}`);
	console.log(`  password: ${user.password}`);
	console.log(`  role: ${user.role}`);
};

main()
	.catch((error) => {
		console.error("Failed to seed test user:", error.message);
		process.exitCode = 1;
	})
	.finally(async () => {
		await db.close();
	});
