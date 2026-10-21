import { api } from './api';

/**
 * Downloads go through a short-lived presigned GET URL issued by the server.
 * The bucket stays private; the browser never sees storage credentials.
 */
export async function downloadAsset(id: string): Promise<string> {
  const info = await api.downloadInfo(id);
  const link = document.createElement('a');
  link.href = info.url;
  link.download = info.filename;
  link.rel = 'noopener noreferrer';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  return info.filename;
}
