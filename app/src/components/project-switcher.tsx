import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** 点站点名切换站点（浏览器里用；桌面版从菜单切，canSwitch 为 false 时不出现）。换的时候 Studio 自己重启，等新站点起来再刷新 */
export function ProjectSwitcher({ children }: { children: ReactNode }) {
  const q = useQuery({ queryKey: ['projects'], queryFn: api.projects, staleTime: 0 });
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!q.data?.canSwitch) return <>{children}</>;

  const go = async (root: string) => {
    setBusy(true);
    setError('');
    try {
      await api.switchProject(root);
      // 旧进程退出、新的起来（可能要先构建界面）：轮询到 /api/ping 报的是新站点
      const until = Date.now() + 120_000;
      for (;;) {
        await new Promise((r) => setTimeout(r, 800));
        try { if ((await api.ping()).root === root || Date.now() > until) break; } catch { /* 还没起来 */ }
        if (Date.now() > until) break;
      }
      location.reload();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };

  return (
    <Popover>
      <PopoverTrigger asChild><button type="button" className="min-w-0 text-left">{children}</button></PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="flex items-center gap-2 px-2 py-1.5 text-13"><Check size={14} className="shrink-0 text-brand" /><span className="mono min-w-0 truncate" title={q.data.current}>{q.data.current}</span></div>
        {q.data.recent.map((r) => (
          <button key={r.path} type="button" disabled={busy} onClick={() => void go(r.path)} className="flex w-full flex-col rounded-lg px-2 py-1.5 pl-8 text-left text-13 hover:bg-foreground/[.06] disabled:opacity-50">
            <span className="truncate">{r.name}</span>
            <span className="mono truncate text-11 text-muted-foreground">{r.path}</span>
          </button>
        ))}
        <form className="flex gap-2 p-2 pt-3" onSubmit={(e) => { e.preventDefault(); if (path.trim()) void go(path.trim()); }}>
          <Input variant="mono" value={path} placeholder="/path/to/site" spellCheck={false} onChange={(e) => setPath(e.target.value)} />
          <Button type="submit" disabled={busy || !path.trim()}>{busy ? '切换中…' : '切换'}</Button>
        </form>
        {error && <p className="px-2 pb-1 text-13 text-destructive">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}
