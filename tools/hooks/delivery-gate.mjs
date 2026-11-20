// 交稿把关（Stop hook）：本轮贴出剧本代码块时，核对 CLAUDE.md 要求的审稿与校验是否已在同一轮完成。
// 缺项时阻止结束并把缺项交回模型；同一轮第二次触发时放行，只向用户显示提醒，避免死循环。
// 任何内部错误一律放行，不影响正常会话。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATE = 'mcp__westcott-state__';
const SKIP_TOOLS = new Set([
  `${STATE}append_gold_sample`,
  `${STATE}preview_mobile_handoff`,
  `${STATE}import_mobile_handoff`,
]);
const SKIP_PROMPT = /只读|不用审|不审稿|免审|入库样稿/;
// 10 条及以上视为群稿片段，要求条数校验（上午写到 10:20 停点约 13 条）。
const FULL_SCENE_MIN_SPEECHES = 10;
const CODE_BLOCK = /```text\r?\n([\s\S]*?)\r?\n```/g;
const HARNESS_MESSAGE = /^(?:Stop hook feedback|<task-notification>|<side-sessions-event>|<ci-monitor-event>)/i;
const ROLE_LINE =/^(?:={3,}\s*\S.*?\s*={3,}|[^\s：:]{1,24}[：:])$/;

function parseLines(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* 跳过损坏行 */ }
  }
  return entries;
}

function promptText(entry) {
  const content = entry.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || content.some(b => b?.type === 'tool_result')) return null;
  const texts = content.filter(b => b?.type === 'text').map(b => b.text ?? '');
  return texts.length ? texts.join('\n') : null;
}

function isRealPrompt(entry) {
  if (entry.type !== 'user' || entry.isSidechain || entry.isMeta) return false;
  const text = promptText(entry);
  // 后台任务完成、跨会话事件等由宿主插入的消息不算新一轮。
  return text !== null && !HARNESS_MESSAGE.test(text.trim());
}

const normalize = s => s.replace(/\r/g, '').split('\n').map(l => l.trimEnd()).join('\n').trim();
export const countSpeeches = body => normalize(body).split('\n').filter(l => ROLE_LINE.test(l.trim())).length;

export function evaluate(entries, { stopHookActive = false } = {}) {
  let start = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isRealPrompt(entries[i])) { start = i; break; }
  }
  if (start < 0) return { action: 'allow' };
  const prompt = promptText(entries[start]) ?? '';

  const tools = [];
  const blocks = [];
  for (const entry of entries.slice(start + 1)) {
    if (entry.type !== 'assistant' || entry.isSidechain) continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type === 'tool_use') tools.push({ name: b.name, input: b.input ?? {} });
      if (b?.type === 'text' && typeof b.text === 'string') {
        for (const m of b.text.matchAll(CODE_BLOCK)) blocks.push(m[1]);
      }
    }
  }
  if (!blocks.length) return { action: 'allow' };
  if (SKIP_PROMPT.test(prompt) || tools.some(t => SKIP_TOOLS.has(t.name))) return { action: 'allow' };

  const delivered = blocks[blocks.length - 1];
  const called = name => tools.filter(t => t.name === `${STATE}${name}`);
  const missing = [];

  const formatCalls = called('validate_speech_format');
  if (!formatCalls.length) {
    missing.push('未对贴出的代码块运行 validate_speech_format（strict_layout: true）');
  } else {
    const last = formatCalls[formatCalls.length - 1].input;
    if (typeof last.body === 'string' && normalize(last.body) !== normalize(delivered)) {
      missing.push('贴出的代码块与最后一次 validate_speech_format 校验的正文不一致，需对实际贴出的版本复验');
    }
  }
  if (!called('validate_whatsapp_voice').length) missing.push('未运行 validate_whatsapp_voice 检查块内台词');
  if (countSpeeches(delivered) >= FULL_SCENE_MIN_SPEECHES && !called('validate_scene_count').length) {
    missing.push('10 条及以上的群稿未运行 validate_scene_count（节选须传 start、end）');
  }
  if (countSpeeches(delivered) >= FULL_SCENE_MIN_SPEECHES
    && !tools.some(t => t.name === 'Agent' && t.input.subagent_type === 'westcott-writer')) {
    missing.push('群稿未由编剧 westcott-writer 动笔，总导演不自己写整段台词');
  }
  const reviewed = tools.some(t => t.name === 'Agent' && t.input.subagent_type === 'westcott-editor');
  if (!reviewed) missing.push('未调用 westcott-editor 独立审稿');

  if (!missing.length) return { action: 'allow' };
  const list = missing.map((m, i) => `${i + 1}. ${m}`).join('\n');
  if (stopHookActive) {
    return {
      action: 'warn',
      message: `交稿把关提醒：本轮剧本仍有未完成的审稿或校验项，已放行。\n${list}\n若工具不可用，请确认稿外已说明未验项与稿件状态。`,
    };
  }
  return {
    action: 'block',
    reason: `交稿把关：本轮贴出了剧本代码块，但 CLAUDE.md 要求的以下步骤未在同一轮完成：\n${list}\n请补做后重新贴出通过的版本。若工具确实不可用，按项目规则完成自检，并在代码块后简短说明未验项与稿件状态。`,
  };
}

function main() {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return; }
  if (!input.transcript_path) return;
  let entries;
  try { entries = parseLines(readFileSync(input.transcript_path, 'utf8')); } catch { return; }
  const result = evaluate(entries, { stopHookActive: Boolean(input.stop_hook_active) });
  if (result.action === 'block') {
    process.stdout.write(JSON.stringify({ decision: 'block', reason: result.reason }));
  } else if (result.action === 'warn') {
    process.stdout.write(JSON.stringify({ systemMessage: result.message }));
  }
}

const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
if (process.argv[1] && samePath(fileURLToPath(import.meta.url), process.argv[1])) {
  try { main(); } catch { /* 放行 */ }
}

export { parseLines };
