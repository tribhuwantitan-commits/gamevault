/**
 * CLI equivalent of POST /api/assets/rescan.
 * Usage: npm run rescan --workspace server
 */
import { config } from '../config.js';
import { listAssetObjects } from '../lib/s3.js';
import { store } from '../lib/store.js';

async function main(): Promise<void> {
  await store.init();
  if (!config.storage.configured) {
    console.error('Filebase credentials are not configured (server/.env). Nothing to rescan.');
    process.exitCode = 1;
    return;
  }
  const objects = await listAssetObjects(config.keyPrefix);
  console.log(`Found ${objects.length} object(s) under ${config.keyPrefix}`);
  console.log('Run the app and use "Rescan bucket" in Settings to rebuild the index,');
  console.log('or call POST /api/assets/rescan.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
