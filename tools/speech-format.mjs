import { publicWebUrl } from './news-image.mjs';
import { allowedMemberField, allowedStaffField, sceneRoleIssues, sceneScopeField, sessionNames, simulationMarker } from './scene-rules.mjs';

const assistantLabel = '===== 资讯助理 =====';
const teacherLabel = '===== David先生 =====';
const rolePattern = /^(={3,}\s*([^=]+?)\s*={3,})(?:[ \t]*(\S.*))?$/u;
const teacherName = /^(?:David(?:\s*Miller)?(?:\s*(?:先生|老[师師]))?|大[卫衛](?:\s*(?:先生|老[师師]))?|先生|老[师師]|教[师師]|[讲講][师師]|teacher)$/iu;
const teacherPrefix = /^([^：:]{1,32}[：:])\s*(.*)$/u;
const memberPattern = /^((\d{1,3})\s*([男女])(?:\s+[\p{Script=Latin}][\p{Script=Latin}\p{M} .'-]{0,30})?\s*[:：])\s*(.*)$/u;
const headlinePattern = /^(\p{Regional_Indicator}{2}|🌍)[ \t]+([^｜|\n]{1,24})财经新闻｜(\S[^\n]*)$/u;
const newsLike = /^(?:\p{Regional_Indicator}{2}\s*)?[^｜|\n]{0,24}财经(?:新闻|资讯快报|快报)[｜|]/u;
const countryFlags = { '🇷🇴': '罗马尼亚', '🇺🇸': '美国', '🌍': '国际' };
// 找不到已核事件图时，配图行写「待补」占位，稿外列出待补清单。
const pendingImage = '待补';
export const pictureFooter = /^配图[：:]\s*(\S+)$/;
export const transcriptBreak = /\r\n|[\r\n\v\u2028\u2029]/u;

export function getBlocks(body) {
  const blocks = [];
  let current;
  const lines = body.split(transcriptBreak);
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    const actor = rolePattern.exec(trimmed);
    const member = memberPattern.exec(trimmed);
    const prefix = !actor && !member ? teacherPrefix.exec(trimmed) : null;
    const teacher = prefix && teacherName.test(prefix[1].slice(0, -1).trim()) ? prefix : null;
    if (actor || member || teacher) {
      const name = actor?.[2].trim();
      let role = member ? 'member' : 'other';
      if (['资讯助理', '助理'].includes(name)) role = 'assistant';
      if (teacher || (name && (name.endsWith('先生') || teacherName.test(name)))) role = 'teacher';
      if (['Gabriela', 'Gabriela顾问', '顾问Gabriela', '投资顾问'].includes(name?.replaceAll(' ', ''))) role = 'adviser';
      const inline = member?.[4] || actor?.[3] || teacher?.[2];
      current = { role, label: member?.[1] ?? actor?.[1] ?? teacher[1], line: index + 1, lines: inline ? [inline] : [],
        ...(member ? { member_id: member[2], gender: member[3] } : {}) };
      blocks.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return blocks;
}

function splitParagraphs(lines) {
  return lines.join('\n').trim().split(/\n[ \t]*\n(?:[ \t]*\n)*/).map((chunk) => chunk.trim()).filter(Boolean);
}

const closingLine = /(?:感谢大家.{0,35}(?:参与|交流)|(?:上午|下午|今晚|今天).{0,15}(?:先到这里|到这里|先聊到这里)|我们(?:下午|晚上|明天|下次)见|各位晚安|祝大家.{0,12}(?:愉快|晚安))/u;
const sentenceEnd = /[。！？!?]+/u;
const openGreeting = { morning: '早上', afternoon: '下午', evening: '晚上' };
const taskWords = /作业|课后练习|练习题|课后观察任务/u;
const submitTask = /(?:明天|课后|下课后|下次课前).{0,30}(?:提交|交给|发给|上传|打卡)|(?:请|需要|必须|记得).{0,12}(?:提交|上传|打卡)|(?:把|将).{0,20}(?:交给|发给)\s*(?:顾问\s*)?Gabriela/iu;
const noTask = /(?:今晚|今天|本课)?(?:不|无需|不用|没有)(?:再|另)?(?:布置|安排|提交|交|留)?(?:课后练习|练习题|作业|打卡|观察任务)/gu;

function validateSceneSpeech(blocks, { body, session, date, scope, close, strict_layout }, issues) {
  if (!blocks.length) issues.push({ line: 1, message: '找不到带标记的发言。' });
  if (!strict_layout && blocks.some((block) => block.role === 'member')
    && body.trimStart().split(transcriptBreak)[0] !== simulationMarker) {
    issues.push({ line: 1, message: `新编编号对话首行请保留「${simulationMarker}」。` });
  }
  if (scope === 'full') {
    const first = blocks[0];
    const greeting = `大家${openGreeting[session]}好！欢迎回到 ELLERY WESTCOTT 社群！`;
    const firstLine = first?.lines.find((line) => line.trim())?.trim() ?? '';
    if (first?.role !== 'assistant' || !firstLine.replace(/^[\p{Extended_Pictographic}\ufe0f\s]+/u, '').startsWith(greeting)) {
      issues.push({ line: first?.line ?? 1, message: `整场由资讯助理开群，开场首句用「${greeting}」。` });
    }
  }
  if (close === 'required') {
    const last = blocks.at(-1);
    const text = last?.lines.join(' ').trim() ?? '';
    if (last?.role !== 'assistant' || !closingLine.test(text)
      || text.split(sentenceEnd).filter((sentence) => /[\p{L}\p{N}]/u.test(sentence)).length !== 3) {
      issues.push({ line: last?.line ?? 1, message: '闭群由资讯助理在最后一条完成，按感谢、承接或课程要点、祝福再见写三句。' });
    }
  } else if (close === 'forbidden') {
    for (const block of blocks.filter(({ role, lines }) => role === 'assistant' && lines.some((line) => closingLine.test(line)))) {
      issues.push({ line: block.line, message: '当前停点保留等待，先不闭群。' });
    }
  }
  const weekday = date && new Date(`${date}T00:00:00Z`).getUTCDay();
  for (const block of blocks) {
    const message = block.lines.join(' ');
    if (block.role === 'assistant' && /参与.{0,15}(?:获得|加|得)\s*[+＋]?\s*\d+\s*积分|答案\s*(?:是|为)\s*[A-D甲乙丙丁对错]/iu.test(message)) {
      issues.push({ line: block.line, message: '助理只公开题面、作答方式和提交对象，答案、积分留在群稿外。' });
    }
    if (block.role !== 'member' && session === 'evening' && [2, 4].includes(weekday)) {
      const positive = message.replace(noTask, '');
      if (taskWords.test(positive) || submitTask.test(positive)) {
        issues.push({ line: block.line, message: '周二、周四晚间不布置作业、课后观察提交或收件提醒。' });
      }
    }
  }
}

function validateSpeechFormat({ body, mode = 'mixed', expected_image_urls, expected_news, strict_layout = false,
  session, date, scope = 'partial', close, allowed_staff, allowed_member_ids }) {
  const blocks = getBlocks(body);
  const sourceLines = body.split(transcriptBreak);
  const issues = [];
  let newsCount = 0;
  let teacherCount = 0;

  function checkBlock(block, label, count, lines = block.lines) {
    if (block.label !== label) issues.push({ line: block.line, message: `发言标记应为「${label}」。` });
    if (!strict_layout && sourceLines[block.line - 1].trim() !== block.label) {
      issues.push({ line: block.line, message: '角色标记与正文必须分行。' });
    }
    const paragraphs = splitParagraphs(lines);
    if (paragraphs.length !== count) {
      issues.push({ line: block.line, message: `正文需 ${count} 段，当前为 ${paragraphs.length} 段。` });
    }
    return paragraphs;
  }

  if (strict_layout && !blocks.length && mode === 'mixed' && !session) {
    issues.push({ line: 1, message: '找不到带标记的发言。' });
  }
  if (strict_layout && blocks[0]?.line > 1) {
    issues.push({ line: 1, message: '正文首行直接写第一位角色，标题和模拟说明放在代码块外。' });
  }
  for (const [index, block] of blocks.entries()) {
    if (strict_layout) {
      if (sourceLines[block.line - 1].trim() !== block.label || !sourceLines[block.line]?.trim()
        || (index + 1 < blocks.length && blocks[index + 1].line === block.line + 1)) {
        issues.push({ line: block.line, message: '角色标记须独占一行，正文从紧接的下一行开始。' });
      }
      if (index > 0 && !sourceLines[block.line - 2].trim()) {
        issues.push({ line: block.line, message: '相邻发言之间直接换行，禁止空行。' });
      }
    }
    if (mode === 'mixed' && session && block.role !== 'member') {
      const staffLabel = { assistant: assistantLabel, teacher: teacherLabel, adviser: '===== Gabriela =====' }[block.role];
      if (staffLabel && block.role !== 'teacher' && block.label !== staffLabel) {
        issues.push({ line: block.line, message: `发言标记应为「${staffLabel}」。` });
      }
    }
    const isNews = mode !== 'teacher' && block.role === 'assistant'
      && (mode === 'news' || block.lines.some((line) => newsLike.test(line.trim())));
    if (isNews) {
      newsCount += 1;
      const lines = block.lines.join('\n').trimEnd().split('\n');
      const footer = pictureFooter.exec(lines.at(-1)?.trim() || '');
      const pending = footer?.[1] === pendingImage;
      const image = footer && !pending && publicWebUrl(footer[1]);
      if (!image && !pending) {
        issues.push({ line: block.line, message: '新闻下方需要一行「配图：」加可打开的事件图片直链；暂时没有已核图片时写「配图：待补」。' });
      }
      if (expected_image_urls && image !== publicWebUrl(expected_image_urls[newsCount - 1])) {
        issues.push({ line: block.line, message: '新闻下方的配图链接与该条已核图片不一致。' });
      }
      const [title = ''] = checkBlock(block, assistantLabel, 3, footer ? lines.slice(0, -1) : lines);
      const match = headlinePattern.exec(title);
      if (!match) {
        issues.push({ line: block.line, message: '首段用一行「国旗 国家财经新闻｜具体事件标题」。' });
      } else if (countryFlags[match[1]] && countryFlags[match[1]] !== match[2].trim()) {
        issues.push({ line: block.line, message: '标题的国旗与国家不一致。' });
      }
      const expected = expected_news?.[newsCount - 1];
      if (expected_news && (!expected || !match || match[2].trim() !== expected.country
        || match[3].trim() !== expected.title || image !== publicWebUrl(expected.image_url))) {
        issues.push({ line: block.line, message: '该条新闻的顺序、国家、标题或配图与已核条目不一致。' });
      }
    } else if (mode !== 'news' && block.role === 'teacher') {
      teacherCount += 1;
      checkBlock(block, teacherLabel, 2);
    }

  }

  if (session) {
    issues.push(...sceneRoleIssues(blocks, { session, scope, allowed_staff, allowed_member_ids }));
    if (mode === 'mixed') validateSceneSpeech(blocks, { body, session, date, scope, close, strict_layout }, issues);
  }
  if (mode === 'news' && newsCount === 0) issues.push({ line: 1, message: '找不到资讯助理发言标记。' });
  if (expected_image_urls && expected_image_urls.length !== newsCount) {
    issues.push({ line: 1, message: '已核配图数与新闻条数不一致。' });
  }
  if (expected_news && expected_news.length !== newsCount) {
    issues.push({ line: 1, message: '成稿新闻条数与已核条目数不一致。' });
  }
  if (mode === 'teacher' && teacherCount === 0) issues.push({ line: 1, message: '找不到 David 先生发言标记。' });
  return { passed: issues.length === 0, news_count: newsCount, teacher_count: teacherCount, issues };
}

export function createSpeechFormatTool({ text, schema, dateField, validateDate }) {
  const definition = {
    name: 'validate_speech_format',
    description: 'Check role labels and paragraphs. Use strict_layout for final scripts and pass body without the Markdown fence. Pass session, date, scope and relevant close for group scripts. Pass allowed_staff or allowed_member_ids only for explicit exceptions. For verified news pass expected_news.',
    inputSchema: schema({
      body: text(160000),
      strict_layout: { type: 'boolean' },
      mode: { type: 'string', enum: ['news', 'teacher', 'mixed'], maxLength: 15 },
      session: { type: 'string', enum: Object.keys(sessionNames), maxLength: 15 },
      date: dateField, scope: sceneScopeField, allowed_staff: allowedStaffField,
      allowed_member_ids: allowedMemberField,
      close: { type: 'string', enum: ['required', 'forbidden'], maxLength: 15 },
      expected_image_urls: { type: 'array', items: text(2000), minItems: 0, maxItems: 40 },
      expected_news: { type: 'array', items: schema({ country: text(24), title: text(300), image_url: text(2000) },
        ['country', 'title', 'image_url']), minItems: 0, maxItems: 40 },
    }, ['body']),
    annotations: { readOnlyHint: true, openWorldHint: false },
  };
  return { definitions: [definition], handlers: { validate_speech_format(args) {
    if (args.date) validateDate(args.date);
    return validateSpeechFormat(args);
  } } };
}
