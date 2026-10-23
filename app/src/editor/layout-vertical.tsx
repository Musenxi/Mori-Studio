/**
 * 竖向读法的版面：整篇是一页往下读的长页，照着主题里竖向读法的版式摆（styles/travel.css 的 v / m）——
 *   文字居中成一栏，单图通栏或内缩，双图并排，网格一大几小，图组是一行可横拖的图，自由排布保持比例，地图一整块，
 *   幕间是整页宽的一屏停顿。
 *   标题和后面那列文字摞在一起（两边都竖排时并排，标题在右）。
 *   上下拖动 → 换顺序（竖向读法里没有“上下位置”和“大小”，那是横滚才有的）
 *   文本框：左右拖 → 放在页面的哪里（x，页宽的比例，靠左 / 居中 / 靠右和原来的栏位会吸住）；
 *   右边、下边、右下角的拖柄 → 宽（bw，页宽的比例）、高（bh，屏高的倍数；这里一屏高按 0.69 个页宽算，和主题的版心比例差不多）
 * 单图：左右拖 → 放在页面的哪里（vx），角上的圆点 → 宽（vbw，高按原图比例）；
 *   拖到一列横排文字的左边或右边三成里松手 → 浮在这列文字里，文字绕着图排（vwrap：start 图在左 / end 图在右）；
 *   环绕的图左右拖是换边，上下拖到两块之间就不再环绕
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { Doc } from '@/lib/types';
import * as ops from '@/lib/layout-ops.js';
import { useLayout, type PlaceInfo } from './layout-ctx';
import { BoxHandles, Cap, FreeFace, hereOf, Img, InterludeFace, MiniMap, PlayMark, posterOf, StripFace, TextFace, VPOS, clamp, px, r2, rowsOf } from './layout-view';

interface Drag { key: string; dy?: number; slot?: number; line?: number; vx?: number; bw?: number; bh?: number; guide?: number; side?: 'start' | 'end'; into?: { key: string; side: 'start' | 'end'; rect: [number, number, number, number] } }
/** 竖滚里单图环绕时默认的宽（页宽的比例），和主题一样 */
const WRAP_W = 0.3;

