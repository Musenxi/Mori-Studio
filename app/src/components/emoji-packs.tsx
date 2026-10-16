import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, type ManagedPack } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ModalContent } from '@/components/modal';
import { Field } from '@/components/field';
import { useConfirm } from '@/components/confirm';
import { Empty } from '@/components/page';

export const EMOJI_ACCEPT = '.png,.gif,.webp,.svg,.avif,.jpg,.jpeg';
export const isEmojiFile = (f: File) => /\.(png|gif|webp|svg|avif|jpe?g)$/i.test(f.name);
const fileUrl = (pack: string, file: string) => `/api/emoji/file/${encodeURIComponent(pack)}/${encodeURIComponent(file)}`;
const size = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

/** 输入一个名字的对话框：新建包、改名共用 */
export function NameDialog({ state, onClose }: { state: { title: string; value: string; submit: string; run: (v: string) => Promise<void> } | null; onClose: () => void }) {
  return (
    <Dialog open={state !== null} onOpenChange={(o) => !o && onClose()}>
      {state && <NameForm key={state.title} state={state} onClose={onClose} />}
    </Dialog>
  );
}
function NameForm({ state, onClose }: { state: NonNullable<Parameters<typeof NameDialog>[0]['state']>; onClose: () => void }) {
  const [v, setV] = useState(state.value);
  const [busy, setBusy] = useState(false);
  const ok = !!v.trim() && v.trim() !== state.value;
  return (
    <ModalContent title={state.title}>
      <form onSubmit={async (e) => { e.preventDefault(); if (!ok) return; setBusy(true); try { await state.run(v.trim()); onClose(); } catch (err) { toast.error((err as Error).message); } setBusy(false); }}>
        <Field label="名字"><Input autoFocus variant="mono" value={v} onChange={(e) => setV(e.target.value)} /></Field>
        <div className="mt-5 flex justify-end gap-2"><Button onClick={onClose}>取消</Button><Button type="submit" variant="default" disabled={!ok || busy}>{state.submit}</Button></div>
      </form>
    </ModalContent>
  );
}

/** 一个表情包里的表情：点一下复制 :[包名_表情名]；本地图可以改名、删除，pack.json 里的链接只看 */
export function EmojiGrid({ pack, q, onChanged }: { pack: ManagedPack; q: string; onChanged: () => Promise<unknown> }) {
  const confirm = useConfirm();
  const [naming, setNaming] = useState<Parameters<typeof NameDialog>[0]['state']>(null);
  const items = pack.items.filter((it) => it.name.toLowerCase().includes(q.toLowerCase()));
  const copy = (key: string) => { void navigator.clipboard?.writeText(`:[${key}]`).then(() => toast.success('已复制'), () => {}); };
  const rename = (name: string) => setNaming({ title: `改名「${name}」`, value: name, submit: '改名', run: async (to) => { await api.renameEmoji(pack.id, name, to); await onChanged(); } });
  const remove = async (name: string) => {
    if (!(await confirm({ title: `删除表情「${name}」？`, description: '写着它的地方会显示成文字。可以在回收站里还原。', confirmLabel: '删除', danger: true }))) return;
    try { await api.removeEmoji(pack.id, name); await onChanged(); toast.success('已删除'); } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3">
        {items.map((it) => (
          <figure key={it.name} className="group relative rounded-2xl bg-muted/70 p-2 transition-colors hover:bg-muted">
            <button type="button" aria-label={`复制 :[${it.key}]`} onClick={() => copy(it.key)} className="grid aspect-square w-full place-items-center rounded-xl bg-muted-hover p-3">
              <img loading="lazy" src={it.file ? fileUrl(pack.id, it.file) : it.url} alt="" className="max-h-full max-w-full object-contain" />
            </button>
            {it.file && (
              <div className="absolute right-3 top-3 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <button type="button" aria-label={`改名 ${it.name}`} onClick={() => rename(it.name)} className="grid h-7 w-7 place-items-center rounded-full bg-popover/90 text-soft-foreground shadow-soft backdrop-blur hover:text-foreground"><Pencil size={12} /></button>
                <button type="button" aria-label={`删除 ${it.name}`} onClick={() => void remove(it.name)} className="grid h-7 w-7 place-items-center rounded-full bg-popover/90 text-soft-foreground shadow-soft backdrop-blur hover:text-destructive"><Trash2 size={12} /></button>
              </div>
            )}
            <figcaption className="px-1 pb-0.5 pt-2">
              <div className="truncate text-12" title={it.name}>{it.name}</div>
              <div className="mono truncate text-10-5 text-muted-foreground">{it.file ? size(it.size ?? 0) : '链接'}</div>
            </figcaption>
          </figure>
        ))}
      </div>
      {items.length === 0 && <Empty>{q ? '没有符合条件的表情。' : '还没有表情。'}</Empty>}
      <NameDialog state={naming} onClose={() => setNaming(null)} />
    </>
  );
}
