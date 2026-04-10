import { Booking } from '../models/Booking.js';
import { AllocationState, GLOBAL_ID } from '../models/AllocationState.js';
import { computeAllocationFromCows } from './allocationService.js';

const MAX_SHARES_PER_BOOKING = 200;

/**
 * Global occupancy from bookings: each cow's occupied shares must form prefix {1..k}.
 */

/** @param {Array<{ cowShareAssignments?: { cowNumber: number, shareNumber: number }[] }>} bookings */
/** @param {string | undefined} excludeBookingId */
export function buildOccupancyMapExcludingBooking(bookings, excludeBookingId) {
  const map = new Map();
  const ex = excludeBookingId != null ? String(excludeBookingId) : null;
  for (const b of bookings) {
    if (ex && String(b._id) === ex) continue;
    for (const a of b.cowShareAssignments ?? []) {
      const cow = Number(a.cowNumber);
      const share = Number(a.shareNumber);
      if (!Number.isInteger(cow) || cow < 1) continue;
      if (!Number.isInteger(share) || share < 1 || share > 7) continue;
      if (!map.has(cow)) map.set(cow, new Set());
      map.get(cow).add(share);
    }
  }
  return map;
}

/** Occupancy including all bookings */
export function buildFullOccupancyMap(bookings) {
  return buildOccupancyMapExcludingBooking(bookings, undefined);
}

/**
 * @param {Map<number, Set<number>>} map
 * @returns {{ ok: true } | { ok: false, cow: number, message: string }}
 */
export function validatePrefixOccupancy(map) {
  for (const [cow, set] of map) {
    if (set.size === 0) continue;
    const sorted = [...set].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i += 1) {
      if (sorted[i] !== i + 1) {
        return {
          ok: false,
          cow,
          message: `Cow ${cow} would have a gap in occupied shares (prefix rule)`
        };
      }
    }
  }
  return { ok: true };
}

/**
 * @param {Array<{ cowNumber: number, shareNumber: number }>} proposed
 * @param {Map<number, Set<number>>} otherOccupancy — all bookings except the one being edited
 */
export function validateProposedAgainstOthers(proposed, otherOccupancy) {
  const seen = new Set();
  for (const a of proposed) {
    const cow = Number(a.cowNumber);
    const share = Number(a.shareNumber);
    const key = `${cow}:${share}`;
    if (seen.has(key)) {
      return { ok: false, message: 'Duplicate cow/share within this booking' };
    }
    seen.add(key);
    if (!Number.isInteger(cow) || cow < 1) {
      return { ok: false, message: 'Invalid cow number' };
    }
    if (!Number.isInteger(share) || share < 1 || share > 7) {
      return { ok: false, message: 'Share must be between 1 and 7' };
    }
    const taken = otherOccupancy.get(cow);
    if (taken?.has(share)) {
      return {
        ok: false,
        message: `Cow ${cow} share ${share} is already taken by another booking`
      };
    }
  }
  return { ok: true };
}

/** Length of prefix 1..k occupied on a cow (ignores gaps above k). */
export function prefixLengthOnCow(occupancyMap, cowNumber) {
  const set = occupancyMap.get(cowNumber);
  if (!set || set.size === 0) return 0;
  let k = 0;
  for (let s = 1; s <= 7; s += 1) {
    if (set.has(s)) k = s;
    else break;
  }
  return k;
}

/**
 * Cows 1..max(occupied cow) with prefix fill counts, including empty cows (filled 0).
 * Lets the allocator prefer lower cow numbers when upper cows are freed.
 */
export function denseCowsFromOccupancyMap(occupancyMap) {
  let maxCow = 0;
  for (const c of occupancyMap.keys()) {
    maxCow = Math.max(maxCow, c);
  }
  const out = [];
  for (let cow = 1; cow <= maxCow; cow += 1) {
    out.push({ cowNumber: cow, filled: prefixLengthOnCow(occupancyMap, cow) });
  }
  return out;
}

/**
 * For allocation edits: keep each row’s chosen cow; assign consecutive share indices on that cow
 * after other bookings’ prefix (so global prefix stays valid).
 */
