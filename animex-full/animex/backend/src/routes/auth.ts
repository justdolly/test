import { Router } from 'express';
import { signup, login, logout, verifyEmail, forgotPassword, resetPassword, requireAuth } from '../auth/auth';

const r = Router();

r.post('/signup',          signup);
r.post('/login',           login);
r.post('/logout',          requireAuth, logout);
r.get( '/verify-email',    verifyEmail);
r.post('/forgot-password', forgotPassword);
r.post('/reset-password',  resetPassword);
r.get( '/me',              requireAuth, (req, res) => res.json((req as any).user));

export default r;
