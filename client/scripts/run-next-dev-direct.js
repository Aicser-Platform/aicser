process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.NEXT_RUNTIME = process.env.NEXT_RUNTIME || 'nodejs';

const { startServer } = require('next/dist/server/lib/start-server');

const port = Number.parseInt(process.env.PORT || '3000', 10);

startServer({
  dir: process.cwd(),
  hostname: '0.0.0.0',
  isDev: true,
  port,
  allowRetry: true,
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
