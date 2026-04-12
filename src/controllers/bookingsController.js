import mongoose from 'mongoose';
import { Booking } from '../models/Booking.js';
import {
  ALLOCATION_CONTENTION,
  persistBookingWithAllocation
} from '../services/persistBookingWithAllocation.js';
import {
  adjustBookingShareCount,
  allocationOptionsPayload,
  buildOccupancyMapExcludingBooking,
  mergeOccupancy,
  normalizeAssignmentsToConsecutivePerCow,
  segmentsFromOrderedAssignments,
  syncAllocationStateFromAllBookings,
  validatePrefixOccupancy,
  validateProposedAgainstOthers
} from '../services/allocationEditService.js';
import { isValidPhone } from '../utils/phone.js';

function bookingFilter(req) {
  return req.user.role === 'admin' ? {} : { created_by: req.user.id };
}

/** @param {{ shares?: number, cowShareAssignments?: unknown[], shareParticipantDetails?: { paymentReceived?: boolean }[] }} booking */
function computePaymentStatus(booking) {
  const n =
    typeof booking.shares === 'number'
      ? booking.shares
      : booking.cowShareAssignments?.length ?? 0;
  if (n < 1) return 'pending';
  const details = booking.shareParticipantDetails || [];
  let paid = 0;
  for (let i = 0; i < n; i += 1) {
    if (details[i]?.paymentReceived === true) paid += 1;
  }
  if (paid === n) return 'paid';
  if (paid === 0) return 'pending';
  if (n === 1) return 'pending';
  return 'partial';
}

function enrichBookingWithPaymentStatus(b) {
  return { ...b, paymentStatus: computePaymentStatus(b) };
}

function bookingOwnerMatches(req, bookingDocOrLean) {
  if (req.user.role === 'admin') return true;
  const created = bookingDocOrLean.created_by;
  const oid = created?._id?.toString?.() ?? created?.toString?.();
  return oid === req.user.id;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCowsQuery(cowsParam) {
  if (cowsParam == null || cowsParam === '') return [];
  const raw = Array.isArray(cowsParam) ? cowsParam.join(',') : String(cowsParam);
  return [
    ...new Set(
      raw
        .split(',')
        .map((x) => parseInt(String(x).trim(), 10))
        .filter((n) => Number.isInteger(n) && n >= 1)
    )
  ];
}

const PAYMENT_STATUS_ALL = new Set(['pending', 'partial', 'paid']);

function parsePaymentsQuery(query) {
  const raw = query.payments ?? query.payment;
  if (raw == null || raw === '') return [];
  const parts = Array.isArray(raw)
    ? raw.flatMap((x) => String(x).split(','))
    : String(raw).split(',');
  return [
    ...new Set(
      parts
        .map((s) => String(s).trim().toLowerCase())
        .filter((s) => PAYMENT_STATUS_ALL.has(s))
    )
  ];
}

/**
 * Mongo match for list filter; aligns with computePaymentStatus().
 * @param {string[]} statuses — subset of pending, partial, paid
 * @returns {object | null} — merge with $and, or null if no filter
 */
function buildPaymentStatusQuery(statuses) {
  const set = new Set(statuses.filter((s) => PAYMENT_STATUS_ALL.has(s)));
  if (set.size === 0 || set.size === PAYMENT_STATUS_ALL.size) return null;

  const sliceDetails = {
    $slice: [{ $ifNull: ['$shareParticipantDetails', []] }, '$shares']
  };
  const paidCountExpr = {
    $size: {
      $filter: {
        input: sliceDetails,
        as: 'd',
        cond: { $eq: ['$$d.paymentReceived', true] }
      }
    }
  };

  const branches = [];
  if (set.has('paid')) {
    branches.push({
      $expr: {
        $and: [{ $gte: ['$shares', 1] }, { $eq: [paidCountExpr, '$shares'] }]
      }
    });
  }
  if (set.has('pending')) {
    branches.push({
      $expr: { $eq: [paidCountExpr, 0] }
    });
  }
  if (set.has('partial')) {
    branches.push({
      $expr: {
        $and: [
          { $gt: ['$shares', 1] },
          { $gt: [paidCountExpr, 0] },
          { $lt: [paidCountExpr, '$shares'] }
        ]
      }
    });
  }
  if (branches.length === 0) return null;
  if (branches.length === 1) return branches[0];
  return { $or: branches };
}

export async function listDistinctCowNumbers(req, res) {
  const filter = bookingFilter(req);
  const raw = await Booking.distinct('cowShareAssignments.cowNumber', filter);
  const nums = [
    ...new Set(raw.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 1))
  ].sort((a, b) => a - b);
  res.json(nums);
}

