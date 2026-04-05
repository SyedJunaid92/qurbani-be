import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { createUser, listUsers } from '../controllers/adminUsersController.js';

export const adminRouter = Router();

adminRouter.use(authenticate, requireAdmin);

adminRouter.get('/users', listUsers);
adminRouter.post('/users', createUser);
