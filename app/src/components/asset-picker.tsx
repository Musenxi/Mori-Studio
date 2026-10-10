import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ImagePlus, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, assetUrl, IMAGE_ACCEPT, isImageFile } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useRefresh } from '@/lib/hooks';
import { assetOf, assetPath, baseName, SHARED, useAssetFolder } from '@/lib/folder';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ModalContent } from '@/components/modal';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/segmented';

/** 上传后的提示：几张是新存的，几张是已经有的 */
export function uploadedToast({ paths, dups }: { paths: string[]; dups: number }) {
  const fresh = paths.length - dups;
  toast.success(dups ? (fresh ? `已上传 ${fresh} 张，${dups} 张已经有了` : `${dups} 张已经有了，用原来的`) : `已上传 ${fresh} 张`);
}

type Scope = 'here' | 'shared' | 'all';

/** 图库：默认看当前文章自己的文件夹，也能看共用、全部；拖入或选择的新图片存进当前文章的文件夹。onPick 拿到图片路径 */
export function AssetDialog({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (path: string) => void }) {
  const folder = useAssetFolder();
  const own = folder !== SHARED;
  const refresh = useRefresh();
  const { data, refetch } = useQuery({ queryKey: ['assets'], queryFn: api.assets, enabled: open, staleTime: 0 });
  const [scope, setScope] = useState<Scope>(own ? 'here' : 'shared');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const all = useMemo(() => data?.assets ?? [], [data?.assets]);
  const inScope = all.filter((a) => (scope === 'all' ? true : a.folder === (scope === 'here' ? folder : SHARED)));
  const shown = inScope.filter((a) => a.path.toLowerCase().includes(q.toLowerCase()));

  const upload = async (files: File[]) => {
    if (!files.some(isImageFile)) return toast.error('只能上传图片');
    setBusy(true);
    try {
      const r = await api.uploadImages(files, folder);
      await Promise.all([refetch(), refresh()]);
      if (r.paths.length === 1) onPick(r.paths[0]);
      else uploadedToast(r);
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ModalContent wide title="图库" description={`${inScope.length} 张`}>
        <div className="flex items-center gap-3">
          <Segmented size="sm" value={scope} onValueChange={setScope} options={[...(own ? [{ value: 'here' as const, label: '本文' }] : []), { value: 'shared' as const, label: '共用' }, { value: 'all' as const, label: '全部' }]} />
          {all.length > 8 && <Input className="w-48" value={q} onChange={(e) => setQ(e.target.value)} placeholder="按文件名找" />}
        </div>
        <div
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); void upload([...e.dataTransfer.files]); }}
          className={cn('mt-3 flex items-center gap-3 rounded-xl bg-muted px-4 py-3 text-13 text-muted-foreground transition-[background-color,color,box-shadow]', over && 'bg-muted-hover text-foreground ring-2 ring-foreground/25')}
        >
          <Upload size={16} />
          <span className="flex-1">{busy ? '上传中……' : '把图片拖到这里，或'}</span>
          <input ref={input} type="file" accept={IMAGE_ACCEPT} multiple hidden onChange={(e) => { void upload([...(e.target.files ?? [])]); e.target.value = ''; }} />
          <Button size="sm" variant="secondary" onClick={() => input.current?.click()} disabled={busy}>选择文件</Button>
        </div>
        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3">
          {shown.map((a) => (
            <button key={a.path} type="button" onClick={() => onPick(a.path)} className="group text-left">
              <img loading="lazy" src={assetUrl(a.path, 240)} alt="" className="aspect-[4/3] w-full rounded-lg bg-muted object-cover transition-[box-shadow,transform] duration-200 group-hover:ring-2 group-hover:ring-foreground/60 group-active:scale-98" />
              <span className="mono mt-1 block truncate text-11 text-muted-foreground" title={a.path}>{a.name}</span>
            </button>
          ))}
        </div>
        {shown.length === 0 && <p className="py-10 text-center text-muted-foreground">{inScope.length ? '没有匹配的图片。' : '还没有图片。'}</p>}
      </ModalContent>
    </Dialog>
  );
}

/** 图片字段：缩略图 + 选择 / 清除。value 是内容里的相对路径 */
export function ImageField({ value, onChange, optional = true }: { value?: string; onChange: (v: string | undefined) => void; optional?: boolean }) {
  const [open, setOpen] = useState(false);
  const path = assetOf(value);
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={() => setOpen(true)} className="grid h-14 w-18 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-muted-foreground transition-[box-shadow] hover:ring-2 hover:ring-foreground/25">
        {path ? <img src={assetUrl(path, 160)} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={18} />}
      </button>
      <div className="min-w-0 text-12-5">
        <div className="mono truncate text-muted-foreground" title={path}>{baseName(path) || '未选择'}</div>
        <div className="mt-0.5 flex gap-3">
          <button type="button" className="text-foreground underline decoration-foreground/25 underline-offset-4 hover:decoration-foreground" onClick={() => setOpen(true)}>{path ? '更换' : '选择图片'}</button>
          {path && optional && <button type="button" className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-destructive" onClick={() => onChange(undefined)}><X size={12} />清除</button>}
        </div>
      </div>
      <AssetDialog open={open} onOpenChange={setOpen} onPick={(p) => { onChange(assetPath(p)); setOpen(false); }} />
    </div>
  );
}
