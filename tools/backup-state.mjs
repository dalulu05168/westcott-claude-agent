// 状态备份与恢复：把 .westcott-state 复制成带时间戳的快照，存到项目目录之外。
//
//   node tools/backup-state.mjs                 备份（内容未变化时跳过）
//   node tools/backup-state.mjs --list          列出快照
//   node tools/backup-state.mjs --restore latest          预览恢复
//   node tools/backup-state.mjs --restore <快照名> --yes   执行恢复（先自动备份当前状态）
//
// 备份目录默认 %LOCALAPPDATA%\Westcott\state-backups，可用环境变量 WESTCOTT_BACKUP_DIR
// 指向别处（例如 Google Drive 本地同步文件夹）。默认保留最近 60 份快照，另为最近 30 天每天留最后一份。
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PREFIX = 'state-';
const MANIFEST = 'manifest.json';
export const DEFAULT_KEEP = 60;
export const DAILY_DAYS = 30;

export function defaultPaths(env = process.env) {
  const project = env.CLAUDE_PROJECT_DIR || fileURLToPath(new URL('../', import.meta.url));
  const local = env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  return {
    stateDir: resolve(project, '.westcott-state'),
    backupDir: resolve(env.WESTCOTT_BACKUP_DIR || join(local, 'Westcott', 'state-backups')),
  };
}

const sha256 = data => createHash('sha256').update(data).digest('hex');

// 只备份已发布的记录文件，跳过写入中的临时文件和子目录。
function stateFiles(stateDir) {
  if (!existsSync(stateDir)) return [];
  return readdirSync(stateDir)
    .filter(name => !name.startsWith('temp-') && statSync(join(stateDir, name)).isFile())
    .sort();
}

function digest(dir, files) {
  const hashes = Object.fromEntries(files.map(name => [name, sha256(readFileSync(join(dir, name)))]));
  return { hashes, hash: sha256(JSON.stringify(hashes)) };
}

function stamp(now) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-');
}

export function listSnapshots(backupDir) {
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir)
    .filter(name => name.startsWith(PREFIX) && existsSync(join(backupDir, name, MANIFEST)))
    .sort()
    .map(name => ({ name, ...JSON.parse(readFileSync(join(backupDir, name, MANIFEST), 'utf8')) }));
}

export function backup({ stateDir, backupDir, keep = DEFAULT_KEEP, label = '', force = false, now = new Date() }) {
  const files = stateFiles(stateDir);
  if (!files.length) return { status: 'skipped', reason: '状态目录为空' };
  const { hashes, hash } = digest(stateDir, files);
  const latest = listSnapshots(backupDir).at(-1);
  if (!force && latest?.hash === hash) return { status: 'unchanged', name: latest.name };

  mkdirSync(backupDir, { recursive: true });
  let name = `${PREFIX}${stamp(now)}${label ? `-${label}` : ''}`;
  for (let i = 2; existsSync(join(backupDir, name)); i++) name = `${PREFIX}${stamp(now)}${label ? `-${label}` : ''}-${i}`;
  // 先写到临时目录，校验完整后再改名，避免留下半份快照。
  const temp = join(backupDir, `.tmp-${randomUUID()}`);
  mkdirSync(temp);
  try {
    for (const file of files) copyFileSync(join(stateDir, file), join(temp, file));
    if (digest(temp, files).hash !== hash) throw new Error('复制后的内容与状态目录不一致，可能有写入正在进行。');
    writeFileSync(join(temp, MANIFEST), JSON.stringify({
      created_at: now.toISOString(), source: stateDir, count: files.length, hash, files: hashes,
    }, null, 2) + '\n');
    renameSync(temp, join(backupDir, name));
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    throw error;
  }
  const pruned = prune(backupDir, keep, now);
  return { status: 'created', name, count: files.length, pruned };
}

