import http from 'node:http';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const port = Number(process.env.PORT ?? 3000);

// Hostinger requires listen() within 3 seconds.
// Only http and pino are loaded statically (fast).
// The full app is loaded via dynamic import() AFTER listen().
let handler: http.RequestListener = (_req, res) => {
  res.statusCode = 503;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ status: 'starting' }));
};

const server = http.createServer((req, res) => handler(req, res));
server.listen(port, '0.0.0.0', () => {
  logger.info({ port }, 'listening, initializing store…');
});

// Load the app AFTER listen() — dynamic import keeps the module graph out of the critical path.
import('./server.js')
  .then(({ createServer }) => createServer())
  .then(({ app, store }) => {
    handler = app;
    logger.info({ store: store.kind }, 'ready');

    const shutdown = async () => {
      logger.info('shutting down');
      server.close();
      const { closePdfRenderer } = await import('./pdf.js');
      await closePdfRenderer();
      await store.close();
      process.exit(0);
    };
    process.on('SIGTERM', () => void shutdown());
    process.on('SIGINT', () => void shutdown());
  })
  .catch((err) => {
    logger.error(err, 'FATAL: createServer failed');
    process.exit(1);
  });
