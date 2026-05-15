import { Router } from 'express';
import { requireAuth } from '../auth/auth';
import { resolveStreamHandler, streamProxy } from '../stream/streamProxy';

const r = Router();
r.get('/resolve/:episodeId', requireAuth, resolveStreamHandler);
r.get('/proxy',              requireAuth, streamProxy);
export default r;
