import { useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ArrowUpRight, Check } from 'lucide-react';
import { api, type CommentsInfo } from '@/lib/api';
import { useProject, useRefresh } from '@/lib/hooks';
import { cn } from '@/lib/cn';
import { Card } from '@/components/page';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CommentsConnect } from '@/components/comments-connect';

const STEPS = ['站点', '评论'];
const DEPLOY = 'https://github.com/Musenxi/Mori-Comment#readme';

/** 新建的站点第一次打开：刊名和作者，再接评论服务；走完或跳过后进仪表盘，以后不再出现 */
export default function Welcome() {
  const [step, setStep] = useState(0);
  const refresh = useRefresh();
  const navigate = useNavigate();
  const finish = async () => {
    try { await api.welcomeDone(); } catch (e) { toast.error((e as Error).message); return; }
    await refresh();
    navigate('/', { replace: true });
  };
  return (
    <div className="flex h-full p-2">
      <main className="min-w-0 flex-1 overflow-y-auto rounded-2xl bg-card shadow-panel">
        <div className="mx-auto max-w-xl px-10 pb-24 pt-24">
          <div className="mb-5 flex items-baseline gap-5">
            <ol className="flex gap-5 text-21 font-semibold tracking-tight">
              {STEPS.map((t, i) => <li key={t} className={cn('transition-colors', i === step ? 'text-foreground' : 'text-muted-foreground/60')}>{t}</li>)}
            </ol>
            {step === 1 && <a href={DEPLOY} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-0.5 text-12-5 text-muted-foreground transition-colors hover:text-foreground">部署评论服务<ArrowUpRight size={13} /></a>}
          </div>
          <div key={step} className="animate-rise">
            {step === 0 ? <SiteStep onNext={() => setStep(1)} /> : <CommentsStep onBack={() => setStep(0)} onFinish={finish} />}
          </div>
        </div>
      </main>
    </div>
  );
}

function SiteStep({ onNext }: { onNext: () => void }) {
  const { data: project } = useProject();
  const refresh = useRefresh();
  const cfg = project!.config;
  const [v, setV] = useState({ title: cfg.title, description: cfg.description ?? '', name: cfg.author.name ?? '', email: cfg.author.email ?? '' });
  const [busy, setBusy] = useState(false);
  const put = (k: keyof typeof v) => (e: ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const next = async () => {
    setBusy(true);
    try {
      const t = (s: string) => s.trim();
      if (t(v.title) !== cfg.title) await api.setConfig('title', t(v.title));
      if (t(v.description) !== (cfg.description ?? '')) await api.setConfig('description', t(v.description));
      if (t(v.name) !== (cfg.author.name ?? '')) await api.setConfig('author.name', t(v.name));
      if (t(v.email) !== (cfg.author.email ?? '')) await api.setConfig('author.email', t(v.email));
      await refresh();
      onNext();
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); void next(); }}>
      <Card>
        <Field label="刊名"><Input value={v.title} autoFocus onChange={put('title')} /></Field>
        <Field label="简介"><Input value={v.description} onChange={put('description')} /></Field>
        <Field label="作者"><Input value={v.name} onChange={put('name')} /></Field>
        <Field label="邮箱"><Input type="email" value={v.email} onChange={put('email')} /></Field>
      </Card>
      <div className="mt-6 flex justify-end">
        <Button type="submit" variant="default" disabled={busy || !v.title.trim()}>下一步</Button>
      </div>
    </form>
  );
}

function CommentsStep({ onBack, onFinish }: { onBack: () => void; onFinish: () => Promise<void> }) {
  const { data: project } = useProject();
  const refresh = useRefresh();
  const [info, setInfo] = useState<CommentsInfo | null>(null);
  const [key, setKey] = useState(project?.config.comments?.turnstileSiteKey ?? '');
  const [busy, setBusy] = useState(false);
  // 连上了：评论服务开了人机验证就还要填站点密钥，否则直接走完
  const connected = (i?: CommentsInfo) => (i?.features.turnstile ? setInfo(i) : void onFinish());
  const done = async () => {
    setBusy(true);
    try {
      if (key.trim() !== (project?.config.comments?.turnstileSiteKey ?? '')) await api.setConfig('comments.turnstileSiteKey', key.trim());
      await refresh();
      await onFinish();
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  };
  return (
    <>
      <Card>
        {info ? (
          <>
            <Field label="服务">
              <div className="flex min-h-9 items-center gap-2">
                <Check size={15} className="shrink-0 text-brand" />
                <span className="mono min-w-0 truncate">{project?.comments.endpoint}</span>
                {info.version && <span className="mono shrink-0 text-muted-foreground">v{info.version}</span>}
              </div>
            </Field>
            <Field label="Turnstile">
              <Input variant="mono" spellCheck={false} placeholder="站点密钥（Site Key）" value={key} autoFocus onChange={(e) => setKey(e.target.value)} />
            </Field>
          </>
        ) : <CommentsConnect onDone={connected} />}
      </Card>
      <div className="mt-6 flex justify-between">
        <Button variant="ghost" disabled={busy} onClick={onBack}>上一步</Button>
        {info
          ? <Button variant="default" disabled={busy} onClick={() => void done()}>完成</Button>
          : <Button disabled={busy} onClick={() => void onFinish()}>跳过</Button>}
      </div>
    </>
  );
}
