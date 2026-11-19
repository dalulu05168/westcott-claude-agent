import { sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { ReadError } from './transcript.mjs';

export const readonlyScope = 'https://www.googleapis.com/auth/documents.readonly';
const tokenEndpoint = 'https://oauth2.googleapis.com/token';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');

const writeScope = 'https://www.googleapis.com/auth/documents';

function makeAssertion(credentials, now, scope) {
  const issued = Math.floor(now / 1000);
  const header = encode({ alg: 'RS256', typ: 'JWT' });
  const claims = encode({
    iss: credentials.client_email,
    scope,
    aud: tokenEndpoint,
    iat: issued,
    exp: issued + 600,
  });
  const message = `${header}.${claims}`;
  const signature = sign('RSA-SHA256', Buffer.from(message), credentials.private_key);
  return `${message}.${signature.toString('base64url')}`;
}

async function getAssertion(credentialPath, now, scope) {
  try {
    if (typeof credentialPath !== 'string' || !isAbsolute(credentialPath)) throw new Error();
    const credentials = JSON.parse(await readFile(credentialPath, 'utf8'));
    if (credentials.type !== 'service_account' || typeof credentials.client_email !== 'string'
      || typeof credentials.private_key !== 'string') throw new Error();
    return makeAssertion(credentials, now, scope);
  } catch {
    throw new ReadError('AUTH_CONFIG', '请检查本机服务账号 JSON 凭据路径和文件格式。');
  }
}

async function request(fetcher, url, options) {
  try {
    return await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new ReadError('NETWORK', '无法连接 Google API。请检查网络后重试。');
  }
}

async function json(response) {
  try {
    return await response.json();
  } catch {
    throw new ReadError('UPSTREAM_RESPONSE', 'Google API 未返回可读取的 JSON。');
  }
}

export function createDocsClient({ credentialPath, fetcher = fetch, now = Date.now } = {}) {
  async function accessToken(scope) {
    const assertion = await getAssertion(credentialPath, now(), scope);
    const tokenResponse = await request(fetcher, tokenEndpoint, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!tokenResponse.ok) {
      throw new ReadError('GOOGLE_AUTH', `Google 身份验证失败（HTTP ${tokenResponse.status}）。`);
    }
    const token = (await json(tokenResponse))?.access_token;
    if (typeof token !== 'string' || !token) {
      throw new ReadError('GOOGLE_AUTH', 'Google 未返回可用的访问令牌。');
    }

    return token;
  }

  const documentUrl = documentId => `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`;
  async function getDocument(documentId) {
    const token = await accessToken(readonlyScope);
    const url = new URL(documentUrl(documentId));
    url.searchParams.set('includeTabsContent', 'true');
    url.searchParams.set('suggestionsViewMode', 'PREVIEW_WITHOUT_SUGGESTIONS');
    url.searchParams.set('fields', 'documentId,title,revisionId,tabs');
    const response = await request(fetcher, url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 403 || response.status === 404) {
      throw new ReadError('DOC_ACCESS', `无法读取文档（HTTP ${response.status}）。请核对 Docs API、文档 ID 和服务账号的查看权限。`);
    }
    if (!response.ok) {
      throw new ReadError('UPSTREAM_RESPONSE', `Google Docs 读取失败（HTTP ${response.status}）。`);
    }
    return json(response);
  }

  async function batchUpdate(documentId, body) {
    const token = await accessToken(writeScope);
    const response = await request(fetcher, documentUrl(documentId) + ':batchUpdate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status === 403 || response.status === 404) {
      throw new ReadError('DOC_WRITE_ACCESS', '请核对服务账号是否具有目标文档的编辑者权限。');
    }
    if (!response.ok) {
      throw new ReadError('DOC_WRITE_FAILED', `追加未获确认（HTTP ${response.status}）。可用同一个稿件 ID 重试。`);
    }
    return json(response);
  }
  return { getDocument, batchUpdate };
}

export function createDocumentReader(options) {
  return createDocsClient(options).getDocument;
}
