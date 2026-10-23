import { toast } from 'sonner';
import { api, VIDEO_ACCEPT } from '@/lib/api';
import { useAssetFolder } from '@/lib/folder';

/** 选一个视频文件，传到当前文章的文件夹（服务端转码、取一帧当封面）；转码要一会儿，期间留一条提示 */
export function useVideoUpload() {
  const folder = useAssetFolder();
  return (onDone: (r: { path: string; poster?: string }) => void) => {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = VIDEO_ACCEPT;
    el.onchange = async () => {
      const f = el.files?.[0];
      if (!f) return;
      const id = toast.loading('视频转码中…');
      try {
        const r = await api.uploadVideo(f, folder);
        toast.dismiss(id);
        onDone(r);
      } catch (e) { toast.error((e as Error).message, { id }); }
    };
    el.click();
  };
}
