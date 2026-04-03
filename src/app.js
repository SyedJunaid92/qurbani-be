import cors from 'cors';
import express from 'express';
import { connectDB } from './db/connect.js';
import {
  ensureAllocationState,
  migrateCowNumberingIfLegacy,
  migrateLinearStateToCows
} from './models/AllocationState.js';
import { bookingsRouter } from './routes/bookings.js';

const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

let initPromise;

function ensureInitialized() {
  if (!initPromise) {
    initPromise = (async () => {
      await connectDB();
      await ensureAllocationState();
      await migrateCowNumberingIfLegacy();
      await migrateLinearStateToCows();
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

app.use('/api/bookings', bookingsRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
