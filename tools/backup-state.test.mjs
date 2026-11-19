// 状态备份脚本的回归测试：node tools/backup-state.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backup, listSnapshots, restore, verifySnapshot } from './backup-state.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`ok - ${name}`); };
const root = mkdtempSync(join(tmpdir(), 'westcott-backup-'));
const stateDir = join(root, 'project', '.westcott-state');
const backupDir = join(root, 'backups');
const at = s => new Date(Date.UTC(2026, 10, 19, 8, 0, s));
const put = (name, value) => writeFileSync(join(stateDir, name), JSON.stringify(value));

try {
  t('状态目录不存在或为空时跳过', () => {
    assert.equal(backup({ stateDir, backupDir, now: at(0) }).status, 'skipped');
    mkdirSync(stateDir, { recursive: true });
    assert.equal(backup({ stateDir, backupDir, now: at(0) }).status, 'skipped');
    assert.equal(existsSync(backupDir), false);
  });

  t('首次备份复制全部记录并跳过临时文件', () => {
    put('agenda-000001.json', { revision: 1 });
    put('scene-2026-11-19-afternoon-000001.json', { body: '14男：\n跌了' });
    writeFileSync(join(stateDir, 'temp-abc'), 'partial');
    const r = backup({ stateDir, backupDir, now: at(1) });
    assert.equal(r.status, 'created');
    assert.equal(r.count, 2);
    const files = readdirSync(join(backupDir, r.name)).sort();
    assert.deepEqual(files, ['agenda-000001.json', 'manifest.json', 'scene-2026-11-19-afternoon-000001.json']);
  });

  t('内容未变化时不重复备份', () => {
    const r = backup({ stateDir, backupDir, now: at(2) });
    assert.equal(r.status, 'unchanged');
    assert.equal(listSnapshots(backupDir).length, 1);
  });

  t('内容变化后生成新快照', () => {
    put('handoff-2026-11-19-morning.json', { items: [] });
    assert.equal(backup({ stateDir, backupDir, now: at(3) }).status, 'created');
    assert.equal(listSnapshots(backupDir).length, 2);
  });

  t('超出保留数量时删除最旧的快照', () => {
    for (let i = 0; i < 4; i++) {
      put(`draft-00000${i}.json`, { i });
      backup({ stateDir, backupDir, keep: 3, now: at(10 + i) });
    }
    const names = listSnapshots(backupDir).map(s => s.name);
    assert.equal(names.length, 3);
    assert.ok(names.every(name => name > 'state-20261119-080003Z'));
  });

  t('快照被改动时校验失败', () => {
    const name = listSnapshots(backupDir).at(-1).name;
    const file = join(backupDir, name, 'agenda-000001.json');
    const original = readFileSync(file);
    writeFileSync(file, '{"revision":999}');
    assert.throws(() => verifySnapshot(backupDir, name), /校验失败/);
    writeFileSync(file, original);
    assert.doesNotThrow(() => verifySnapshot(backupDir, name));
  });

  t('恢复会先另存当前状态，再完整替换', () => {
    const target = listSnapshots(backupDir)[0].name;
    const expected = Object.keys(listSnapshots(backupDir)[0].files).sort();
    put('mistake.json', { wrong: true });
    const r = restore({ stateDir, backupDir, name: target, keep: 3, now: at(30) });
    assert.equal(r.restored, target);
    assert.match(r.safety, /pre-restore/);
    assert.deepEqual(readdirSync(stateDir).filter(f => !f.startsWith('temp-')).sort(), expected);
    assert.ok(existsSync(join(backupDir, r.safety, 'mistake.json')));
  });

  t('恢复 latest 与找不到快照时报错', () => {
    assert.doesNotThrow(() => restore({ stateDir, backupDir, name: 'latest', now: at(40) }));
    assert.throws(() => restore({ stateDir, backupDir, name: 'state-nope' }), /找不到快照/);
  });

  t('命令行：备份、列表、恢复预览不改动状态', () => {
    const script = fileURLToPath(new URL('./backup-state.mjs', import.meta.url));
    const env = { ...process.env, CLAUDE_PROJECT_DIR: join(root, 'project'), WESTCOTT_BACKUP_DIR: backupDir };
    const run = (...args) => spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });
    put('cli.json', { cli: true });
    const created = run();
    assert.equal(created.status, 0, created.stderr);
    assert.match(created.stdout, /已备份/);
    assert.equal(run('--quiet').stdout, '');
    assert.match(run('--list').stdout, /state-/);
    const before = readdirSync(stateDir).sort();
    const preview = run('--restore', 'latest');
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /--yes/);
    assert.deepEqual(readdirSync(stateDir).sort(), before);
    const bad = run('--restore');
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /快照名/);
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`PASS: backup-state ${n} 项`);
