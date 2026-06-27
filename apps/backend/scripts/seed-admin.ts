/**
 * Create or update an ADMIN user. Admins are never created via public signup.
 *
 * Usage:
 *   npm run seed:admin --workspace=@coreai/backend -- "admin@example.com" "StrongPassword123" "Core Admin"
 *
 * Same email can still exist as BUSINESS/ARCHITECT because uniqueness is (email, role).
 * The password is never logged.
 */
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";

async function main() {
  const [emailRaw, password, ...nameParts] = process.argv.slice(2);
  const email = (emailRaw ?? "").trim().toLowerCase();
  const fullName = nameParts.join(" ").trim() || "Core Admin";

  if (!email || !password) {
    console.error('Usage: npm run seed:admin --workspace=@coreai/backend -- "admin@example.com" "Password" "Name"');
    process.exitCode = 1;
    return;
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exitCode = 1;
    return;
  }

  const passwordHash = hashPassword(password);

  const user = await prisma.user.upsert({
    where: { email_role: { email, role: "ADMIN" } },
    update: { passwordHash, fullName, isSuspended: false },
    create: { email, role: "ADMIN", passwordHash, fullName }
  });

  console.log(`Admin ready: ${user.email} (id=${user.id})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
