import cors from 'cors';
import express from 'express';
import { connectDB } from './db/connect.js';
import { authenticate } from './middleware/auth.js';
import {
  ensureAllocationState,
  migrateCowNumberingIfLegacy,
  migrateLinearStateToCows
} from './models/AllocationState.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { bookingsRouter } from './routes/bookings.js';
import { ensureInitialAdmin } from './seed/ensureInitialAdmin.js';

const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

let initPromise;

function ensureInitialized() {
  if (!initPromise) {
    initPromise = (async () => {
      await connectDB();
      if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET environment variable is required');
      }
      await ensureAllocationState();
      await migrateCowNumberingIfLegacy();
      await migrateLinearStateToCows();
      await ensureInitialAdmin();
    })();
  }
  return initPromise;
}

const app = express();

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

app.use(async (req, res, next) => {
  try {
    await ensureInitialized();
    next();
  } catch (err) {
    next(err);
  }
});

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/bookings', authenticate, bookingsRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
