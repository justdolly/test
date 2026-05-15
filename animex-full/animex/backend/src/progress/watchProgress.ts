// watchProgress.ts
// Problem: 1000+ updates/sec would destroy DB
// Solution: Redis buffer → debounce per user/episode → batch flush every 30s

import { redis } from "../lib/redis";
import { prisma } from "../lib/prisma";

const DEBOUNCE_TTL = 10;     // seconds — collapse rapid updates
const FLUSH_INTERVAL = 30000; // ms — periodic DB flush

interface ProgressData {
  userId: string;
  animeId: string;
  episodeId: string;
  position: number;
  duration: number;
  completed: boolean;
}

// ─── BUFFER WRITE (called on every frontend heartbeat) ─────────────────────
export async function bufferProgress(data: ProgressData): Promise<void> {
  const key = `progress:${data.userId}:${data.episodeId}`;
  await redis.setex(key, DEBOUNCE_TTL * 6, JSON.stringify(data)); // TTL = 1min

  // Track active keys for flush
  await redis.sadd("progress:active", key);
}

// ─── FLUSH to DB (runs every 30s via setInterval or BullMQ repeat job) ─────
export async function flushProgressBuffer(): Promise<void> {
  const keys = await redis.smembers("progress:active");
  if (!keys.length) return;

  const pipeline = redis.pipeline();
  keys.forEach(k => pipeline.get(k));
  const results = await pipeline.exec();

  const upserts: ProgressData[] = [];
  const deadKeys: string[] = [];

  results?.forEach((result, i) => {
    const [err, val] = result as [Error | null, string | null];
    if (err || !val) { deadKeys.push(keys[i]); return; }
    try { upserts.push(JSON.parse(val)); } catch {}
  });

  if (upserts.length) {
    // Batch upsert — single round-trip via $transaction
    await prisma.$transaction(
      upserts.map(d =>
        prisma.watchProgress.upsert({
          where: { userId_episodeId: { userId: d.userId, episodeId: d.episodeId } },
          create: d,
          update: { position: d.position, completed: d.completed },
        })
      )
    );
  }

  // Clean up dead keys from tracking set
  if (deadKeys.length) {
    await redis.srem("progress:active", ...deadKeys);
  }
}

// ─── START flush loop (call once at app startup) ───────────────────────────
export function startProgressFlusher(): NodeJS.Timeout {
  return setInterval(flushProgressBuffer, FLUSH_INTERVAL);
}

// ─── GET progress for a user (read from DB, fallback to Redis buffer) ───────
export async function getProgress(userId: string, episodeId: string) {
  // Try Redis buffer first (most recent)
  const buffered = await redis.get(`progress:${userId}:${episodeId}`);
  if (buffered) return JSON.parse(buffered);

  return prisma.watchProgress.findUnique({
    where: { userId_episodeId: { userId, episodeId } },
  });
}

// ─── GET watch history for user (from DB, paginated) ──────────────────────
export async function getWatchHistory(userId: string, page = 1, limit = 20) {
  return prisma.watchProgress.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    skip: (page - 1) * limit,
    take: limit,
    include: {
      episode: { select: { number: true, title: true, thumbnail: true } },
      anime: { select: { slug: true, title: true, coverImage: true } },
    },
  });
}
