import { useState, type ReactNode } from 'react';
import { api, type CommentsInfo } from '@/lib/api';
import { useProject, useRefresh } from '@/lib/hooks';
import { useConfirm } from '@/components/confirm';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OptionSelect } from '@/components/option-select';

/** mori.config.ts 里第三方评论的名字 */
export const THIRD_PARTY: Record<string, string> = { giscus: 'Giscus', waline: 'Waline', twikoo: 'Twikoo', artalk: 'Artalk', disqus: 'Disqus' };

/** 第三方评论要填的项：[键, 名称, 占位, 必填] */
const THIRD_FIELDS: Record<string, [string, string, string, boolean][]> = {
  giscus: [['repo', '仓库', 'owner/repo', true], ['repoId', '仓库 ID', '', true], ['category', '分类', '', true], ['categoryId', '分类 ID', '', true]],
  waline: [['serverURL', '服务地址', 'https://waline.example.com', true]],
  twikoo: [['envId', '环境 ID', '', true]],
  artalk: [['server', '服务地址', 'https://artalk.example.com', true], ['site', '站点名', '默认用域名', false]],
  disqus: [['shortname', 'Shortname', '', true]],
};

/**
 * 接入自建评论服务：地址 + 管理令牌，连得通才写进 mori.config.ts、存令牌（评论页、设定、新站点的引导共用）。
 * 已经接入过的，令牌留空表示沿用现在的。
 */
export function CommentsConnect({ onDone, onCancel, error: initialError = '', extra }: { onDone?: (info?: CommentsInfo) => void; onCancel?: () => void; /** 一打开就显示的错误（令牌被拒）；这时现在的令牌不能沿用 */ error?: string; extra?: ReactNode }) {
  const { data: project } = useProject();
  const refresh = useRefresh();
  const confirm = useConfirm();
  const c = project!.comments;
  const [svc, setSvc] = useState(c.provider ?? 'mori');
  const [fields, setFields] = useState<Record<string, string>>(() => (c.provider && c.provider !== 'mori' ? { ...(c.third ?? {}) } : {}));
  const [endpoint, setEndpoint] = useState(c.provider === 'mori' ? c.endpoint : '');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const keep = c.hasToken && !initialError; // 令牌可以留空沿用
  const third = c.provider && c.provider !== 'mori' ? (THIRD_PARTY[c.provider] ?? c.provider) : null;
  const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(endpoint.trim());

  const connectThird = async () => {
    if (c.provider && c.provider !== svc && !(await confirm({ title: `换成 ${THIRD_PARTY[svc]}？`, description: `mori.config.ts 里现在的评论设置会被替换。`, confirmLabel: '替换', danger: true }))) return;
    setBusy(true);
    setError('');
    try {
      await api.connectThirdComments(svc, fields);
      await refresh();
      onDone?.();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  const connect = async (t: string) => {
    if (third && !(await confirm({ title: '换成自建评论？', description: `mori.config.ts 里 ${third} 的设置会被替换。`, confirmLabel: '替换', danger: true }))) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.connectComments(endpoint, t);
      await refresh();
      setToken('');
      onDone?.(r.info);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  const pick = (
    <Field label="评论服务">
      <OptionSelect value={svc} onValueChange={(v) => { setSvc(v); setError(''); if (v !== 'mori' && v !== c.provider) setFields({}); else if (v === c.provider) setFields({ ...(c.third ?? {}) }); }}
        options={[{ value: 'mori', label: 'Mori' }, ...Object.entries(THIRD_PARTY).map(([value, label]) => ({ value, label }))]} />
    </Field>
  );

  if (svc !== 'mori') {
    const spec = THIRD_FIELDS[svc];
    return (
      <form onSubmit={(e) => { e.preventDefault(); void connectThird(); }}>
        {pick}
        {spec.map(([k, label, ph]) => (
          <Field key={k} label={label}><Input variant="mono" value={fields[k] ?? ''} placeholder={ph || undefined} spellCheck={false} autoComplete="off" onChange={(e) => setFields({ ...fields, [k]: e.target.value })} /></Field>
        ))}
        {error && <p className="py-1 pl-30 text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-2 pl-30">
          <Button type="submit" variant="default" disabled={busy || spec.some(([k, , , req]) => req && !(fields[k] ?? '').trim())}>{busy ? '保存中…' : '保存'}</Button>
          {onCancel && <Button variant="ghost" disabled={busy} onClick={onCancel}>取消</Button>}
          {extra}
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void connect(token); }}>
      {pick}
      <Field label="服务地址"><Input variant="mono" value={endpoint} placeholder="https://comments.example.com" spellCheck={false} autoComplete="off" onChange={(e) => setEndpoint(e.target.value)} /></Field>
      <Field label="管理令牌"><Input type="password" value={token} placeholder={keep ? '留空不改' : undefined} autoComplete="off" onChange={(e) => setToken(e.target.value)} /></Field>
      {error && <p className="py-1 pl-30 text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-2 pt-2 pl-30">
        <Button type="submit" variant="default" disabled={busy || !endpoint.trim() || (!token.trim() && !keep)}>{busy ? '连接中…' : '连接'}</Button>
        {local && <Button disabled={busy} onClick={() => void connect('dev-token')}>使用 dev-token</Button>}
        {onCancel && <Button variant="ghost" disabled={busy} onClick={onCancel}>取消</Button>}
        {extra}
      </div>
    </form>
  );
}