// 保留最近 keep 份；另为最近 DAILY_DAYS 天每天保留最后一份，避免高频使用时只覆盖一两天。
function prune(backupDir, keep, now) {
  const snapshots = listSnapshots(backupDir);
  const kept = new Set(snapshots.slice(-keep).map(s => s.name));
  const cutoff = now.getTime() - DAILY_DAYS * 24 * 60 * 60 * 1000;
  const lastOfDay = new Map();
  for (const s of snapshots) {
    if (Date.parse(s.created_at) >= cutoff) lastOfDay.set(s.created_at.slice(0, 10), s.name);
  }
  for (const name of lastOfDay.values()) kept.add(name);
  const old = snapshots.filter(s => !kept.has(s.name));
  for (const s of old) rmSync(join(backupDir, s.name), { recursive: true, force: true });
  return old.map(s => s.name);
}

export function verifySnapshot(backupDir, name) {
  const dir = join(backupDir, name);
  const manifest = JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8'));
  const files = Object.keys(manifest.files).sort();
  for (const file of files) {
    if (!existsSync(join(dir, file))) throw new Error(`快照缺少文件：${file}`);
  }
  if (digest(dir, files).hash !== manifest.hash) throw new Error(`快照 ${name} 校验失败，文件已损坏或被改动。`);
  return { manifest, files };
}

export function restore({ stateDir, backupDir, name, keep = DEFAULT_KEEP, now = new Date() }) {
  const snapshots = listSnapshots(backupDir);
  const target = name === 'latest' ? snapshots.at(-1)?.name : name;
  if (!target || !snapshots.some(s => s.name === target)) throw new Error(`找不到快照：${name}`);
  const { files } = verifySnapshot(backupDir, target);
  // 恢复前先保存当前状态，误恢复时还能退回。
  const safety = backup({ stateDir, backupDir, keep: keep + 1, label: 'pre-restore', force: true, now });
  mkdirSync(stateDir, { recursive: true });
  for (const file of stateFiles(stateDir)) rmSync(join(stateDir, file));
  for (const file of files) copyFileSync(join(backupDir, target, file), join(stateDir, file));
  if (digest(stateDir, stateFiles(stateDir)).hash !== digest(join(backupDir, target), files).hash) {
    throw new Error('恢复后的状态目录与快照不一致，请勿继续写入，并检查备份目录。');
  }
  return { restored: target, count: files.length, safety: safety.name ?? null };
}

function main(argv) {
  const { stateDir, backupDir } = defaultPaths();
  const quiet = argv.includes('--quiet');
  const at = argv.indexOf('--restore');
  if (argv.includes('--list')) {
    const snapshots = listSnapshots(backupDir);
    console.log(`备份目录：${backupDir}`);
    if (!snapshots.length) console.log('还没有快照。');
    for (const s of snapshots) console.log(`${s.name}  ${s.count} 个文件  ${s.created_at}`);
    return;
  }
  if (at >= 0) {
    const name = argv[at + 1];
    if (!name || name.startsWith('--')) throw new Error('请指定快照名或 latest。');
    if (!argv.includes('--yes')) {
      const target = name === 'latest' ? listSnapshots(backupDir).at(-1)?.name : name;
      if (!target) throw new Error(`找不到快照：${name}`);
      const { manifest } = verifySnapshot(backupDir, target);
      console.log(`将用快照 ${target}（${manifest.count} 个文件，${manifest.created_at}）替换 ${stateDir}。`);
      console.log('当前状态会先另存为 pre-restore 快照。请先关闭正在运行的 Westcott 会话，再加 --yes 执行。');
      return;
    }
    const r = restore({ stateDir, backupDir, name });
    console.log(`已恢复 ${r.restored}（${r.count} 个文件）。恢复前的状态另存为 ${r.safety ?? '（原状态为空，未另存）'}。`);
    return;
  }
  const r = backup({ stateDir, backupDir });
  if (quiet) return;
  if (r.status === 'created') console.log(`已备份 ${r.count} 个文件到 ${join(backupDir, r.name)}`);
  else if (r.status === 'unchanged') console.log(`状态没有变化，最新快照仍是 ${r.name}`);
  else console.log(`未备份：${r.reason}`);
}

const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
if (process.argv[1] && samePath(fileURLToPath(import.meta.url), process.argv[1])) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`状态备份失败：${error.message}`);
    process.exitCode = 1;
  }
}
