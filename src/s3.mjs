/**
 * S3 兼容对象存储的最小客户端（AWS 签名 V4）：上传、删除。Cloudflare R2、阿里云 OSS、腾讯云 COS、七牛、AWS S3、MinIO 都兼容这套接口。
 * 不引入 SDK；只用 Node 自带的 crypto 和 fetch。
 */
import { createHash, createHmac } from 'node:crypto';

const sha256hex = (d) => createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => createHmac('sha256', k).update(d).digest();
/** 路径按 S3 的规则逐段编码（保留 /，其余 RFC 3986 之外的都编码） */
const encodePath = (p) => p.split('/').map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');

/**
 * 给一个请求签名，返回要带上的请求头（含 Authorization）。
 * headers 里的键用小写；host、x-amz-date、x-amz-content-sha256 会自动加上
 */
export function sign({ method, host, path, headers = {}, payloadHash, region, accessKeyId, secretAccessKey, date = new Date() }) {
  const amzDate = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const all = { ...headers, host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(all).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const signed = names.join(';');
  const canonical = [method, encodePath(path), '', names.map((k) => `${k}:${lower[k]}\n`).join(''), signed, payloadHash].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return { ...lower, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}` };
}

/**
 * 客户端。endpoint 是服务商给的 S3 接口地址（不含存储桶）；pathStyle：存储桶写在路径里（R2、MinIO），否则写在域名里（OSS、COS、七牛、AWS）
 */
export function s3Client({ endpoint, region, bucket, accessKeyId, secretAccessKey, pathStyle }) {
  const ep = new URL(endpoint);
  const target = (key) => {
    const host = pathStyle ? ep.host : `${bucket}.${ep.host}`;
    const path = pathStyle ? `/${bucket}/${key}` : `/${key}`;
    return { host, path, url: `${ep.protocol}//${host}${encodePath(path)}` };
  };
  async function call(method, key, body, headers = {}) {
    const { host, path, url } = target(key);
    const payloadHash = body ? sha256hex(body) : sha256hex('');
    const h = sign({ method, host, path, headers, payloadHash, region, accessKeyId, secretAccessKey });
    delete h.host; // fetch 自己会带 Host
    const r = await fetch(url, { method, headers: h, body, signal: AbortSignal.timeout(60_000) });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
      const msg = /<Message>([^<]+)<\/Message>/.exec(text)?.[1];
      throw new Error(`对象存储返回 ${r.status}${code ? ` ${code}` : ''}${msg ? `：${msg}` : ''}`);
    }
    return r;
  }
  return {
    put: (key, body, contentType) => call('PUT', key, body, { 'content-type': contentType, 'cache-control': 'public, max-age=31536000, immutable' }),
    del: (key) => call('DELETE', key),
  };
}
