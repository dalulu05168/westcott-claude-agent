export const revisionField = { type: 'integer', minimum: 0, maximum: 999998 };

export function latestSnapshotIds(ids, pattern, matches) {
  const latest = new Map();
  for (const id of ids) {
    const match = pattern.exec(id);
    if (!match || !matches(match)) continue;
    const key = id.slice(0, -7);
    if (!latest.has(key) || id > latest.get(key)) latest.set(key, id);
  }
  return [...latest.values()];
}

export function createRevisionStore({ listIds, readEntry, insertRecord }) {
  async function readSnapshot(id, kind) {
    const entry = await readEntry(id);
    if (!entry || entry.kind !== kind || entry.revision !== Number(id.slice(-6))) {
      throw new Error(`Cannot read the ${kind} record: ${id}`);
    }
    return entry;
  }

  async function saveSnapshot(prefix, kind, expected, data) {
    const current = (await listIds()).filter((id) => id.startsWith(`${prefix}-`)
      && /^\d{6}$/.test(id.slice(prefix.length + 1))).sort().at(-1);
    if ((current ? Number(current.slice(-6)) : 0) !== expected) {
      throw new Error('Revision changed. Read the latest record before saving.');
    }
    if (current) await readSnapshot(current, kind);
    const revision = expected + 1;
    const id = `${prefix}-${String(revision).padStart(6, '0')}`;
    try {
      return await insertRecord({ ...data, id, kind, revision, recorded_at: new Date().toISOString() });
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error('Revision changed. Read the latest record before saving.');
      throw error;
    }
  }

  return { readSnapshot, saveSnapshot };
}
