import { useState } from 'react';
import { asSpans, compact, spansToText, textToSpans } from '@/lib/inline.js';
import { ImageField } from '@/components/asset-picker';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { OptionSelect } from '@/components/option-select';
import { SwitchField } from '@/components/switch-field';
import type { Doc } from '@/lib/types';
import { InlineField } from './inline-field';

export const POST_BLOCKS: Array<{ type: string; label: string; prefix: string; make: () => Doc }> = [
  { type: 'p', label: '段落', prefix: 'b', make: () => ({ type: 'p', text: '' }) },
  { type: 'h', label: '标题', prefix: 'b', make: () => ({ type: 'h', level: 2, text: '' }) },
  { type: 'quote', label: '引用', prefix: 'b', make: () => ({ type: 'quote', text: '', writing: 'h' }) },
  { type: 'image', label: '图片', prefix: 'b', make: () => ({ type: 'image', alt: '', layout: 'inline' }) },
  { type: 'list', label: '列表', prefix: 'b', make: () => ({ type: 'list', items: [''] }) },
  { type: 'code', label: '代码', prefix: 'b', make: () => ({ type: 'code', code: '' }) },
  { type: 'callout', label: '提示框', prefix: 'b', make: () => ({ type: 'callout', kind: 'note', text: [''] }) },
  { type: 'math', label: '公式', prefix: 'b', make: () => ({ type: 'math', tex: '' }) },
  { type: 'embed', label: '网站卡片', prefix: 'b', make: () => ({ type: 'embed', url: '' }) },
];

const CALLOUT_KINDS = [
  { value: 'note', label: '说明' }, { value: 'tip', label: '提示' }, { value: 'important', label: '重要' },
  { value: 'warning', label: '注意' }, { value: 'caution', label: '警告' },
];

const cap = (b: Doc) => b.text; // 让 lint 别抱怨

/** 页面里一个块的编辑内容 */
export function PostBlockBody({ b, patch }: { b: Doc; patch: (p: Doc) => void }) {
  switch (b.type) {
    case 'p':
      return <InlineField rows={3} value={cap(b)} onChange={(v) => patch({ text: v })} placeholder="正文" />;
    case 'h':
      return (
        <div className="flex items-start gap-2">
          <OptionSelect className="w-24" value={String(b.level ?? 2)} onValueChange={(v) => patch({ level: +v })} options={[{ value: '2', label: '二级' }, { value: '3', label: '三级' }]} />
          <div className="flex-1"><InlineField rows={1} value={b.text} onChange={(v) => patch({ text: v })} placeholder="标题" /></div>
        </div>
      );
    case 'quote':
      return (
        <div className="space-y-2">
          <InlineField rows={2} value={b.text} onChange={(v) => patch({ text: v })} placeholder="引文" />
          <div className="grid grid-cols-[1fr_8rem] gap-2">
            <Input value={b.cite ?? ''} onChange={(e) => patch({ cite: e.target.value || undefined })} placeholder="出处" />
            <OptionSelect value={b.writing ?? 'h'} onValueChange={(v) => patch({ writing: v })} options={[{ value: 'h', label: '横排' }, { value: 'v', label: '竖排' }]} />
          </div>
        </div>
      );
    case 'image':
      return (
        <div className="space-y-2">
          <ImageField value={b.src} onChange={(v) => patch({ src: v })} optional={false} />
          <div className="grid grid-cols-[1fr_10rem] gap-2">
            <Input value={b.alt ?? ''} onChange={(e) => patch({ alt: e.target.value })} placeholder="替代文字" />
            <OptionSelect value={b.layout ?? 'wide'} onValueChange={(v) => patch({ layout: v })} options={[{ value: 'wide', label: '跨出正文栏' }, { value: 'inline', label: '与正文同宽' }]} />
          </div>
          <Input value={b.caption ?? ''} onChange={(e) => patch({ caption: e.target.value || undefined })} placeholder="图注" />
        </div>
      );
    case 'list':
      return <ListField b={b} patch={patch} />;
    case 'code':
      return (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input className="w-40" value={b.lang ?? ''} onChange={(e) => patch({ lang: e.target.value || undefined })} placeholder="语言" />
            <Input className="min-w-0 flex-1" value={b.filename ?? ''} onChange={(e) => patch({ filename: e.target.value || undefined })} placeholder="文件名" />
            <Input className="w-32" value={b.highlight ?? ''} onChange={(e) => patch({ highlight: e.target.value.replace(/\s/g, '') || undefined })} placeholder="高亮行 1,3-5" />
          </div>
          <Textarea rows={6} value={b.code} spellCheck={false} onChange={(e) => patch({ code: e.target.value })} variant="code" className="tab-2 whitespace-pre" />
        </div>
      );
    case 'callout':
      return (
        <div className="space-y-2">
          <OptionSelect className="w-28" value={b.kind ?? 'note'} onValueChange={(v) => patch({ kind: v })} options={CALLOUT_KINDS} />
          <CalloutField b={b} patch={patch} />
        </div>
      );
    case 'math':
      return <Textarea rows={3} value={b.tex ?? ''} spellCheck={false} onChange={(e) => patch({ tex: e.target.value })} variant="code" placeholder="TeX" className="whitespace-pre" />;
    case 'embed':
      return <Input value={b.url ?? ''} onChange={(e) => patch({ url: e.target.value.trim() })} placeholder="网址" />;
  }
  return <span className="text-muted-foreground">不认识的块类型 {String(b.type)}</span>;
}

/** 提示框的几段：空行分段 */
function CalloutField({ b, patch }: { b: Doc; patch: (p: Doc) => void }) {
  const [text, setText] = useState(() => (b.text as unknown[]).map((it) => spansToText(asSpans(it))).join('\n\n'));
  return (
    <Textarea rows={3} value={text} placeholder="正文"
      onChange={(e) => { setText(e.target.value); patch({ text: e.target.value.split(/\n\s*\n/).map((t) => compact(textToSpans(t.trim()))) }); }} />
  );
}

function ListField({ b, patch }: { b: Doc; patch: (p: Doc) => void }) {
  const [text, setText] = useState(() => (b.items as unknown[]).map((it) => spansToText(asSpans(it))).join('\n'));
  return (
    <div className="space-y-2">
      <Textarea rows={4} value={text} onChange={(e) => { setText(e.target.value); patch({ items: e.target.value.split('\n').map((l) => compact(textToSpans(l))) }); }} />
      <SwitchField checked={!!b.ordered} onCheckedChange={(v) => patch({ ordered: v || undefined })} label="有序列表（1. 2. 3.）" />
    </div>
  );
}
