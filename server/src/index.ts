import { createApp } from './app.js';
import { assertValidConfig, config } from './config.js';
import { store } from './lib/store.js';

async function main(): Promise<void> {
  await store.init();

  const app = createApp();

  // Start in a clear setup state when credentials are missing instead of crashing.
  const problems = assertValidConfig();
  if (problems.length > 0) {
    console.warn('');
    console.warn('  ⚠️  GameVault is running in SETUP MODE');
    console.warn('     Filebase credentials are not configured, so uploads and downloads are disabled.');
    for (const problem of problems) console.warn(`     · ${problem}`);
    console.warn('     · Copy server/.env.example to server/.env and fill in your Filebase keys.');
    console.warn('');
  }

  if (!config.authToken) {
    console.warn(
      '  ⚠️  GAMEVAULT_AUTH_TOKEN is not set. Anyone who can reach this server can read and delete your assets.',
    );
    console.warn('     Set it before exposing GameVault beyond localhost.\n');
  }

  const server = app.listen(config.port, config.host, () => {
    console.log(`[gamevault] API listening on http://${config.host}:${config.port}`);
    console.log(`[gamevault] storage: ${config.storage.endpoint}/${config.storage.bucket} (${config.storage.configured ? 'configured' : 'not configured'})`);
    console.log(`[gamevault] metadata: ${store.path}`);
  });

  server.on('error', (err) => {
    console.error('[gamevault] failed to start:', err.message);
    process.exit(1);
  });

  const shutdown = (signal: string) => {
    console.log(`[gamevault] ${signal} received — shutting down.`);
    void store.flushRemoteIndex().catch(() => undefined);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[gamevault] fatal startup error:', err);
  process.exit(1);
});
