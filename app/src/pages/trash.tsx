import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Image as ImageIcon, PanelTop, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, type TrashItem } from '@/lib/api';
import { useRefresh } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/confirm';
import { Body, Empty, PageHeader } from '@/components/page';

const KIND = { post: '文章', page: '页面', asset: '图片' } as const;
const IMAGE = /\.(jpe?g|png|webp|avif|gif|svg)$/i;

const pad = (n: number) => String(n).padStart(2, '0');
const when = (t: number) => { const d = new Date(t); return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const bytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
/** 原来在哪：文章、页面给网址那一段，图片给图库里的路径 */
const where = (it: TrashItem) => (it.kind === 'asset' ? it.label : `/${it.kind === 'page' ? '' : 'posts/'}${it.key.replace(/^(legacy:)?\d+-(post|travel|page)-/, '')}/`);

export default function Trash() {
  const qc = useQueryClient();
  const refresh = useRefresh();
  const confirm = useConfirm();
  const { data } = useQuery({ queryKey: ['trash'], queryFn: api.trash });
  const items = data?.items ?? [];
  const reload = async () => { await qc.invalidateQueries({ queryKey: ['trash'] }); await refresh(); };

  const restore = async (it: TrashItem) => {
    try { await api.restoreTrash(it.key); await reload(); toast.success(`已还原${it.kind === 'asset' ? '' : `「${it.label}」`}`); } catch (e) { toast.error((e as Error).message); }
  };
  const purge = async (it: TrashItem) => {
    if (!(await confirm({ title: `彻底删除「${it.label}」？`, description: '删除后不能恢复。', confirmLabel: '彻底删除', danger: true }))) return;
    try { await api.purgeTrash(it.key); await reload(); } catch (e) { toast.error((e as Error).message); }
  };
  const empty = async () => {
    if (!(await confirm({ title: '清空回收站？', description: `${items.length} 项会被彻底删除，不能恢复。`, confirmLabel: '清空', danger: true }))) return;
    try { await api.emptyTrash(); await reload(); } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <>
      <PageHeader title="回收站" sub={items.length ? `${items.length}` : undefined} actions={<Button variant="danger" onClick={() => void empty()} disabled={!items.length}><Trash2 size={14} />清空</Button>} />
      <Body wide>
        {data && !items.length && <Empty>回收站是空的。</Empty>}
        <div className="space-y-0.5">
          {items.map((it) => {
            const img = it.kind === 'asset' && IMAGE.test(it.files[0][0]) ? `/api/trash/file?path=${encodeURIComponent(it.files[0][0])}` : null;
            const Icon = it.kind === 'asset' ? ImageIcon : it.kind === 'page' ? PanelTop : FileText;
            return (
              <div key={it.key} className="group grid grid-cols-[2.5rem_minmax(0,1fr)_4rem_9rem_5rem_auto] items-center gap-x-4 rounded-xl px-4 py-3 transition-colors hover:bg-foreground/[.045]">
                <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-lg bg-foreground/[.05] text-muted-foreground">
                  {img ? <img src={img} alt="" className="h-full w-full object-cover" /> : <Icon size={16} />}
                </span>
                <div className="min-w-0">
                  <div className="truncate font-medium">{it.kind === 'asset' ? it.label.split('/').pop() : it.label}</div>
                  <div className="mono truncate text-11 text-muted-foreground">{where(it)}</div>
                </div>
                <span className="text-soft-foreground">{KIND[it.kind]}</span>
                <span className="mono text-12 text-muted-foreground">{when(it.deletedAt)}</span>
                <span className="mono text-12 text-muted-foreground">{bytes(it.size)}</span>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => void restore(it)}><RotateCcw size={13} />还原</Button>
                  <Button size="sm" variant="ghost-danger" onClick={() => void purge(it)}>彻底删除</Button>
                </div>
              </div>
            );
          })}
        </div>
      </Body>
    </>
  );
}
