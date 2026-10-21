#!/usr/bin/env node
/**
 * Minimal S3-compatible server used ONLY for local development and automated tests.
 * It implements the subset of the S3 REST API that GameVault uses:
 *
 *   PUT    /:bucket/:key                     single-part upload
 *   GET    /:bucket/:key                     download
 *   HEAD   /:bucket/:key                     metadata
 *   DELETE /:bucket/:key                     delete object
 *   GET    /:bucket?list-type=2&prefix=...   listing (XML)
 *   POST   /:bucket/:key?uploads             create multipart upload
 *   PUT    /:bucket/:key?partNumber&uploadId upload part
 *   POST   /:bucket/:key?uploadId            complete multipart upload
 *   DELETE /:bucket/:key?uploadId            abort multipart upload
 *
 * It is NOT a production server, does not validate SigV4 signatures, and stores
 * objects in a temp directory. Use Filebase for anything real.
 *
 *   node dev/mock-s3.mjs [--port 9100] [--dir .mock-s3] [--bucket gaming-asset]
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import fsp from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
};

const PORT = Number(getArg('port', '9100'));
const ROOT = path.resolve(getArg('dir', '.mock-s3'));
const BUCKET = getArg('bucket', 'gaming-asset');

const objectsDir = () => path.join(ROOT, BUCKET);
const partsDir = () => path.join(ROOT, '.parts');

async function ensureDirs() {
  await fs.mkdir(objectsDir(), { recursive: true });
  await fs.mkdir(partsDir(), { recursive: true });
}

const keyToPath = (key) => {
  const safe = path
    .normalize(key)
    .replace(/^([.]{2}(\/|\\|$))+/, '')
    .replace(/^\/+/, '');
  const full = path.join(objectsDir(), safe);
  if (!full.startsWith(objectsDir())) throw new Error('path traversal blocked');
  return full;
};

const etagOf = (buffer) => `"${crypto.createHash('md5').update(buffer).digest('hex')}"`;

/** S3 XML escapes quotes in ETags as &quot;. */
const unescapeXml = (value) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,HEAD,OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'ETag, Content-Length, Content-Type',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function xml(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/xml',
    ...CORS,
  });
  res.end(body);
}

function errorXml(res, status, code, message) {
  xml(
    res,
    status,
    `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`,
  );
}

/** Split "/bucket/key..." honouring encoded slashes. */
function parseTarget(rawUrl) {
  const url = new URL(rawUrl, 'http://localhost');
  const segments = url.pathname.replace(/^\/+/, '').split('/');
  const bucket = decodeURIComponent(segments.shift() ?? '');
  const key = segments.map(decodeURIComponent).join('/');
  return { url, bucket, key };
}

