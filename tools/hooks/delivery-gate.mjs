// 交稿把关（Stop hook）：本轮贴出剧本代码块时，核对校验工具的实际结果，而不只看是否调用。
// 第二次触发时警告并放行，避免工具不可用时形成死循环；内部异常仍按 fail-open 处理。
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
const FULL_SCENE_MIN_SPEECHES = 10;
const CODE_BLOCK = /```text\r?\n([\s\S]*?)\r?\n```/g;
const HARNESS_MESSAGE = /^(?:Stop hook feedback|<task-notification>|<side-sessions-event>|<ci-monitor-event>)/i;
const ROLE_LINE = /^(?:={3,}\s*\S.*?\s*={3,}|[^\s：:]{1,24}[：:])$/;

function parseLines(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* 忽略损坏行 */ }
  }
  return entries;
}

function promptText(entry) {
  const content = entry.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || content.some(block => block?.type === 'tool_result')) return null;
  const texts = content.filter(block => block?.type === 'text').map(block => block.text ?? '');
  return texts.length ? texts.join('\n') : null;
}

function isRealPrompt(entry) {
  if (entry.type !== 'user' || entry.isSidechain || entry.isMeta) return false;
  const text = promptText(entry);
  return text !== null && !HARNESS_MESSAGE.test(text.trim());
}

const normalize = text => text.replace(/\r/g, '').split('\n').map(line => line.trimEnd()).join('\n').trim();
export const countSpeeches = body => normalize(body).split('\n').filter(line => ROLE_LINE.test(line.trim())).length;

function resultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(block => block?.type === 'text').map(block => block.text ?? '').join('\n');
}

function parseToolJson(result) {
  if (!result?.ok) return null;
  try { return JSON.parse(result.text); } catch { return null; }
}

function passedValidation(call, result, delivered) {
  if (!call || !result?.ok) return false;
  if (typeof call.input.body !== 'string' || normalize(call.input.body) !== normalize(delivered)) return false;
  const report = parseToolJson(result);
  return report?.passed === true;
}

function resultFor(call, results) {
  return call?.id ? results.get(call.id) : null;
}

function conclusionPassed(result) {
  if (!result?.ok) return false;
  return result.text.split(/\r?\n/).some(line =>
    /^(?:审稿结论\s*[:：]\s*)?通过[。！!]?$/.test(line.trim()));
}

export function evaluate(entries, { stopHookActive = false } = {}) {
  let start = -1;
  for (let index = entries.length - 1; index >= 0; index--) {
    if (isRealPrompt(entries[index])) { start = index; break; }
  }
  if (start < 0) return { action: 'allow' };
  const prompt = promptText(entries[start]) ?? '';

  const calls = [];
  const results = new Map();
  const blocks = [];
  for (const entry of entries.slice(start + 1)) {
    if (entry.type === 'assistant' && !entry.isSidechain && Array.isArray(entry.message?.content)) {
      for (const item of entry.message.content) {
        if (item?.type === 'tool_use') calls.push({ id: item.id, name: item.name, input: item.input ?? {} });
        if (item?.type === 'text' && typeof item.text === 'string') {
          for (const match of item.text.matchAll(CODE_BLOCK)) blocks.push(match[1]);
        }
      }
    }
    if (entry.type === 'user' && !entry.isSidechain && Array.isArray(entry.message?.content)) {
      for (const item of entry.message.content) {
        if (item?.type !== 'tool_result' || !item.tool_use_id) continue;
        results.set(item.tool_use_id, {
          ok: item.is_error !== true && item.isError !== true,
          text: resultText(item.content),
        });
      }
    }
  }
  if (!blocks.length) return { action: 'allow' };
  if (SKIP_PROMPT.test(prompt) || calls.some(call => SKIP_TOOLS.has(call.name))) return { action: 'allow' };

  const delivered = blocks.at(-1);
  const missing = [];
  const findCalls = name => calls.filter(call => call.name === `${STATE}${name}`);
  const checkLatest = (name, label) => {
    const matching = findCalls(name);
    const latest = matching.at(-1);
    if (!latest) {
      missing.push(`未运行 ${name} 检查`);
      return;
    }
    const result = resultFor(latest, results);
    if (!result?.ok) {
      missing.push(`${name} 调用失败或没有返回结果`);
      return;
    }
    if (typeof latest.input.body !== 'string' || normalize(latest.input.body) !== normalize(delivered)) {
      missing.push(`${name} 校验的正文与最终贴出的正文不一致，需对最终版本复验`);
      return;
    }
    const report = parseToolJson(result);
    if (report?.passed !== true) missing.push(`${name} 未返回可确认的 passed: true 结果`);
    if (label === 'format' && latest.input.strict_layout !== true) {
      missing.push('validate_speech_format 未启用 strict_layout: true');
    }
  };

  checkLatest('validate_speech_format', 'format');
  checkLatest('validate_whatsapp_voice', 'voice');

  const speechCount = countSpeeches(delivered);
  if (speechCount >= FULL_SCENE_MIN_SPEECHES) {
    checkLatest('validate_scene_count', 'count');
    const writers = calls.filter(call => call.name === 'Agent' && call.input.subagent_type === 'westcott-writer');
    if (!writers.length) missing.push('群稿未由编剧 westcott-writer 动笔');
    else if (!resultFor(writers.at(-1), results)?.ok) missing.push('westcott-writer 没有成功返回稿件');
  }

  const editors = calls.filter(call => call.name === 'Agent' && call.input.subagent_type === 'westcott-editor');
  if (!editors.length) {
    missing.push('未调用 westcott-editor 独立审稿');
  } else {
    const review = resultFor(editors.at(-1), results);
    if (!review?.ok) missing.push('westcott-editor 调用失败或没有返回审稿结果');
    else if (!conclusionPassed(review)) missing.push('westcott-editor 未给出明确的「通过」结论');
  }

  if (!missing.length) return { action: 'allow' };
  const list = missing.map((item, index) => `${index + 1}. ${item}`).join('\n');
  if (stopHookActive) {
    return { action: 'warn', message: `交稿把关提醒：以下审稿或校验项未通过或无法确认，已按防死循环策略放行。\n${list}\n请在交付说明中标明未验项与稿件状态。` };
  }
  return {
    action: 'block',
    reason: `交稿把关：本轮贴出了剧本代码块，但以下审稿或校验项未通过或无法确认：\n${list}\n请补做后重新贴出通过的版本。若工具确实不可用，请在交付说明中标明未验项与稿件状态。`,
  };
}

function main() {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return; }
  if (!input.transcript_path) return;
  let entries;
  try { entries = parseLines(readFileSync(input.transcript_path, 'utf8')); } catch { return; }
  const result = evaluate(entries, { stopHookActive: Boolean(input.stop_hook_active) });
  if (result.action === 'block') process.stdout.write(JSON.stringify({ decision: 'block', reason: result.reason }));
  else if (result.action === 'warn') process.stdout.write(JSON.stringify({ systemMessage: result.message }));
}

const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
if (process.argv[1] && samePath(fileURLToPath(import.meta.url), process.argv[1])) {
  try { main(); } catch { /* 内部异常时放行，避免影响会话 */ }
}

export { parseLines };
