import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

export interface MockS3 {
  port: number;
  process: ChildProcess;
  stop: () => Promise<void>;
}

const waitForLine = (child: ChildProcess, needle: string, timeoutMs = 10000): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${needle}"`)), timeoutMs);
    const onData = (chunk: Buffer) => {
      if (chunk.toString().includes(needle)) {
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        resolve();
      }
    };
    child.stdout?.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`mock-s3 exited early with code ${code}`));
    });
  });

export async function startMockS3(port: number, dir: string): Promise<MockS3> {
  await fs.rm(dir, { recursive: true, force: true });
  const child = spawn(
    process.execPath,
    [path.join(process.cwd(), 'dev', 'mock-s3.mjs'), '--port', String(port), '--dir', dir],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stderr?.on('data', (chunk) => process.stderr.write(`[mock-s3] ${chunk.toString()}`));
  await waitForLine(child, 'S3-compatible dev server');
  return {
    port,
    process: child,
    stop: () =>
      new Promise<void>((resolve) => {
        child.on('exit', () => resolve());
        child.kill('SIGTERM');
        setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 3000).unref();
      }),
  };
}

export async function startApi(createApp: () => { listen: Server['listen'] }): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = createApp();
  const server = await new Promise<Server>((resolve) => {
    const s = (app as unknown as { listen: (p: number, h: string, cb: () => void) => Server }).listen(
      0,
      '127.0.0.1',
      () => resolve(s),
    );
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** Deterministic pseudo-random bytes so size assertions are meaningful. */
export function makeBytes(size: number, seed = 1): Buffer {
  const buffer = Buffer.alloc(size);
  let value = seed * 2654435761;
  for (let i = 0; i < size; i += 1) {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    buffer[i] = value & 0xff;
  }
  return buffer;
}
