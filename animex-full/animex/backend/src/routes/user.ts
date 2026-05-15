import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth/auth';
import { prisma } from '../lib/prisma';

const r = Router();
r.use(requireAuth);

// GET /api/user/me — full profile with stats
r.get('/me', async (req: Request, res: Response) => {
  const userId = (req as any).user.sub;
  const [user, watchCount, epCount, bookmarks] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId },
      select: { id:1, username:1, email:1, avatarUrl:1, createdAt:1, role:1 } as any }),
    prisma.watchProgress.count({ where: { userId } }),
    prisma.watchProgress.aggregate({ where: { userId }, _sum: { position: true } }),
    prisma.bookmark.count({ where: { userId } }),
  ]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    ...user,
    stats: {
      watched: watchCount,
      totalSeconds: epCount._sum.position ?? 0,
      bookmarks,
    },
  });
});

// PATCH /api/user/me — update username/avatar
r.patch('/me', async (req: Request, res: Response) => {
  const { username, avatarUrl } = req.body;
  const updated = await prisma.user.update({
    where: { id: (req as any).user.sub },
    data: { ...(username && { username }), ...(avatarUrl && { avatarUrl }) },
    select: { id:1, username:1, email:1, avatarUrl:1 } as any,
  });
  res.json(updated);
});

// GET /api/user/bookmarks
r.get('/bookmarks', async (req: Request, res: Response) => {
  const { status } = req.query;
  const where: any = { userId: (req as any).user.sub };
  if (status) where.status = (status as string).toUpperCase();
  const data = await prisma.bookmark.findMany({
    where,
    include: { anime: { select: { id:1, slug:1, title:1, coverImage:1, type:1, status:1, totalEpisodes:1 } as any } },
    orderBy: { updatedAt: 'desc' },
  });
  res.json(data);
});

// PUT /api/user/bookmarks/:animeId — upsert
r.put('/bookmarks/:animeId', async (req: Request, res: Response) => {
  const { status, score, notes } = req.body;
  const data = await prisma.bookmark.upsert({
    where: { userId_animeId: { userId: (req as any).user.sub, animeId: req.params.animeId } },
    create: { userId: (req as any).user.sub, animeId: req.params.animeId, status, score, notes },
    update: { ...(status && { status }), ...(score !== undefined && { score }), ...(notes !== undefined && { notes }) },
  });
  res.json(data);
});

// DELETE /api/user/bookmarks/:animeId
r.delete('/bookmarks/:animeId', async (req: Request, res: Response) => {
  await prisma.bookmark.deleteMany({
    where: { userId: (req as any).user.sub, animeId: req.params.animeId },
  });
  res.status(204).send();
});

export default r;