async function listObjects(res, prefix, continuationToken, maxKeys) {
  const base = objectsDir();
  const results = [];
  async function walk(dir, rel = '') {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const key = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(abs, key);
      else if (entry.name.endsWith('.meta.json')) continue;
      else {
        const stat = await fs.stat(abs);
        results.push({
          key,
          size: stat.size,
          lastModified: stat.mtime.toISOString(),
          etag: `"${crypto.createHash('md5').update(`${key}:${stat.size}:${stat.mtimeMs}`).digest('hex')}"`,
        });
      }
    }
  }
  await walk(base);
  const filtered = results
    .filter((item) => item.key.startsWith(prefix))
    .sort((a, b) => a.key.localeCompare(b.key));

  const start = continuationToken ? Number(Buffer.from(continuationToken, 'base64').toString('utf8')) : 0;
  const limit = Math.min(Number(maxKeys) || 1000, 1000);
  const page = filtered.slice(start, start + limit);
  const truncated = start + limit < filtered.length;

  const contents = page
    .map(
      (item) =>
        `<Contents><Key>${item.key.replace(/&/g, '&amp;')}</Key><LastModified>${item.lastModified}</LastModified>` +
        `<ETag>${item.etag.replace(/&/g, '&amp;')}</ETag><Size>${item.size}</Size>` +
        `<StorageClass>STANDARD</StorageClass></Contents>`,
    )
    .join('');

  xml(
    res,
    200,
    `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
      `<Name>${BUCKET}</Name><Prefix>${prefix.replace(/&/g, '&amp;')}</Prefix><KeyCount>${page.length}</KeyCount>` +
      `<MaxKeys>${limit}</MaxKeys><IsTruncated>${truncated}</IsTruncated>` +
      (truncated
        ? `<NextContinuationToken>${Buffer.from(String(start + limit)).toString('base64')}</NextContinuationToken>`
        : '') +
      `${contents}</ListBucketResult>`,
  );
}

async function handleMultipart(req, res, { url, bucket, key }) {
  if (bucket !== BUCKET) return errorXml(res, 404, 'NoSuchBucket', 'Bucket not found');

  const uploadId = url.searchParams.get('uploadId');

  // Create
  if (req.method === 'POST' && url.searchParams.has('uploads')) {
    const id = crypto.randomUUID();
    await fs.writeFile(
      path.join(partsDir(), `${id}.json`),
      JSON.stringify({ key, createdAt: Date.now(), parts: {} }),
    );
    xml(
      res,
      200,
      `<?xml version="1.0" encoding="UTF-8"?><InitiateMultipartUploadResult><Bucket>${BUCKET}</Bucket><Key>${key}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`,
    );
    return true;
  }

  if (!uploadId) return false;
  const manifestPath = path.join(partsDir(), `${uploadId}.json`);

  if (req.method === 'PUT') {
    const partNumber = Number(url.searchParams.get('partNumber'));
    if (!Number.isInteger(partNumber) || partNumber < 1) {
      errorXml(res, 400, 'InvalidPart', 'partNumber is required');
      return true;
    }
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const body = await readBody(req);
    const partEtag = etagOf(body);
    await fs.writeFile(path.join(partsDir(), `${uploadId}.${partNumber}`), body);
    manifest.parts[String(partNumber)] = { etag: partEtag, size: body.length };
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    res.writeHead(200, { ETag: partEtag, ...CORS });
    res.end();
    return true;
  }

  if (req.method === 'POST') {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const body = (await readBody(req)).toString('utf8');
    const requested = [...body.matchAll(/<Part>([\s\S]*?)<\/Part>/g)]
      .map((block) => {
        const partNumber = Number(/<PartNumber>(\d+)<\/PartNumber>/.exec(block[1])?.[1] ?? 0);
        const etag = unescapeXml(/<ETag>(.*?)<\/ETag>/.exec(block[1])?.[1] ?? '');
        return { partNumber, etag };
      })
      .filter((part) => part.partNumber > 0);
    const numbers = Object.keys(manifest.parts).map(Number).sort((a, b) => a - b);
    if (requested.length === 0 || requested.length !== numbers.length) {
      errorXml(res, 400, 'InvalidPart', 'Part list is incomplete');
      return true;
    }
    for (const part of requested) {
      const stored = manifest.parts[String(part.partNumber)];
      if (!stored || stored.etag !== part.etag) {
        console.error(
          `[mock-s3] part ${part.partNumber} mismatch: stored=${stored?.etag ?? 'none'} received=${part.etag}`,
        );
        errorXml(res, 400, 'InvalidPart', `ETag mismatch for part ${part.partNumber}`);
        return true;
      }
    }
    const buffers = [];
    for (const partNumber of numbers) {
      buffers.push(await fs.readFile(path.join(partsDir(), `${uploadId}.${partNumber}`)));
    }
    const combined = Buffer.concat(buffers);
    const target = keyToPath(manifest.key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, combined);
    for (const partNumber of numbers) {
      await fs.rm(path.join(partsDir(), `${uploadId}.${partNumber}`), { force: true });
    }
    await fs.rm(manifestPath, { force: true });
    xml(
      res,
      200,
      `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUploadResult><Location>/</Location><Bucket>${BUCKET}</Bucket><Key>${manifest.key}</Key><ETag>${etagOf(combined)}</ETag></CompleteMultipartUploadResult>`,
    );
    return true;
  }

  if (req.method === 'DELETE') {
    try {
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      for (const partNumber of Object.keys(manifest.parts)) {
        await fs.rm(path.join(partsDir(), `${uploadId}.${partNumber}`), { force: true });
      }
    } catch {
      /* already gone */
    }
    await fs.rm(manifestPath, { force: true });
    res.writeHead(204, CORS);
    res.end();
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  try {
    const target = parseTarget(req.url ?? '/');
    const { url, bucket, key } = target;

    if (!bucket) return errorXml(res, 400, 'InvalidRequest', 'Bucket is required');
    if (bucket !== BUCKET) return errorXml(res, 404, 'NoSuchBucket', `Bucket ${bucket} not found`);

    // GameVault always talks to the bucket with path-style URLs, so the bucket
    // path segment must match exactly.
    if (req.method === 'GET' && !key && url.searchParams.has('list-type')) {
      return listObjects(
        res,
        url.searchParams.get('prefix') ?? '',
        url.searchParams.get('continuation-token'),
        url.searchParams.get('max-keys'),
      );
    }

    if (await handleMultipart(req, res, target)) return;

    if (!key) return errorXml(res, 400, 'InvalidRequest', 'Object key is required');
    const filePath = keyToPath(key);

    if (req.method === 'PUT') {
      const body = await readBody(req);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, body);
      await fs.writeFile(
        `${filePath}.meta.json`,
        JSON.stringify({ contentType: req.headers['content-type'] ?? 'application/octet-stream', etag: etagOf(body) }),
      );
      res.writeHead(200, { ETag: etagOf(body), ...CORS });
      res.end();
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat) return errorXml(res, 404, 'NoSuchKey', 'The specified key does not exist.');
      let meta = {};
      try {
        meta = JSON.parse(await fs.readFile(`${filePath}.meta.json`, 'utf8'));
      } catch {
        /* not critical */
      }
      const disposition = url.searchParams.get('response-content-disposition');
      const contentTypeOverride = url.searchParams.get('response-content-type');
      const headers = {
        'Content-Length': stat.size,
        'Content-Type': contentTypeOverride ?? meta.contentType ?? 'application/octet-stream',
        ETag: meta.etag ?? `"${crypto.createHash('md5').update(String(stat.size)).digest('hex')}"`,
        'Last-Modified': stat.mtime.toUTCString(),
        'Accept-Ranges': 'bytes',
        ...(disposition ? { 'Content-Disposition': disposition } : {}),
        ...CORS,
      };
      if (req.method === 'HEAD') {
        res.writeHead(200, headers);
        res.end();
        return;
      }
      res.writeHead(200, headers);
      fsp.createReadStream(filePath).pipe(res);
      return;
    }

    if (req.method === 'DELETE') {
      await fs.rm(filePath, { force: true });
      await fs.rm(`${filePath}.meta.json`, { force: true });
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    errorXml(res, 405, 'MethodNotAllowed', `${req.method} is not supported`);
  } catch (err) {
    console.error('[mock-s3]', err);
    errorXml(res, 500, 'InternalError', err instanceof Error ? err.message : 'unknown error');
  }
});

await ensureDirs();
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-s3] S3-compatible dev server on http://127.0.0.1:${PORT} (bucket: ${BUCKET}, dir: ${ROOT})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
