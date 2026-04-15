import { Router } from 'express';
import {
  createBooking,
  deleteBooking,
  exportData,
  getAllocationOptions,
  getBookingById,
  listBookings,
  listDistinctCowNumbers,
  patchBooking,
  updateAllocationAndShareDetails,
  updateShareParticipantDetails
} from '../controllers/bookingsController.js';

export const bookingsRouter = Router();

bookingsRouter.get('/cow-numbers', listDistinctCowNumbers);
bookingsRouter.get('/export-data', exportData);
bookingsRouter.get('/', listBookings);
bookingsRouter.post('/', createBooking);
bookingsRouter.get('/:id/allocation-options', getAllocationOptions);
bookingsRouter.patch('/:id/allocation-details', updateAllocationAndShareDetails);
bookingsRouter.patch('/:id/share-details', updateShareParticipantDetails);
bookingsRouter.patch('/:id', patchBooking);
bookingsRouter.delete('/:id', deleteBooking);
bookingsRouter.get('/:id', getBookingById);
