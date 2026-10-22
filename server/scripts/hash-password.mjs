#!/usr/bin/env node
/**
 * Generate a GAMEVAULT_PASSWORD_HASH value.
 *
 *   node server/scripts/hash-password.mjs 'my login password'
 *   node server/scripts/hash-password.mjs          # reads the password from stdin
 *
 * Output is a single line, e.g.
 *   pbkdf2$sha256$600000$<salt>$<hash>
 *
 * Paste that into the host's secret field (Render → Environment →
 * GAMEVAULT_PASSWORD_HASH). Never commit the password itself.
 *
 * The same algorithms run in tools/password-hash.html for phone use.
 */
import { createInterface } from 'node:readline/promises';
import { pbkdf2 as pbkdf2Callback, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2 = promisify(pbkdf2Callback);

const ITERATIONS = 600_000; // must match server/src/lib/password.ts
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

/** Read the password without echoing it, when stdin is a TTY. */
async function readPassword() {
  const fromArgv = process.argv.slice(2).join(' ').trim();
  if (fromArgv) return fromArgv;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  if (process.stdin.isTTY) {
    // Minimal no-echo prompt: read one line, then clear it from the screen.
    process.stdout.write('Login password (input is hidden): ');
    const original = process.stdin.isRaw;
    process.stdin.setRawMode?.(true);
    const answer = await rl.question('');
    process.stdin.setRawMode?.(original ?? false);
    process.stdout.write('\n');
    rl.close();
    return answer.trim();
  }
  const answer = await rl.question('');
  rl.close();
  return answer.trim();
}

const password = await readPassword();

if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}
if (password.length > 200) {
  console.error('Password must be at most 200 characters.');
  process.exit(1);
}

const salt = randomBytes(16);
const derived = await pbkdf2(password, salt, ITERATIONS, KEY_LENGTH, DIGEST);

// Self-check: re-derive and compare in constant time before printing.
const check = await pbkdf2(password, salt, ITERATIONS, KEY_LENGTH, DIGEST);
if (!timingSafeEqual(derived, check)) {
  console.error('Hashing self-check failed; aborting.');
  process.exit(1);
}

const hash = `pbkdf2$${DIGEST}$${ITERATIONS}$${salt.toString('base64url')}$${derived.toString('base64url')}`;

// Plain line first so it is easy to select-and-copy on a phone.
console.log('');
console.log(hash);
console.log('');
console.log('Paste that line into the host secret GAMEVAULT_PASSWORD_HASH. Do not save it in Git.');
