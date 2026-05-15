// crawler.ts
// BullMQ worker pipeline: fetch → validate → normalize → merge → upsert
// Sources: AniList (primary) → MAL (secondary) → internal

import { Queue, Worker, Job } from "bullmq";
import { z } from "zod";
import { redis } from "../lib/redis";
import { prisma } from "../lib/prisma";
import DOMPurify from "isomorphic-dompurify";

// ─── QUEUE SETUP ───────────────────────────────────────────────────────────

export const crawlQueue = new Queue("crawl", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

// ─── SCHEMA VALIDATION ─────────────────────────────────────────────────────

const AnimeSchema = z.object({
  anilistId: z.number().optional(),
  malId: z.number().optional(),
  title: z.object({
    romaji: z.string().max(500),
    english: z.string().max(500).optional(),
    native: z.string().max(500).optional(),
  }),
  synopsis: z.string().max(5000).optional(),
  coverImage: z.string().url().optional(),
  bannerImage: z.string().url().optional(),
  genres: z.array(z.string().max(50)).max(20),
  tags: z.array(z.string().max(100)).max(50),
  status: z.enum(["ONGOING", "COMPLETED", "UPCOMING", "HIATUS", "CANCELLED"]),
  type: z.enum(["TV", "MOVIE", "OVA", "ONA", "SPECIAL", "MUSIC"]),
  year: z.number().int().min(1900).max(2100).optional(),
  rating: z.number().min(0).max(10).optional(),
  totalEpisodes: z.number().int().min(0).optional(),
  isAdult: z.boolean().default(false),
});

type ValidatedAnime = z.infer<typeof AnimeSchema>;

// ─── SOURCE ADAPTERS ───────────────────────────────────────────────────────

const SOURCE_PRIORITY = { anilist: 1, mal: 2, internal: 3 } as const;
type Source = keyof typeof SOURCE_PRIORITY;

async function fetchAnilist(id: number): Promise<ValidatedAnime> {
  const query = `
    query($id:Int){Media(id:$id){
      id idMal title{romaji english native}
      description coverImage{extraLarge} bannerImage
      genres tags{name} status format season seasonYear
      averageScore popularity episodes isAdult
    }}
  `;
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { id } }),
  });
  const { data } = await res.json();
  const m = data.Media;

  return AnimeSchema.parse({
    anilistId: m.id,
    malId: m.idMal,
    title: m.title,
    synopsis: m.description ? sanitize(m.description) : undefined,
    coverImage: m.coverImage?.extraLarge,
    bannerImage: m.bannerImage,
    genres: m.genres ?? [],
    tags: (m.tags ?? []).map((t: any) => t.name).slice(0, 50),
    status: mapStatus(m.status),
    type: mapType(m.format),
    year: m.seasonYear,
    rating: m.averageScore ? m.averageScore / 10 : undefined,
    totalEpisodes: m.episodes,
    isAdult: m.isAdult ?? false,
  });
}

// ─── SANITIZATION ──────────────────────────────────────────────────────────

function sanitize(input: string): string {
  // Strip HTML from external synopsis, prevent XSS if ever rendered
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: [] }).trim().slice(0, 5000);
}

// ─── CONFLICT RESOLUTION ───────────────────────────────────────────────────
// Strategy: source priority → recency → field-level merge

async function mergeAnime(
  existing: any,
  incoming: ValidatedAnime,
  source: Source
): Promise<Partial<ValidatedAnime>> {
  const incomingPriority = SOURCE_PRIORITY[source];
  const existingPriority = existing.sourcePriority ?? 99;

  // Higher priority source wins on conflict (lower number = higher priority)
  if (incomingPriority > existingPriority) {
    // Only update fields that are missing in existing
    const merged: any = {};
    for (const [k, v] of Object.entries(incoming)) {
      if (existing[k] === null || existing[k] === undefined) merged[k] = v;
    }
    return merged;
  }

  // Equal or better priority — incoming wins, but preserve fields not in incoming
  return {
    ...incoming,
    // Preserve higher-quality fields from existing if incoming lacks them
    synopsis: incoming.synopsis ?? existing.synopsis,
    bannerImage: incoming.bannerImage ?? existing.bannerImage,
  };
}

// ─── WORKER ────────────────────────────────────────────────────────────────

export const crawlWorker = new Worker(
  "crawl",
  async (job: Job) => {
    const { type, id, source = "anilist" } = job.data;

    let validated: ValidatedAnime;
    try {
      if (source === "anilist") validated = await fetchAnilist(id);
      else throw new Error(`Unknown source: ${source}`);
    } catch (err: any) {
      await prisma.crawlJob.updateMany({
        where: { source, targetId: String(id) },
        data: { status: "FAILED", lastError: err.message, attempts: { increment: 1 } },
      });
      throw err; // BullMQ handles retry
    }

    // Generate slug from title
    const slug = generateSlug(validated.title.romaji);

    const existing = await prisma.anime.findFirst({
      where: { OR: [{ anilistId: validated.anilistId }, { slug }] },
    });

    if (existing) {
      const merged = await mergeAnime(existing, validated, source as Source);
      await prisma.anime.update({ where: { id: existing.id }, data: { ...merged, lastCrawledAt: new Date() } });
    } else {
      await prisma.anime.create({ data: { ...validated, slug, lastCrawledAt: new Date() } });
    }

    await prisma.crawlJob.updateMany({
      where: { source, targetId: String(id) },
      data: { status: "DONE", completedAt: new Date() },
    });
  },
  { connection: redis, concurrency: 5 }
);

// ─── UTILS ─────────────────────────────────────────────────────────────────

function generateSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
}

function mapStatus(s: string): ValidatedAnime["status"] {
  const map: Record<string, ValidatedAnime["status"]> = {
    RELEASING: "ONGOING", FINISHED: "COMPLETED", NOT_YET_RELEASED: "UPCOMING",
    HIATUS: "HIATUS", CANCELLED: "CANCELLED",
  };
  return map[s] ?? "ONGOING";
}

function mapType(f: string): ValidatedAnime["type"] {
  const map: Record<string, ValidatedAnime["type"]> = {
    TV: "TV", MOVIE: "MOVIE", OVA: "OVA", ONA: "ONA", SPECIAL: "SPECIAL", MUSIC: "MUSIC",
  };
  return map[f] ?? "TV";
}

// ─── SCHEDULE BULK CRAWL ──────────────────────────────────────────────────
export async function scheduleCrawl(anilistIds: number[]) {
  const jobs = anilistIds.map(id => ({
    name: "crawl-anime",
    data: { id, source: "anilist" },
    opts: { jobId: `anilist:${id}` }, // dedup by jobId
  }));
  await crawlQueue.addBulk(jobs);
}
