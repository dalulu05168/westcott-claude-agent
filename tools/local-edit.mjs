import { getBlocks } from './speech-format.mjs';

function sections(body) {
  const labels = getBlocks(body);
  if (!labels.length) return { preamble: '', blocks: [{ label: null, text: body }] };
  const lines = body.match(/[^\r\n\v\u2028\u2029]+(?:\r\n|[\r\n\v\u2028\u2029]|$)|\r\n|[\r\n\v\u2028\u2029]/gu);
  return {
    preamble: lines.slice(0, labels[0].line - 1).join(''),
    blocks: labels.map((block, index) => ({
      label: block.label,
      text: lines.slice(block.line - 1, labels[index + 1] ? labels[index + 1].line - 1 : lines.length).join(''),
    })),
  };
}

const numbers = (text) => text.match(/[+−-]?\d+(?:[.,]\d+)*(?:[ \u00a0]*[%‰])?/g) ?? [];

function validateLocalEdit({ original, revised, editable_blocks, allow_number_changes = false, protected_literals = [] }) {
  const before = sections(original);
  const after = sections(revised);
  const selected = new Set(editable_blocks ?? (before.blocks[0].label === null ? [1] : []));
  const issues = [];
  const report = (type, block, message) => issues.push({ type, block, message });
  if (selected.size === 0 || [...selected].some((position) => position > before.blocks.length)) {
    report('scope', null, '请按现有发言块次序指定要改的编号。');
    return { passed: false, checked_blocks: 0, issues };
  }
  if (before.preamble !== after.preamble) report('preamble', null, '原文开头或教学模拟标识已改变。');
  if (before.blocks.length !== after.blocks.length) {
    report('block_count', null, '原文的发言条数已改变。');
    return { passed: false, checked_blocks: 0, issues };
  }
  for (const [index, oldBlock] of before.blocks.entries()) {
    const position = index + 1;
    const newBlock = after.blocks[index];
    if (newBlock.label !== oldBlock.label) report('role', position, '角色标记或出场顺序已改变。');
    if (!selected.has(position)) {
      if (oldBlock.text !== newBlock.text) report('outside_scope', position, '指定范围之外的原文已改变。');
      continue;
    }
    if (!allow_number_changes && JSON.stringify(numbers(oldBlock.text)) !== JSON.stringify(numbers(newBlock.text))) {
      report('number', position, '数字或百分比与原文不一致。');
    }
    for (const literal of new Set(protected_literals)) {
      if (oldBlock.text.split(literal).length !== newBlock.text.split(literal).length) {
        report('literal', position, `原文指定保留的内容已改变：${literal}`);
      }
    }
  }
  return { passed: issues.length === 0, checked_blocks: before.blocks.length, issues };
}

export function createLocalEditTool({ text, schema }) {
  const definition = {
    name: 'validate_local_edit',
    description: 'Check a short edit against the exact original excerpt. Pass both excerpts with the same unedited neighbors. Only the selected one-based message blocks may change. Role order and numeric text are preserved by default.',
    inputSchema: schema({
      original: text(20000), revised: text(20000),
      editable_blocks: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 100 }, minItems: 1, maxItems: 100 },
      allow_number_changes: { type: 'boolean' },
      protected_literals: { type: 'array', items: text(200), minItems: 0, maxItems: 20 },
    }, ['original', 'revised']),
    annotations: { readOnlyHint: true, openWorldHint: false },
  };
  return { definitions: [definition], handlers: { validate_local_edit: validateLocalEdit } };
}
