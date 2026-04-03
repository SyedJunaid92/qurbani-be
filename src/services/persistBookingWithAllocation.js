import { Booking } from '../models/Booking.js';
import {
  AllocationState,
  ensureAllocationState,
  GLOBAL_ID
} from '../models/AllocationState.js';
import { computeAllocation } from './allocationService.js';

const MAX_ATTEMPTS = 64;

export const ALLOCATION_CONTENTION = 'ALLOCATION_CONTENTION';

/**
 * Persists a booking with consecutive share allocation.
 * Uses compare-and-swap on AllocationState so concurrent API calls cannot interleave shares
 * between users (safe across multiple Node processes / load-balanced instances).
 */
export async function persistBookingWithAllocation({ name, contact, shareNum }) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let state = await AllocationState.findById(GLOBAL_ID).lean();
    if (!state) {
      await ensureAllocationState();
      state = await AllocationState.findById(GLOBAL_ID).lean();
    }
    if (!state) {
      throw new Error('Allocation state missing');
    }

    const prevCow = state.currentCow;
    const prevFilled = state.sharesFilledOnCurrentCow;
    const { segments, assignments, nextCow, nextFilled } = computeAllocation(
      prevCow,
      prevFilled,
      shareNum
    );

    const cas = await AllocationState.updateOne(
      { _id: GLOBAL_ID, currentCow: prevCow, sharesFilledOnCurrentCow: prevFilled },
      { $set: { currentCow: nextCow, sharesFilledOnCurrentCow: nextFilled } }
    );

    if (cas.modifiedCount !== 1) {
      continue;
    }

    try {
      return await Booking.create({
        name,
        contact,
        shares: shareNum,
        allocations: segments,
        cowShareAssignments: assignments
      });
    } catch (err) {
      await AllocationState.updateOne(
        { _id: GLOBAL_ID, currentCow: nextCow, sharesFilledOnCurrentCow: nextFilled },
        { $set: { currentCow: prevCow, sharesFilledOnCurrentCow: prevFilled } }
      );
      throw err;
    }
  }

  const err = new Error('Could not reserve allocation after concurrent updates; try again');
  err.code = ALLOCATION_CONTENTION;
  throw err;
}
