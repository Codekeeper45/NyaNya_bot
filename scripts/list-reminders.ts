import { getDb } from '../src/db/client.js';
import { repeatingJobs, users } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { config } from '../src/config.js';

async function main() {
  const db = getDb(config.databaseUrl);
  const rows = await db
    .select({
      name: users.name,
      userId: users.id,
      schedulerId: repeatingJobs.schedulerId,
      kind: repeatingJobs.kind,
      cronPattern: repeatingJobs.cronPattern,
      timezone: repeatingJobs.timezone,
    })
    .from(repeatingJobs)
    .innerJoin(users, eq(users.id, repeatingJobs.userId))
    .orderBy(users.id, repeatingJobs.kind);

  console.log('\n📋 Активные напоминания:\n');
  
  for (const row of rows) {
    console.log(`👤 ${row.name} (ID: ${row.userId})`);
    console.log(`   📌 ${row.kind}`);
    console.log(`   ⏰ Cron: ${row.cronPattern}`);
    console.log(`   🌍 TZ: ${row.timezone}`);
    console.log(`   🆔 Scheduler: ${row.schedulerId}`);
    console.log('');
  }
  
  console.log(`Всего: ${rows.length} напоминаний\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
