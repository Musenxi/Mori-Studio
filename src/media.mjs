/**
 * 导入时的格式转换：HEIC → JPEG（浏览器和 sharp 都读不了 iPhone 的 HEIC），
 * 实况照片的视频、正文里的视频 → H.264 的 mp4（iPhone 录的是 HEVC，很多浏览器放不了）。
 * HEIC 用 macOS 自带的 sips；视频优先用 ffmpeg，没有就用 macOS 自带的 avconvert。
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import exifReader from 'exif-reader';
import sharp from 'sharp';

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
      // 先存最高质量，转正时（uprightJpeg）再压一次
      await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '100', join(dir, 'in.heic'), '--out', join(dir, 'out.jpg')]);
    } catch { throw new Error('HEIC 转换失败'); }
    return uprightJpeg(readFileSync(join(dir, 'out.jpg')), true);
  });
}

/**
 * 带 EXIF 方向标记的 JPEG（手机竖拍、HEIC 转出来的）把像素转正、标记改回正常，别的 EXIF（时间、定位）保留。
 * 不转的话，不看方向标记的地方（Studio 的缩略图、排版里量的宽高）图是躺倒的。force：没有方向标记也重新压缩
 */
export async function uprightJpeg(buffer, force = false) {
  const { format, orientation = 1 } = await sharp(buffer).metadata();
  if (format !== 'jpeg' || (orientation === 1 && !force)) return buffer;
  return sharp(buffer).rotate().withMetadata({ orientation: 1 }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

/**
 * 清除位置信息（GPS）：在原 JPEG 的 EXIF 里把 GPS 目录清零（条目数、条目、值都抹掉），别的字节一个不动，
 * 拍摄参数、镜头、时间都保留，也不重新压缩。没有定位、不是 JPEG 就原样返回
 */
export async function stripLocation(buffer) {
  const { format, exif } = await sharp(buffer).metadata();
  if (format !== 'jpeg' || !exif) return buffer;
  let e;
  try { e = exifReader(exif); } catch { return buffer; }
  if (!Object.keys(e.GPSInfo ?? {}).length) return buffer;
  const out = Buffer.from(buffer);
  for (let p = 2; p + 4 <= out.length && out[p] === 0xff && out[p + 1] !== 0xda; ) {
    const len = out.readUInt16BE(p + 2);
    const data = p + 4;
    if (out[p + 1] === 0xe1 && out.toString('latin1', data, data + 6) === 'Exif\0\0') wipeGps(out, data + 6, p + 2 + len);
    p += 2 + len;
  }
  return out;
}

const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

/** TIFF 结构里找到 GPS 目录（IFD0 的 0x8825 指针）并清零；end 是这段 EXIF 的结尾，越界的地方不碰 */
function wipeGps(buf, tiff, end) {
  const le = buf.toString('latin1', tiff, tiff + 2) === 'II';
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const ok = (o, n) => o >= tiff && o + n <= end;
  const ifd0 = tiff + u32(tiff + 4);
  if (!ok(ifd0, 2)) return;
  for (let i = 0, n = u16(ifd0); i < n; i++) {
    const e = ifd0 + 2 + 12 * i;
    if (!ok(e, 12) || u16(e) !== 0x8825) continue;
    const gps = tiff + u32(e + 8);
    if (!ok(gps, 2)) return;
    const count = u16(gps);
    if (!ok(gps, 2 + 12 * count + 4)) return;
    // 先清每个条目的值（超过 4 字节的值放在别处），再清条目和下一个目录的指针
    for (let j = 0; j < count; j++) {
      const ge = gps + 2 + 12 * j;
      const size = (TYPE_SIZE[u16(ge + 2)] ?? 0) * u32(ge + 4);
      if (size > 4 && ok(tiff + u32(ge + 8), size)) buf.fill(0, tiff + u32(ge + 8), tiff + u32(ge + 8) + size);
    }
    buf.fill(0, gps, gps + 2 + 12 * count + 4);
    return;
  }
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

/** 长边最多 1920（iPhone 视频的原尺寸，不缩），另一边按比例取偶数 */
const SCALE = "scale='if(gte(iw,ih),min(1920,iw),-2)':'if(gte(iw,ih),-2,min(1920,ih))'";

/**
 * 视频转成网页用的 mp4：H.264、长边最多 1920（iPhone 实况视频的原尺寸，不缩）、crf 19，码率最高 14M（噪点很多的画面不至于太大）、
 * 去掉声音、索引放在开头，写到 out。实况视频只有两三秒，文件大一点没关系；播放时会放大到照片的尺寸，压得太狠或缩得太小都会糊
 * 原有的元数据（含拍摄地点）全部去掉，只在注释里记静态照片的时间点（mori-photo-time=1.4667），主题读它交给 LivePhotosKit
 */
export function toWebMp4(buffer, out) {
  return scratch(async (dir) => {
    const src = join(dir, 'in.mov'), tmp = join(dir, 'out.mp4');
    writeFileSync(src, buffer);
    try {
      const time = await stillTime(src);
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-map', '0:v:0', '-map_metadata', '-1', ...(time ? ['-metadata', `comment=mori-photo-time=${time}`] : []), '-vf', SCALE, '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-maxrate', '14M', '-bufsize', '28M', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', tmp]);
    } catch (e) {
      if (e.code !== 'ENOENT') throw new Error('视频转换失败');
      if (process.platform !== 'darwin') throw new Error('需要先安装 ffmpeg 才能导入实况照片');
      try { await run('avconvert', ['--source', src, '--output', tmp, '--preset', 'Preset1920x1080', '--replace']); } catch { throw new Error('视频转换失败'); }
    }
    copyFileSync(tmp, out);
  });
}

/**
 * 正文里的视频：转成网页用的 mp4（H.264、长边最多 1920、留着声音转成 AAC、去掉元数据，索引放在开头），写到 out；
 * 再从转好的视频里取一帧（0.3 秒处，太短就取第一帧）存成 JPEG 封面，写到 poster
 */
export function toWebVideo(buffer, out, poster) {
  return scratch(async (dir) => {
    const src = join(dir, 'in'), tmp = join(dir, 'out.mp4'), jpg = join(dir, 'poster.jpg');
    writeFileSync(src, buffer);
    try {
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1', '-vf', SCALE, '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-maxrate', '14M', '-bufsize', '28M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', tmp]);
      for (const at of ['0.3', '0']) {
        await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', at, '-i', tmp, '-frames:v', '1', '-q:v', '2', jpg]).catch(() => {});
        if (existsSync(jpg)) break;
      }
    } catch (e) {
      throw new Error(e.code === 'ENOENT' ? '需要先安装 ffmpeg 才能插入视频' : '视频转换失败');
    }
    copyFileSync(tmp, out);
    if (existsSync(jpg)) copyFileSync(jpg, poster);
  });
}
