import { readFileSync } from 'node:fs';

function readOpenCc(name) {
  const rows = readFileSync(new URL(`./opencc/${name}.txt`, import.meta.url), 'utf8');
  return rows.split(/\r?\n/u).filter((row) => row && !row.startsWith('#')).map((row) => {
    const [original, targets] = row.split('\t');
    return [original, targets.split(' ').includes(original)];
  });
}

const characters = new Map(readOpenCc('TSCharacters'));
const phrases = new Map(readOpenCc('TSPhrases'));
const longestPhrase = Math.max(...[...phrases.keys()].map((phrase) => phrase.length));
const han = /\p{Script=Han}/u;
const url = /https?:\/\/[^\s<>()]+/giu;
const snippets = /\p{Script=Latin}[\p{Script=Latin}\p{M}\d]*(?:[.'’_/-][\p{Script=Latin}\p{M}\d]+)*(?:[ \t]+\p{Script=Latin}[\p{Script=Latin}\p{M}\d]*(?:[.'’_/-][\p{Script=Latin}\p{M}\d]+)*)*/gu;
const languageWord = /^(?:ok|okay|yes|no|hi|hello|bye|thank|thanks|done|pass|passed|fail|failed|success|ready|please|sorry|sure|nice|completed|updated|verified|approved|denied|blocked|pending|working|warning|error|normal|păi|mda|gata|deci|serios)$/iu;
const sentenceWords = /^(?:a|an|and|are|but|for|has|have|here|how|is|it|of|on|that|the|this|to|was|we|were|what|will|with|you|your)$/iu;
const financeToken = /^(?:[A-Z][A-Z0-9]{0,11}(?:[.-][A-Z0-9]{1,8})*|p\/e|e-?bitda|m\/a)$/u;
const projectToken = /^(?:mcp__[-_\w]+|westcott-[-\w]+|validate_\w+|[\w.-]+\.(?:md|mjs|json|cmd|exe))$/iu;
const names = /^(?:ELLERY WESTCOTT|David(?: Miller)?|Gabriela(?: Ion)?|Ana Maria|Claude Code|Claude Agent SDK|Google Drive|Google Docs|CloudCLI|WhatsApp|PowerShell|OpenCC|MCP|SDK|OAuth)$/iu;
const namePart = /^(?:\p{Lu}[\p{L}\p{M}.'’\-]+|and|for|of|the)$/u;
const codeFence = /^\s*(?:```(?:text)?|~~~(?:text)?)\s*$/u;

function traditionalForm(text) {
  for (let offset = 0; offset < text.length;) {
    let phrase;
    for (let end = Math.min(text.length, offset + longestPhrase); end > offset + 1; end -= 1) {
      const candidate = text.slice(offset, end);
      if (phrases.has(candidate)) {
        phrase = candidate;
        break;
      }
    }
    if (phrase) {
      if (!phrases.get(phrase)) return phrase;
      offset += phrase.length;
      continue;
    }
    const char = String.fromCodePoint(text.codePointAt(offset));
    if (characters.get(char) === false) return char;
    offset += char.length;
  }
  return undefined;
}

function foreignProse(line) {
  for (const match of line.matchAll(snippets)) {
    const phrase = match[0];
    if (names.test(phrase)) continue;
    const words = phrase.split(/\s+/u);
    if (words.length === 1) {
      if (languageWord.test(phrase)) return phrase;
      if (projectToken.test(phrase) || financeToken.test(phrase)) continue;
      if (!han.test(line) && /^\p{Ll}+(?:['’]\p{Ll}+)?$/u.test(phrase)) return phrase;
      continue;
    }
    if (words.some((word) => languageWord.test(word))) return phrase;
    if (words.every((word) => !sentenceWords.test(word) && (financeToken.test(word) || projectToken.test(word)))) continue;
    if (han.test(line) && words.every((word) => namePart.test(word))) continue;
    if (words.some((word) => sentenceWords.test(word)) || !han.test(line)
      || words.some((word) => /^\p{Ll}{2,}$/u.test(word))) return phrase;
  }
  return undefined;
}

export function scriptLanguageIssues(lines) {
  const issues = [];
  for (const [index, rawLine] of lines.entries()) {
    if (codeFence.test(rawLine)) continue;
    const line = rawLine.normalize('NFKC').replace(url, '').replace(/[\u200b-\u200d\u2060\ufeff]/gu, '');
    const traditional = traditionalForm(line);
    if (traditional) issues.push({ line: index + 1, role: '', severity: 'block', type: 'traditional_chinese',
      message: '用户可见内容必须使用简体中文。请改为对应简体写法。', term: traditional });
    const foreign = foreignProse(line);
    if (foreign) issues.push({ line: index + 1, role: '', severity: 'block', type: 'language',
      message: '汇报和台词使用简体中文。正式人名、代码及必要的专业缩写可保留。', term: foreign });
  }
  return issues;
}