export function normalizeAssignmentsToConsecutivePerCow(otherMap, proposed) {
  if (!Array.isArray(proposed) || proposed.length === 0) {
    return { ok: false, message: 'Invalid assignments' };
  }
  const byCow = new Map();
  for (let i = 0; i < proposed.length; i += 1) {
    const cow = Number(proposed[i].cowNumber);
    if (!Number.isInteger(cow) || cow < 1) {
      return { ok: false, message: 'Invalid cow number' };
    }
    if (!byCow.has(cow)) byCow.set(cow, []);
    byCow.get(cow).push(i);
  }
  const next = proposed.map((p) => ({
    cowNumber: Number(p.cowNumber),
    shareNumber: Number(p.shareNumber)
  }));
  for (const [cow, indices] of byCow) {
    const kO = prefixLengthOnCow(otherMap, cow);
    const sortedIdx = [...indices].sort((a, b) => a - b);
    const n = sortedIdx.length;
    if (kO + n > 7) {
      return {
        ok: false,
        message: `Not enough free share slots on cow ${cow} (${n} required after existing bookings)`
      };
    }
    sortedIdx.forEach((rowIdx, j) => {
      next[rowIdx] = { cowNumber: cow, shareNumber: kO + j + 1 };
    });
  }
  return { ok: true, assignments: next };
}

/** Merge proposed into a clone of otherOccupancy */
export function mergeOccupancy(otherOccupancy, proposed) {
  const merged = new Map();
  for (const [cow, set] of otherOccupancy) {
    merged.set(cow, new Set(set));
  }
  for (const a of proposed) {
    const cow = Number(a.cowNumber);
    const share = Number(a.shareNumber);
    if (!merged.has(cow)) merged.set(cow, new Set());
    merged.get(cow).add(share);
  }
  return merged;
}

/**
 * @param {Map<number, Set<number>>} fullMap
 * @returns {Array<{ cowNumber: number, filled: number }>}
 */
export function cowsArrayFromOccupancyMap(fullMap) {
  const cows = [];
  for (const [cowNumber, set] of fullMap) {
    if (set.size === 0) continue;
    cows.push({ cowNumber, filled: Math.max(...set) });
  }
  cows.sort((a, b) => a.cowNumber - b.cowNumber);
  return cows;
}

/**
 * Build allocation segments from ordered assignments (booking row order).
 * Groups consecutive same-cow shares with consecutive share numbers.
 */
export function segmentsFromOrderedAssignments(assignments) {
  if (!assignments.length) return [];
  const segments = [];
  let cow = Number(assignments[0].cowNumber);
  let run = [Number(assignments[0].shareNumber)];
  for (let i = 1; i < assignments.length; i += 1) {
    const cur = assignments[i];
    const c = Number(cur.cowNumber);
    const s = Number(cur.shareNumber);
    const last = run[run.length - 1];
    if (c === cow && s === last + 1) {
      run.push(s);
    } else {
      segments.push({
        cowNumber: cow,
        fromShare: run[0],
        toShare: run[run.length - 1],
        shareNumbers: [...run],
        shareCount: run.length
      });
      cow = c;
      run = [s];
    }
  }
  segments.push({
    cowNumber: cow,
    fromShare: run[0],
    toShare: run[run.length - 1],
    shareNumbers: [...run],
    shareCount: run.length
  });
  return segments;
}

/**
 * For UI: per-cow sets occupied by others, and max cow to offer (max existing + 1).
 * @param {Map<number, Set<number>>} otherOccupancy
 */
export function allocationOptionsPayload(otherOccupancy, currentAssignments) {
  const prefixByCow = {};
  const rawByCow = {};
  let maxCow = 1;
  for (const [cow, set] of otherOccupancy) {
    maxCow = Math.max(maxCow, cow);
    rawByCow[cow] = [...set].sort((a, b) => a - b);
    let k = 0;
    for (let s = 1; s <= 7; s += 1) {
      if (set.has(s)) k = s;
      else break;
    }
    prefixByCow[cow] = k;
  }
  for (const a of currentAssignments ?? []) {
    maxCow = Math.max(maxCow, Number(a.cowNumber) || 0);
  }
  return {
    prefixByCow,
    rawByCow,
    maxCow: maxCow + 1,
    currentAssignments: (currentAssignments ?? []).map((a) => ({
      cowNumber: Number(a.cowNumber),
      shareNumber: Number(a.shareNumber)
    }))
  };
}

const SYNC_ATTEMPTS = 48;

/**
 * Mutates a Booking document: shares, cowShareAssignments, allocations, shareParticipantDetails.
 * Decrease: keeps the first `newShares` slots (removes the last rows).
 * Increase: appends new slots using the global allocator (other bookings’ occupancy only).
 *
 * @param {*} booking — Mongoose Booking document
 * @param {number} newShares
 * @param {Array<{ _id: unknown, cowShareAssignments?: unknown[], shares?: number }>} allBookingsLean
 * @param {string} bookingId
 * @returns {{ ok: true, changed: boolean } | { ok: false, message: string }}
 */
