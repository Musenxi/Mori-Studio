import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, type MailSettings, type SpamRules } from '@/lib/api';
import { useProject, useRefresh } from '@/lib/hooks';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Body, Card, PageHeader, Section } from '@/components/page';
import { Segmented } from '@/components/segmented';
import { SwitchField } from '@/components/switch-field';
import { cn } from '@/lib/cn';
import { autosaveSeconds, setAutosaveSeconds } from '@/lib/prefs';

/** 防垃圾规则：每行一条，存在评论服务里 */
const SPAM: Array<[keyof SpamRules, string]> = [['words', '屏蔽词'], ['ips', '屏蔽 IP'], ['urls', '屏蔽网址'], ['names', '屏蔽昵称']];
const spamText = (r: SpamRules) => Object.fromEntries(SPAM.map(([k]) => [k, r[k].join('\n')])) as Record<keyof SpamRules, string>;
const spamLines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

const PRESETS: Array<[string, string]> = [['#002fa7', '克莱因蓝'], ['#b0442b', '朱'], ['#3f6b4f', '松绿'], ['#5b3f8c', '紫']];
// 和主题里的推导一致：亮色下亮度封顶，暗色下亮度托底（都在 OKLCH 里，色相和饱和度不变）
const light = (c: string) => `oklch(from ${c} min(l,.52) c h)`;
const dark = (c: string) => `oklch(from ${c} max(l,.7) min(c,.18) h)`;

