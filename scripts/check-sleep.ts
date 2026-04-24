import { getDb } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { config } from '../src/config.js';

async function main() {
  const db = getDb(config.databaseUrl);
  const user = await db.select().from(users).where(eq(users.id, 3)).limit(1);
  
  if (!user[0]) {
    console.log('User not found');
    process.exit(1);
  }
  
  const u = user[0];
  console.log('\n👤 Лу (ID: 3) — Режим сна:\n');
  console.log(`   Подъём (будни):        ${u.wakeTime ?? '—'}`);
  console.log(`   Сон (будни):           ${u.sleepTime ?? '—'}`);
  console.log(`   Подъём (выходные):     ${u.weekendWakeTime ?? '—'}`);
  console.log(`   Сон (выходные):        ${u.weekendSleepTime ?? '—'}`);
  console.log(`   Часовой пояс:          ${u.timezone}`);
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
