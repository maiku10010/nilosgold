import { Router } from 'express';
import usersRouter from './users';
// Retain the old URL as a guarded alias. No legacy credential or delete bypass.
const router = Router();
router.delete('/:id', (_req, res) => res.status(405).json({ error: 'Use Users to deactivate this account.' }));
router.put('/:id', (_req, res) => res.status(405).json({ error: 'Use Users to change roles or reset passwords.' }));
router.use(usersRouter);
export default router;
