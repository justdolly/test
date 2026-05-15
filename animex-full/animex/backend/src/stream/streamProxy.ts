// streamProxy.ts
// Frontend hits /api/stream/proxy?token=X
// Server validates token, fetches content, pipes to client
// Real mirror URLs: never in browser, never in logs (redacted)

import type { Request, Response } from "express";
import { validateStreamToken } from "../resolver/mirrorResolver";
import { requireAuth } from "../auth/auth";
import { redis } from "../lib/redis";

const PROXY_RATE_LIMIT = 30; // requests per minute per user

export async function streamProxy(req: Request, res: Response) {
  const { token } = req.query as { token: string };
  const userId = (req as any).user.sub;

  if (!token) return res.status(400).json({ error: "Missing token" });

  // Per-user rate limit on proxy requests
  const rlKey = `rl:proxy:${userId}`;
  const count = await redis.incr(rlKey);
  if (count === 1) await redis.expire(rlKey, 60);
  if (count > PROXY_RATE_LIMIT) return res.status(429).json({ error: "Rate limited" });

  // Validate and consume token (single-use)
  const realUrl = await validateStreamToken(token, userId);
  if (!realUrl) return res.status(403).json({ error: "Invalid or expired stream token" });

  // Pipe to client — never expose realUrl in response headers
  try {
    const upstream = await fetch(realUrl, {
      headers: {
        // Forward range for seeking
        ...(req.headers.range ? { Range: req.headers.range } : {}),
        // Spoof referer to satisfy mirror host restrictions
        Referer: process.env.MIRROR_REFERER ?? "https://animex.tv",
        "User-Agent": "Mozilla/5.0 (compatible; AnimexPlayer/1.0)",
      },
    });

    // Forward relevant headers only (strip location/server/x-powered-by)
    const forwardHeaders = ["content-type", "content-length", "content-range", "accept-ranges"];
    forwardHeaders.forEach(h => {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    });

    // Security headers
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.status(upstream.status);

    // Stream body to client
    if (upstream.body) {
      const reader = upstream.body.getReader();
      const write = async () => {
        const { done, value } = await reader.read();
        if (done) { res.end(); return; }
        res.write(value);
        await write();
      };
      await write();
    } else {
      res.end();
    }
  } catch {
    res.status(502).json({ error: "Upstream error" });
  }
}

// ─── ROUTES ────────────────────────────────────────────────────────────────
// In Express router:
// router.get("/stream/resolve/:episodeId", requireAuth, resolveStreamHandler)
// router.get("/stream/proxy", requireAuth, streamProxy)

export async function resolveStreamHandler(req: Request, res: Response) {
  const { resolveStream } = await import("../resolver/mirrorResolver");
  const { episodeId } = req.params;
  const userId = (req as any).user.sub;
  const preferType = (req.query.type as "SUB" | "DUB") ?? "SUB";

  const stream = await resolveStream(episodeId, preferType, userId);
  if (!stream) return res.status(404).json({ error: "No available mirrors" });

  // Return token only — real URL stays server-side
  return res.json(stream);
}
