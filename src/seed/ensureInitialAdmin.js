import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';

/**
 * If the database has no users, create an admin from INITIAL_ADMIN_EMAIL + INITIAL_ADMIN_PASSWORD.
 */
export async function ensureInitialAdmin() {
  const n = await User.countDocuments();
  if (n > 0) return;

  const email = process.env.INITIAL_ADMIN_EMAIL?.trim()?.toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn(
      '[auth] No users in database. Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD to create the first admin, or use POST /api/admin/users after seeding.'
    );
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await User.create({
    email,
    passwordHash,
    name: 'Administrator',
    role: 'admin'
  });
  console.log('[auth] Initial admin created:', email);
}
