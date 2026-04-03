import { Router } from 'express';
import {
  createBooking,
  getBookingById,
  listBookings
} from '../controllers/bookingsController.js';

export const bookingsRouter = Router();

bookingsRouter.get('/', listBookings);
bookingsRouter.get('/:id', getBookingById);
bookingsRouter.post('/', createBooking);
