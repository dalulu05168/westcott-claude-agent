// 读取课程讲义 docx：按段落输出正文，图片按出现顺序标成〔图N〕，可导出图片。
//
//   node tools/read-lesson-docx.mjs 2026-11-20                 按日期在 课程\本 里找讲义并输出正文
//   node tools/read-lesson-docx.mjs <讲义.docx> --images <目录>  输出正文并把图片按图序导出
//
// 不依赖第三方库：docx 是 zip 包，用内置 zlib 解压 word/document.xml 和图片。
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

export const LESSON_DIR = 'C:\\Users\\pipi0\\Desktop\\课程\\本';

function unzip(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('不是有效的 docx（找不到 zip 目录）。');
  const count = buffer.readUInt16LE(end + 10);
  let p = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i += 1) {
    const method = buffer.readUInt16LE(p + 10);
    const size = buffer.readUInt32LE(p + 20);
    const nameLength = buffer.readUInt16LE(p + 28);
    const extra = buffer.readUInt16LE(p + 30);
    const comment = buffer.readUInt16LE(p + 32);
    const local = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLength);
    entries.set(name, { method, size, local });
    p += 46 + nameLength + extra + comment;
  }
  return (name) => {
    const entry = entries.get(name);
    if (!entry) return null;
    const start = entry.local + 30 + buffer.readUInt16LE(entry.local + 26) + buffer.readUInt16LE(entry.local + 28);
    const data = buffer.subarray(start, start + entry.size);
    return entry.method === 8 ? inflateRawSync(data) : Buffer.from(data);
  };
}

const unescape = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export function readLesson(file, { imagesTo } = {}) {
  const read = unzip(readFileSync(file));
  const xml = read('word/document.xml')?.toString('utf8');
  if (!xml) throw new Error('讲义里没有 word/document.xml。');
  const rels = new Map();
  for (const m of (read('word/_rels/document.xml.rels')?.toString('utf8') ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1];
    const target = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : `word/${target}`);
  }
  const paragraphs = [];
  const images = [];
  for (const para of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    let line = '';
    for (const piece of para[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|r:embed="([^"]+)"|<w:tab\/>|<w:br\/>/g)) {
      if (piece[1] !== undefined) line += unescape(piece[1]);
      else if (piece[2]) {
        const target = rels.get(piece[2]);
        if (target) { images.push(target); line += `〔图${images.length}〕`; }
      } else line += ' ';
    }
    if (line.trim()) paragraphs.push(line.trim());
  }
  if (imagesTo) {
    mkdirSync(imagesTo, { recursive: true });
    images.forEach((target, index) => {
      const data = read(target);
      if (data) writeFileSync(join(imagesTo, `图${index + 1}_${basename(target)}`), data);
    });
  }
  return { file, paragraphs, images };
}

// 按布加勒斯特日期 YYYY-MM-DD 在讲义文件夹里找当天讲义（文件名以 MM-DD 开头）。
export function findLesson(dir, date) {
  const prefix = date.slice(5);
  const hit = readdirSync(dir).filter((name) => name.endsWith('.docx') && name.startsWith(prefix)).sort();
  return hit.length ? join(dir, hit[0]) : null;
}

function main(argv) {
  const [target, ...rest] = argv;
  if (!target) throw new Error('用法：node tools/read-lesson-docx.mjs <YYYY-MM-DD 或 讲义.docx> [--images 目录]');
  const file = /^\d{4}-\d{2}-\d{2}$/.test(target) ? findLesson(LESSON_DIR, target) : target;
  if (!file) throw new Error(`讲义文件夹里没有 ${target} 的讲义。`);
  const at = rest.indexOf('--images');
  const lesson = readLesson(file, { imagesTo: at >= 0 ? rest[at + 1] : undefined });
  console.log(`讲义：${lesson.file}\n图片共 ${lesson.images.length} 张\n`);
  console.log(lesson.paragraphs.join('\n'));
}

const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
if (process.argv[1] && samePath(fileURLToPath(import.meta.url), process.argv[1])) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
