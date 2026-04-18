import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _databaseUrl: string | null = null;

export function getDb(databaseUrl: string) {
  if (_databaseUrl && _databaseUrl !== databaseUrl) {
    throw new Error('getDb called with a different DATABASE_URL after initialization');
  }

  if (!_db) {
    const sql = neon(databaseUrl);
    _db = drizzle({ client: sql, schema });
    _databaseUrl = databaseUrl;
  }

  return _db;
}
