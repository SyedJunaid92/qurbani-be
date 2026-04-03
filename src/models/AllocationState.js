import mongoose from 'mongoose';
import { Booking } from './Booking.js';

const GLOBAL_ID = 'global';

const allocationStateSchema = new mongoose.Schema({
  _id: { type: String, default: GLOBAL_ID },
  currentCow: { type: Number, default: 1, min: 1 },
  sharesFilledOnCurrentCow: { type: Number, default: 0, min: 0, max: 6 },
  /** 1 = first cow is cow #1; legacy DBs may be migrated from 0-based once */
  cowNumberingBase: { type: Number, default: 1, min: 1 }
});

allocationStateSchema.pre('save', function validateFilled(next) {
  if (this.sharesFilledOnCurrentCow > 6) {
    return next(new Error('Invalid state: sharesFilledOnCurrentCow must be 0–6'));
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
        currentCow: 1,
        sharesFilledOnCurrentCow: 0,
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
        currentCow: 1,
        sharesFilledOnCurrentCow: 0,
        cowNumberingBase: 1
      });
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }
  }
}

/** One-time shift from 0-based cows to 1-based when legacy data is detected */
export async function migrateCowNumberingIfLegacy() {
  const state = await AllocationState.findById(GLOBAL_ID);
  if (!state || state.cowNumberingBase === 1) return;

  const hasCowZeroBooking = await Booking.exists({
    $or: [{ 'allocations.cowNumber': 0 }, { 'cowShareAssignments.cowNumber': 0 }]
  });
  const stateAtZero = state.currentCow === 0;

  if (!hasCowZeroBooking && !stateAtZero) {
    state.cowNumberingBase = 1;
    await state.save();
    return;
  }

  if (!hasCowZeroBooking && stateAtZero) {
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

  state.currentCow = state.currentCow + 1;
  state.cowNumberingBase = 1;
  await state.save();
}

export { GLOBAL_ID };
