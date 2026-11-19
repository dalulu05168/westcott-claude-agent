export class ReadError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function* walkTabs(tabs = []) {
  for (const tab of tabs) {
    yield tab;
    yield* walkTabs(tab.childTabs);
  }
}

export function* readParagraphs(content) {
  for (const item of content) {
    if (item.paragraph) {
      yield item.paragraph.elements.map(element => element.textRun?.content ?? '').join('');
    } else if (item.table) {
      for (const row of item.table.tableRows) {
        for (const cell of row.tableCells) yield* readParagraphs(cell.content);
      }
    }
  }
}

const sentenceSegmenter = new Intl.Segmenter('zh', { granularity: 'sentence' });
const masterLabel = /^={3,}\s*([^=]+?)\s*={3,}\s*(.*)$/u;
const memberLabel = /^(\d{1,3}\s*[男女])\s*[:：]\s*(.*)$/u;
const attachmentLine = /^(?:配图\s*[:：]|https?:\/\/\S+$)/iu;

export function extractLastSpeech(paragraphs) {
  let role = '';
  let lastLine = '';
  for (const paragraph of paragraphs) {
    for (const rawLine of paragraph.split(/\r\n|[\r\n\v\u2028\u2029]/u)) {
      const line = rawLine.trim();
      const label = masterLabel.exec(line) ?? memberLabel.exec(line);
      const speech = label ? label[2].trim() : line;
      if (label) {
        role = label[1].trim();
        lastLine = '';
      }
      if (role && speech && !attachmentLine.test(speech)) lastLine = speech;
    }
  }

  if (!role || !lastLine) {
    throw new ReadError('SPEECH_UNCLEAR', '指定页签的最后一条带标记发言缺少可核对的正文。');
  }
  const sentences = Array.from(sentenceSegmenter.segment(lastLine));
  // Keep trailing punctuation or emoji that belongs to the last substantive sentence.
  const lastText = sentences.findLast(sentence => /[\p{L}\p{N}]/u.test(sentence.segment));
  return { role, last_sentence: lastLine.slice(lastText?.index ?? 0).trim() };
}

export function checkedTab(document, { document_id, document_title, tab_id, tab_title }) {
  if (document?.documentId !== document_id || document.title !== document_title) {
    throw new ReadError('DOCUMENT_MISMATCH', '返回的文档 ID 或标题与请求不一致。');
  }
  const matchingTabs = [...walkTabs(document.tabs)]
    .filter(tab => tab.tabProperties?.tabId === tab_id);
  if (matchingTabs.length !== 1) {
    throw new ReadError('TAB_NOT_FOUND', '无法唯一定位指定 tabId。');
  }
  const [tab] = matchingTabs;
  if (tab_title != null && tab.tabProperties.title !== tab_title) {
    throw new ReadError('TAB_MISMATCH', '指定 tabId 的实际页签标题与请求不一致。');
  }
  const content = tab.documentTab?.body?.content;
  if (!Array.isArray(content)) {
    throw new ReadError('TAB_BODY_MISSING', 'Google Docs 没有返回指定页签的正文。');
  }
  return tab;
}

export function readDocumentTail(document, args) {
  const tab = checkedTab(document, args);
  const { document_id, tab_id, tab_title } = args;
  return {
    ...extractLastSpeech(readParagraphs(tab.documentTab.body.content)),
    tab_id,
    tab_title,
    source_url: `https://docs.google.com/document/d/${document_id}/edit?tab=${tab_id}`,
  };
}
