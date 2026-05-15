// mirrorResolver.ts
// Brain: DB → Resolver → signed token → frontend
// Real URLs NEVER leave this layer

import crypto from "crypto";
import { redis } from "./lib/redis";
import { prisma } from "./lib/prisma";
import { MirrorHealth } from "@prisma/client";

const CACHE_TTL = 30;          // seconds — mirror health cache
const TOKEN_TTL = 120;         // seconds — signed stream token
const HMAC_SECRET = process.env.STREAM_SECRET!;
const URL_ENCRYPTION_KEY = process.env.MIRROR_ENC_KEY!; // 32-byte hex

// ─── DECRYPT stored mirror URL ─────────────────────────────────────────────
function decryptUrl(encrypted: string): string {
  const [ivHex, authTagHex, cipherHex] = encrypted.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const key = Buffer.from(URL_ENCRYPTION_KEY, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(cipherHex, "hex", "utf8") + decipher.final("utf8");
}

// ─── ENCRYPT URL before storing in DB ─────────────────────────────────────
export function encryptUrl(rawUrl: string): string {
  const key = Buffer.from(URL_ENCRYPTION_KEY, "hex");
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(rawUrl, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`;
}

// ─── HEALTH CHECK a single mirror (HEAD request, 2s timeout) ──────────────
async function checkMirrorHealth(
  mirrorId: string,
  encryptedUrl: string
): Promise<boolean> {
  const cacheKey = `mirror:health:${mirrorId}`;
  const cached = await redis.get(cacheKey);
  if (cached !== null) return cached === "1";

  try {
    const url = decryptUrl(encryptedUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(url, { method: "HEAD", signal: controller.signal });
    clearTimeout(timeout);
    const healthy = res.ok || res.status === 405; // 405 = HEAD not allowed but server alive
    await redis.setex(cacheKey, CACHE_TTL, healthy ? "1" : "0");
    return healthy;
  } catch {
    await redis.setex(cacheKey, CACHE_TTL, "0");
    return false;
  }
}

// ─── RESOLVE best mirror for an episode ───────────────────────────────────
interface ResolvedStream {
  token: string;     // signed, expiring — sent to frontend
  provider: string;
  quality: string;
  type: "SUB" | "DUB" | "RAW";
  expiresAt: number;
}

export async function resolveStream(
  episodeId: string,
  preferType: "SUB" | "DUB" = "SUB",
  userId: string
): Promise<ResolvedStream | null> {
  // 1. Fetch mirrors sorted by priority
  const mirrors = await prisma.episodeMirror.findMany({
    where: {
      episodeId,
      type: preferType,
      healthStatus: { in: ["HEALTHY", "UNKNOWN"] },
    },
    orderBy: { priority: "asc" },
  });

  if (!mirrors.length) return null;

  // 2. Find first healthy mirror (parallel health check with short-circuit)
  let selectedMirror: typeof mirrors[0] | null = null;
  for (const mirror of mirrors) {
    const ok = await checkMirrorHealth(mirror.id, mirror.encryptedUrl);
    if (ok) { selectedMirror = mirror; break; }

    // Mark degraded in DB async (non-blocking)
    prisma.episodeMirror.update({
      where: { id: mirror.id },
      data: { failCount: { increment: 1 }, healthStatus: MirrorHealth.DEGRADED },
    }).catch(() => {});
  }

  if (!selectedMirror) return null;

  // 3. Issue signed stream token (never return raw URL)
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL;
  const payload = `${selectedMirror.id}:${userId}:${expiresAt}`;
  const sig = crypto.createHmac("sha256", HMAC_SECRET).update(payload).digest("hex");
  const token = Buffer.from(`${payload}:${sig}`).toString("base64url");

  // 4. Cache token → mirrorId in Redis (expires with token)
  await redis.setex(`stream:token:${token}`, TOKEN_TTL, selectedMirror.id);

  return {
    token,
    provider: selectedMirror.provider,
    quality: selectedMirror.quality,
    type: selectedMirror.type as "SUB" | "DUB" | "RAW",
    expiresAt,
  };
}

// ─── VALIDATE token & return real URL (server-side proxy only) ─────────────
export async function validateStreamToken(
  token: string,
  userId: string
): Promise<string | null> {
  const raw = Buffer.from(token, "base64url").toString("utf8");
  const parts = raw.split(":");
  if (parts.length !== 4) return null;

  const [mirrorId, tokenUserId, expiresAtStr, sig] = parts;

  // Reject if wrong user or expired
  if (tokenUserId !== userId) return null;
  if (parseInt(expiresAtStr) < Math.floor(Date.now() / 1000)) return null;

  // Verify HMAC
  const payload = `${mirrorId}:${userId}:${expiresAtStr}`;
  const expected = crypto.createHmac("sha256", HMAC_SECRET).update(payload).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  // Verify token still in Redis (single-use: delete after validation)
  const cached = await redis.getdel(`stream:token:${token}`);
  if (!cached) return null;  // already used or expired

  // Fetch and decrypt real URL
  const mirror = await prisma.episodeMirror.findUnique({ where: { id: mirrorId } });
  if (!mirror) return null;

  return decryptUrl(mirror.encryptedUrl);
}
