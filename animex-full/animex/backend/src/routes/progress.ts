import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth/auth';
import { bufferProgress, getWatchHistory, getProgress } from '../progress/watchProgress';

const r = Router();
r.use(requireAuth);

r.post('/', async (req: Request, res: Response) => {
  await bufferProgress({ ...req.body, userId: (req as any).user.sub });
  res.status(204).send();
});

r.get('/', async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  res.json(await getWatchHistory((req as any).user.sub, page));
});

r.get('/:episodeId', async (req: Request, res: Response) => {
  res.json(await getProgress((req as any).user.sub, req.params.episodeId));
});

export default r;
