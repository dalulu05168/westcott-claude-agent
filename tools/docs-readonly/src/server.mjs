import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createDocsClient } from './google-docs.mjs';
import { createHandler, serve } from './mcp.mjs';
import { createExtraTools, readSavedRecord } from './publish.mjs';

const source = JSON.parse(await readFile(new URL('../source.json', import.meta.url), 'utf8'));
const client = createDocsClient({ credentialPath: process.env.DOCS_READONLY_CREDENTIALS });
const recordReader = id => readSavedRecord(fileURLToPath(new URL('../../course-state.mjs', import.meta.url)), id);
const extraTools = createExtraTools({ source, client, recordReader });
await serve({ handle: createHandler({ source, getDocument: client.getDocument, extraTools }) });
