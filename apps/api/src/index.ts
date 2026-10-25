import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createProductionApi, toNodeHandler } from '@chronostasis/api';

try {
  const envFile = new URL('../../../.env', import.meta.url);
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const api = createProductionApi(process.env);
  const adapter = toNodeHandler(api.handler, `http://api:${String(api.port)}`);
  const server = createServer((request, response) => { void adapter(request, response); });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.on('error', () => {
    console.error('API listener failed.');
    void api.close().then(() => { process.exitCode = 1; }, () => { process.exitCode = 1; });
  });
  server.listen(api.port, api.host, () => { console.info(`API listening on ${api.host}:${String(api.port)}.`); });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => { void api.close().catch(() => { process.exitCode = 1; }); });
    server.closeIdleConnections();
    setTimeout(() => { server.closeAllConnections(); }, 5_000).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch {
  console.error('API startup failed. Check DATABASE_URL, CLERK_SECRET_KEY, CLERK_ISSUER, CLERK_AUTHORIZED_PARTIES, and API_PORT.');
  process.exitCode = 1;
}
