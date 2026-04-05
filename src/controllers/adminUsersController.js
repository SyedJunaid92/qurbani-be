import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';

export async function listUsers(_req, res) {
  const users = await User.find().sort({ created_at: -1 }).lean();
  res.json(
    users.map((u) => ({
      id: u._id.toString(),
      email: u.email,
      name: u.name,
      role: u.role,
      isActive: u.isActive,
      created_at: u.created_at
    }))
  );
}

export async function createUser(req, res) {
  const { email, password, name, role } = req.body ?? {};

  if (typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'Email is required' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const r = role === 'admin' ? 'admin' : 'staff';

  const exists = await User.exists({ email: email.trim().toLowerCase() });
  if (exists) {
    return res.status(409).json({ error: 'A user with this email already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    email: email.trim().toLowerCase(),
    passwordHash,
    name: name.trim(),
    role: r
  });

  res.status(201).json({
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive
  });
}
