import mongoose from 'mongoose';
import { Booking } from '../models/Booking.js';
import {
  ALLOCATION_CONTENTION,
  persistBookingWithAllocation
} from '../services/persistBookingWithAllocation.js';
import { isValidPhone } from '../utils/phone.js';

function bookingFilter(req) {
  return req.user.role === 'admin' ? {} : { created_by: req.user.id };
}

function bookingOwnerMatches(req, bookingDocOrLean) {
  if (req.user.role === 'admin') return true;
  const created = bookingDocOrLean.created_by;
  const oid = created?._id?.toString?.() ?? created?.toString?.();
  return oid === req.user.id;
}

export async function listBookings(req, res) {
  const bookings = await Booking.find(bookingFilter(req))
    .populate('created_by', 'name email')
    .sort({ created_at: -1 })
    .lean();
  res.json(bookings);
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
  res.json(booking);
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

  booking.shareParticipantDetails = assignments.map((a, i) => {
    const d = shareParticipantDetails[i];
    return {
      cowNumber: a.cowNumber,
      shareNumber: a.shareNumber,
      name: typeof d.name === 'string' ? d.name.trim() : '',
      contact: typeof d.contact === 'string' ? d.contact.trim() : '',
      address: typeof d.address === 'string' ? d.address.trim() : ''
    };
  });

  await booking.save();
  const populated = await Booking.findById(id).populate('created_by', 'name email').lean();
  res.json(populated);
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
    res.status(201).json(populated);
  } catch (e) {
    console.error(e);
    if (e?.code === ALLOCATION_CONTENTION) {
      return res.status(503).json({ error: e.message });
    }
    res.status(500).json({ error: 'Could not create booking' });
  }
}
