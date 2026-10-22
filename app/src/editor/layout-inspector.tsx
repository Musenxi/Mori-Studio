/**
 * 排版视图右边的属性面板（InDesign 的“属性”面板）：选中什么就显示什么的设置，改了马上在版面上看到。
 *   没选中：整篇的结构，点一项选中它
 *   文字、标题：写法、对齐、位置；改字时多出段落样式和粗体斜体
 *   图片：版式、每张图的图注和替代文字、合并拆分；竖滚里单图的环绕、左边、宽
 *   幕间：画布比例，上面每样东西（文字、图片）的内容和角度
 */
import type { ReactNode } from 'react';
import { Bold, ImagePlus, Italic, Merge, Plus, RotateCcw, Split, Trash2, Type, X } from 'lucide-react';
import { assetUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { Doc } from '@/lib/types';
import * as ops from '@/lib/layout-ops.js';
import * as t from '@/lib/text-ops.js';
import { assetOf, baseName } from '@/lib/folder';
import { NumInput } from '@/components/field';
import { Segmented } from '@/components/segmented';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLayout } from './layout-ctx';
import { InlineField } from './inline-field';
import { formatSel, readSel } from './layout-text';
import { GAP_MAX, GAP_MIN, NAMES, ToolBtn, blockPlain, bleedable, r2, scalable, yOf } from './layout-view';

export function Inspector() {
  const L = useLayout();
  return (
    <aside className="w-68 shrink-0 overflow-y-auto rounded-2xl bg-muted/70 px-4 py-3.5 on-card">
      {L.selected ? <BlockPanel key={L.selected.key} b={L.selected} /> : <Outline />}
    </aside>
  );
}

/** 一行设置：左边名字，右边控件；stack 时控件另起一行占满宽 */
const Prop = ({ label, children, stack }: { label: string; children: ReactNode; stack?: boolean }) => (
  <div className={cn('flex py-0.5', stack ? 'flex-col gap-1.5 pt-1.5' : 'min-h-9 items-center gap-3')}>
    <span className="w-9 shrink-0 text-12 text-muted-foreground">{label}</span>
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
  </div>
);
const Section = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn('border-t border-border pt-2.5 mt-2.5 first:mt-0 first:border-t-0 first:pt-0', className)}>{children}</div>;

/** 一个项的简短名字：标题的字、文字的头几个字、图注 */
function labelOf(b: Doc) {
  if (ops.isTextItem(b)) return (b.blocks ?? []).map(blockPlain).join(' ').trim().slice(0, 40);
  if (b.type === 'map') return '';
  if (b.type === 'interlude') return (b.items ?? []).filter((it: Doc) => it.kind === 'text').map((it: Doc) => blockPlain({ type: 'p', text: it.text })).join(' ').slice(0, 40);
  const ims = ops.imagesOf(b);
  return ims.map((i: Doc) => i.caption).filter(Boolean).join(' / ') || (ims.length > 1 ? `${ims.length} 张` : baseName(assetOf(ims[0]?.src)));
}

