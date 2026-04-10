import { Router } from 'express';
import {
  createBooking,
  getBookingById,
  listBookings,
  updateShareParticipantDetails
} from '../controllers/bookingsController.js';

export const bookingsRouter = Router();

bookingsRouter.get('/', listBookings);
bookingsRouter.post('/', createBooking);
bookingsRouter.patch('/:id/share-details', updateShareParticipantDetails);
bookingsRouter.get('/:id', getBookingById);
