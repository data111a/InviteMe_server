/**
 * Prints what is in the data file, in a readable way and WITHOUT secrets.
 *
 *   npm run db:show
 *
 * Password hashes are never printed. Intake tokens are shown only as a short
 * fingerprint, so you can tell two apart without this output being worth
 * stealing from your screen or a screenshot.
 */
import { closeMongo, countAnswers, initStore, listEvents, listUsers, mongoTarget } from '../store';

function fingerprint(token: string): string {
  return `${token.slice(0, 8)}…${token.slice(-4)} (${token.length} chars)`;
}

async function main(): Promise<void> {
  await initStore();

  const users = await listUsers();
  const events = await listEvents();

  console.log('');
  console.log(`  data:      MongoDB ${mongoTarget()}`);

  console.log('');
  console.log(`  USERS (${users.length})`);
  if (users.length === 0) {
    console.log('    none yet - run: npm run seed');
  }
  for (const user of users) {
    const scope = user.role === 'client' ? `event ${user.eventId ?? '(none)'}` : 'all events';
    console.log(`    ${user.role.padEnd(6)} ${user.username.padEnd(20)} ${scope}`);
    console.log(`    ${''.padEnd(6)} ${'password:'.padEnd(20)} bcrypt hash, ${user.passwordHash.length} chars (not shown)`);
  }

  console.log('');
  console.log(`  EVENTS (${events.length})`);
  if (events.length === 0) {
    console.log('    none yet - create one in the dashboard (Phase 4)');
  }
  for (const event of events) {
    const answers = await countAnswers(event.id);
    console.log(`    ${event.name}  [${event.type}]  ${event.id}`);
    console.log(`      date:    ${new Date(event.eventDate).toLocaleDateString()}`);
    console.log(`      token:   ${fingerprint(event.intakeToken)}`);
    console.log(`      fields:  ${event.fieldSchema.length}`);
    for (const field of event.fieldSchema) {
      const extra = field.type === 'dropdown' ? ` [${(field.options ?? []).join(', ')}]` : '';
      console.log(
        `         - ${field.label} (${field.key}) ${field.type}${field.required ? ' *required' : ''}${extra}`,
      );
    }
    console.log(`      answers: ${answers}`);
  }

  console.log('');
}

main()
  .catch((err: unknown) => {
    console.error('');
    console.error(`  Could not read the data: ${err instanceof Error ? err.message : String(err)}`);
    console.error('');
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
