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
import { hashPassword, passwordProblem } from './auth/password';
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

/** Only the seed needs the admin credentials, so it checks them itself. */
function adminCredentials(): { username: string; password: string } {
  const username = env.ADMIN_USERNAME;
  const password = env.ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD must both be set in .env to run the seed');
  }
  const problem = passwordProblem(password, username);
  if (problem) throw new Error(`ADMIN_PASSWORD ${problem}`);
  return { username, password };
}

async function main(): Promise<void> {
  const admin = adminCredentials();

  await initStore();

  console.log('');
  console.log(`  data:      MongoDB ${mongoTarget()}`);

  const users = await listUsers();
  const existingAdmin = users.find((u) => u.role === 'admin');

  // --- no admin yet: create one ---
  if (!existingAdmin) {
    const clash = await getUserByUsername(admin.username);
    if (clash) {
      throw new Error(
        `"${admin.username}" is already taken by a client login. ` +
          'Choose a different ADMIN_USERNAME in .env.',
      );
    }

    const created = await createUser({
      username: admin.username,
      passwordHash: await hashPassword(admin.password),
      role: 'admin',
    });

    console.log('');
    console.log('  Admin created.');
    console.log(`    username: ${created.username}`);
    console.log(`    password: (the ADMIN_PASSWORD from your .env)`);
    console.log(`    id:       ${created.id}`);
    console.log('');
    return;
  }

  // --- an admin already exists ---
  const nameChanged = existingAdmin.username.toLowerCase() !== admin.username.toLowerCase();

  if (!RESET) {
    console.log('');
    console.log('  Admin already exists. Nothing changed.');
    console.log(`    username: ${existingAdmin.username}`);
    console.log(`    created:  ${new Date(existingAdmin.createdAt).toLocaleString()}`);
    if (nameChanged) {
      console.log('');
      console.log(`  Note: .env now says ADMIN_USERNAME=${admin.username}, which is different.`);
    }
    console.log('');
    console.log('  To apply the username and password from .env to this account:');
    console.log('    npm run seed -- --reset-password');
    console.log('');
    return;
  }

  if (nameChanged) {
    const clash = await getUserByUsername(admin.username);
    if (clash && clash.id !== existingAdmin.id) {
      throw new Error(`"${admin.username}" is already taken by another account.`);
    }
  }

  // updateUser also bumps the session version: every existing admin login ends.
  await updateUser(existingAdmin.id, {
    username: admin.username,
    passwordHash: await hashPassword(admin.password),
  });

  console.log('');
  console.log('  Admin updated from .env (all existing admin sessions were signed out).');
  console.log(`    username: ${admin.username}`);
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
