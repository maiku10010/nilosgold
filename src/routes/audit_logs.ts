import { Request, Response, Router } from 'express';
import { prisma } from '../db';

const router = Router();
router.get('/', async (req: Request, res: Response) => {
  const take = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const logs = await prisma.systemLog.findMany({
    ...(typeof req.query.actorEmpId === 'string' ? { where: { actorEmpId: req.query.actorEmpId } } : {}),
    orderBy: { createdAt: 'desc' }, take,
  });
  res.json(logs);
});

export default router;
