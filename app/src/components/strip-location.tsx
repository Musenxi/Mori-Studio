import { useState } from 'react';
import { Switch } from '@/components/ui/switch';

const KEY = 'mori-strip-location';

/** 导入时是否清除位置信息；记在这台电脑上 */
export function useStripLocation() {
  const [on, setOn] = useState(() => {
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
  });
  const set = (v: boolean) => {
    setOn(v);
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* 存不了就只记在当前页面 */ }
  };
  return [on, set] as const;
}

export function StripLocationSwitch({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-13 text-muted-foreground select-none">
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
      清除位置信息
    </label>
  );
}
