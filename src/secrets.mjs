/**
 * 密钥（评论管理令牌、图床的 Secret Key）存在系统钥匙串里，服务名“Mori Studio”。
 * 账号名按密钥属于哪个服务来起，不按项目：换项目目录、几个项目连同一个服务，都共用一份。
 * 现在只有 macOS（用系统自带的 security 命令）；别的系统、或设了 MORI_STUDIO_KEYCHAIN=0（测试），keychain() 返回 null，调用方退回到项目里的 .mori-studio.json。
 */
import { execFileSync, spawnSync } from 'node:child_process';

const SERVICE = 'Mori Studio';
/** 以前的服务名；读不到时去这里找，找到就搬过来 */
const OLD_SERVICE = 'MORI Studio';
const NOT_FOUND = 44;

export const commentsAccount = (endpoint) => `comments:${endpoint}`;
export const imageHostAccount = (h) => `s3:${h.endpoint ?? ''}/${h.bucket ?? ''}/${h.accessKeyId ?? ''}`;

/** 读一项；没有是 ''。存的是 base64：security -w 遇到非 ASCII 会输出十六进制，统一编码就不用猜 */
function find(service, account) {
  try {
    return Buffer.from(execFileSync('security', ['find-generic-password', '-s', service, '-a', account, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(), 'base64').toString('utf8');
  } catch (e) {
    if (e.status !== NOT_FOUND) throw new Error(`读取钥匙串失败：${e.message}`);
    return '';
  }
}

export function keychain() {
  if (process.platform !== 'darwin' || process.env.MORI_STUDIO_KEYCHAIN === '0') return null;
  const cache = new Map();
  const safe = (account) => {
    if (/["\\\n]/.test(account)) throw new Error('密钥的账号名里不能有引号、反斜杠或换行');
    return account;
  };
  return {
    get(account) {
      if (cache.has(account)) return cache.get(account);
      let v = find(SERVICE, account);
      if (!v && (v = find(OLD_SERVICE, account))) {
        this.set(account, v);
        spawnSync('security', ['delete-generic-password', '-s', OLD_SERVICE, '-a', account], { stdio: 'ignore' });
      }
      cache.set(account, v);
      return v;
    },
    set(account, value) {
      if (!value) return this.remove(account);
      // 用 security -i 从标准输入传，密钥不出现在命令行参数里（ps 看得到参数）
      const r = spawnSync('security', ['-i'], { input: `add-generic-password -U -s "${SERVICE}" -a "${safe(account)}" -w "${Buffer.from(value, 'utf8').toString('base64')}"\n`, encoding: 'utf8' });
      if (r.status !== 0 || /error|denied/i.test(r.stderr ?? '')) throw new Error(`写入钥匙串失败：${(r.stderr || '').trim() || r.status}`);
      cache.set(account, value);
    },
    remove(account) {
      spawnSync('security', ['delete-generic-password', '-s', SERVICE, '-a', account], { stdio: 'ignore' });
      cache.set(account, '');
    },
  };
}
