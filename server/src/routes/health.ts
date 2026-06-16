import { Router } from 'express';
import db from '../db/client';

const router = Router();

router.get('/', (_req, res) => {
  const { product_count } = db
    .prepare('SELECT COUNT(*) as product_count FROM products')
    .get() as { product_count: number };

  res.json({
    ok: true,
    db: 'connected',
    product_count,
    time: new Date().toISOString(),
  });
});

export default router;
