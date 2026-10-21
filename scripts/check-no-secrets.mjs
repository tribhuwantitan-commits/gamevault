#!/usr/bin/env node
/**
 * Fails if any configured secret value (or a credential-shaped string) appears in
 * the built frontend bundle. Run after `npm run build`.
 *
 *   node scripts/check-no-secrets.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.cwd(), 'client', 'dist');

if (!fs.existsSync(dist)) {
  console.error('client/dist not found — run `npm run build` first.');
  process.exit(1);
}

/** Read secrets straight from the environment (values are never printed). */
const secrets = [
  process.env.FILEBASE_ACCESS_KEY_ID,
  process.env.FILEBASE_SECRET_ACCESS_KEY,
  process.env.GAMEVAULT_AUTH_TOKEN,
].filter((value) => typeof value === 'string' && value.length >= 8);

const CREDENTIAL_PATTERNS = [
  /AWS4-HMAC-SHA256/,                          // signed-request header
  /X-Amz-Signature=/,                          // presigned URL fragment
  // a real assignment (ignores the `=...` placeholder shown in the UI docs)
  /FILEBASE_SECRET_ACCESS_KEY\s*=\s*(?!\.\.\.)[A-Za-z0-9/+=_-]{12,}/,
  /AKIA[0-9A-Z]{16}/,                          // AWS-style key id
];

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

const files = walk(dist);
const findings = [];

for (const file of files) {
  if (!/\.(js|css|html|map|json|svg|txt)$/i.test(file)) continue;
  const content = fs.readFileSync(file, 'utf8');
  for (const secret of secrets) {
    if (content.includes(secret)) findings.push(`${path.relative(dist, file)} contains a configured secret value`);
  }
  for (const pattern of CREDENTIAL_PATTERNS) {
    if (pattern.test(content)) findings.push(`${path.relative(dist, file)} matches ${pattern}`);
  }
}

if (findings.length > 0) {
  console.error('✖ Potential secret exposure in the frontend bundle:');
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}

console.log(`✔ No secrets or credential-shaped strings found in ${files.length} built file(s).`);