export async function listBookings(req, res) {
  const allowedLimits = [10, 20, 30, 50];
  const limitRaw = parseInt(String(req.query.limit ?? ''), 10);
  const limit = allowedLimits.includes(limitRaw) ? limitRaw : 10;
  const pageRaw = parseInt(String(req.query.page ?? ''), 10);
  const pageRequested = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  let filter = { ...bookingFilter(req) };

  const nameQ = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  if (nameQ) {
    filter.name = { $regex: escapeRegex(nameQ), $options: 'i' };
  }

  const contactQ = typeof req.query.contact === 'string' ? req.query.contact.trim() : '';
  if (contactQ) {
    filter.contact = { $regex: escapeRegex(contactQ), $options: 'i' };
  }

  const cows = parseCowsQuery(req.query.cows);
  if (cows.length > 0) {
    filter['cowShareAssignments.cowNumber'] = { $in: cows };
  }

  const paymentStatuses = parsePaymentsQuery(req.query);
  const paymentQ = buildPaymentStatusQuery(paymentStatuses);
  if (paymentQ) {
    filter = { $and: [filter, paymentQ] };
  }

  const total = await Booking.countDocuments(filter);
  const totalPages = total === 0 ? 1 : Math.ceil(total / limit);
  const page = Math.min(Math.max(1, pageRequested), totalPages);
  const skip = (page - 1) * limit;

  const bookings = await Booking.find(filter)
    .populate('created_by', 'name email')
    .sort({ created_at: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  res.json({
    data: bookings.map(enrichBookingWithPaymentStatus),
    page,
    limit,
    total,
    totalPages
  });
}

export async function getBookingById(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid booking id' });
  }
  const booking = await Booking.findById(id).populate('created_by', 'name email').lean();
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }
  if (!bookingOwnerMatches(req, booking)) {
    return res.status(403).json({ error: 'You do not have access to this booking' });
  }
  res.json(enrichBookingWithPaymentStatus(booking));
}

export async function updateSharePayment(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid booking id' });
  }
  const { index, paymentReceived } = req.body ?? {};
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0) {
    return res.status(400).json({ error: 'index must be a non-negative integer (share row)' });
  }
  if (typeof paymentReceived !== 'boolean') {
    return res.status(400).json({ error: 'paymentReceived must be a boolean' });
  }

  const booking = await Booking.findById(id);
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }
  if (!bookingOwnerMatches(req, booking)) {
    return res.status(403).json({ error: 'You do not have access to this booking' });
  }

  const det = booking.shareParticipantDetails || [];
  if (idx >= det.length) {
    return res.status(400).json({ error: 'Invalid share index' });
  }

  det[idx].paymentReceived = paymentReceived;
  booking.markModified('shareParticipantDetails');
  await booking.save();
  const populated = await Booking.findById(id).populate('created_by', 'name email').lean();
  res.json(enrichBookingWithPaymentStatus(populated));
}

export async function updateShareParticipantDetails(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid booking id' });
  }
  const { shareParticipantDetails } = req.body ?? {};
  if (!Array.isArray(shareParticipantDetails)) {
    return res.status(400).json({ error: 'shareParticipantDetails must be an array' });
  }

  const booking = await Booking.findById(id);
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }
  if (!bookingOwnerMatches(req, booking)) {
    return res.status(403).json({ error: 'You do not have access to this booking' });
  }

  const assignments = booking.cowShareAssignments || [];
  if (assignments.length === 0) {
    return res.status(400).json({ error: 'Booking has no share slots' });
  }
  if (shareParticipantDetails.length !== assignments.length) {
    return res.status(400).json({
      error: `shareParticipantDetails must have ${assignments.length} row(s), one per share`
    });
  }

  for (let i = 0; i < assignments.length; i += 1) {
    const d = shareParticipantDetails[i];
    const a = assignments[i];
    if (
      !d ||
      Number(d.cowNumber) !== a.cowNumber ||
      Number(d.shareNumber) !== a.shareNumber
    ) {
      return res.status(400).json({
        error: 'shareParticipantDetails must follow the same order as share slots (cow · share)'
      });
    }
    const c = typeof d.contact === 'string' ? d.contact.trim() : '';
    if (c && !isValidPhone(c)) {
      return res.status(400).json({
        error: `Invalid phone for cow ${a.cowNumber}, share ${a.shareNumber}`
      });
    }
  }

  const prevDetails = booking.shareParticipantDetails || [];
  booking.shareParticipantDetails = assignments.map((a, i) => {
    const d = shareParticipantDetails[i];
    const prev = prevDetails[i];
    return {
      cowNumber: a.cowNumber,
      shareNumber: a.shareNumber,
      name: typeof d.name === 'string' ? d.name.trim() : '',
      contact: typeof d.contact === 'string' ? d.contact.trim() : '',
      address: typeof d.address === 'string' ? d.address.trim() : '',
      paymentReceived: prev?.paymentReceived === true
    };
  });

  await booking.save();
  const populated = await Booking.findById(id).populate('created_by', 'name email').lean();
  res.json(enrichBookingWithPaymentStatus(populated));
}

