import mongoose from 'mongoose';
import { Booking } from './Booking.js';

const GLOBAL_ID = 'global';

const cowSlotSchema = new mongoose.Schema(
  {
    cowNumber: { type: Number, required: true, min: 1 },
    filled: { type: Number, required: true, min: 0, max: 7 }
  },
  { _id: false }
);

const allocationStateSchema = new mongoose.Schema({
  _id: { type: String, default: GLOBAL_ID },
  cows: { type: [cowSlotSchema], default: [] },
  stateVersion: { type: Number, default: 0, min: 0 },
  cowNumberingBase: { type: Number, default: 1, min: 1 },
  /** Legacy fields (removed after migrateLinearStateToCows) */
  currentCow: { type: Number, required: false, min: 1 },
  sharesFilledOnCurrentCow: { type: Number, required: false, min: 0, max: 6 }
});

allocationStateSchema.pre('save', function validateCows(next) {
  for (const c of this.cows ?? []) {
    if (c.filled > 7) {
      return next(new Error('Invalid state: cow filled must be 0–7'));
    }
  }
  next();
});

export const AllocationState =
  mongoose.models.AllocationState || mongoose.model('AllocationState', allocationStateSchema);

export async function ensureAllocationState() {
  await AllocationState.findOneAndUpdate(
    { _id: GLOBAL_ID },
    {
      $setOnInsert: {
        cows: [],
        stateVersion: 0,
        cowNumberingBase: 1
      }
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  const exists = await AllocationState.exists({ _id: GLOBAL_ID });
  if (!exists) {
    try {
      await AllocationState.create({
        _id: GLOBAL_ID,
        cows: [],
        stateVersion: 0,
        cowNumberingBase: 1
      });
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }
  }
}

/** Convert old single-pointer state to per-cow filled counts */
export async function migrateLinearStateToCows() {
  const raw = await AllocationState.findById(GLOBAL_ID).lean();
  if (!raw) return;

  const hasLegacy =
    raw.currentCow !== undefined || raw.sharesFilledOnCurrentCow !== undefined;
  if (!hasLegacy) return;

  if (Array.isArray(raw.cows) && raw.cows.length > 0) {
    await AllocationState.updateOne(
      { _id: GLOBAL_ID },
      { $unset: { currentCow: '', sharesFilledOnCurrentCow: '' } }
    );
    return;
  }

  const cc = raw.currentCow ?? 1;
  const sf = raw.sharesFilledOnCurrentCow ?? 0;
  const cows = [];
  if (cc > 1) {
    for (let i = 1; i < cc; i += 1) {
      cows.push({ cowNumber: i, filled: 7 });
    }
  }
  cows.push({ cowNumber: cc, filled: sf });

  await AllocationState.updateOne(
    { _id: GLOBAL_ID },
    {
      $set: {
        cows,
        stateVersion: typeof raw.stateVersion === 'number' ? raw.stateVersion : 0
      },
      $unset: { currentCow: '', sharesFilledOnCurrentCow: '' }
    }
  );
}

/** One-time shift from 0-based cows to 1-based when legacy data is detected */
export async function migrateCowNumberingIfLegacy() {
  const state = await AllocationState.findById(GLOBAL_ID);
  if (!state || state.cowNumberingBase === 1) return;

  const hasCowZeroBooking = await Booking.exists({
    $or: [{ 'allocations.cowNumber': 0 }, { 'cowShareAssignments.cowNumber': 0 }]
  });

  const stateAtZero =
    state.currentCow === 0 ||
    (Array.isArray(state.cows) && state.cows.some((c) => c.cowNumber === 0));

  if (!hasCowZeroBooking && !stateAtZero) {
    state.cowNumberingBase = 1;
    await state.save();
    return;
  }

  if (!hasCowZeroBooking && stateAtZero && state.currentCow === 0 && !state.cows?.length) {
    state.currentCow = 1;
    state.cowNumberingBase = 1;
    await state.save();
    return;
  }

  const bookings = await Booking.find({});
  for (const b of bookings) {
    for (const seg of b.allocations ?? []) {
      if (typeof seg.cowNumber === 'number') seg.cowNumber += 1;
    }
    for (const a of b.cowShareAssignments ?? []) {
      if (typeof a.cowNumber === 'number') a.cowNumber += 1;
    }
    if ((b.allocations?.length ?? 0) > 0 || (b.cowShareAssignments?.length ?? 0) > 0) {
      await b.save();
    }
  }

  if (Array.isArray(state.cows) && state.cows.length > 0) {
    for (const c of state.cows) {
      if (typeof c.cowNumber === 'number') c.cowNumber += 1;
    }
  } else if (state.currentCow != null) {
    state.currentCow = state.currentCow + 1;
  }

  state.cowNumberingBase = 1;
  await state.save();
}

export { GLOBAL_ID };
