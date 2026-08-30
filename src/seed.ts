/**
 * Creates the one admin account, from ADMIN_USERNAME / ADMIN_PASSWORD in .env.
 *
 *   npm run seed                      create the admin if there isn't one
 *   npm run seed -- --reset-password  also reset an existing admin's password
 *
 * Safe to run more than once: it never creates a second admin and never
 * silently changes an existing password unless you ask it to.
 */
import { env } from './env';
import { hashPassword, MIN_PASSWORD_LENGTH } from './auth/password';
import {
  closeMongo,
  createUser,
  getUserByUsername,
  initStore,
  listUsers,
  mongoTarget,
  updateUser,
} from './store';

const RESET = process.argv.includes('--reset-password');

async function main(): Promise<void> {
  await initStore();

  console.log('');
  console.log(`  data:      MongoDB ${mongoTarget()}`);

  if (env.ADMIN_PASSWORD.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const users = await listUsers();
  const existingAdmin = users.find((u) => u.role === 'admin');

  // --- no admin yet: create one ---
  if (!existingAdmin) {
    const clash = await getUserByUsername(env.ADMIN_USERNAME);
    if (clash) {
      throw new Error(
        `"${env.ADMIN_USERNAME}" is already taken by a client login. ` +
          'Choose a different ADMIN_USERNAME in .env.',
      );
    }

    const admin = await createUser({
      username: env.ADMIN_USERNAME,
      passwordHash: await hashPassword(env.ADMIN_PASSWORD),
      role: 'admin',
    });

    console.log('');
    console.log('  Admin created.');
    console.log(`    username: ${admin.username}`);
    console.log(`    password: (the ADMIN_PASSWORD from your .env)`);
    console.log(`    id:       ${admin.id}`);
    console.log('');
    return;
  }

  // --- an admin already exists ---
  const nameChanged = existingAdmin.username.toLowerCase() !== env.ADMIN_USERNAME.toLowerCase();

  if (!RESET) {
    console.log('');
    console.log('  Admin already exists. Nothing changed.');
    console.log(`    username: ${existingAdmin.username}`);
    console.log(`    created:  ${new Date(existingAdmin.createdAt).toLocaleString()}`);
    if (nameChanged) {
      console.log('');
      console.log(`  Note: .env now says ADMIN_USERNAME=${env.ADMIN_USERNAME}, which is different.`);
    }
    console.log('');
    console.log('  To apply the username and password from .env to this account:');
    console.log('    npm run seed -- --reset-password');
    console.log('');
    return;
  }

  if (nameChanged) {
    const clash = await getUserByUsername(env.ADMIN_USERNAME);
    if (clash && clash.id !== existingAdmin.id) {
      throw new Error(`"${env.ADMIN_USERNAME}" is already taken by another account.`);
    }
  }

  await updateUser(existingAdmin.id, {
    username: env.ADMIN_USERNAME,
    passwordHash: await hashPassword(env.ADMIN_PASSWORD),
  });

  console.log('');
  console.log('  Admin updated from .env.');
  console.log(`    username: ${env.ADMIN_USERNAME}`);
  console.log('    password: reset to the ADMIN_PASSWORD from your .env');
  console.log('');
}

main()
  .catch((err: unknown) => {
    console.error('');
    console.error(`  Seed failed: ${err instanceof Error ? err.message : String(err)}`);
    console.error('');
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