export async function getAllocationOptions(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid booking id' });
  }
  const booking = await Booking.findById(id).lean();
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }
  if (!bookingOwnerMatches(req, booking)) {
    return res.status(403).json({ error: 'You do not have access to this booking' });
  }
  const all = await Booking.find({}).select('cowShareAssignments').lean();
  const otherMap = buildOccupancyMapExcludingBooking(all, id);
  const payload = allocationOptionsPayload(
    otherMap,
    booking.cowShareAssignments || []
  );
  res.json({
    shares: booking.shares,
    ...payload
  });
}

export async function updateAllocationAndShareDetails(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid booking id' });
  }
  const { cowShareAssignments, shareParticipantDetails } = req.body ?? {};
  if (!Array.isArray(cowShareAssignments) || !Array.isArray(shareParticipantDetails)) {
    return res.status(400).json({
      error: 'cowShareAssignments and shareParticipantDetails must be arrays'
    });
  }

  const booking = await Booking.findById(id);
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }
  if (!bookingOwnerMatches(req, booking)) {
    return res.status(403).json({ error: 'You do not have access to this booking' });
  }

  const expected = booking.shares;
  if (cowShareAssignments.length !== expected || shareParticipantDetails.length !== expected) {
    return res.status(400).json({
      error: `Expected ${expected} share row(s) for cowShareAssignments and shareParticipantDetails`
    });
  }

  const proposedRaw = cowShareAssignments.map((a) => ({
    cowNumber: Number(a.cowNumber),
    shareNumber: Number(a.shareNumber)
  }));

  const all = await Booking.find({}).select('cowShareAssignments').lean();
  const otherMap = buildOccupancyMapExcludingBooking(all, id);
  const norm = normalizeAssignmentsToConsecutivePerCow(otherMap, proposedRaw);
  if (!norm.ok) {
    return res.status(400).json({ error: norm.message });
  }
  const proposed = norm.assignments;

  const vOther = validateProposedAgainstOthers(proposed, otherMap);
  if (!vOther.ok) {
    return res.status(400).json({ error: vOther.message });
  }

  const merged = mergeOccupancy(otherMap, proposed);
  const vPrefix = validatePrefixOccupancy(merged);
  if (!vPrefix.ok) {
    return res.status(400).json({ error: vPrefix.message });
  }

  for (let i = 0; i < expected; i += 1) {
    const d = shareParticipantDetails[i];
    if (!d || typeof d !== 'object') {
      return res.status(400).json({
        error: `shareParticipantDetails row ${i + 1} is missing`
      });
    }
    const c = typeof d.contact === 'string' ? d.contact.trim() : '';
    if (c && !isValidPhone(c)) {
      return res.status(400).json({
        error: `Invalid phone on share row ${i + 1}`
      });
    }
  }

  const segments = segmentsFromOrderedAssignments(proposed);
  const sumSeg = segments.reduce((acc, s) => acc + s.shareCount, 0);
  if (sumSeg !== expected) {
    return res.status(400).json({ error: 'Allocation segments do not match share count' });
  }

  const prevDetails = booking.shareParticipantDetails || [];
  const prevPayBySlot = new Map();
  for (const row of prevDetails) {
    if (row?.cowNumber != null && row?.shareNumber != null) {
      prevPayBySlot.set(`${row.cowNumber}:${row.shareNumber}`, row.paymentReceived === true);
    }
  }

  booking.cowShareAssignments = proposed;
  booking.allocations = segments;
  booking.shareParticipantDetails = proposed.map((a, i) => {
    const d = shareParticipantDetails[i];
    const key = `${a.cowNumber}:${a.shareNumber}`;
    const fromBody =
      d && typeof d.paymentReceived === 'boolean' ? d.paymentReceived : undefined;
    const fromPrevSlot = prevPayBySlot.get(key);
    const paymentReceived =
      fromBody !== undefined ? fromBody : fromPrevSlot === true ? true : false;
    return {
      cowNumber: a.cowNumber,
      shareNumber: a.shareNumber,
      name: typeof d.name === 'string' ? d.name.trim() : '',
      contact: typeof d.contact === 'string' ? d.contact.trim() : '',
      address: typeof d.address === 'string' ? d.address.trim() : '',
      paymentReceived
    };
  });

  try {
    await booking.save();
    await syncAllocationStateFromAllBookings();
  } catch (e) {
    console.error(e);
    if (e?.code === 'INVALID_GLOBAL_OCCUPANCY' || e?.code === 'ALLOCATION_SYNC_CONTENTION') {
      return res.status(503).json({ error: e.message });
    }
    return res.status(500).json({ error: 'Could not save allocation' });
  }

  const populated = await Booking.findById(id).populate('created_by', 'name email').lean();
  res.json(enrichBookingWithPaymentStatus(populated));
}

