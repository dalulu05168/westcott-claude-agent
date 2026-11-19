import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const svgWidth = 960;
const svgHeight = 540;
const smallNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 });
const green = '#15825c';
const red = '#be3a4a';
const ink = '#19314b';
const muted = '#52667b';
const axisFloor = 370;
const priceTop = 105;
const volumeFloor = 474;

const escapeMarkup = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const labelNumber = (value) => smallNumber.format(value);
const numberField = (minimum, maximum) => ({ type: 'number', minimum, maximum });

function validateChart(chart) {
  if (chart.hypothetical_from && chart.hypothetical_from > chart.candles.length) {
    throw new Error('hypothetical_from must identify an existing candle after the first candle.');
  }
  for (const [index, row] of chart.candles.entries()) {
    if (row.low > Math.min(row.open, row.close) || row.high < Math.max(row.open, row.close)) {
      throw new Error(`Candle ${index + 1} has inconsistent open, high, low and close prices.`);
    }
  }
}

function chartSvg(chart) {
  const inset = 70;
  const right = 880;
  const step = (right - inset) / chart.candles.length;
  const high = Math.max(...chart.candles.map((candle) => candle.high), chart.level ?? 0);
  const low = Math.min(...chart.candles.map((candle) => candle.low), chart.level ?? high);
  const padding = (high - low || high * 0.04) * 0.12;
  const max = high + padding;
  const min = Math.max(0, low - padding);
  const priceY = (price) => axisFloor - (price - min) * (axisFloor - priceTop) / (max - min);
  const maxVolume = Math.max(1, ...chart.candles.map((candle) => candle.volume));
  const px = (value) => value.toFixed(2);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" role="img" aria-label="${escapeMarkup(chart.title)}" id="lesson-chart">`,
    '<rect width="960" height="540" fill="#fff"/>',
    '<g font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif">',
    `<text x="70" y="49" font-size="29" font-weight="700" fill="${ink}">${escapeMarkup(chart.title)}</text>`,
    `<text x="70" y="77" font-size="14" fill="${muted}">教材示意图  ·  合成数据</text>`,
  ];

  if (chart.hypothetical_from) {
    const x = inset + step * (chart.hypothetical_from - 1);
    svg.push(`<rect data-hypothetical-from="${chart.hypothetical_from}" x="${px(x)}" y="96" width="${px(right - x)}" height="390" fill="#fff2d9"/>`);
    svg.push(`<line x1="${px(x)}" x2="${px(x)}" y1="96" y2="486" stroke="#a16b16" stroke-dasharray="6 5"/>`);
  }
  for (let line = 0; line <= 4; line += 1) {
    const value = min + (max - min) * line / 4;
    const y = px(priceY(value));
    svg.push(`<line x1="${inset}" x2="${right}" y1="${y}" y2="${y}" stroke="#dce5ed"/>`);
    svg.push(`<text x="60" y="${px(Number(y) + 4)}" text-anchor="end" fill="${muted}" font-size="11">${labelNumber(value)}</text>`);
  }
  if (chart.level !== undefined) {
    const y = px(priceY(chart.level));
    svg.push(`<line x1="${inset}" x2="${right}" y1="${y}" y2="${y}" stroke="#46658a" stroke-width="1.5" stroke-dasharray="7 4"/>`);
    svg.push(`<text x="896" y="${px(Number(y) + 4)}" fill="#33577e" font-size="11">${labelNumber(chart.level)}</text>`);
  }
  svg.push(`<text x="70" y="399" font-size="13" fill="${muted}">成交量</text>`);
  svg.push(`<line x1="${inset}" x2="${right}" y1="${volumeFloor}" y2="${volumeFloor}" stroke="#dce5ed"/>`);

  const bodyWidth = Math.min(34, step * 0.52);
  for (const [index, candle] of chart.candles.entries()) {
    const bar = index + 1;
    const scenario = chart.hypothetical_from !== undefined && bar >= chart.hypothetical_from;
    const color = candle.close > candle.open ? green : candle.close < candle.open ? red : '#6b7783';
    const x = inset + step * (index + 0.5);
    const y = Math.min(priceY(candle.open), priceY(candle.close));
    const height = Math.max(1.4, Math.abs(priceY(candle.open) - priceY(candle.close)));
    const volumeHeight = candle.volume * 60 / maxVolume;
    const strokeStyle = scenario ? 'stroke-dasharray="3 2"' : '';
    svg.push(`<g data-candle="${bar}" data-scenario="${scenario ? 'hypothetical' : 'example'}">`);
    svg.push(`<line x1="${px(x)}" x2="${px(x)}" y1="${px(priceY(candle.high))}" y2="${px(priceY(candle.low))}" stroke="${color}" stroke-width="2" ${strokeStyle}/>`);
    svg.push(`<rect x="${px(x - bodyWidth / 2)}" y="${px(y)}" width="${px(bodyWidth)}" height="${px(height)}" fill="${scenario ? '#fff9ed' : color}" stroke="${color}" stroke-width="2" ${strokeStyle}/>`);
    svg.push(`<rect x="${px(x - bodyWidth / 2)}" y="${px(volumeFloor - volumeHeight)}" width="${px(bodyWidth)}" height="${px(volumeHeight)}" fill="${color}" fill-opacity="${scenario ? '.22' : '.52'}"/>`);
    if (chart.candles.length <= 20 || bar % 5 === 0 || bar === chart.hypothetical_from) {
      svg.push(`<text x="${px(x)}" y="499" text-anchor="middle" font-size="12" fill="${muted}">${bar}</text>`);
    }
    svg.push('</g>');
  }
  const conditional = chart.hypothetical_from ? `    浅黄区从第 ${chart.hypothetical_from} 根起表示假设，可用来讨论不同走法。` : '';
  svg.push(`<text x="70" y="524" font-size="13" fill="${muted}">绿涨、红跌、灰平盘。${conditional}</text>`);
  svg.push('</g></svg>');
  return svg.join('\n');
}

