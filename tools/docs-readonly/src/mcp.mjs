import { createInterface } from 'node:readline';
import { ReadError, readDocumentTail } from './transcript.mjs';

const name = 'get_last_speech';
const versions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const fields = ['document_title', 'tab_id', 'tab_title'];
const definition = {
  name,
  description: 'Read the last labelled speech from an allowlisted Google Docs tab. Return its role, exact final sentence and source URL.',
  inputSchema: {
    type: 'object',
    properties: Object.fromEntries(fields.map(field => [field, { type: 'string', minLength: 1, maxLength: 300 }])),
    required: fields,
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

function validArguments(args) {
  return args && typeof args === 'object' && Object.keys(args).length === fields.length
    && fields.every(field => typeof args[field] === 'string' && args[field].length >= 1
      && args[field].length <= 300);
}

export function createHandler({ source, getDocument, extraTools = [] }) {
  return async function handle(message) {
    const id = message?.id ?? null;
    const result = value => ({ jsonrpc: '2.0', id, result: value });
    const error = (code, details) => ({ jsonrpc: '2.0', id, error: { code, message: details } });
    if (message?.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return error(-32600, 'Invalid request.');
    }
    if (!Object.hasOwn(message, 'id')) return undefined;
    const { method, params } = message;
    switch (method) {
      case 'initialize': {
        const requested = params?.protocolVersion;
        return result({
          protocolVersion: versions.includes(requested) ? requested : versions[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'docs-readonly', version: '1.1.0' },
        });
      }
      case 'ping':
        return result({});
      case 'tools/list':
        return result({ tools: [definition, ...extraTools.map(tool => tool.definition)] });
      case 'tools/call': {
        const extra = extraTools.find(tool => tool.definition.name === params?.name);
        if (params?.name !== name && !extra) return error(-32602, 'Unknown tool.');
        if (extra) {
          try {
            const value = await extra.run(params.arguments);
            return result({ content: [{ type: 'text', text: JSON.stringify(value) }] });
          } catch (cause) {
            const details = cause instanceof ReadError
              ? { code: cause.code, message: cause.message }
              : { code: 'DOCS_OPERATION_FAILED', message: 'Google Docs 操作未获确认。' };
            return result({ isError: true, content: [{ type: 'text', text: JSON.stringify(details) }] });
          }
        }
        if (!validArguments(params.arguments)) return error(-32602, 'Invalid tool arguments.');
        const args = params.arguments;
        const content = value => [{ type: 'text', text: JSON.stringify(value) }];
        try {
          if (args.document_title !== source.document_title || !Object.hasOwn(source.tabs, args.tab_id)
            || args.tab_title !== source.tabs[args.tab_id]) {
            throw new ReadError('SOURCE_NOT_ALLOWED', '文档标题、日期页签或 tabId 不在本地许可范围内。');
          }
          const document = await getDocument(source.document_id);
          return result({ content: content(readDocumentTail(document, {
            ...args, document_id: source.document_id,
          })) });
        } catch (cause) {
          const details = cause instanceof ReadError
            ? { code: cause.code, message: cause.message }
            : { code: 'READ_FAILED', message: '未能读取并解析指定页签。' };
          return result({ isError: true, content: content(details) });
        }
      }
      default:
        return error(-32601, 'Method not found.');
    }
  };
}

export async function serve({ handle, input = process.stdin, output = process.stdout }) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      output.write(JSON.stringify({
        jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' },
      }) + '\n');
      continue;
    }
    const response = await handle(message);
    if (response) output.write(JSON.stringify(response) + '\n');
  }
}
