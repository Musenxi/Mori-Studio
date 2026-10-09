import type { ReactNode } from 'react';
import { parseComment } from 'astro-mori/comment-md';

/** 评论正文：和站点一样按评论用的 Markdown 显示（节点见主题的 comment-md.mjs，不经过 HTML 字符串） */
export function CommentBody({ text }: { text: string }) {
  return <div className="my-1.5 space-y-2 break-words">{render(parseComment(text))}</div>;
}

type Node = { type: string; text?: string; href?: string; start?: number; children?: Node[]; items?: Node[][] };

function render(nodes: Node[]): ReactNode[] {
  const kids = (n: Node) => render(n.children ?? []);
  const items = (n: Node) => (n.items ?? []).map((it, i) => <li key={i}>{render(it)}</li>);
  return nodes.map((n, i) => {
    switch (n.type) {
      case 'text': return n.text;
      case 'br': return <br key={i} />;
      case 'code': return <code key={i} className="mono rounded-sm bg-foreground/[.06] px-1">{n.text}</code>;
      case 'pre': return <pre key={i} className="mono overflow-x-auto rounded-lg bg-foreground/[.05] px-3.5 py-2.5"><code className="whitespace-pre">{n.text}</code></pre>;
      case 'a': return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer nofollow" className="underline decoration-foreground/25 underline-offset-2 transition-colors hover:decoration-foreground">{kids(n)}</a>;
      case 'ul': return <ul key={i} className="list-disc pl-5">{items(n)}</ul>;
      case 'ol': return <ol key={i} start={n.start} className="list-decimal pl-5">{items(n)}</ol>;
      case 'quote': return <blockquote key={i} className="space-y-2 border-l-2 border-border pl-3 text-soft-foreground">{kids(n)}</blockquote>;
      case 'b': return <strong key={i} className="font-semibold">{kids(n)}</strong>;
      case 'i': return <em key={i} className="italic">{kids(n)}</em>;
      case 'del': return <del key={i} className="text-muted-foreground">{kids(n)}</del>;
      default: return <p key={i}>{kids(n)}</p>;
    }
  });
}
