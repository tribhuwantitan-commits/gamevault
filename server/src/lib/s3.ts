import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  type S3ClientConfig,
  type CompletedPart,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';
import { AppError } from '../types.js';

let client: S3Client | null = null;

/** Credentials are read from the server environment only — never from the client. */
export function getS3Client(): S3Client {
  if (!config.storage.configured) {
    throw new AppError(
      503,
      'storage_not_configured',
      'Filebase credentials are not configured on the server. Add FILEBASE_ACCESS_KEY_ID and FILEBASE_SECRET_ACCESS_KEY to server/.env and restart.',
    );
  }
  if (!client) {
    const cfg = {
      region: config.storage.region,
      endpoint: config.storage.endpoint,
      forcePathStyle: config.storage.forcePathStyle,
      credentials: {
        accessKeyId: config.storage.accessKeyId,
        secretAccessKey: config.storage.secretAccessKey,
      },
      // Avoid the SDK adding checksum parameters that break presigned URLs.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    } as unknown as S3ClientConfig;
    client = new S3Client(cfg);
  }
  return client;
}

/** For tests: drop the memoised client so new env settings take effect. */
export function resetS3Client(): void {
  client = null;
}

const bucket = () => config.storage.bucket;

function wrapError(err: unknown, action: string): never {
  // Configuration / validation errors raised by our own code pass through untouched.
  if (err instanceof AppError) throw err;
  const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  if (e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404) {
    throw new AppError(404, 'object_not_found', `The stored file no longer exists in Filebase (${action}).`);
  }
  if (e?.name === 'AccessDenied' || e?.$metadata?.httpStatusCode === 403) {
    throw new AppError(
      502,
      'storage_access_denied',
      'Filebase rejected the request. Check that the access key has read/write access to the bucket.',
    );
  }
  if (e?.name === 'CredentialsProviderError') {
    throw new AppError(503, 'storage_not_configured', 'Filebase credentials are missing or invalid.');
  }
  // Log the AWS error name/message only — never the credentials.
  console.error(`[gamevault] storage ${action} failed:`, e?.name ?? 'Error', e?.message ?? '');
  throw new AppError(502, 'storage_error', `Filebase ${action} failed. Please retry.`);
}

export interface ObjectInfo {
  size: number;
  contentType?: string;
  etag?: string;
  lastModified?: string;
}

export async function headObjectInfo(key: string): Promise<ObjectInfo | null> {
  try {
    const res = await getS3Client().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return {
      size: Number(res.ContentLength ?? 0),
      contentType: res.ContentType,
      etag: res.ETag?.replace(/"/g, ''),
      lastModified: res.LastModified?.toISOString(),
    };
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound' || e?.name === 'NoSuchKey') {
      return null;
    }
    wrapError(err, 'object check');
  }
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  } catch (err) {
    wrapError(err, 'delete');
  }
}

export async function presignPut(key: string, contentType: string, expiresIn: number): Promise<string> {
  try {
    return await getSignedUrl(
      getS3Client(),
      new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
      { expiresIn },
    );
  } catch (err) {
    wrapError(err, 'upload URL');
  }
}

export async function presignGet(
  key: string,
  expiresIn: number,
  opts: { filename?: string; disposition?: 'inline' | 'attachment'; contentType?: string } = {},
): Promise<string> {
  try {
    const command = new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseContentDisposition: opts.filename
        ? `${opts.disposition ?? 'inline'}; filename="${opts.filename.replace(/["\\]/g, '_')}"`
        : undefined,
      ResponseContentType: opts.contentType,
    });
    return await getSignedUrl(getS3Client(), command, { expiresIn });
  } catch (err) {
    wrapError(err, 'download URL');
  }
}

/** Read a small UTF-8 object (used for the optional bucket-backed index). */
export async function getObjectText(key: string): Promise<string | null> {
  try {
    const res = await getS3Client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    const body = res.Body as { transformToString?: () => Promise<string> } | undefined;
    if (!body?.transformToString) return null;
    return await body.transformToString();
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NoSuchKey' || e?.name === 'NotFound') {
      return null;
    }
    throw err;
  }
}

/** Write a small UTF-8 object. */
export async function putObjectText(key: string, text: string, contentType = 'application/json'): Promise<void> {
  await getS3Client().send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: text, ContentType: contentType }),
  );
}

export interface BucketObject {
  key: string;
  size: number;
  lastModified?: string;
  etag?: string;
}

/** List every object under the GameVault prefix (paginated, nothing else in the bucket). */
export async function listAssetObjects(prefix: string): Promise<BucketObject[]> {
  const out: BucketObject[] = [];
  let token: string | undefined;
  try {
    do {
      const res = await getS3Client().send(
        new ListObjectsV2Command({
          Bucket: bucket(),
          Prefix: prefix,
          ContinuationToken: token,
          MaxKeys: 1000,
        }),
      );
      for (const item of res.Contents ?? []) {
        if (!item.Key) continue;
        out.push({
          key: item.Key,
          size: Number(item.Size ?? 0),
          lastModified: item.LastModified?.toISOString(),
          etag: item.ETag?.replace(/"/g, ''),
        });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  } catch (err) {
    wrapError(err, 'bucket listing');
  }
  return out;
}

export async function createMultipart(key: string, contentType: string): Promise<string> {
  try {
    const res = await getS3Client().send(
      new CreateMultipartUploadCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
    );
    if (!res.UploadId) throw new AppError(502, 'storage_error', 'Filebase did not return an upload id.');
    return res.UploadId;
  } catch (err) {
    if (err instanceof AppError) throw err;
    wrapError(err, 'multipart start');
  }
}

export async function presignUploadParts(
  key: string,
  uploadId: string,
  partNumbers: number[],
  expiresIn: number,
): Promise<Array<{ partNumber: number; url: string }>> {
  try {
    return await Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await getSignedUrl(
          getS3Client(),
          new UploadPartCommand({ Bucket: bucket(), Key: key, UploadId: uploadId, PartNumber: partNumber }),
          { expiresIn },
        ),
      })),
    );
  } catch (err) {
    wrapError(err, 'multipart part URL');
  }
}

export async function completeMultipart(
  key: string,
  uploadId: string,
  parts: CompletedPart[],
): Promise<void> {
  try {
    await getS3Client().send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket(),
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
  } catch (err) {
    wrapError(err, 'multipart completion');
  }
}

export async function abortMultipart(key: string, uploadId: string): Promise<void> {
  try {
    await getS3Client().send(
      new AbortMultipartUploadCommand({ Bucket: bucket(), Key: key, UploadId: uploadId }),
    );
  } catch (err) {
    // Aborting is best-effort; log without throwing so cleanup never blocks.
    console.warn('[gamevault] multipart abort failed:', (err as Error).name);
  }
}