export function VerticalLayout() {
  const L = useLayout();
  const { doc, its, places, blocks, sel, selected, editing, commit } = L;
  const area = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(720);
  const [drag, setDrag] = useState<Drag | null>(null);
  const rows = useMemo(() => rowsOf(its), [its]);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAvail(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // 页宽：窄一点能一眼看到更多；字号跟着页宽走
  const W = Math.round(clamp((avail - 8) * ({ s: 0.62, m: 0.88, l: 1 }[L.zoom] ?? 0.88), 300, 960));
  const fs = Math.max(11, W * 0.019);
  const gap = W * 0.055;
  /** 一屏高：主题竖向读法里内容宽约 1248px，常见屏高约 860px */
  const VH = W * 0.69;

  /* ── 拖动：上下换顺序 ── */
  const slotAt = (clientY: number, key: string) => {
    const els = [...(page.current?.querySelectorAll<HTMLElement>('[data-seq]') ?? [])].filter((el) => el.dataset.key !== key);
    let slot = 0;
    for (const el of els) { const r = el.getBoundingClientRect(); if (r.top + r.height / 2 < clientY) slot++; }
    const t = page.current!.getBoundingClientRect();
    const prev = els[slot - 1]?.getBoundingClientRect(), next = els[slot]?.getBoundingClientRect();
    const edge = !prev && !next ? t.top + t.height / 2 : prev && next ? (prev.bottom + next.top) / 2 : prev ? prev.bottom + gap / 2 : next!.top - gap / 2;
    return { slot, line: edge - t.top };
  };

  const startMove = (e: React.PointerEvent, b: Doc) => {
    if (e.button !== 0) return;
    if (editing) { if (ops.isTextItem(b)) return; L.stopEdit(); }
    e.preventDefault();
    L.select(b.key);
    scroller.current?.focus({ preventScroll: true });
    const sx = e.clientX, sy = e.clientY, sc0 = scroller.current!.scrollTop;
    // 文本框左右拖是摆位置（第一下往哪边动就是哪种），上下拖是换顺序
    const el = e.currentTarget as HTMLElement, w = el.getBoundingClientRect().width / W;
    const x0 = (el.getBoundingClientRect().left - page.current!.getBoundingClientRect().left) / W;
    const image = b.type === 'image', wrapped = image && !!el.closest('[data-wrap]');
    const sideways = (ops.isTextItem(b) || image) && !el.parentElement?.closest('[data-vv]');
    // 环绕的图：左右拖是换边，按指针在那列文字的哪一半算
    const wrapBox = wrapped ? el.closest<HTMLElement>('[data-wrap]')!.getBoundingClientRect() : null;
    let moved = false, mode: 'x' | 'y' | null = null, last: Drag = { key: b.key }, raf = 0, py = e.clientY;
    /** 单图拖到一列横排文字的左右三成里：放进那列文字（环绕） */
    const intoAt = (cx: number, cy: number): Drag['into'] => {
      if (!image) return undefined;
      const t = page.current!.getBoundingClientRect();
      for (const x of page.current!.querySelectorAll<HTMLElement>('[data-flow]')) {
        if (x.dataset.key === b.key) continue;
        const r = x.getBoundingClientRect();
        if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) continue;
        const f = (cx - r.left) / r.width;
        if (f > 0.3 && f < 0.7) return undefined;
        return { key: x.dataset.key!, side: f <= 0.3 ? 'start' : 'end', rect: [r.left - t.left, r.top - t.top, r.width, r.height] };
      }
      return undefined;
    };
    const update = (cy: number, cx = sx, alt = false) => {
      const dy = cy - sy + (scroller.current!.scrollTop - sc0), dx = cx - sx;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      mode ??= sideways && Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (mode === 'x' && wrapBox) last = { key: b.key, side: cx < wrapBox.left + wrapBox.width / 2 ? 'start' : 'end' };
      else if (mode === 'x') {
        let x = clamp(x0 + dx / W, 0, Math.max(0, 1 - w)), guide: number | undefined;
        // 吸住：靠左、居中、靠右，和原来文字栏的左边（第 3 栏）
        if (!alt) for (const [at, line] of [[0, 0], [(1 - w) / 2, 0.5], [1 - w, 1], [1 / 6, 1 / 6]] as const) if (Math.abs(x - at) * W < 6) { x = at; guide = line; break; }
        last = { key: b.key, vx: r2(x), bw: r2(w), guide };
      } else {
        const into = intoAt(cx, cy);
        last = into ? { key: b.key, dy, into } : { key: b.key, dy, ...slotAt(cy, b.key) };
      }
      setDrag(last);
    };
    const edge = () => {
      const r = scroller.current!.getBoundingClientRect();
      const v = py < r.top + 60 ? -14 : py > r.bottom - 60 ? 14 : 0;
      if (v && moved) { scroller.current!.scrollTop += v; update(py, px0); }
      raf = requestAnimationFrame(edge);
    };
    let px0 = e.clientX;
    const move = (ev: PointerEvent) => { py = ev.clientY; px0 = ev.clientX; update(ev.clientY, ev.clientX, ev.altKey); };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); cancelAnimationFrame(raf);
      setDrag(null);
      if (!moved) return;
      if (last.side) { if (last.side !== b.vwrap) commit(ops.setPlace(doc, b.key, { wrap: last.side }, 'v')); }
      else if (last.into) {
        // 放进那列文字：挪到它前面，设上环绕（左右位置不再起作用）
        const slot = its.filter((x) => x.key !== b.key).findIndex((x) => x.key === last.into!.key);
        commit(ops.setPlace(ops.moveItem(doc, b.key, slot), b.key, { wrap: last.into.side, vx: undefined }, 'v'));
      } else if (last.vx !== undefined) commit(ops.setPlace(doc, b.key, { vx: last.vx, ...(b.vwriting === 'v' ? {} : { bw: last.bw }) }, 'v'));
      else if (last.slot !== undefined) {
        // 拖到两块之间：环绕的图变回单独一块
        const next = ops.moveItem(doc, b.key, last.slot);
        commit(b.vwrap ? ops.setPlace(next, b.key, { wrap: undefined }, 'v') : next);
      }
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
    raf = requestAnimationFrame(edge);
  };

  /** 文本框自由变换：右边改宽（页宽的比例），下边改高（屏高的倍数），角上一起改 */
  const startBox = (e: React.PointerEvent, b: Doc, which: 'w' | 'h' | 'wh') => {
    e.preventDefault(); e.stopPropagation();
    const el = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-seq]')!, r0 = el.getBoundingClientRect();
    const left = (r0.left - page.current!.getBoundingClientRect().left) / W;
    const sx = e.clientX, sy = e.clientY;
    let bw = b.vbw, bh = b.vbh;
    const move = (ev: PointerEvent) => {
      if (which !== 'h') bw = r2(clamp((r0.width + ev.clientX - sx) / W, 0.08, 1 - left));
      if (which !== 'w') bh = r2(clamp((r0.height + ev.clientY - sy) / VH, 0.05, 1));
      setDrag({ key: b.key, bw, bh });
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); setDrag(null);
      if (bw === b.vbw && bh === b.vbh) return;
      // 第一次拖大小：把现在的左边也记下来，框就留在原地
      commit(ops.setPlace(doc, b.key, { ...(which !== 'h' ? { bw } : {}), ...(which !== 'w' ? { bh } : {}), ...(b.vx === undefined ? { vx: r2(left) } : {}) }, 'v'));
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  /** 单图改大小：拖角上的圆点改宽（页宽的比例），高跟着原图比例走；靠近通栏、内缩、文字栏宽时吸住（按住 ⌥ 不吸）。
   *  图在右边环绕时圆点在左下角，往左拖变大 */
  const startSize = (e: React.PointerEvent, b: Doc, dir: 1 | -1) => {
    e.preventDefault(); e.stopPropagation();
    const el = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-seq]')!, r0 = el.getBoundingClientRect();
    const wrap = el.closest<HTMLElement>('[data-wrap]'), wrapped = !!wrap;
    const left = (r0.left - page.current!.getBoundingClientRect().left) / W;
    // 环绕的图最宽到那列文字的七成（和站点一样）
    const max = wrap ? (wrap.getBoundingClientRect().width * 0.7) / W : 1 - left;
    const sx = e.clientX;
    let bw = b.vbw;
    const move = (ev: PointerEvent) => {
      let w = clamp((r0.width + (ev.clientX - sx) * dir) / W, 0.1, max);
      if (!ev.altKey) for (const at of wrapped ? [WRAP_W] : [1, 0.67, 0.56]) if (Math.abs(w - at) * W < 6 && at <= max + 0.001) { w = at; break; }
      bw = r2(w);
      setDrag({ key: b.key, bw });
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); setDrag(null);
      if (bw === b.vbw) return;
      // 第一次改大小：把现在的左边也记下来，图就留在原地（往右长）
      commit(ops.setPlace(doc, b.key, { bw, ...(!wrapped && b.vx === undefined ? { vx: r2(left) } : {}) }, 'v'));
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  /* ── 键盘：↑↓ 换顺序，回车改字，⌘Z 撤销 ── */
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).isContentEditable || (e.target as HTMLElement).tagName === 'TEXTAREA') return; // 在改字：方向键、删除键是给文字的
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) L.hist.redo(); else L.hist.undo(); return; }
    if (!selected) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); commit(ops.nudgeItem(doc, selected.key, e.key === 'ArrowUp' ? -1 : 1)); }
    else if (e.key === 'Enter' && ops.isTextItem(selected)) { e.preventDefault(); L.startEdit(selected.key); }
    else if (e.key === 'Escape') L.select(null);
    else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); void L.remove(selected); }
  };
  useEffect(() => {
    if (!sel || editing) return;
    page.current?.querySelector(`[data-key="${CSS.escape(sel)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [sel, blocks, editing]);

  const block = (b0: Doc, i: number, w?: number, float?: 'start' | 'end') => {
    const d = drag?.key === b0.key ? drag : null;
    // 拖的过程中先用拖出来的位置、宽高画
    const b = d && (d.vx !== undefined || d.bw !== undefined || d.bh !== undefined) ? { ...b0, ...(d.vx !== undefined ? { vx: d.vx } : {}), ...(d.bw !== undefined ? { vbw: d.bw } : {}), ...(d.bh !== undefined ? { vbh: d.bh } : {}) } : b0;
    // 摆过的文本框：左边在页面的 vx 处（没设是第 3 栏），宽 vbw；竖排的宽跟着字，vbw 是最小宽度
    const boxed = ops.isTextItem(b) && w === undefined && (b.vx !== undefined || b.vbw !== undefined);
    // 排过的单图：宽 vbw，左边 vx（只设了宽的居中）；环绕的图默认三成页宽
    const placed = b.type === 'image' && !float && (b.vx !== undefined || b.vbw !== undefined);
    const vert = b.vwriting === 'v';
    const bw = float ? W * (b.vbw ?? WRAP_W) : boxed ? (vert ? 0 : W * (b.vbw ?? 0.5)) : w ?? W * (b.type === 'image' ? b.vbw ?? widthOf(b) : widthOf(b));
    const left = boxed ? W * (b.vx ?? 0.25) : placed ? W * (b.vx ?? (1 - (b.vbw ?? widthOf(b))) / 2) : undefined;
    return (
      <VBlock key={b.key} b={b} W={bw} left={left} float={float} seq={i} selected={sel === b.key} editing={editing} drag={d}
        onDown={(e) => startMove(e, b0)} onBox={(e, which) => startBox(e, b0, which)} onSize={(e, dir) => startSize(e, b0, dir)} onOpen={(e) => { if (ops.isTextItem(b)) L.startEdit(b.key, { x: e.clientX, y: e.clientY }); }}>
        <VFace b={b} W={W} VH={VH} fs={fs} places={places} here={b.type === 'map' ? hereOf(blocks, b.key, places) : undefined}
          active={sel === b.key && !drag && !editing} editing={editing} onPatch={(p) => commit(ops.patchBlock(doc, b.key, p))} />
      </VBlock>
    );
  };

  return (
    <div ref={area} className="absolute inset-0">
      <div ref={scroller} tabIndex={0} onKeyDown={onKey} onPointerDown={(e) => { if (e.target === e.currentTarget || e.target === page.current) { L.stopEdit(); L.select(null); } }}
        className="absolute inset-0 overflow-y-auto overflow-x-hidden rounded-2xl bg-muted/70 outline-none [scrollbar-width:thin]">
        <div ref={page} className="relative mx-auto flex w-(--w) flex-col items-center gap-(--gap) py-(--gap)" style={{ '--w': px(W), '--gap': px(gap) }}>
          {rows.map((r, ri) => {
            if ('item' in r) {
              // 环绕：图和后面那列横排文字包在一起，图浮在左上 / 右上，文字绕着排（拖的时候按拖着的那一边画）
              const next = rows[ri + 1];
              if (r.item.type === 'image' && r.item.vwrap && next && 'item' in next && next.item.type === 'text' && next.item.vwriting !== 'v') {
                const t = next.item, side = drag?.key === r.item.key && drag?.side ? drag.side : r.item.vwrap;
                const boxed = t.vx !== undefined || t.vbw !== undefined;
                return (
                  <div key={r.item.key} data-wrap className={cn('flow-root w-(--w)', boxed && 'ml-(--ml) self-start')} style={{ '--w': px(W * (boxed ? t.vbw ?? 0.5 : widthOf(t))), '--ml': boxed ? px(W * (t.vx ?? 0.25)) : undefined }}>
                    {block(r.item, r.at, undefined, side)}{block(t, next.at, W * (boxed ? t.vbw ?? 0.5 : widthOf(t)))}
                  </div>
                );
              }
              const prev = rows[ri - 1];
              if (r.item.type === 'text' && prev && 'item' in prev && prev.item.type === 'image' && prev.item.vwrap && r.item.vwriting !== 'v') return null;
              return block(r.item, r.at);
            }
            const { head, text } = r;
            // 两边都竖排：并排，标题在右，整组按文字的位置靠左 / 居中 / 靠右；否则标题摞在文字上面
            if (head.vwriting === 'v' && text.vwriting === 'v') {
              return (
                <div key={head.key} data-vv className={cn('flex w-(--w) flex-row-reverse', VPOS[text.vpos as keyof typeof VPOS] ?? 'justify-end')} style={{ '--w': px(W * 0.67) }}>
                  <div className="flex flex-row-reverse">{block(head, r.at, 0)}{block(text, r.at + 1, 0)}</div>
                </div>
              );
            }
            return <div key={head.key} className="flex w-full flex-col items-center gap-(--g)" style={{ '--g': px(fs * 0.8) }}>{block(head, r.at)}{block(text, r.at + 1)}</div>;
          })}
          {!its.length && <p className="py-24 text-muted-foreground">还没有内容。</p>}
          {drag?.guide !== undefined && <i className="pointer-events-none absolute top-0 bottom-0 left-(--l) w-px bg-brand/60" style={{ '--l': px(drag.guide * W) }} />}
          {drag?.line !== undefined && <i className="pointer-events-none absolute left-0 right-0 top-(--l) h-0.5 rounded-full bg-primary" style={{ '--l': px(drag.line - 1) }} />}
          {drag?.into && <IntoMark {...drag.into} w={Math.min(W * WRAP_W, drag.into.rect[2] * 0.5)} />}
        </div>
      </div>
    </div>
  );
}

/** 一块占页宽的几成：照主题竖向读法的栏位（文字第 3–9 栏，内缩图 3–11，双图 2–12，其余通栏） */
function widthOf(b: Doc): number {
  switch (b.type) {
    case 'text': case 'head': return b.vwriting === 'v' ? 0.67 : 0.56;
    case 'image': case 'video': return b.layout === 'inline' ? 0.67 : 1;
    case 'pair': return 0.83;
    case 'map': return 0.83;
    default: return 1;
  }
}

/** W 为 0：宽度跟着内容（并排的竖排标题和文字） */
function VBlock({ b, W, left, float, seq, selected, editing, drag, onDown, onBox, onSize, onOpen, children }: {
  b: Doc; W: number; left?: number; float?: 'start' | 'end'; seq: number; selected: boolean; editing: boolean; drag: Drag | null; onDown: (e: React.PointerEvent) => void; onBox: (e: React.PointerEvent, which: 'w' | 'h' | 'wh') => void; onSize: (e: React.PointerEvent, dir: 1 | -1) => void; onOpen: (e: React.MouseEvent) => void; children: ReactNode;
}) {
  const lifting = drag?.dy !== undefined;
  const typing = editing && ops.isTextItem(b);
  return (
    <div data-seq={seq} data-key={b.key} data-flow={b.type === 'text' && b.vwriting !== 'v' ? '' : undefined} onPointerDown={onDown} onDoubleClick={onOpen}
      className={cn('relative flex-none rounded-3 outline-offset-6 [transform:translateY(var(--dy))]', W ? 'w-(--w)' : 'w-auto', left !== undefined && 'ml-(--ml) self-start',
        float && ['mt-[.4em] mb-[.8em] max-w-[70%]', float === 'end' ? 'float-right ml-[1.6em]' : 'float-left mr-[1.6em]'], typing ? 'cursor-text' : ['touch-none select-none', drag ? 'cursor-grabbing' : 'cursor-grab'], drag ? 'transition-none' : '[transition:transform_.25s_var(--ease-out)]',
        selected ? (typing ? 'outline outline-1 outline-foreground/45' : 'outline outline-2 outline-foreground') : 'hover:outline hover:outline-1 hover:outline-foreground/25', lifting && 'z-10 opacity-90 shadow-pop')}
      style={{ '--w': W ? px(W) : undefined, '--dy': px(drag?.dy ?? 0), '--ml': left !== undefined ? px(left) : undefined }}>
      {children}
      {selected && !editing && ops.isTextItem(b) && <BoxHandles rtl={false} onBox={onBox} />}
      {selected && !editing && b.type === 'image' && (
        <span onPointerDown={(e) => onSize(e, float === 'end' ? -1 : 1)} aria-label="拖动改大小" className={cn('absolute -bottom-2.75 z-20 grid h-5.5 w-5.5 place-items-center rounded-full bg-popover shadow-pop', float === 'end' ? '-left-2.75 cursor-nesw-resize' : '-right-2.75 cursor-nwse-resize')}>
          <i className="h-2 w-2 rounded-full bg-primary" />
        </span>
      )}
      {drag?.bw !== undefined && b.type === 'image' && <span className="mono pointer-events-none absolute -top-7 right-0 rounded-full bg-primary px-2 py-0.5 text-11 text-primary-foreground">{Math.round(drag.bw * 100)}%</span>}
    </div>
  );
}

function VFace({ b, W, VH, fs, places, here, active, editing, onPatch }: { b: Doc; W: number; VH: number; fs: number; places: PlaceInfo[]; here?: number; active: boolean; editing: boolean; onPatch: (p: Doc) => void }) {
  const cap = (text?: string) => <Cap text={text} size={fs * 0.78} />;
  switch (b.type) {
    case 'text': case 'head': {
      const v = b.vwriting === 'v';
      // 拖出来的高（vbh）：竖排是列高，横排是最小高度；竖排拖出来的宽是最小宽度
      const bh = b.vbh !== undefined ? b.vbh * VH : undefined;
      const face = <TextFace b={b} v={v} fs={fs * (b.vfs ?? 1)} lh={b.vlh} align={b.valign} editing={editing} size={v ? bh ?? fs * 21 : undefined} minH={v ? undefined : bh} minW={v && b.vbw !== undefined ? b.vbw * W : undefined} />;
      return v && b.type === 'text' ? <div className={cn('flex', VPOS[b.vpos as keyof typeof VPOS] ?? 'justify-end')}>{face}</div> : face;
    }
    case 'image':
      return <figure><Img src={b.src} className="h-auto w-full" />{cap(b.caption)}</figure>;
    case 'video':
      return <figure><span className="relative block"><Img src={posterOf(b)} className="h-auto w-full" /><PlayMark /></span>{cap(b.caption)}</figure>;
    case 'pair':
      return <figure><div className="grid grid-cols-2 gap-(--g)" style={{ '--g': px(W * 0.012) }}>{b.images.map((im: Doc, i: number) => <figure key={i}><Img src={im.src} className="aspect-[4/3] w-full" />{cap(im.caption)}</figure>)}</div></figure>;
    case 'grid': {
      const n = b.images.length;
      return (
        <figure>
          <div className="grid grid-cols-3 gap-(--g)" style={{ '--g': px(W * 0.009) }}>
            {b.images.map((im: Doc, i: number) => <figure key={i} className={cn('flex min-w-0 flex-col', i === 0 && 'col-span-2 row-span-2')}><Img src={im.src} className={cn('min-h-0 w-full flex-1 aspect-[4/3]', i === n - 1 && n > 1 && i !== 0 && 'aspect-auto')} />{cap(im.caption)}</figure>)}
          </div>
        </figure>
      );
    }
    case 'strip':
      return <div className="overflow-x-auto overflow-y-hidden [scrollbar-width:none]"><StripFace b={b} H={W * 0.32} fs={fs} rtl={false} active={active} onPatch={onPatch} /></div>;
    case 'free':
      return <FreeFace b={b} h={W / (b.ar ?? 1.6)} fs={fs} active={active} onPatch={onPatch} />;
    case 'map':
      return <MiniMap places={places} here={b.scope === 'near' ? here : undefined} w={W * 0.83} h={W * 0.45} fs={fs} />;
    case 'interlude':
      return <InterludeFace b={b} w={W} h={VH} active={active} onPatch={onPatch} />;
  }
  return <div className="text-muted-foreground">不认识的块</div>;
}

/** 拖着单图进到一列文字的左右三成里：在那一边画出图要放的位置 */
function IntoMark({ side, rect: [x, y, w, h], w: iw }: { side: 'start' | 'end'; rect: [number, number, number, number]; w: number }) {
  return (
    <>
      <i className="pointer-events-none absolute top-(--t) left-(--l) h-(--h) w-(--w) rounded-3 outline outline-1 outline-primary/50" style={{ '--t': px(y), '--l': px(x), '--h': px(h), '--w': px(w) }} />
      <i className="pointer-events-none absolute top-(--t) left-(--l) h-(--h) w-(--w) rounded-3 bg-primary/15 outline outline-2 outline-primary" style={{ '--t': px(y), '--l': px(side === 'start' ? x : x + w - iw), '--h': px(Math.min(h, iw * 0.75)), '--w': px(iw) }} />
    </>
  );
}
