/**
 * 导入时的格式转换：HEIC → JPEG（浏览器和 sharp 都读不了 iPhone 的 HEIC），
 * 实况照片的视频 → H.264 的 mp4（iPhone 录的是 HEVC，很多浏览器放不了）。
 * HEIC 用 macOS 自带的 sips；视频优先用 ffmpeg，没有就用 macOS 自带的 avconvert。
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const HEIC_EXT = new Set(['.heic', '.heif']);

const scratch = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'mori-media-'));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

/** HEIC 转 JPEG，EXIF（拍摄时间、定位）保留 */
export function heicToJpeg(buffer) {
  if (process.platform !== 'darwin') throw new Error('这台电脑转换不了 HEIC，请先导出为 JPEG');
  return scratch(async (dir) => {
    writeFileSync(join(dir, 'in.heic'), buffer);
    try {
      await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', join(dir, 'in.heic'), '--out', join(dir, 'out.jpg')]);
    } catch { throw new Error('HEIC 转换失败'); }
    return readFileSync(join(dir, 'out.jpg'));
  });
}

/**
 * 实况照片里静态照片对应的时间点（秒）：iPhone 的 MOV 里有一条只有一帧、时长极短的元数据轨（still-image-time），它的起点就是。
 * LivePhotosKit 播放要用它；转成 mp4 后这条轨就没了，所以转之前读出来。读不出返回 undefined
 */
async function stillTime(src) {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_tag_string,start_time,duration,nb_frames', '-of', 'json', src]);
    const marks = JSON.parse(stdout).streams
      .filter((s) => s.codec_type === 'data' && s.codec_tag_string === 'mebx' && +s.nb_frames === 1 && +s.start_time > 0)
      .sort((a, b) => a.duration - b.duration);
    return marks.length ? +(+marks[0].start_time).toFixed(4) : undefined;
  } catch { return undefined; }
}

/**
 * 视频转成网页用的 mp4：H.264、最宽 1440、去掉声音、索引放在开头，写到 out。
 * 原有的元数据（含拍摄地点）全部去掉，只在注释里记静态照片的时间点（mori-photo-time=1.4667），主题读它交给 LivePhotosKit
 */
export function toWebMp4(buffer, out) {
  return scratch(async (dir) => {
    const src = join(dir, 'in.mov'), tmp = join(dir, 'out.mp4');
    writeFileSync(src, buffer);
    try {
      const time = await stillTime(src);
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-map', '0:v:0', '-map_metadata', '-1', ...(time ? ['-metadata', `comment=mori-photo-time=${time}`] : []), '-vf', "scale='min(1440,iw)':-2", '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', tmp]);
    } catch (e) {
      if (e.code !== 'ENOENT') throw new Error('视频转换失败');
      if (process.platform !== 'darwin') throw new Error('需要先安装 ffmpeg 才能导入实况照片');
      try { await run('avconvert', ['--source', src, '--output', tmp, '--preset', 'Preset1920x1080', '--replace']); } catch { throw new Error('视频转换失败'); }
    }
    copyFileSync(tmp, out);
  });
}
