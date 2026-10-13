import { Request, Response, Router } from 'express';
import { getGoldPrice } from '../services/gold';

const router = Router();
router.get('/price', async (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    res.json(await getGoldPrice());
  } catch {
    res.status(503).json({ error: 'Live gold pricing is temporarily unavailable. Enter a verified rate manually for job costing.', retryAfterSeconds: 60 });
  }
});
export default router;
