import { Booking } from '../models/Booking.js';
import {
  AllocationState,
  ensureAllocationState,
  GLOBAL_ID
} from '../models/AllocationState.js';
import {
  buildFullOccupancyMap,
  cowsArrayFromOccupancyMap,
  denseCowsFromOccupancyMap,
  mergeOccupancy
} from './allocationEditService.js';
import { computeAllocationFromCows } from './allocationService.js';

const MAX_ATTEMPTS = 64;

export const ALLOCATION_CONTENTION = 'ALLOCATION_CONTENTION';

function cloneCows(cows) {
  return (cows ?? []).map((c) => ({ cowNumber: c.cowNumber, filled: c.filled }));
}

/**
 * Persists a booking with allocation (whole chunks on one cow; partial cows keep trailing free slots).
 * CAS on stateVersion + cows snapshot.
 */
export async function persistBookingWithAllocation({ name, contact, shareNum, createdBy }) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let state = await AllocationState.findById(GLOBAL_ID).lean();
    if (!state) {
      await ensureAllocationState();
      state = await AllocationState.findById(GLOBAL_ID).lean();
    }
    if (!state) {
      throw new Error('Allocation state missing');
    }

    const prevVersion =
      typeof state.stateVersion === 'number' ? state.stateVersion : 0;
    const prevCows = cloneCows(state.cows);

    const existingBookings = await Booking.find({})
      .select('cowShareAssignments')
      .lean();
    const occ = buildFullOccupancyMap(existingBookings);
    const dense = denseCowsFromOccupancyMap(occ);
    const { segments, assignments } = computeAllocationFromCows(dense, shareNum);
    const mergedOcc = mergeOccupancy(occ, assignments);
    const sparseCows = cowsArrayFromOccupancyMap(mergedOcc);

    const cas = await AllocationState.updateOne(
      { _id: GLOBAL_ID, stateVersion: prevVersion },
      {
        $set: { cows: sparseCows },
        $inc: { stateVersion: 1 }
      }
    );

    if (cas.modifiedCount !== 1) {
      continue;
    }

    try {
      return await Booking.create({
        name,
        contact,
        shares: shareNum,
        created_by: createdBy,
        allocations: segments,
        cowShareAssignments: assignments,
        shareParticipantDetails: assignments.map((a) => ({
          cowNumber: a.cowNumber,
          shareNumber: a.shareNumber,
          name: '',
          contact: '',
          address: ''
        }))
      });
    } catch (err) {
      await AllocationState.updateOne(
        { _id: GLOBAL_ID, stateVersion: prevVersion + 1 },
        { $set: { cows: prevCows, stateVersion: prevVersion } }
      );
      throw err;
    }
  }

  const err = new Error('Could not reserve allocation after concurrent updates; try again');
  err.code = ALLOCATION_CONTENTION;
  throw err;
}
