import { useEffect, useState } from 'react';
import { Smile } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tip } from '@/components/tip';
import { api, type EmojiPack } from '@/lib/api';
import { cn } from '@/lib/cn';

let cache: Promise<EmojiPack[]> | null = null;
const load = () => (cache ??= api.emoji().then((r) => r.packs).catch(() => { cache = null; return []; }));

/** 站点的表情包（public/emoji/）。每次打开选择器时重新取，新放进去的表情马上能用 */
export function useEmoji(fresh = false): EmojiPack[] {
  const [packs, setPacks] = useState<EmojiPack[]>([]);
  useEffect(() => { if (fresh) cache = null; let on = true; void load().then((p) => on && setPacks(p)); return () => { on = false; }; }, [fresh]);
  return packs;
}

/** 表情名 → 图片地址（评论正文里显示表情用） */
export function useEmojiMap(): Record<string, string> {
  const packs = useEmoji();
  return Object.fromEntries(packs.flatMap((p) => p.items.map((it) => [it.key, it.url])));
}

/** 工具栏里的表情按钮：点开一排标签（每个表情包一个），下面是这个包的表情；选一个就交给 onPick（表情的名字：包名_表情名） */
export function EmojiPicker({ btnClass, onPick, onClose }: { btnClass: string; onPick: (key: string) => void; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const packs = useEmoji(open);
  const [at, setAt] = useState(0);
  const pack = packs[Math.min(at, packs.length - 1)];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tip label="表情"><PopoverTrigger asChild><button type="button" aria-label="表情" onMouseDown={(e) => e.preventDefault()} className={btnClass}><Smile size={15} /></button></PopoverTrigger></Tip>
      <PopoverContent align="end" className="w-80" onCloseAutoFocus={(e) => { e.preventDefault(); onClose?.(); }}>
        {pack ? (
          <>
            <div role="tablist" className="flex gap-0.5 overflow-x-auto">
              {packs.map((p, i) => (
                <button key={p.id} type="button" role="tab" aria-selected={p === pack} onClick={() => setAt(i)}
                  className={cn('shrink-0 rounded-full px-2.5 py-1 text-smaller transition-colors', p === pack ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}>{p.title}</button>
              ))}
            </div>
            <div className="mt-2 grid max-h-56 grid-cols-7 gap-0.5 overflow-y-auto">
              {pack.items.map((it) => (
                <button key={it.key} type="button" title={it.name} onClick={() => { onPick(it.key); setOpen(false); }}
                  className="grid h-10 place-items-center rounded-lg transition-colors hover:bg-muted">
                  <img src={it.url} alt={it.name} loading="lazy" className="h-7 w-7 object-contain" />
                </button>
              ))}
            </div>
          </>
        ) : <p className="text-smaller text-muted-foreground">还没有表情包。</p>}
      </PopoverContent>
    </Popover>
  );
}
