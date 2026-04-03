import mongoose from 'mongoose';
import { Booking } from '../models/Booking.js';
import {
  ALLOCATION_CONTENTION,
  persistBookingWithAllocation
} from '../services/persistBookingWithAllocation.js';
import { isValidPhone } from '../utils/phone.js';

export async function listBookings(_req, res) {
  const bookings = await Booking.find().sort({ created_at: -1 }).lean();
  res.json(bookings);
}

export async function getBookingById(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid booking id' });
  }
  const booking = await Booking.findById(id).lean();
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }
  res.json(booking);
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
      shareNum
    });
    res.status(201).json(created.toObject());
  } catch (e) {
    console.error(e);
    if (e?.code === ALLOCATION_CONTENTION) {
      return res.status(503).json({ error: e.message });
    }
    res.status(500).json({ error: 'Could not create booking' });
  }
}