const browserControls = `
const pages = [...document.querySelectorAll('.slide')];
const counter = document.querySelector('#counter');
let active = 0;
function show(index) {
  active = Math.max(0, Math.min(index, pages.length - 1));
  pages.forEach((page, i) => { page.hidden = i !== active; });
  counter.textContent = (active + 1) + ' / ' + pages.length;
  document.querySelector('#previous').disabled = active === 0;
  document.querySelector('#next').disabled = active === pages.length - 1;
}
document.querySelector('#previous').onclick = () => show(active - 1);
document.querySelector('#next').onclick = () => show(active + 1);
document.querySelector('#print').onclick = () => window.print();
document.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft') show(active - 1);
  if (event.key === 'ArrowRight') show(active + 1);
});
document.querySelector('#download').onclick = async () => {
  const feedback = document.querySelector('#download-status');
  const xml = new XMLSerializer().serializeToString(document.querySelector('#lesson-chart'));
  const svgUrl = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.src = svgUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 3840;
    canvas.height = 2160;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, 3840, 2160);
    const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('无法生成 PNG');
    const pngUrl = URL.createObjectURL(png);
    const anchor = document.createElement('a');
    anchor.href = pngUrl;
    anchor.download = 'lesson-chart-3840x2160.png';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(pngUrl), 60000);
    feedback.textContent = 'PNG 已生成';
  } catch {
    feedback.textContent = 'PNG 导出失败，可打开 lesson-chart.svg 使用原图。';
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
};
show(0);
`;

