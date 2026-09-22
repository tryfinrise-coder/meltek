import express from 'express';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import pino from 'pino';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store/index.js';
import { buildRouter, errorHandler } from './routes.js';
import { closePdfRenderer } from './pdf.js';
import { attachUser } from './auth/middleware.js';
import { buildAuthRouter, seedProtectedAdmin } from './auth/routes.js';

const here = dirname(fileURLToPath(import.meta.url));
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

/** The built web app, served by the same process so this deploys as one Node service. */
function webRoot(): string | null {
  for (const candidate of [
    process.env.WEB_DIST,
    resolve(here, '../../web/dist'),
    resolve(here, '../../../apps/web/dist'),
  ]) {
    if (candidate && existsSync(join(candidate, 'index.html'))) return candidate;
  }
  return null;
}

export async function createServer() {
  const store = await createStore();
  await seedProtectedAdmin(store, (msg) => logger.info(msg));
  const app = express();
  app.locals.store = store;

  // Behind a proxy, req.ip must come from the forwarded header for throttling to be
  // per-client rather than per-proxy.
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

  app.use(pinoHttp({
    logger,
    autoLogging: { ignore: (req: { url?: string }) => req.url === '/api/health' },
    // Never let a credential reach the log.
    redact: ['req.headers.cookie', 'res.headers["set-cookie"]', 'req.body.password',
      'req.body.newPassword', 'req.body.currentPassword'],
  }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(attachUser);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, store: store.kind, version: '1.0.0' });
  });

  // Sign-in and setup sit outside the authenticated router, by necessity.
  app.use('/api', buildAuthRouter());
  app.use('/api', buildRouter());
  app.use('/api', (_req, res) => res.status(404).json({ error: 'No such endpoint.' }));
  app.use(errorHandler);

  const dist = webRoot();
  if (dist) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    // Client-side routing: anything that is not an API call returns the shell.
    app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')));
  } else {
    app.get('/', (_res, res) => res.type('text').send(
      'The API is running. The web app is not built yet - run `npm run build` at the repo root.',
    ));
  }

  return { app, store };
}

const thisFile = resolve(fileURLToPath(import.meta.url));
const isMain = !process.argv[1] || resolve(process.argv[1]) === thisFile
  || process.argv[1].endsWith('server.js');
if (isMain) {
  void (async () => {
    const port = Number(process.env.PORT ?? 3000);
    const host = process.env.HOST ?? '0.0.0.0';
    logger.info('starting server…');
    logger.info({ MYSQL_URL: process.env.MYSQL_URL ? '(set)' : '(not set)', NODE_ENV: process.env.NODE_ENV }, 'env check');
    let app, store;
    try {
      ({ app, store } = await createServer());
    } catch (err) {
      logger.error(err, 'FATAL: createServer failed');
      process.exit(1);
    }
    const server = app.listen(port, host, () => {
      logger.info({ port, host, store: store.kind }, 'meltek api listening');
    });
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'shutting down');
      server.close();
      await closePdfRenderer();
      await store.close();
      process.exit(0);
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  })();
}