export default function Settings() {
  const { data: project } = useProject();
  const refresh = useRefresh();
  const cfg = project?.config;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [head, setHead] = useState('');
  const [accent, setAccent] = useState('#002fa7');
  const [accentDark, setAccentDark] = useState('');
  const [override, setOverride] = useState(false);
  const [auto, setAuto] = useState(String(autosaveSeconds()));
  const [edits, setEdits] = useState<Record<string, string>>({}); // 还没保存的、用选项改的设定（键是配置路径）
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const spamOn = project?.comments.provider === 'mori' && project.comments.hasToken;
  const spamQ = useQuery({ queryKey: ['comment-settings'], queryFn: api.commentSettings, enabled: !!spamOn, retry: false });
  const [spam, setSpam] = useState<Record<keyof SpamRules, string> | null>(null);
  useEffect(() => { if (spamQ.data) setSpam(spamText(spamQ.data.spam)); }, [spamQ.data]);
  const mailQ = useQuery({ queryKey: ['comment-mail'], queryFn: api.commentMail, enabled: !!spamOn, retry: false });
  const [mail, setMail] = useState<MailSettings | null>(null);
  useEffect(() => { if (mailQ.data) setMail(mailQ.data.mail); }, [mailQ.data]);
  const [testing, setTesting] = useState(false);
  useEffect(() => { if (cfg) { setTitle(cfg.title); setDescription(cfg.description ?? ''); setAccent(cfg.accent); setAccentDark(cfg.accentDark ?? ''); setOverride(!!cfg.accentDark); } }, [cfg?.title, cfg?.description, cfg?.accent, cfg?.accentDark]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (cfg) setHead(cfg.head ?? ''); }, [cfg?.head]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!cfg) return null;
  const rawAvatar = cfg.comments?.avatar;
  const avatarKey = rawAvatar == null || rawAvatar === '' ? 'cravatar' : rawAvatar; // 配置里是自定义地址时，三个选项都不亮

  const put = (key: string, value: string) => setEdits((e) => ({ ...e, [key]: value }));
  const autoN = Math.min(3600, Math.max(1, Math.round(Number(auto)) || 60));
  const accentDarkNow = override ? accentDark : '';
  const spamDirty = !!(spam && spamQ.data && SPAM.some(([k]) => spamLines(spam[k]).join('\n') !== spamQ.data.spam[k].join('\n')));
  const mailDirty = !!(mail && mailQ.data && JSON.stringify(mail) !== JSON.stringify(mailQ.data.mail));
  const dirty = mailDirty || spamDirty || (title && title !== cfg.title) || description !== (cfg.description ?? '') || accent !== cfg.accent || accentDarkNow !== (cfg.accentDark ?? '') || Object.keys(edits).length > 0 || autoN !== autosaveSeconds() || head.trim() !== (cfg.head ?? '');

  const save = async () => {
    setBusy(true);
    try {
      if (title && title !== cfg.title) await api.setConfig('title', title);
      if (description !== (cfg.description ?? '')) await api.setConfig('description', description);
      if (accent !== cfg.accent) await api.setConfig('accent', accent);
      if (accentDarkNow !== (cfg.accentDark ?? '')) await api.setConfig('accentDark', accentDarkNow || null);
      for (const [k, v] of Object.entries(edits)) await api.setConfig(k, v);
      if (head.trim() !== (cfg.head ?? '')) await api.setConfig('head', head.trim() || null);
      // 邮件里的链接用站点主题色：邮件设置改了、或者主题色改了，都把当前的主题色一起存过去
      if (mail && (mailDirty || mail.accent !== accent)) {
        const r = await api.setCommentMail({ ...mail, accent });
        qc.setQueryData(['comment-mail'], r);
        setMail(r.mail);
      }
      if (spam && spamDirty) {
        const r = await api.setCommentSettings(Object.fromEntries(SPAM.map(([k]) => [k, spamLines(spam[k])])) as unknown as SpamRules);
        qc.setQueryData(['comment-settings'], r);
        setSpam(spamText(r.spam));
      }
      setAutosaveSeconds(autoN); setAuto(String(autoN));
      setEdits({});
      await refresh();
      toast.success('已保存');
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  };

  return (
    <>
      <PageHeader title="设定" actions={<Button variant="default" onClick={() => void save()} disabled={busy || !dirty}>保存</Button>} />
      <Body>
        <Section title="刊名与简介"><Card>
          <Field label="刊名"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="简介"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        </Card></Section>

        <Section title="作者"><Card>
          <Field label="名字"><Input value={edits['author.name'] ?? cfg.author.name ?? ''} onChange={(e) => put('author.name', e.target.value)} /></Field>
          <Field label="邮箱"><Input type="email" value={edits['author.email'] ?? cfg.author.email ?? ''} onChange={(e) => put('author.email', e.target.value)} /></Field>
          <Field label="网址"><Input value={edits['author.url'] ?? cfg.author.url ?? ''} onChange={(e) => put('author.url', e.target.value)} /></Field>
        </Card></Section>

        <Section title="首页与归档"><Card>
          <Field label="版式">
            <Segmented value={edits['home.style'] ?? cfg.home?.style ?? 'quote'} onValueChange={(v) => put('home.style', v)} options={[{ value: 'quote', label: '引文版' }, { value: 'cover', label: '封面版' }, { value: 'list', label: '列表' }]} />
          </Field>
          <Field label="展示篇数">
            <div className="flex items-center gap-2">
              <Input type="number" min={1} max={8} className="w-24" value={edits['home.count'] ?? String(cfg.home?.count ?? 4)} onChange={(e) => put('home.count', e.target.value)} />
              <span className="text-soft-foreground">篇</span>
            </div>
          </Field>
          <Field label="首页排法">
            <Segmented value={edits['home.direction'] ?? cfg.home?.direction ?? 'h'} onValueChange={(v) => put('home.direction', v)} options={[{ value: 'h', label: '横排' }, { value: 'v', label: '竖排' }]} />
          </Field>
          <Field label="目次排法">
            <Segmented value={edits['home.tocDirection'] ?? cfg.home?.tocDirection ?? cfg.home?.direction ?? 'h'} onValueChange={(v) => put('home.tocDirection', v)} options={[{ value: 'h', label: '横排' }, { value: 'v', label: '竖排' }]} />
          </Field>
        </Card></Section>

        <Section title="订阅"><Card>
          <Field label="订阅内容">
            <Segmented value={edits['feed.content'] ?? cfg.feed?.content ?? 'excerpt'} onValueChange={(v) => put('feed.content', v)} options={[{ value: 'excerpt', label: '只放摘要' }, { value: 'full', label: '放全文' }]} />
          </Field>
        </Card></Section>

        {project?.comments.provider === 'mori' && (
          <Section title="评论"><Card>
            <Field label="状态">
              <Segmented value={edits['comments.status'] ?? cfg.comments?.status ?? 'on'} onValueChange={(v) => put('comments.status', v)} options={[{ value: 'on', label: '开启' }, { value: 'readonly', label: '禁用，显示历史评论' }, { value: 'off', label: '禁用，不显示' }]} />
            </Field>
            <Field label="头像服务">
              <Segmented value={edits['comments.avatar'] ?? avatarKey} onValueChange={(v) => put('comments.avatar', v)} options={[{ value: 'cravatar', label: 'Cravatar' }, { value: 'gravatar', label: 'Gravatar' }, { value: 'none', label: '不显示' }]} />
            </Field>
            {!project.comments.hasToken
              ? <p className="pt-2 text-soft-foreground">防垃圾规则要先在评论页填管理令牌。</p>
              : spamQ.error
                ? <p className="pt-2 text-destructive">{(spamQ.error as Error).message}</p>
                : spam && SPAM.map(([k, label]) => (
                  <Field key={k} label={label}>
                    <Textarea rows={3} spellCheck={false} value={spam[k]} onChange={(e) => setSpam({ ...spam, [k]: e.target.value })} placeholder={k === 'ips' ? '1.2.3.4\n1.2.3.*\n10.0.0.0/8' : undefined} />
                  </Field>
                ))}
          </Card></Section>
        )}

        {spamOn && mail && (
          <Section title="邮件提醒"><Card>
            <MailFields mail={mail} set={setMail} defaults={{ to: cfg.author.email ?? '', site: cfg.site, fromName: cfg.title }} />
            {mail.provider !== 'off' && (
              <div className="pt-3">
                <Button variant="secondary" size="sm" disabled={testing || mailDirty || !mailQ.data?.mail.to} onClick={async () => {
                  setTesting(true);
                  try { await api.testCommentMail(); toast.success(`已发到 ${mailQ.data!.mail.to}`); } catch (e) { toast.error((e as Error).message); }
                  setTesting(false);
                }}>发送测试邮件</Button>
              </div>
            )}
          </Card></Section>
        )}
        {spamOn && mailQ.error && <p className="text-destructive">{(mailQ.error as Error).message}</p>}

        <Section title="自定义代码"><Card>
          <Field label="<head>" hint="只在构建出的站点里生效，预览里没有。">
            <Textarea variant="code" rows={6} spellCheck={false} value={head} onChange={(e) => setHead(e.target.value)} />
          </Field>
        </Card></Section>

        <Section title="编辑器"><Card>
          <Field label="自动保存间隔">
            <div className="flex items-center gap-2">
              <Input type="number" min={1} max={3600} className="w-24" value={auto} onChange={(e) => setAuto(e.target.value)} />
              <span className="text-soft-foreground">秒</span>
            </div>
          </Field>
        </Card></Section>

        <Section title="主题色"><Card>
          <div className="flex items-center gap-2.5 pb-3">
            {PRESETS.map(([c, n]) => (
              <button key={c} type="button" title={n} aria-label={n} onClick={() => setAccent(c)} style={{ '--c': c }} className={cn('h-7 w-7 rounded-full bg-(--c) outline-offset-2 transition-[outline-color,transform] hover:scale-110', accent === c ? 'outline outline-2 outline-foreground' : 'outline outline-1 outline-transparent hover:outline-muted-foreground')} />
            ))}
            <input type="color" value={accent} aria-label="自选颜色" onChange={(e) => setAccent(e.target.value)} className="ml-1 h-8 w-10 cursor-pointer rounded-md border-0 bg-transparent p-0" />
            <HexInput value={accent} onChange={setAccent} label="主题色" />
          </div>
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <Swatch bg={light(accent)} paper="#f3f0e8" ink="#1d1b18" label="亮色" />
            <Swatch bg={override && accentDark ? accentDark : dark(accent)} paper="#151412" ink="#ececec" label="暗色" />
          </div>
          <div className="mt-4 flex items-center gap-3">
            <SwitchField checked={override} label="手动指定暗色版本" onCheckedChange={(v) => { setOverride(v); if (v && !accentDark) setAccentDark('#7f9bff'); }} />
            {override && <input type="color" value={accentDark || '#7f9bff'} aria-label="暗色版本" onChange={(e) => setAccentDark(e.target.value)} className="h-8 w-10 cursor-pointer rounded-md border-0 bg-transparent p-0" />}
            {override && <HexInput value={accentDark || '#7f9bff'} onChange={setAccentDark} label="暗色版本" />}
          </div>
        </Card></Section>
      </Body>
    </>
  );
}