export async function patchBooking(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid booking id' });
  }
  const { shares } = req.body ?? {};
  if (shares === undefined) {
    return res.status(400).json({ error: 'Provide shares (total share count)' });
  }
  const newShares = Number(shares);

  const booking = await Booking.findById(id);
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }
  if (!bookingOwnerMatches(req, booking)) {
    return res.status(403).json({ error: 'You do not have access to this booking' });
  }

  const all = await Booking.find({}).select('cowShareAssignments shares').lean();
  const result = adjustBookingShareCount(booking, newShares, all, id);
  if (!result.ok) {
    return res.status(400).json({ error: result.message });
  }
  if (!result.changed) {
    const populated = await Booking.findById(id).populate('created_by', 'name email').lean();
    return res.json(enrichBookingWithPaymentStatus(populated));
  }

  try {
    await booking.save();
    await syncAllocationStateFromAllBookings();
  } catch (e) {
    console.error(e);
    if (e?.code === 'INVALID_GLOBAL_OCCUPANCY' || e?.code === 'ALLOCATION_SYNC_CONTENTION') {
      return res.status(503).json({ error: e.message });
    }
    return res.status(500).json({ error: 'Could not update share count' });
  }

  const populated = await Booking.findById(id).populate('created_by', 'name email').lean();
  res.json(enrichBookingWithPaymentStatus(populated));
}

export async function deleteBooking(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid booking id' });
  }
  const existing = await Booking.findById(id).lean();
  if (!existing) {
    return res.status(404).json({ error: 'Booking not found' });
  }
  if (!bookingOwnerMatches(req, existing)) {
    return res.status(403).json({ error: 'You do not have access to this booking' });
  }

  await Booking.deleteOne({ _id: id });
  try {
    await syncAllocationStateFromAllBookings();
  } catch (e) {
    console.error(e);
    return res.status(503).json({ error: e.message || 'Could not sync allocation after delete' });
  }
  res.status(204).send();
}

export async function createBooking(req, res) {
  const { name, contact, shares } = req.body ?? {};

  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (typeof contact !== 'string' || !isValidPhone(contact)) {
    return res.status(400).json({ error: 'Valid phone number is required' });
  }
  const shareNum = Number(shares);
  if (!Number.isInteger(shareNum) || shareNum < 1) {
    return res.status(400).json({ error: 'shares must be a positive integer' });
  }

  try {
    const created = await persistBookingWithAllocation({
      name: name.trim(),
      contact: contact.trim(),
      shareNum,
      createdBy: req.user.id
    });
    const populated = await Booking.findById(created._id)
      .populate('created_by', 'name email')
      .lean();
    res.status(201).json(enrichBookingWithPaymentStatus(populated));
  } catch (e) {
    console.error(e);
    if (e?.code === ALLOCATION_CONTENTION) {
      return res.status(503).json({ error: e.message });
    }
    res.status(500).json({ error: 'Could not create booking' });
  }
}
