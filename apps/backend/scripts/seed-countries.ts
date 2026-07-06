import { prisma } from "../src/lib/prisma";
import { getCountrySeedRows } from "../src/lib/countrydata";

async function main() {
  const rows = getCountrySeedRows();
  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const existing = await prisma.country.findUnique({
      where: { countryCode: row.countryCode },
      select: { id: true, name: true, flag: true }
    });

    if (existing) {
      if (existing.name !== row.name || existing.flag !== row.flag) {
        await prisma.country.update({
          where: { countryCode: row.countryCode },
          data: { name: row.name, flag: row.flag }
        });
        updated += 1;
      }
      continue;
    }

    await prisma.country.create({
      data: {
        name: row.name,
        countryCode: row.countryCode,
        flag: row.flag
      }
    });
    created += 1;
  }

  const total = await prisma.country.count();
  console.log(`Countries seeded: ${created} created, ${updated} updated, ${total} total in database`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
