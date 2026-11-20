// 讲义读取工具的回归测试：node tools/read-lesson-docx.test.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { findLesson, readLesson } from './read-lesson-docx.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`ok - ${name}`); };

// 造一个最小 docx（zip）：两段文字，中间一张图。
function zip(files) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text); const packed = deflateRawSync(data); const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed); centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const cd = Buffer.concat(centrals); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const dir = mkdtempSync(join(tmpdir(), 'westcott-docx-'));
try {
  const doc = '<w:document><w:body>'
    + '<w:p><w:r><w:t>双重底：</w:t></w:r><w:r><w:t xml:space="preserve">先看颈线</w:t></w:r></w:p>'
    + '<w:p><w:r><w:drawing><a:blip r:embed="rId5"/></w:drawing></w:r></w:p>'
    + '<w:p><w:r><w:t>收盘站上颈线才算确认 &amp; 量能配合</w:t></w:r></w:p>'
    + '</w:body></w:document>';
  const rels = '<Relationships><Relationship Id="rId5" Type="image" Target="media/image1.png"/></Relationships>';
  const libDir = join(dir, '本');
  const fs = await import('node:fs');
  fs.mkdirSync(libDir);
  writeFileSync(join(libDir, '11-20技术课双重底_W底_含图.docx'), zip({
    'word/document.xml': doc, 'word/_rels/document.xml.rels': rels, 'word/media/image1.png': 'PNGDATA',
  }));
  writeFileSync(join(libDir, '12-01_周二_锚定偏差.docx'), zip({ 'word/document.xml': '<w:p><w:r><w:t>锚定</w:t></w:r></w:p>' }));

  t('按段落读出正文，图片按出现顺序标成〔图1〕', () => {
    const lesson = readLesson(join(libDir, '11-20技术课双重底_W底_含图.docx'));
    assert.deepEqual(lesson.paragraphs, ['双重底：先看颈线', '〔图1〕', '收盘站上颈线才算确认 & 量能配合']);
    assert.deepEqual(lesson.images, ['word/media/image1.png']);
  });
  t('导出图片到指定目录，文件名带图序', () => {
    const out = join(dir, 'imgs');
    readLesson(join(libDir, '11-20技术课双重底_W底_含图.docx'), { imagesTo: out });
    assert.deepEqual(readdirSync(out), ['图1_image1.png']);
  });
  t('按日期在讲义文件夹里找当天讲义（带不带下划线都认）', () => {
    assert.match(findLesson(libDir, '2026-11-20'), /11-20技术课双重底/);
    assert.match(findLesson(libDir, '2026-12-01'), /12-01_周二_锚定偏差/);
    assert.equal(findLesson(libDir, '2026-11-21'), null);
  });
  const real = 'C:/Users/pipi0/Desktop/课程/本/11-20技术课双重底_W底_含图.docx';
  if (existsSync(real)) {
    t('真实讲义 11-20 能读出双重底正文和图片', () => {
      const lesson = readLesson(real);
      assert.ok(lesson.paragraphs.join('').includes('双重底'));
      assert.ok(lesson.images.length >= 1);
    });
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`PASS: read-lesson-docx ${n} 项`);