function renderFiles(record, kit) {
  const title = escapeMarkup(record.topic);
  const chart = chartSvg(kit.chart);
  const goal = escapeMarkup(kit.learning_goal);
  const guide = kit.lecturer_points.map((point) => `<li>${escapeMarkup(point)}</li>`).join('\n');
  const prompt = escapeMarkup(kit.exercise.prompt).replaceAll('\n', '<br>');
  const chartCaption = kit.chart.hypothetical_from
    ? `从第 ${kit.chart.hypothetical_from} 根起为课堂讨论的假设。`
    : '图中价量均为教学模拟。';
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root{font-family:Microsoft YaHei,system-ui,sans-serif;color:#19314b;background:#e8eef4}
body{margin:0}
.page{width:min(100% - 2rem,1080px);margin:1.2rem auto}
header{font-size:.77rem;letter-spacing:.1em;color:#425f7f;margin-bottom:.65rem}
.slide{box-sizing:border-box;background:#fff;border:1px solid #cbd7e3;border-radius:12px;padding:clamp(1rem,3.4vw,2.1rem);min-height:28rem}
h1{font-size:clamp(1.5rem,4vw,2.65rem);margin:.1em 0 .4em} h2{font-size:clamp(1.4rem,3.8vw,2.1rem);margin-top:.2rem}
p,li{font-size:clamp(1rem,2.3vw,1.46rem);line-height:1.55}
li+li{margin-top:.85rem}
figure{margin:.8rem 0 0} figure svg{display:block;width:100%;height:auto}
figcaption{color:#425f7f;font-size:.9rem}
.controls{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;padding:.85rem 0}
button{font:inherit;background:#fff;color:#19314b;border:1px solid #a0b3c8;border-radius:7px;padding:.55rem .78rem;cursor:pointer}
button:disabled{opacity:.45;cursor:default} #counter,#download-status{font-size:.92rem;color:#425f7f}
@media print{body{background:#fff}.page{width:100%;margin:0}.controls{display:none}.slide,.slide[hidden]{display:block;break-after:page;min-height:auto;border:0;border-radius:0}.slide:last-of-type{break-after:auto}figure{break-inside:avoid}}
</style>
</head>
<body><main class="page">
<header>ELLERY WESTCOTT · 教学模拟</header>
<section class="slide"><h1>${title}</h1><p>${goal}</p><figure>${chart}<figcaption>${chartCaption}</figcaption></figure></section>
<section class="slide"><h2>讲解要点</h2><ol>${guide}</ol></section>
<section class="slide"><h2>课后练习</h2><p>${prompt}</p></section>
<nav class="controls" aria-label="课件操作"><button id="previous">上一页</button><span id="counter" aria-live="polite"></span><button id="next">下一页</button><button id="download">下载 4K 图</button><button id="print">打印 / PDF</button><span id="download-status" role="status"></span></nav>
</main><script>${browserControls}</script></body></html>`;
  const teacher = [
    `# ${record.topic}｜讲师提纲`, '',
    `课程日期（罗马尼亚时间） ${record.date}`, `来源定稿 ${record.id}`, '',
    '## 学习目标', '', kit.learning_goal, '',
    '## 讲解顺序', '', ...kit.lecturer_points.map((point, index) => `${index + 1}. ${point}`), '',
    '## 图表说明', '', chartCaption, '课件中的价格和成交量均为模拟数据。', '',
    '## 练习参考', '', kit.exercise.answer || '由讲师根据课堂实际讨论核对。', '',
    '## 课程衔接', '', record.growth_step, '',
  ];
  if (record.next_question) teacher.push(`后续问题：${record.next_question}`, '');
  const exercise = [`# ${record.topic}｜课后练习`, '', '本练习使用教学模拟图。', '',
    kit.exercise.prompt, '', '请用自己的话写下观察依据和判断条件。', ''].join('\n');
  return {
    'lesson.html': html,
    'lesson-chart.svg': chart,
    'teacher-notes.md': teacher.join('\n'),
    'exercise.md': exercise,
  };
}

async function verifyFiles(directory, files) {
  const dir = await lstat(directory);
  if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Error('Lesson kit path is not a regular directory.');
  for (const [name, content] of Object.entries(files)) {
    const file = join(directory, name);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== Buffer.byteLength(content)
      || await readFile(file, 'utf8') !== content) {
      throw new Error(`An existing lesson file was modified: ${name}. Keep it and request a revised kit.`);
    }
  }
}

export function createLessonKit({ text, schema, getRecord, checkState, state }) {
  const price = numberField(0.000001, 1000000000);
  const candle = schema({ open: price, high: price, low: price, close: price,
    volume: { type: 'integer', minimum: 0, maximum: 1000000000000 } },
  ['open', 'high', 'low', 'close', 'volume']);
  const definition = {
    name: 'build_lesson_kit',
    description: 'Generate a local HTML deck, SVG teaching chart, teacher outline and student exercise from a saved adopted lesson. Chart inputs are simulated OHLCV. Mark any hypothetical candles explicitly.',
    inputSchema: schema({
      adopted_id: { ...text(44), pattern: '^adopted-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$' },
      learning_goal: text(500),
      lecturer_points: { type: 'array', items: text(420), minItems: 1, maxItems: 6 },
      exercise: schema({ prompt: text(1400), answer: text(1800) }, ['prompt']),
      chart: schema({
        title: text(60), level: price,
        hypothetical_from: { type: 'integer', minimum: 2, maximum: 60 },
        candles: { type: 'array', items: candle, minItems: 4, maxItems: 60 },
      }, ['title', 'candles']),
    }, ['adopted_id', 'learning_goal', 'lecturer_points', 'exercise', 'chart']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  };

  async function buildLessonKit(kit) {
    const record = await getRecord(kit.adopted_id);
    if (record.kind !== 'adopted') throw new Error('Choose an adopted lesson record.');
    validateChart(kit.chart);
    const files = renderFiles(record, kit);
    const key = createHash('sha256').update(JSON.stringify([record.id, files])).digest('hex').slice(0, 16);
    await checkState(true);
    const parent = join(state, 'lesson-kits');
    await mkdir(parent, { recursive: true });
    const parentInfo = await lstat(parent);
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) throw new Error('Lesson kits parent must be a local directory.');
    const output = join(parent, `lesson-${record.date}-${key}`);
    let reused = true;
    try {
      await verifyFiles(output, files);
    } catch (error) {
      if (error.code !== 'ENOENT' || error.path !== output) throw error;
      const temporary = join(parent, `.creating-${randomUUID()}`);
      await mkdir(temporary);
      try {
        await Promise.all(Object.entries(files).map(([name, content]) =>
          writeFile(join(temporary, name), content, { encoding: 'utf8', flag: 'wx' })));
        try {
          await rename(temporary, output);
          reused = false;
        } catch (renameError) {
          if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(renameError.code)) throw renameError;
        }
        await verifyFiles(output, files);
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    }
    return { adopted_id: record.id, directory: output, reused,
      files: Object.keys(files).map((name) => ({ name, path: join(output, name) })) };
  }

  return { definitions: [definition], handlers: { build_lesson_kit: buildLessonKit } };
}
