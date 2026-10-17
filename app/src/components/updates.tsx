import { useState } from 'react';
import { api, type UpdateCheck } from '@/lib/api';
import { useConfirm } from '@/components/confirm';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';

/** 设定页的“更新”：手动检查主题和评论服务有没有新版本；主题可以直接更新 */
export function Updates() {
  const confirm = useConfirm();
  const [res, setRes] = useState<UpdateCheck | null>(null);
  const [busy, setBusy] = useState<'' | 'check' | 'theme' | 'studio'>('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const check = async () => {
    setBusy('check');
    setError('');
    setDone('');
    try { setRes(await api.checkUpdates()); } catch (e) { setError((e as Error).message); }
    setBusy('');
  };

  /** 更新完 Studio 自己会重启：等它停了又起来，再刷新 */
  const afterUpdate = async (r: { restart: boolean }, what: string) => {
    if (!r.restart) {
      setDone(`${what}已更新，重新打开项目后生效。`);
      setRes(null);
      return;
    }
    let down = false;
    for (let i = 0; i < 150; i++) {
      await new Promise((ok) => setTimeout(ok, 800));
      try { await api.ping(); if (down) break; } catch { down = true; }
    }
    location.reload();
  };

  const updateTheme = async () => {
    if (!(await confirm({ title: '更新主题？', description: '会把新版主题合并进这个站点；有冲突就放弃，文件保持原样。', confirmLabel: '更新' }))) return;
    setBusy('theme');
    setError('');
    try { await afterUpdate(await api.updateTheme(), '主题'); } catch (e) { setError((e as Error).message); }
    setBusy('');
  };

  const updateStudio = async () => {
    if (!(await confirm({ title: '更新 Studio？', description: '会在 Studio 所在的仓库里拉取新版，然后重启。', confirmLabel: '更新' }))) return;
    setBusy('studio');
    setError('');
    try { await afterUpdate(await api.updateStudio(), 'Studio'); } catch (e) { setError((e as Error).message); }
    setBusy('');
  };

  const studio = res?.studio;
  const theme = res?.theme;
  const cm = res?.comments;
  return (
    <>
      {studio && (
        <Field label="Studio">
          {'error' in studio ? <span className="text-destructive">{studio.error}</span> : (
            <>
              <div className="flex min-h-9 items-center gap-3">
                <span className="mono">v{studio.version}</span>
                <span className="text-muted-foreground">{studio.outdated ? `有新版 v${studio.latest}` : '已是最新'}</span>
                {studio.outdated && studio.canUpdate && <Button size="sm" variant="default" className="ml-auto shrink-0" disabled={!!busy} onClick={() => void updateStudio()}>{busy === 'studio' ? '更新中…' : '更新'}</Button>}
              </div>
              {studio.outdated && studio.desktop && <p className="mt-1 text-13 text-muted-foreground">重新打开应用时会提示更新</p>}
            </>
          )}
        </Field>
      )}
      <Field label="主题">
        <div className="flex min-h-9 items-center gap-3">
          {theme && !('error' in theme) && <span className="mono">v{theme.version}</span>}
          <span className="min-w-0 text-muted-foreground">
            {!theme ? (done || '—') : 'error' in theme ? <span className="text-destructive">{theme.error}</span> : theme.outdated ? `有新版 v${theme.latest}` : '已是最新'}
          </span>
          {theme && !('error' in theme) && theme.outdated && <Button size="sm" variant="default" className="ml-auto shrink-0" disabled={!!busy} onClick={() => void updateTheme()}>{busy === 'theme' ? '更新中…' : '更新'}</Button>}
        </div>
        {theme && !('error' in theme) && theme.commits.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-13 text-muted-foreground">
            {theme.commits.map((c) => <li key={c.hash} className="flex gap-2"><span className="mono shrink-0">{c.hash}</span><span className="truncate">{c.subject}</span></li>)}
          </ul>
        )}
      </Field>
      {cm !== undefined && res && (
        <Field label="评论服务">
          {cm === null ? <span className="text-muted-foreground">没有用自建评论</span> : (
            <>
              <div className="flex min-h-9 items-center gap-3">
                <span className="mono">{cm.version ? `v${cm.version}` : '—'}</span>
                <span className="text-muted-foreground">{cm.error ? cm.error : cm.latest && cm.outdated ? `有新版 v${cm.latest}` : '已是最新'}</span>
              </div>
              {cm.outdated && (
                <p className="mono mt-1 text-13 text-muted-foreground">{cm.runtime === 'workers' ? 'git pull && pnpm install && wrangler deploy' : 'git pull && pnpm install，然后重启'}</p>
              )}
            </>
          )}
        </Field>
      )}
      {error && <p className="py-1 pl-30 text-destructive">{error}</p>}
      <div className="flex items-center gap-2 pt-2 pl-30">
        <Button disabled={!!busy} onClick={() => void check()}>{busy === 'check' ? '检查中…' : '检查更新'}</Button>
      </div>
    </>
  );
}
