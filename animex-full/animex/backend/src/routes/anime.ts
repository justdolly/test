import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { requireAuth } from '../auth/auth';

const r = Router();
const CACHE = (k: string, ttl: number, fn: () => Promise<any>) =>
  redis.get(k).then(c => c ? JSON.parse(c) :
    fn().then(d => { redis.setex(k, ttl, JSON.stringify(d)); return d; }));

// GET /api/anime?page=1&genre=Action&type=TV&status=ONGOING&sort=TRENDING_DESC&search=
r.get('/', async (req: Request, res: Response) => {
  const { page = '1', genre, type, status, sort = 'POPULARITY_DESC', search, year } = req.query as Record<string, string>;
  const take = 24, skip = (parseInt(page) - 1) * take;

  const where: any = { isAdult: false };
  if (genre)  where.genres  = { has: genre };
  if (type)   where.type    = type.toUpperCase();
  if (status) where.status  = status.toUpperCase();
  if (year)   where.year    = parseInt(year);
  if (search) where.OR = [
    { title: { path: ['romaji'],  string_contains: search } },
    { title: { path: ['english'], string_contains: search } },
  ];

  const orderBy: any = {
    POPULARITY_DESC:  { popularity: 'desc' },
    TRENDING_DESC:    { popularity: 'desc' },
    SCORE_DESC:       { rating: 'desc' },
    NEWEST:           { year: 'desc' },
    TITLE_ASC:        { slug: 'asc' },
  }[sort] ?? { popularity: 'desc' };

  const [data, total] = await prisma.$transaction([
    prisma.anime.findMany({ where, orderBy, take, skip,
      select: { id:1, anilistId:1, slug:1, title:1, coverImage:1, bannerImage:1,
                genres:1, status:1, type:1, year:1, rating:1, totalEpisodes:1 } as any }),
    prisma.anime.count({ where }),
  ]);

  res.json({ data, total, page: parseInt(page), pages: Math.ceil(total / take) });
});

// GET /api/anime/:slug
r.get('/:slug', async (req: Request, res: Response) => {
  const key = `anime:${req.params.slug}`;
  const data = await CACHE(key, 300, () =>
    prisma.anime.findUnique({
      where: { slug: req.params.slug },
      include: {
        episodes: {
          orderBy: { number: 'asc' },
          select: { id:1, number:1, title:1, thumbnail:1, duration:1, airDate:1, isFiller:1 } as any,
        },
      },
    })
  );
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});

// GET /api/anime/:slug/episodes/:epNum/mirrors
r.get('/:slug/episodes/:epNum/mirrors', requireAuth, async (req: Request, res: Response) => {
  const ep = await prisma.episode.findFirst({
    where: { anime: { slug: req.params.slug }, number: parseFloat(req.params.epNum) },
    select: { id: true, number: true },
  });
  if (!ep) return res.status(404).json({ error: 'Episode not found' });
  // Return episode id so frontend can call /api/stream/resolve/:episodeId
  res.json({ episodeId: ep.id, number: ep.number });
});

// POST /api/anime (admin — upsert from crawler)
r.post('/', requireAuth, async (req: Request, res: Response) => {
  if ((req as any).user.role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' });
  const { slug, ...data } = req.body;
  const anime = await prisma.anime.upsert({
    where: { slug },
    create: { slug, ...data },
    update: data,
  });
  await redis.del(`anime:${slug}`);
  res.json(anime);
});

export default r;
