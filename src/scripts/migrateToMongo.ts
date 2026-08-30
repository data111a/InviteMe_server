/**
 * One-time import of the old JSON store (server/data/db.json) into MongoDB Atlas.
 *
 *   npm run migrate:mongo
 *
 * Idempotent: it upserts by each record's own `id`, so running it twice does not
 * create duplicates - it refreshes. It never deletes anything already in Atlas.
 *
 * Typical first-time flow:
 *   1. set MONGODB_URI in .env
 *   2. npm run migrate:mongo     (import your existing data)
 *   3. npm run seed              (ensure the admin login exists)
 *   4. npm run db:show           (confirm what landed)
 */
import { read } from '../store/file';
import type { Answer, Database, EventRecord, User } from '../store/types';
import {
  answersCol,
  closeMongo,
  connectMongo,
  eventsCol,
  mongoTarget,
  usersCol,
} from '../store/mongo';

/** Upsert every row by its `id`, so re-running refreshes instead of duplicating. */
function upsertOps<T extends { id: string }>(rows: T[]) {
  return rows.map((row) => ({
    updateOne: { filter: { id: row.id }, update: { $set: row }, upsert: true },
  }));
}

async function main(): Promise<void> {
  console.log('');
  console.log('  Reading the local db.json ...');
  const db: Database = await read((d) => d);

  await connectMongo();
  console.log(`  Importing into MongoDB ${mongoTarget()}`);
  console.log('');

  if (db.users.length > 0) await usersCol().bulkWrite(upsertOps<User>(db.users));
  console.log(`    users    ${db.users.length}`);

  if (db.events.length > 0) await eventsCol().bulkWrite(upsertOps<EventRecord>(db.events));
  console.log(`    events   ${db.events.length}`);

  if (db.answers.length > 0) await answersCol().bulkWrite(upsertOps<Answer>(db.answers));
  console.log(`    answers  ${db.answers.length}`);

  console.log('');
  console.log('  Done. Verify with:  npm run db:show');
  console.log('');
}

main()
  .catch((err: unknown) => {
    console.error('');
    console.error(`  Migration failed: ${err instanceof Error ? err.message : String(err)}`);
    console.error('');
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
