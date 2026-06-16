import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { initSchema } from './db/schema';
import { seedIfEmpty } from './db/seed';
import healthRouter from './routes/health';
import productsRouter from './routes/products';
import tabsRouter from './routes/tabs';
import poolRouter from './routes/pool';
import reportsRouter from './routes/reports';
import settingsRouter from './routes/settings';
import categoriesRouter from './routes/categories';
import waitlistRouter from './routes/waitlist';
import sessionsRouter from './routes/sessions';
import { initWSServer } from './ws/server';
import { resumeActiveTickers } from './ws/ticker';
import { startRetryLoop } from './services/tseRetry';
import { errorHandler } from './middleware/errors';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

console.log('downtown pos starting…');
initSchema();
console.log('  schema ready');
seedIfEmpty();
resumeActiveTickers();
startRetryLoop();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/health', healthRouter);
app.use('/api/products', productsRouter);
app.use('/api/tabs', tabsRouter);
app.use('/api/pool', poolRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/waitlist', waitlistRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/categories', categoriesRouter);

app.use(errorHandler);

const server = createServer(app);
initWSServer(server);

server.listen(PORT, () => {
  console.log(`\nrunning → http://localhost:${PORT}`);
  console.log(`health  → http://localhost:${PORT}/api/health\n`);
});