function Swatch({ bg, paper, ink, label }: { bg: string; paper: string; ink: string; label: string }) {
  return (
    <div style={{ '--paper': paper, '--ink': ink, '--bg': bg }} className="rounded-xl bg-(--paper) p-4 text-(--ink) shadow-soft">
      <div className="h-8 w-full rounded-lg bg-(--bg)" />
      <div className="mt-2 text-12-5">{label}</div>
    </div>
  );
}

const parseHex = (v: string) => {
  const m = v.trim().toLowerCase().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  return m ? `#${m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]}` : null;
};

/** 16 进制色值：#rrggbb 或 #rgb（# 可省），写对了才改颜色；离开时没写对就恢复原值 */
function HexInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [text, setText] = useState(value);
  // 颜色从别处改了（取色器、预设）才同步过来；自己正在输入的不打断
  useEffect(() => { if (parseHex(text) !== value) setText(value); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const parse = parseHex;
  return (
    <div className="mono w-28">
      <Input aria-label={label} spellCheck={false} value={text}
        onChange={(e) => { setText(e.target.value); const v = parse(e.target.value); if (v) onChange(v); }}
        onBlur={() => setText(parse(text) ?? value)} />
    </div>
  );
}

/** 邮件提醒的各项。从“关闭”切到某种发信方式时，空着的收件邮箱、站点地址、发件人名字先用作者邮箱、站点配置补上 */
function MailFields({ mail, set, defaults }: { mail: MailSettings; set: (m: MailSettings) => void; defaults: { to: string; site: string; fromName: string } }) {
  const put = (patch: Partial<MailSettings>) => set({ ...mail, ...patch });
  const secret = (has?: boolean) => (has ? '已填，留空不改' : undefined);
  return (
    <>
      <Field label="发信方式">
        <Segmented value={mail.provider} onValueChange={(v) => put({ provider: v, ...(mail.provider === 'off' && v !== 'off' ? { to: mail.to || defaults.to, site: mail.site || defaults.site, fromName: mail.fromName || defaults.fromName } : {}) })}
          options={[{ value: 'off', label: '关闭' }, { value: 'smtp', label: 'SMTP' }, { value: 'resend', label: 'Resend' }, { value: 'cloudflare', label: 'Cloudflare' }]} />
      </Field>
      {mail.provider === 'smtp' && (
        <>
          <Field label="服务器"><Input value={mail.smtp.host} placeholder="smtp.qq.com" onChange={(e) => put({ smtp: { ...mail.smtp, host: e.target.value } })} /></Field>
          <Field label="端口"><Input type="number" className="w-24" value={String(mail.smtp.port)} onChange={(e) => put({ smtp: { ...mail.smtp, port: Number(e.target.value) || 0 } })} /></Field>
          <Field label="用户名"><Input value={mail.smtp.user} onChange={(e) => put({ smtp: { ...mail.smtp, user: e.target.value } })} /></Field>
          <Field label="密码"><Input type="password" value={mail.smtp.pass} placeholder={secret(mail.smtp.hasPass)} onChange={(e) => put({ smtp: { ...mail.smtp, pass: e.target.value } })} /></Field>
        </>
      )}
      {mail.provider === 'resend' && (
        <Field label="API Key"><Input type="password" value={mail.resend.apiKey} placeholder={secret(mail.resend.hasKey)} onChange={(e) => put({ resend: { ...mail.resend, apiKey: e.target.value } })} /></Field>
      )}
      {mail.provider === 'cloudflare' && (
        <>
          <Field label="账号 ID" hint="Workers 版绑了 send_email 就不用填账号 ID 和令牌。"><Input value={mail.cloudflare.accountId} onChange={(e) => put({ cloudflare: { ...mail.cloudflare, accountId: e.target.value } })} /></Field>
          <Field label="API 令牌"><Input type="password" value={mail.cloudflare.apiToken} placeholder={secret(mail.cloudflare.hasToken)} onChange={(e) => put({ cloudflare: { ...mail.cloudflare, apiToken: e.target.value } })} /></Field>
        </>
      )}
      {mail.provider !== 'off' && (
        <>
          <Field label="发件人"><Input value={mail.fromName} onChange={(e) => put({ fromName: e.target.value })} /></Field>
          <Field label="发件邮箱"><Input type="email" value={mail.fromEmail} onChange={(e) => put({ fromEmail: e.target.value })} /></Field>
          <Field label="收件邮箱"><Input type="email" value={mail.to} onChange={(e) => put({ to: e.target.value })} /></Field>
          <Field label="站点地址"><Input value={mail.site} placeholder="https://" onChange={(e) => put({ site: e.target.value })} /></Field>
          <div className="flex flex-wrap gap-x-6 gap-y-2 pt-2">
            <SwitchField checked={mail.notifyAuthor} label="新评论提醒我" onCheckedChange={(v) => put({ notifyAuthor: v })} />
            <SwitchField checked={mail.notifyReply} label="有人回复时提醒读者" onCheckedChange={(v) => put({ notifyReply: v })} />
          </div>
        </>
      )}
    </>
  );
}