function Outline() {
  const { its, select } = useLayout();
  return (
    <>
      <h3 className="mb-2 flex items-baseline justify-between text-13 font-semibold">结构<span className="text-12 font-normal text-muted-foreground">{its.length} 块</span></h3>
      {!its.length && <p className="text-12-5 text-muted-foreground">还没有内容。</p>}
      <ol className="-mx-2">
        {its.map((b) => (
          <li key={b.key}>
            <button type="button" onClick={() => select(b.key)} className={cn('flex w-full items-baseline gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-foreground/[.06]', b.type === 'head' && 'mt-1.5')}>
              <span className="w-12 shrink-0 text-11-5 text-muted-foreground">{NAMES[b.type]}</span>
              <span className={cn('min-w-0 flex-1 truncate text-12-5', b.type === 'head' ? 'font-medium' : 'text-soft-foreground')}>{labelOf(b) || '—'}</span>
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

function BlockPanel({ b }: { b: Doc }) {
  const L = useLayout();
  const { doc, axis, commit } = L;
  const text = ops.isTextItem(b);
  const raw = doc.blocks?.find((x: Doc) => x.id === b.key) ?? b;
  const patch = (p: Doc) => commit(ops.patchBlock(doc, b.key, p));
  /** 打字式的改动（图注、替代文字）：连续的合成一步撤销 */
  const typePatch = (p: Doc) => L.edit.type(ops.patchBlock(L.edit.doc(), b.key, p));
  const place = (p: Doc) => commit(ops.setPlace(doc, b.key, p, axis));
  return (
    <>
      <div className="mb-2.5 flex min-h-8 items-center gap-2">
        <b className="text-13 font-semibold">{NAMES[b.type] ?? b.type}</b>
        {text && L.editing && <span className="text-12 text-muted-foreground">改字中</span>}
        <span className="ml-auto flex items-center">
          {text && (L.editing
            ? <Button size="sm" variant="ghost" onClick={L.stopEdit}>完成</Button>
            : <Button size="sm" variant="ghost" onClick={() => L.startEdit(b.key)}><Type size={14} />改字</Button>)}
          <ToolBtn label="删除" onClick={() => void L.remove(b)}><Trash2 size={14} /></ToolBtn>
        </span>
      </div>

      {text && L.editing && <TypeTools />}
      {text && <TextProps b={b} place={place} />}
      {b.type === 'map' && (
        <Section><Prop label="范围"><Segmented size="sm" value={b.scope ?? 'region'} onValueChange={(v) => patch({ scope: v })} options={[{ value: 'region', label: '所在区域' }, { value: 'route', label: '全程' }, { value: 'near', label: '这一处' }]} /></Prop></Section>
      )}
      {axis === 'v' && b.type === 'image' && <VImageProps b={b} place={place} />}
      {ops.isImageBlock(b) && <ImageProps b={raw} patch={patch} typePatch={typePatch} />}
      {b.type === 'interlude' && <InterludeProps b={raw} patch={patch} typePatch={typePatch} />}
      {axis === 'h' && b.type !== 'interlude' && <PlaceProps b={b} raw={raw} place={place} />}
    </>
  );
}

/* ───────────── 文字 ───────────── */

const STYLE_LABEL: Record<string, string> = { p: '正文', h2: '标题', h3: '小标题', quote: '引用' };

/** 改字时：光标所在那段的段落样式，选中的字的粗体斜体（按钮不抢走光标） */
function TypeTools() {
  const L = useLayout();
  const unit = L.cursor;
  const blk = unit ? L.doc.blocks?.find((x: Doc) => x.id === unit.split('/')[0]) : null;
  const style = t.styleOf(blk);
  const s = readSel();
  const spans = s && s.a.unit === s.b.unit ? t.getUnit(L.doc, s.a.unit) : null;
  const [a, z] = s ? [Math.min(s.a.off, s.b.off), Math.max(s.a.off, s.b.off)] : [0, 0];
  const on = (type: string) => !!spans && typeof spans !== 'string' && z > a && t.hasMark(spans, a, z, type);
  const setStyle = (v: string) => { const c = readSel(); if (blk) L.edit.apply(t.setStyle(L.doc, blk.id, v), c ? { ...c.a, focus: c.b } : null); };
  const mark = (type: string) => { const r = formatSel(L.doc, type); if (r) L.edit.apply(r.doc, r.caret); };
  return (
    // 按下时不让按钮拿走焦点：光标和选区留在文字里
    <Section className="pb-1">
      <div onMouseDownCapture={(e) => e.preventDefault()}>
        {blk && t.STYLES.includes(style) && (
          <Prop label="段落" stack><Segmented size="sm" value={style} onValueChange={setStyle} options={t.STYLES.map((v: string) => ({ value: v, label: STYLE_LABEL[v] }))} /></Prop>
        )}
        <Prop label="字">
          <ToolBtn label="粗体　⌘B" active={on('strong')} onClick={() => mark('strong')}><Bold size={14} /></ToolBtn>
          <ToolBtn label="斜体　⌘I" active={on('em')} onClick={() => mark('em')}><Italic size={14} /></ToolBtn>
        </Prop>
      </div>
    </Section>
  );
}

function TextProps({ b, place }: { b: Doc; place: (p: Doc) => void }) {
  const { axis } = useLayout();
  const writing = (axis === 'v' ? b.vwriting : b.writing) === 'v' ? 'v' : 'h';
  const vw = writing === 'v';
  const align = (axis === 'v' ? b.valign : b.align) ?? 'justify';
  const labels = vw ? ['上', '中', '下', '两端'] : ['左', '中', '右', '两端'];
  return (
    <Section>
      <Prop label="写法"><Segmented size="sm" value={writing} onValueChange={(v) => place({ writing: v })} options={[{ value: 'h', label: '横排' }, { value: 'v', label: '竖排' }]} /></Prop>
      <Prop label="对齐"><Segmented size="sm" value={align} onValueChange={(v) => place({ align: v })} options={labels.map((label, i) => ({ value: ['start', 'center', 'end', 'justify'][i], label }))} /></Prop>
      {/* 文本框：横滚里宽高是屏高的百分比；竖滚里左边位置和宽是页宽的百分比，高是屏高的百分比。空着是自动 */}
      {axis === 'v' && <BoxNum label="左边" value={b.vx} max={100} onChange={(v) => place({ vx: v })} />}
      <BoxNum label="宽" value={axis === 'v' ? b.vbw : b.bw} max={axis === 'v' ? 100 : 1000} onChange={(v) => place({ bw: v })} />
      <BoxNum label="高" value={axis === 'v' ? b.vbh : b.bh} max={100} onChange={(v) => place({ bh: v })} />
      <Prop label="字号">
        <NumInput className="h-8 w-24" min={50} max={400} step={10} value={Math.round(((axis === 'v' ? b.vfs : b.fs) ?? 1) * 100)} onChange={(v) => place({ fs: v === undefined || v === 100 ? undefined : r2(Math.min(400, Math.max(50, v)) / 100) })} />
        <span className="text-12 text-muted-foreground">%</span>
      </Prop>
      <Prop label="行距">
        <NumInput className="h-8 w-24" min={1} max={4} step={0.1} value={axis === 'v' ? b.vlh : b.lh} placeholder={vw ? '2.05' : '1.9'} onChange={(v) => place({ lh: v === undefined ? undefined : Math.round(Math.min(4, Math.max(1, v)) * 100) / 100 })} />
      </Prop>
      {axis === 'v' && vw && b.type === 'text' && (
        <Prop label="位置"><Segmented size="sm" value={b.vpos ?? 'end'} onValueChange={(v) => place({ pos: v })} options={[{ value: 'start', label: '靠左' }, { value: 'center', label: '居中' }, { value: 'end', label: '靠右' }]} /></Prop>
      )}
    </Section>
  );
}

/** 文本框的一个尺寸（百分比，空着是自动） */
function BoxNum({ label, value, max, onChange }: { label: string; value?: number; max: number; onChange: (v: number | undefined) => void }) {
  return (
    <Prop label={label}>
      <NumInput className="h-8 w-24" min={0} max={max} step={5} value={value === undefined ? undefined : Math.round(value * 100)} placeholder="自动"
        onChange={(v) => onChange(v === undefined || v <= 0 ? undefined : r2(Math.min(max, v) / 100))} />
      <span className="text-12 text-muted-foreground">%</span>
    </Prop>
  );
}

/* ───────────── 竖滚里单图的摆法 ───────────── */

function VImageProps({ b, place }: { b: Doc; place: (p: Doc) => void }) {
  return (
    <Section>
      <Prop label="环绕"><Segmented size="sm" value={b.vwrap ?? 'none'} onValueChange={(v) => place({ wrap: v === 'none' ? undefined : v, ...(v === 'none' ? {} : { vx: undefined }) })} options={[{ value: 'none', label: '无' }, { value: 'start', label: '图在左' }, { value: 'end', label: '图在右' }]} /></Prop>
      {!b.vwrap && <BoxNum label="左边" value={b.vx} max={100} onChange={(v) => place({ vx: v })} />}
      <BoxNum label="宽" value={b.vbw} max={100} onChange={(v) => place({ bw: v })} />
    </Section>
  );
}

/* ───────────── 横滚里的上下位置和大小 ───────────── */

function PlaceProps({ b, raw, place }: { b: Doc; raw: Doc; place: (p: Doc) => void }) {
  const { its } = useLayout();
  const follow = b.type === 'head' && b.lead && b.y === undefined;
  const bleed = !!b.bleed && bleedable(b);
  // 挨着标题的那列文字：间距跟着整组，在标题上改
  const at = its.findIndex((x) => x.key === b.key);
  const grouped = b.type === 'text' && its[at - 1]?.type === 'head' && !!its[at - 1]?.lead;
  // 标题没设的位置、大小是跟着正文的，不算它自己的
  const float = b.x !== undefined;
  const own = b.type === 'head' ? raw.h?.y !== undefined || raw.h?.scale !== undefined || raw.h?.gap !== undefined || float : b.y !== undefined || b.scale !== undefined || b.gap !== undefined || bleed || float;
  const pct = (v?: number) => (v === undefined ? undefined : Math.round(v * 100));
  return (
    <Section>
      <Prop label="排法"><Segmented size="sm" value={float ? 'float' : 'flow'} onValueChange={(v) => place({ x: v === 'float' ? 0 : undefined })} options={[{ value: 'flow', label: '随文' }, { value: 'float', label: '浮动' }]} /></Prop>
      {float && (
        <Prop label="左右">
          <NumInput className="h-8 w-24" min={-2000} max={2000} step={5} value={Math.round(b.x * 100)} onChange={(v) => place({ x: v === undefined ? 0 : r2(Math.min(2000, Math.max(-2000, v)) / 100) })} />
          <span className="text-12 text-muted-foreground">%</span>
        </Prop>
      )}
      {bleedable(b) && (
        <Prop label="范围"><Segmented size="sm" value={bleed ? 'bleed' : 'band'} onValueChange={(v) => place({ bleed: v === 'bleed' || undefined })} options={[{ value: 'band', label: '版心' }, { value: 'bleed', label: '满屏' }]} /></Prop>
      )}
      {!bleed && (
        <Prop label="上下">
          <NumInput className="h-8 w-24" min={0} max={100} value={follow ? undefined : pct(b.y ?? yOf(b))} placeholder={follow ? '跟着正文' : undefined}
            onChange={(v) => place({ y: v === undefined ? undefined : r2(Math.min(100, Math.max(0, v)) / 100) })} />
          <span className="text-12 text-muted-foreground">%</span>
        </Prop>
      )}
      {scalable(b) && !bleed && (
        <Prop label={b.type === 'text' && b.writing !== 'v' ? '宽度' : '大小'}>
          <NumInput className="h-8 w-24" min={30} max={b.type === 'text' && b.writing !== 'v' ? 240 : 160} value={pct(b.scale ?? 1)} onChange={(v) => place({ scale: v === undefined || v === 100 ? undefined : r2(Math.min(b.type === 'text' && b.writing !== 'v' ? 240 : 160, Math.max(30, v)) / 100) })} />
          <span className="text-12 text-muted-foreground">%</span>
        </Prop>
      )}
      {!grouped && !float && (
        <Prop label="间距">
          <NumInput className="h-8 w-24" min={GAP_MIN * 100} max={GAP_MAX * 100} step={25} value={pct(b.gap ?? 1)} onChange={(v) => place({ gap: v === undefined || v === 100 ? undefined : r2(Math.min(GAP_MAX * 100, Math.max(GAP_MIN * 100, v)) / 100) })} />
          <span className="text-12 text-muted-foreground">%</span>
        </Prop>
      )}
      {own && (
        <Prop label="">
          <Button size="sm" variant="ghost" className="-ml-3" onClick={() => place({ y: undefined, scale: undefined, gap: undefined, bleed: undefined, x: undefined })}><RotateCcw size={13} />{b.type === 'head' && b.lead ? '回到正文旁' : '复位'}</Button>
        </Prop>
      )}
    </Section>
  );
}

/* ───────────── 幕间 ───────────── */

/** 去掉值是 undefined 的字段 */
const clean = (o: Doc) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const ITEM_NAMES: Record<string, string> = { text: '文字', image: '图片' };

/** 幕间：画布的宽高比；上面每样东西一块（文字、图片），各自能转角度、能去掉；新加的摆在画布左上一带，错开一点 */
function InterludeProps({ b, patch, typePatch }: { b: Doc; patch: (p: Doc) => void; typePatch: (p: Doc) => void }) {
  const L = useLayout();
  const items: Doc[] = b.items ?? [];
  const at = (i: number, p: Doc) => items.map((x, k) => (k === i ? clean({ ...x, ...p }) : x));
  const n = items.length, spot = { x: r2(0.08 + (n % 4) * 0.18), y: r2(0.1 + (n % 3) * 0.24) };
  const add = (it: Doc) => patch({ items: [...items, { ...spot, ...it }] });
  return (
    <>
      <Section><Prop label="比例"><NumInput className="h-8 w-24" min={0.5} step={0.1} value={b.ar ?? 1.6} onChange={(v) => v && v >= 0.5 && patch({ ar: v })} /></Prop></Section>
      <Section className="space-y-2">
        {items.map((it, i) => (
          <div key={`${i}/${n}`} className="space-y-1.5 rounded-lg bg-foreground/[.04] p-2">
            <div className="flex items-center gap-1.5">
              <span className="text-12 text-muted-foreground">{ITEM_NAMES[it.kind]}</span>
              <span className="ml-auto text-12 text-muted-foreground">旋转</span>
              <NumInput className="h-7 w-16" step={1} value={it.rot ?? 0} onChange={(v) => patch({ items: at(i, { rot: v ? Math.max(-180, Math.min(180, v)) : undefined }) })} />
              <button type="button" aria-label="移除" onClick={() => patch({ items: items.filter((_, k) => k !== i) })} className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-foreground/[.06] hover:text-destructive"><X size={13} /></button>
            </div>
            {it.kind === 'text' && (
              <>
                <InlineField rows={2} value={it.text} placeholder="文字" onChange={(v) => typePatch({ items: at(i, { text: v }) })} />
                <div className="flex items-center gap-1.5">
                  <Segmented size="sm" value={it.writing === 'v' ? 'v' : 'h'} onValueChange={(v) => patch({ items: at(i, { writing: v, ...(v === 'v' ? { w: undefined } : {}) }) })} options={[{ value: 'h', label: '横排' }, { value: 'v', label: '竖排' }]} />
                  <span className="ml-auto text-12 text-muted-foreground">字号</span>
                  <NumInput className="h-7 w-16" min={50} max={600} step={10} value={Math.round((it.size ?? 1) * 100)} onChange={(v) => patch({ items: at(i, { size: v === undefined || v === 100 ? undefined : r2(Math.min(600, Math.max(50, v)) / 100) }) })} />
                </div>
              </>
            )}
            {it.kind === 'image' && (
              <div className="flex gap-2.5">
                <Thumb src={it.src} onClick={() => L.pickImage((src) => patch({ items: at(i, { src }) }))} />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Input className="h-8" placeholder="图注" value={it.caption ?? ''} onChange={(e) => typePatch({ items: at(i, { caption: e.target.value || undefined }) })} />
                  <Input className="h-8" placeholder="替代文字" value={it.alt ?? ''} onChange={(e) => typePatch({ items: at(i, { alt: e.target.value }) })} />
                </div>
              </div>
            )}
          </div>
        ))}
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" className="-ml-3" onClick={() => add({ kind: 'text', text: '', w: 0.3, writing: 'h' })}><Plus size={13} />文字</Button>
          <Button size="sm" variant="ghost" onClick={() => L.pickImage((src) => add({ kind: 'image', src, alt: '', w: 0.24 }))}><Plus size={13} />图片</Button>
        </div>
      </Section>
    </>
  );
}

/* ───────────── 图片 ───────────── */

function Thumb({ src, onClick }: { src?: string; onClick: () => void }) {
  const path = assetOf(src);
  return (
    <button type="button" onClick={onClick} aria-label="更换" className="grid h-14 w-16 shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-muted-foreground transition-[box-shadow] hover:ring-2 hover:ring-foreground/25">
      {path ? <img src={assetUrl(path, 160)} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={16} />}
    </button>
  );
}

function ImageProps({ b, patch, typePatch }: { b: Doc; patch: (p: Doc) => void; typePatch: (p: Doc) => void }) {
  const L = useLayout();
  const { doc, commit } = L;
  const layouts = ops.layoutsFor(b);
  // 每张图：单图就是块本身，图组 / 双图 / 网格是 images，自由排布是 items 里的图
  const list: Doc[] = b.type === 'image' ? [b] : b.type === 'free' ? (b.items ?? []).filter((it: Doc) => it.kind === 'image') : b.images ?? [];
  const put = (i: number, p: Doc, typed = false) => {
    const fn = typed ? typePatch : patch;
    if (b.type === 'image') return fn(p);
    if (b.type === 'free') { let k = -1; return fn({ items: b.items.map((it: Doc) => (it.kind === 'image' && ++k === i ? { ...it, ...p } : it)) }); }
    fn({ images: b.images.map((x: Doc, k: number) => (k === i ? { ...x, ...p } : x)) });
  };
  const drop = (i: number) => {
    if (b.type === 'free') { let k = -1; return patch({ items: b.items.filter((it: Doc) => !(it.kind === 'image' && ++k === i)) }); }
    patch({ images: b.images.filter((_: Doc, k: number) => k !== i) });
  };
  const add = () => L.pickImage((src) => {
    if (b.type === 'free') patch({ items: [...b.items, { kind: 'image', src, alt: '', x: 0.1, y: 0.1, w: 0.4, z: b.items.length + 1 }] });
    else patch({ images: [...b.images, { src, alt: '', ...(b.type === 'strip' ? { scale: 1, offset: 0 } : {}) }] });
  });
  const removable = (b.type === 'grid' || b.type === 'strip' || b.type === 'free') && list.length > 2;
  return (
    <>
      <Section>
        {b.type === 'image' && <Prop label="版式"><Segmented size="sm" value={b.layout === 'inline' ? 'inline' : 'wide'} onValueChange={(v) => patch({ layout: v })} options={[{ value: 'wide', label: '通栏' }, { value: 'inline', label: '内缩' }]} /></Prop>}
        {layouts.length > 0 && <Prop label="版式" stack={layouts.length > 3}><Segmented size="sm" value={b.type} onValueChange={(v) => commit(ops.setLayout(doc, b.id, v))} options={layouts.map((v: string) => ({ value: v, label: NAMES[v] }))} /></Prop>}
        {b.type === 'free' && <Prop label="比例"><NumInput className="h-8 w-24" min={0.2} step={0.1} value={b.ar} onChange={(v) => v && v >= 0.2 && patch({ ar: v })} /></Prop>}
      </Section>
      <Section className="space-y-2.5">
        {list.map((im, i) => (
          <div key={i} className="flex gap-2.5">
            <Thumb src={im.src} onClick={() => L.pickImage((src) => put(i, { src }))} />
            <div className="min-w-0 flex-1 space-y-1.5">
              {b.type !== 'free' && <Input className="h-8" placeholder="图注" value={im.caption ?? ''} onChange={(e) => put(i, { caption: e.target.value || undefined }, true)} />}
              <Input className="h-8" placeholder="替代文字" value={im.alt ?? ''} onChange={(e) => put(i, { alt: e.target.value }, true)} />
            </div>
            {removable && <button type="button" aria-label="移除这张" onClick={() => drop(i)} className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-foreground/[.06] hover:text-destructive"><X size={13} /></button>}
          </div>
        ))}
        {b.type === 'free' && (b.items ?? []).map((it: Doc, i: number) => it.kind === 'text' && (
          <div key={`t${i}`} className="flex gap-2.5">
            <div className="min-w-0 flex-1 space-y-1.5">
              <InlineField className="min-w-0" rows={2} value={it.text} placeholder="文本框" onChange={(v) => typePatch({ items: b.items.map((x: Doc, k: number) => (k === i ? { ...x, text: v } : x)) })} />
              <Segmented size="sm" value={it.writing === 'h' ? 'h' : 'v'} onValueChange={(v) => patch({ items: b.items.map((x: Doc, k: number) => (k === i ? { ...x, writing: v, ...(v === 'h' && !x.w ? { w: 0.3 } : {}) } : x)) })} options={[{ value: 'h', label: '横排' }, { value: 'v', label: '竖排' }]} />
            </div>
            <button type="button" aria-label="移除" onClick={() => patch({ items: b.items.filter((_: Doc, k: number) => k !== i) })} className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-foreground/[.06] hover:text-destructive"><X size={13} /></button>
          </div>
        ))}
        {b.type !== 'image' && b.type !== 'pair' && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="-ml-3" onClick={add}><Plus size={13} />图片</Button>
            {b.type === 'free' && <Button size="sm" variant="ghost" onClick={() => patch({ items: [...b.items, { kind: 'text', text: '', x: 0.1, y: 0.1, writing: 'h', w: 0.3 }] })}><Plus size={13} />文本框</Button>}
          </div>
        )}
      </Section>
      {(ops.canMergeNext(doc, b.id) || b.type !== 'image') && (
        <Section className="flex flex-wrap gap-1">
          {ops.canMergeNext(doc, b.id) && <Button size="sm" variant="ghost" className="-ml-3" onClick={() => commit(ops.mergeWithNext(doc, b.id))}><Merge size={14} />和后一块合并</Button>}
          {b.type !== 'image' && <Button size="sm" variant="ghost" className={cn(!ops.canMergeNext(doc, b.id) && '-ml-3')} onClick={() => commit(ops.split(doc, b.id))}><Split size={14} />拆成单图</Button>}
        </Section>
      )}
    </>
  );
}
