import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { sendVerificationEmail, sendPasswordResetEmail } from '../lib/mailer';
import type { Request, Response, NextFunction } from 'express';

const JWT_SECRET    = process.env.JWT_SECRET!;
const BCRYPT_ROUNDS = 12;
const JWT_TTL       = '7d';
const VERIFY_TTL    = 86_400;
const RESET_TTL     = 3_600;

async function rl(key: string, max: number, win: number): Promise<boolean> {
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, win);
  return n > max;
}

export async function signup(req: Request, res: Response) {
  if (await rl(`rl:signup:${req.ip}`, 5, 3600)) return res.status(429).json({ error: 'Too many signups' });
  const { email, password, username } = req.body;
  if (!email || !password || !username) return res.status(400).json({ error: 'Missing fields' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });
  if (password.length < 8) return res.status(400).json({ error: 'Password too short' });
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Invalid username' });

  const exists = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] }, select: { id: true } });
  if (exists) return res.status(409).json({ error: 'Email or username already taken' });

  const passwordHash    = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const verifyToken     = crypto.randomBytes(32).toString('hex');
  const verifyExpiresAt = new Date(Date.now() + VERIFY_TTL * 1000);

  const user = await prisma.user.create({
    data: { email, passwordHash, username, verifyToken, verifyExpiresAt },
    select: { id: true, username: true, email: true },
  });

  await sendVerificationEmail(email, verifyToken);
  res.status(201).json({ message: 'Account created. Check your email to verify.', user });
}

export async function verifyEmail(req: Request, res: Response) {
  if (await rl(`rl:verify:${req.ip}`, 10, 3600)) return res.status(429).json({ error: 'Too many attempts' });
  const token = req.query.token as string;
  if (!token || token.length !== 64) return res.status(400).json({ error: 'Invalid token' });

  const user = await prisma.user.findUnique({ where: { verifyToken: token },
    select: { id: true, verifyExpiresAt: true, isVerified: true } });
  if (!user) return res.status(400).json({ error: 'Invalid or expired token' });
  if (user.isVerified) return res.json({ message: 'Already verified' });
  if (user.verifyExpiresAt! < new Date()) return res.status(400).json({ error: 'Token expired' });

  await prisma.user.update({ where: { id: user.id },
    data: { isVerified: true, verifyToken: null, verifyExpiresAt: null } });
  res.json({ message: 'Email verified. You can now sign in.' });
}

export async function login(req: Request, res: Response) {
  if (await rl(`rl:login:${req.ip}`, 10, 900)) return res.status(429).json({ error: 'Too many login attempts' });
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });

  const user = await prisma.user.findUnique({ where: { email },
    select: { id: true, passwordHash: true, isVerified: true, role: true, username: true, avatarUrl: true, createdAt: true } });

  const hash  = user?.passwordHash ?? '$2b$12$invalidhashpadding000000000000000000000000000000000000';
  const match = await bcrypt.compare(password, hash);
  if (!user || !match) return res.status(401).json({ error: 'Invalid credentials' });
  if (!user.isVerified) return res.status(403).json({ error: 'Please verify your email first' });

  const jti     = crypto.randomUUID();
  const token   = jwt.sign({ sub: user.id, role: user.role, jti }, JWT_SECRET, { expiresIn: JWT_TTL });
  const jtiHash = crypto.createHash('sha256').update(jti).digest('hex');

  await prisma.session.create({
    data: { userId: user.id, tokenHash: jtiHash,
            expiresAt: new Date(Date.now() + 7 * 86_400_000),
            ip: req.ip, userAgent: req.headers['user-agent'] },
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  res.json({
    token,
    user: { id: user.id, username: user.username, email, avatarUrl: user.avatarUrl,
            role: user.role, createdAt: user.createdAt },
  });
}

export async function logout(req: Request, res: Response) {
  const jtiHash = crypto.createHash('sha256').update((req as any).user.jti).digest('hex');
  await prisma.session.deleteMany({ where: { tokenHash: jtiHash } });
  res.json({ message: 'Logged out' });
}

export async function forgotPassword(req: Request, res: Response) {
  const { email } = req.body;
  if (await rl(`rl:forgot:${email}`, 3, 3600)) return res.status(429).json({ error: 'Too many requests' });
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (user) {
    const resetToken = crypto.randomBytes(32).toString('hex');
    await prisma.user.update({ where: { id: user.id },
      data: { resetToken, resetExpiresAt: new Date(Date.now() + RESET_TTL * 1000) } });
    await sendPasswordResetEmail(email, resetToken);
  }
  res.json({ message: 'If that email exists, a reset link was sent.' });
}

export async function resetPassword(req: Request, res: Response) {
  const { token, password } = req.body;
  if (!token || !password || password.length < 8) return res.status(400).json({ error: 'Invalid request' });
  const user = await prisma.user.findUnique({ where: { resetToken: token },
    select: { id: true, resetExpiresAt: true } });
  if (!user || user.resetExpiresAt! < new Date()) return res.status(400).json({ error: 'Invalid or expired token' });

  await prisma.user.update({ where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS), resetToken: null, resetExpiresAt: null } });
  await prisma.session.deleteMany({ where: { userId: user.id } });
  res.json({ message: 'Password updated. Please sign in.' });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  let payload: any;
  try { payload = jwt.verify(h.slice(7), JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Invalid or expired token' }); }

  const jtiHash = crypto.createHash('sha256').update(payload.jti).digest('hex');
  const session = await prisma.session.findUnique({ where: { tokenHash: jtiHash } });
  if (!session || session.expiresAt < new Date()) return res.status(401).json({ error: 'Session expired' });
  (req as any).user = payload;
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!roles.includes((req as any).user?.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}
