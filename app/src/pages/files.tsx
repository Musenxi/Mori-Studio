import { useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { Check, CloudUpload, FolderInput, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, assetUrl, IMAGE_ACCEPT, isImageFile, type AssetInfo } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useProject, useRefresh } from '@/lib/hooks';
import { folderLabel, SHARED } from '@/lib/folder';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useConfirm } from '@/components/confirm';
import { Input } from '@/components/ui/input';
import { Empty, PageHeader } from '@/components/page';
import { uploadedToast } from '@/components/asset-picker';
import { StripLocationSwitch, useStripLocation } from '@/components/strip-location';

const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const href = (r: AssetInfo['usedBy'][number]) => (r.kind === 'page' ? `/pages/${r.id}` : r.kind === 'friends' ? '/friends' : `/posts/${r.id}`);
const entryHref = (folder: string) => (folder.startsWith('posts/') ? `/posts/${folder.slice(6)}` : folder.startsWith('pages/') ? `/pages/${folder.slice(6)}` : null);
const DRAG = 'application/x-mori-assets';

/** 左边的一类：全部 / 没被引用 / 看起来一样，或者一个文件夹（f:路径） */
type View = 'all' | 'unused' | 'similar' | `f:${string}`;

export default function Files() {
  const refresh = useRefresh();
  const confirm = useConfirm();
  const { data: project } = useProject();
  const { data, refetch } = useQuery({ queryKey: ['assets'], queryFn: api.assets, staleTime: 0 });
  const [params, setParams] = useSearchParams();
  const view = (params.get('v') ?? 'all') as View;
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [over, setOver] = useState<string | null>(null); // 拖着的东西正在哪儿上面：'grid' 或某个文件夹
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const setView = (v: View) => { setParams(v === 'all' ? {} : { v }); setSel(new Set()); };

  const all = useMemo(() => data?.assets ?? [], [data?.assets]);
  const similar = data?.similar ?? [];
  const byPath = useMemo(() => new Map(all.map((a) => [a.path, a])), [all]);
  const counts = useMemo(() => { const m = new Map<string, number>(); for (const a of all) m.set(a.folder, (m.get(a.folder) ?? 0) + 1); return m; }, [all]);
  const count = (f: string) => counts.get(f) ?? 0;

  // 文件夹：共用、未归类，然后每篇文章、每个页面（没有图的也列出来，好往里放）；文章删掉后留下的文件夹也列出
  const titles = useMemo(() => new Map<string, string>([...(project?.entries ?? []).map((e) => [`posts/${e.id}`, e.title || e.id] as const), ...(project?.pages ?? []).map((p) => [`pages/${p.id}`, p.title || p.id] as const)]), [project]);
  const groups = useMemo(() => {
    const known = new Set([SHARED, '', ...titles.keys()]);
    const extra = [...counts.keys()].filter((f) => !known.has(f));
    return [
      { label: null, folders: [SHARED, ...(counts.get('') ? [''] : [])] },
      { label: '文章', folders: [...(project?.entries ?? []).map((e) => `posts/${e.id}`), ...extra.filter((f) => f.startsWith('posts/'))] },
      { label: '页面', folders: [...(project?.pages ?? []).map((p) => `pages/${p.id}`), ...extra.filter((f) => !f.startsWith('posts/'))] },
    ].filter((g) => g.folders.length);
  }, [counts, project, titles]);
  const label = (f: string) => folderLabel(f, titles);

  const folder = view.startsWith('f:') ? view.slice(2) : null;
  const list = useMemo(() => {
    const base = view === 'unused' ? all.filter((a) => a.usedBy.length === 0) : folder !== null ? all.filter((a) => a.folder === folder) : all;
    return base.filter((a) => a.path.toLowerCase().includes(q.toLowerCase()));
  }, [all, view, folder, q]);
  const unused = all.filter((a) => a.usedBy.length === 0).length;
  const title = view === 'all' ? '全部' : view === 'unused' ? '没被引用' : view === 'similar' ? '看起来一样' : label(folder!);

  const reload = () => Promise.all([refetch(), refresh()]);
  const [strip, setStrip] = useStripLocation();
  const upload = async (files: File[]) => {
    if (!files.some(isImageFile)) return toast.error('只能上传图片');
    setBusy(true);
    try { uploadedToast(await api.uploadImages(files, folder ?? SHARED, strip)); await reload(); } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  };
  const move = async (paths: string[], to: string) => {
    const from = paths.filter((p) => byPath.get(p)?.folder !== to);
    if (!from.length) return;
    try { await api.moveAssets(from, to); setSel(new Set()); await reload(); toast.success(`已移到“${label(to)}”`); } catch (e) { toast.error((e as Error).message); }
  };
  const remove = async (paths: string[]) => {
    const used = paths.filter((p) => byPath.get(p)?.usedBy.length).length;
    const one = paths.length === 1 ? byPath.get(paths[0])?.name : null;
    if (!(await confirm({ title: one ? `删除 ${one}？` : `删除 ${paths.length} 张图片？`, description: used ? `有 ${used} 张正被内容使用，删掉之后那里会找不到图片、构建会报错。可以在回收站里还原。` : '可以在回收站里还原。', confirmLabel: '删除', danger: true }))) return;
    try { for (const p of paths) await api.removeAsset(p); setSel(new Set()); await reload(); toast.success('已删除'); } catch (e) { toast.error((e as Error).message); }
  };
  const keep = async (path: string, group: string[]) => {
    const drops = group.filter((p) => p !== path);
    if (!(await confirm({ title: '保留这张？', description: `其余 ${drops.length} 张的引用会改成这张，然后移进回收站。`, confirmLabel: '保留这张' }))) return;
    try { await api.mergeAssets(path, drops); await reload(); toast.success('已合并'); } catch (e) { toast.error((e as Error).message); }
  };
  const sync = async () => {
    setSyncing(true);
    let out = '';
    try {
      const code = await api.syncImageHost((t) => { out = t; });
      const last = out.trim().split('\n').filter((l) => !l.startsWith('[exit')).pop() ?? '';
      if (code) toast.error(last); else toast.success(last);
      await refetch();
    } catch (e) { toast.error((e as Error).message); }
    setSyncing(false);
  };
  const toggle = (p: string) => setSel((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  // 拖动：卡片拖到左边的文件夹上是移动；电脑里的文件拖进来是上传
  const dragStart = (e: DragEvent, p: string) => {
    e.dataTransfer.setData(DRAG, JSON.stringify(sel.has(p) ? [...sel] : [p]));
    e.dataTransfer.effectAllowed = 'move';
  };
  const dropOn = (target: string) => ({
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); setOver(target); } },
    onDragLeave: () => setOver((o) => (o === target ? null : o)),
    onDrop: (e: DragEvent) => { const raw = e.dataTransfer.getData(DRAG); setOver(null); if (raw) { e.preventDefault(); void move(JSON.parse(raw), target); } },
  });

  const row = (key: View, text: string, n: number, target?: string) => (
    <button
      key={key} type="button" onClick={() => setView(key)} {...(target !== undefined ? dropOn(target) : {})}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-lg px-3 text-left text-13 transition-[background-color,color,box-shadow] duration-150',
        view === key ? 'bg-popover font-medium text-foreground shadow-soft' : 'text-soft-foreground hover:bg-foreground/[.05] hover:text-foreground',
        target !== undefined && over === target && 'ring-2 ring-foreground/30',
      )}
    >
      <span className="flex-1 truncate">{text}</span>
      <span className={cn('mono text-11', n ? 'text-muted-foreground' : 'text-muted-foreground/50')}>{n}</span>
    </button>
  );

  const card = (a: AssetInfo, extra?: ReactNode) => (
    <figure key={a.path} draggable onDragStart={(e) => dragStart(e, a.path)} className={cn('group rounded-2xl bg-muted/70 p-2 transition-[background-color,box-shadow] hover:bg-muted', sel.has(a.path) && 'bg-muted ring-2 ring-foreground/40')}>
      <div className="relative overflow-hidden rounded-xl bg-muted-hover">
        <button type="button" aria-label={sel.has(a.path) ? '取消选择' : '选择'} onClick={() => toggle(a.path)} className="block w-full">
          <img loading="lazy" src={assetUrl(a.path, 360)} alt="" draggable={false} className="aspect-[4/3] w-full object-cover" />
        </button>
        <span className={cn('pointer-events-none absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full border transition-opacity', sel.has(a.path) ? 'border-foreground bg-foreground text-background opacity-100' : 'border-white/80 bg-black/15 opacity-0 group-hover:opacity-100', sel.size > 0 && 'opacity-100')}>
          {sel.has(a.path) && <Check size={12} strokeWidth={3} />}
        </span>
        <button type="button" aria-label={`删除 ${a.name}`} onClick={() => remove([a.path])} className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-full bg-popover/90 text-soft-foreground opacity-0 shadow-soft backdrop-blur transition-opacity hover:text-destructive focus:opacity-100 group-hover:opacity-100"><Trash2 size={13} /></button>
      </div>
      <figcaption className="px-1.5 pb-1 pt-2">
        <div className="mono truncate text-11-5" title={a.path}>{a.name}</div>
        <div className="mono truncate text-10-5 text-muted-foreground">
          {folder === null && <>{label(a.folder)} · </>}
          {a.width && a.height ? `${a.width}×${a.height} · ` : ''}{size(a.size)}{a.live && ' · 实况'}{a.remote === false && ' · 未上传'}
        </div>
        <div className="mt-0.5 truncate text-12">
          {a.usedBy.length === 0 ? <span className="text-muted-foreground">没被引用</span> : (
            <span className="text-soft-foreground">被引用：{a.usedBy.slice(0, 2).map((r, i) => <span key={r.kind + r.id}>{i > 0 && '、'}<Link to={href(r)} className="text-foreground underline decoration-foreground/20 underline-offset-2 hover:decoration-foreground">{r.title}</Link></span>)}{a.usedBy.length > 2 && ` 等 ${a.usedBy.length} 处`}</span>
          )}
        </div>
        {extra}
      </figcaption>
    </figure>
  );

  const open = folder !== null ? entryHref(folder) : null;
  const moveTargets = [SHARED, ...groups.slice(1).flatMap((g) => g.folders)];

  return (
    <div className="min-h-full">
      <PageHeader title="文件" sub={`${all.length} 张`} actions={<>
        <input ref={input} type="file" accept={IMAGE_ACCEPT} multiple hidden onChange={(e) => { void upload([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <StripLocationSwitch checked={strip} onCheckedChange={setStrip} />
        {data?.host && <Button variant="secondary" onClick={() => void sync()} disabled={syncing || !data.host.pending}><CloudUpload size={14} />{syncing ? '同步中……' : data.host.pending ? `同步到图床（${data.host.pending}）` : '已同步到图床'}</Button>}
        <Button variant="default" onClick={() => input.current?.click()} disabled={busy || view === 'similar'}><Upload size={14} />{busy ? '上传中……' : '上传图片'}</Button>
      </>} />
      <div className="mx-auto flex max-w-320 animate-rise gap-8 px-10 pb-24 pt-4">
        <nav className="sticky top-20 max-h-[calc(100vh-6rem)] w-56 shrink-0 space-y-0.5 self-start overflow-y-auto">
          {row('all', '全部', all.length)}
          {row('unused', '没被引用', unused)}
          {similar.length > 0 && row('similar', '看起来一样', similar.length)}
          {groups.map((g) => (
            <div key={g.label ?? 'top'} className="pt-4">
              {g.label && <div className="px-3 pb-1 text-11-5 text-muted-foreground">{g.label}</div>}
              {g.folders.map((f) => row(`f:${f}`, label(f), count(f), f))}
            </div>
          ))}
        </nav>

        <main
          className={cn('min-w-0 flex-1 rounded-2xl transition-[background-color,box-shadow]', over === 'grid' && 'bg-foreground/[.03] ring-2 ring-foreground/20')}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files') && view !== 'similar') { e.preventDefault(); setOver('grid'); } }}
          onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(null); }}
          onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setOver(null); void upload([...e.dataTransfer.files]); }}
        >
          <div className="mb-5 flex min-h-9 items-center gap-3">
            {sel.size > 0 ? (
              <>
                <span className="text-14 font-semibold">已选 {sel.size} 张</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button size="sm" variant="secondary"><FolderInput size={14} />移到</Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
                    {moveTargets.map((f, i) => (
                      <div key={f}>
                        {i === 1 && <DropdownMenuSeparator />}
                        <DropdownMenuItem onSelect={() => void move([...sel], f)}>{label(f)}</DropdownMenuItem>
                      </div>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button size="sm" variant="secondary" onClick={() => remove([...sel])}><Trash2 size={14} />删除</Button>
                <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}><X size={14} />取消</Button>
              </>
            ) : (
              <>
                <h2 className="truncate text-14 font-semibold">{title}</h2>
                {open && <Link to={open} className="text-12-5 text-muted-foreground underline decoration-foreground/20 underline-offset-4 hover:text-foreground hover:decoration-foreground">打开</Link>}
              </>
            )}
            {view !== 'similar' && <Input variant="pill" className="ml-auto w-52" value={q} onChange={(e) => setQ(e.target.value)} placeholder="按文件名找" />}
          </div>

          {view === 'similar' ? (
            <div className="space-y-8">
              {similar.map((g) => (
                <div key={g.join('|')} className="grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-4">
                  {g.map((p) => byPath.get(p)).filter((a): a is AssetInfo => !!a).map((a) => card(a, (
                    <button type="button" onClick={() => keep(a.path, g)} className="mt-1.5 text-12 text-foreground underline decoration-foreground/25 underline-offset-4 hover:decoration-foreground">保留这张</button>
                  )))}
                </div>
              ))}
              {similar.length === 0 && <Empty>没有看起来一样的图片。</Empty>}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-4">{list.map((a) => card(a))}</div>
              {list.length === 0 && <Empty>{q ? '没有符合条件的图片。' : '还没有图片。'}</Empty>}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
