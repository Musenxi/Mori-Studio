import { useState } from 'react';
import { toast } from 'sonner';
import { useProject } from '@/lib/hooks';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import { Body, Card, PageHeader, Section } from '@/components/page';

/** shell 里的一个参数：有空格、引号这类字符就用单引号包起来 */
const sh = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

function Snippet({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { toast.error('复制失败'); }
  };
  return (
    <div className="flex items-start gap-2">
      <pre className="mono min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-lg bg-foreground/[.05] px-3 py-2 text-11-5 leading-relaxed">{text}</pre>
      <Button size="sm" onClick={() => void copy()}>{done ? '已复制' : '复制'}</Button>
    </div>
  );
}

/** MCP：让 AI 客户端读写博客、管评论。本机的客户端用启动命令（stdio） */
export default function Mcp() {
  const { data: project } = useProject();
  if (!project) return null;
  const { command, args } = project.mcp;
  const cmd = [command, ...args].map(sh).join(' ');
  return (
    <>
      <PageHeader title="MCP" />
      <Body>
        <Section title="Claude 桌面版"><Card>
          <Field label="配置"><Snippet text={JSON.stringify({ mcpServers: { mori: { command, args } } }, null, 2)} /></Field>
        </Card></Section>

        <Section title="Claude Code"><Card>
          <Field label="命令"><Snippet text={`claude mcp add mori -- ${cmd}`} /></Field>
        </Card></Section>

        <Section title="Codex"><Card>
          <Field label="命令"><Snippet text={`codex mcp add mori -- ${cmd}`} /></Field>
          <Field label="config.toml"><Snippet text={`[mcp_servers.mori]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}`} /></Field>
        </Card></Section>

        <Section title="命令行"><Card>
          <Field label="列出工具"><Snippet text={[command, args[0], 'tool', ...args.slice(2)].map(sh).join(' ')} /></Field>
        </Card></Section>
      </Body>
    </>
  );
}
