import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import { json } from 'express';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from './lib/redis';
import { prisma } from './lib/prisma';
import { startProgressFlusher } from './progress/watchProgress';

// Routes
import authRouter from './routes/auth';
import animeRouter from './routes/anime';
import streamRouter from './routes/stream';
import progressRouter from './routes/progress';
import userRouter from './routes/user';

const app = express();
app.set('trust proxy', 1);

// ── SECURITY ──────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // frontend served by nginx with its own CSP
  crossOriginEmbedderPolicy: false,
}));

// ── CORS — only same origin needed (nginx proxies /api) ───────────────────
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost').split(',');
app.use(cors({
  origin: (o, cb) => (!o || ORIGINS.includes(o) ? cb(null, true) : cb(new Error('CORS'))),
  credentials: true,
}));

app.use(compression());
app.use(json({ limit: '64kb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── GLOBAL RATE LIMIT ─────────────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({ sendCommand: (...a: string[]) => (redis as any).call(...a) }),
}));

// ── ROUTES ────────────────────────────────────────────────────────────────
app.use('/api/auth',     authRouter);
app.use('/api/anime',    animeRouter);
app.use('/api/stream',   streamRouter);
app.use('/api/progress', progressRouter);
app.use('/api/user',     userRouter);

// ── HEALTH ────────────────────────────────────────────────────────────────
app.get('/api/health', async (_, res) => {
  const [db, cache] = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`,
    redis.ping(),
  ]);
  const ok = db.status === 'fulfilled' && cache.status === 'fulfilled';
  res.status(ok ? 200 : 503).json({ status: ok ? 'healthy' : 'degraded', ts: Date.now() });
});

// ── ERROR ─────────────────────────────────────────────────────────────────
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(err?.message ?? err);
  res.status(err.status ?? 500).json({ error: err.message ?? 'Internal error' });
});

const PORT = parseInt(process.env.PORT ?? '4000');
app.listen(PORT, '0.0.0.0', () => {
  console.log(`ANIMEX API → :${PORT} [${process.env.NODE_ENV}]`);
  startProgressFlusher();
});

export default app;