export function adjustBookingShareCount(booking, newShares, allBookingsLean, bookingId) {
  const oldN = booking.shares;
  const assignments = (booking.cowShareAssignments || []).map((a) => ({
    cowNumber: Number(a.cowNumber),
    shareNumber: Number(a.shareNumber)
  }));
  const details = booking.shareParticipantDetails || [];

  if (!Number.isInteger(newShares) || newShares < 1) {
    return { ok: false, message: 'shares must be a positive integer' };
  }
  if (newShares > MAX_SHARES_PER_BOOKING) {
    return { ok: false, message: `shares cannot exceed ${MAX_SHARES_PER_BOOKING}` };
  }
  if (assignments.length !== oldN) {
    return { ok: false, message: 'Booking data inconsistent; reload and try again' };
  }

  if (newShares === oldN) {
    return { ok: true, changed: false };
  }

  if (newShares < oldN) {
    const kept = assignments.slice(0, newShares);
    booking.cowShareAssignments = kept;
    booking.allocations = segmentsFromOrderedAssignments(kept);
    booking.shares = newShares;
    booking.shareParticipantDetails = kept.map((a, i) => {
      const d = details[i];
      return {
        cowNumber: a.cowNumber,
        shareNumber: a.shareNumber,
        name: typeof d?.name === 'string' ? d.name.trim() : '',
        contact: typeof d?.contact === 'string' ? d.contact.trim() : '',
        address: typeof d?.address === 'string' ? d.address.trim() : ''
      };
    });
    return { ok: true, changed: true };
  }

  const delta = newShares - oldN;
  const otherMap = buildOccupancyMapExcludingBooking(allBookingsLean, bookingId);
  const otherCowsDense = denseCowsFromOccupancyMap(otherMap);
  let added;
  try {
    ({ assignments: added } = computeAllocationFromCows(otherCowsDense, delta));
  } catch (e) {
    return { ok: false, message: e?.message || 'Could not allocate additional shares' };
  }

  const combined = [...assignments, ...added];
  const merged = mergeOccupancy(otherMap, combined);
  const vPrefix = validatePrefixOccupancy(merged);
  if (!vPrefix.ok) {
    return { ok: false, message: vPrefix.message };
  }

  booking.cowShareAssignments = combined;
  booking.allocations = segmentsFromOrderedAssignments(combined);
  booking.shares = newShares;
  booking.shareParticipantDetails = combined.map((a, i) => {
    if (i < oldN) {
      const d = details[i];
      return {
        cowNumber: a.cowNumber,
        shareNumber: a.shareNumber,
        name: typeof d?.name === 'string' ? d.name.trim() : '',
        contact: typeof d?.contact === 'string' ? d.contact.trim() : '',
        address: typeof d?.address === 'string' ? d.address.trim() : ''
      };
    }
    return {
      cowNumber: a.cowNumber,
      shareNumber: a.shareNumber,
      name: '',
      contact: '',
      address: ''
    };
  });

  return { ok: true, changed: true };
}

/** Rebuild AllocationState.cows from all bookings (CAS on stateVersion). */
export async function syncAllocationStateFromAllBookings() {
  const bookings = await Booking.find({}).select('cowShareAssignments').lean();
  const full = buildFullOccupancyMap(bookings);
  const prefix = validatePrefixOccupancy(full);
  if (!prefix.ok) {
    const err = new Error(prefix.message || 'Invalid global occupancy');
    err.code = 'INVALID_GLOBAL_OCCUPANCY';
    throw err;
  }
  const newCows = cowsArrayFromOccupancyMap(full);
  for (let attempt = 0; attempt < SYNC_ATTEMPTS; attempt += 1) {
    const state = await AllocationState.findById(GLOBAL_ID).lean();
    const prevV = typeof state?.stateVersion === 'number' ? state.stateVersion : 0;
    const r = await AllocationState.updateOne(
      { _id: GLOBAL_ID, stateVersion: prevV },
      { $set: { cows: newCows }, $inc: { stateVersion: 1 } }
    );
    if (r.modifiedCount === 1) return;
  }
  const err = new Error('Could not sync allocation state; try again');
  err.code = 'ALLOCATION_SYNC_CONTENTION';
  throw err;
}
