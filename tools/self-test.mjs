import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = mkdtempSync(join(tmpdir(), 'westcott-mcp-'));
const server = fileURLToPath(new URL('./course-state.mjs', import.meta.url));
const request = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });
const call = (id, name, args) => request(id, 'tools/call', { name, arguments: args });

function run(messages) {
  const run = spawnSync(process.execPath, [server], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: project },
    input: messages.map((message) => JSON.stringify(message)).join('\n') + '\n',
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(run.status, 0, run.stderr || String(run.error || 'Process failed'));
  assert.equal(run.stderr, '');
  return run.stdout.trim().split('\n').map((line) => JSON.parse(line));
}

function decode(response) {
  assert.equal(response.result.isError, undefined, response.result.content?.[0]?.text);
  return JSON.parse(response.result.content[0].text);
}

try {
  const draftText = { date: '2026-11-17', topic: '箱体', growth_step: '观察机构线索',
    next_question: '为什么要跟踪机构？', body: '教学模拟：先看价量。', source: '模拟课件' };
  const results = run([
    request(1, 'initialize', { protocolVersion: '2025-06-18' }),
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    request(2, 'tools/list'),
    call(3, 'list_records', {}),
    call(4, 'save_draft', draftText),
    call(5, 'list_records', {}),
    call(6, 'save_draft', { ...draftText, date: '2026-02-30' }),
    call(7, 'read_record', { id: '../CLAUDE.md' }),
  ]);
  assert.equal(results.length, 7);
  assert.equal(results[0].result.protocolVersion, '2025-06-18');
  assert.equal(results[0].result.serverInfo.version, '1.7.2');
  assert.deepEqual(results[1].result.tools.map((tool) => tool.name),
    ['list_records', 'read_record', 'get_agenda', 'save_agenda', 'save_draft', 'record_adoption',
      'complete_lesson', 'get_scene_checkpoint', 'save_scene_checkpoint', 'append_gold_sample',
      'get_handoff', 'save_handoff', 'get_fact_checks', 'save_fact_check',
      'preview_mobile_handoff', 'import_mobile_handoff',
      'get_cast_context', 'save_member_profile', 'save_member_activity', 'build_lesson_kit', 'validate_speech_format',
      'validate_whatsapp_voice', 'validate_news_broadcast', 'validate_scene_count',
      'validate_local_edit', 'plan_market_open']);
  assert.deepEqual(decode(results[2]).records, []);
  const { id } = decode(results[3]);
  assert.deepEqual(decode(results[4]).records, []);
  assert.equal(results[5].result.isError, true);
  assert.equal(results[6].result.isError, true);

  {
  const loopDate = '2026-10-31';
  const publishedNews = { key: loopDate + '-published', category: 'published', summary: '已发测试新闻',
    status: 'completed', source: '模拟明确发送记录', news_published_at: loopDate + 'T09:15:00+02:00' };
  const morningFinal = { date: loopDate, session: 'morning', expected_revision: 0, track: 'final',
    body: '29男：\n跳空了，下午再看？', coverage: 'partial', status: 'closed', node: '定稿',
    unresolved: ['跳空后还有没有量'], source: { ref: '隔离验收模拟' }, confirmation: '通过审稿的模拟定稿',
    summary: '留下跳空后的观察问题', planned_news: ['待发测试新闻'],
    hooks: [{ speaker: '29男：', quote: '跳空了，下午再看？', target: 'afternoon', question: '量能有没有跟上？' }] };
  const [, invalidHook, savedMorning, oldRevision, readMorning] = run([
    call(1, 'save_handoff', { date: loopDate, session: 'morning', expected_revision: 0, items: [publishedNews] }),
    call(2, 'save_scene_checkpoint', { ...morningFinal, hooks: [{ ...morningFinal.hooks[0], quote: '并不存在的台词' }] }),
    call(3, 'save_scene_checkpoint', morningFinal),
    call(4, 'save_scene_checkpoint', morningFinal),
    call(5, 'get_scene_checkpoint', { date: loopDate, session: 'morning', include_body: true }),
  ]);
  assert.equal(invalidHook.result.isError, true);
  assert.equal(oldRevision.result.isError, true);
  assert.equal(decode(savedMorning).final.summary, morningFinal.summary);
  const readBackMorning = decode(readMorning);
  assert.equal(readBackMorning.adopted, null);
  assert.equal(readBackMorning.sent, null);
  assert.equal(readBackMorning.final.body, morningFinal.body);
  assert.deepEqual(readBackMorning.final.hooks, morningFinal.hooks);
  assert.deepEqual(readBackMorning.final.planned_news, morningFinal.planned_news);
  assert.equal(readBackMorning.final.published_news[0].summary, publishedNews.summary);
  const afternoonFinal = { ...morningFinal, session: 'afternoon', body: '29男：\n量跟上了，可站稳了吗？',
    hooks: [{ speaker: '29男：', quote: '量跟上了，可站稳了吗？', target: 'evening', question: '如何判断站稳？' }] };
  const [savedAfternoon, readAfternoon] = run([
    call(1, 'save_scene_checkpoint', afternoonFinal),
    call(2, 'get_scene_checkpoint', { date: loopDate, session: 'afternoon' }),
  ]);
  assert.deepEqual(decode(savedAfternoon).final.published_news, []);
  assert.deepEqual(decode(readAfternoon).final.hooks, afternoonFinal.hooks);

  mkdirSync(join(project, 'reference'));
  const samplePath = join(project, 'reference', 'gold-samples.md');
  writeFileSync(samplePath, '# 已有样稿\n', 'utf8');
  const sample = { date: loopDate, body: '29男：还没看到。\n35女：\n我等一下。' };
  const [added, repeated, malformed] = run([
    call(1, 'append_gold_sample', sample), call(2, 'append_gold_sample', sample),
    call(3, 'append_gold_sample', { ...sample, body: '没有角色。' }),
  ]);
  assert.equal(decode(added).messages, 2);
  assert.equal(decode(repeated).unchanged, true);
  assert.equal(malformed.result.isError, true);
  const library = readFileSync(samplePath, 'utf8');
  assert.ok(library.startsWith('# 已有样稿\n'));
  assert.equal(library.split('29男：\n还没看到。\n35女：\n我等一下。').length, 2);
  }

  const adoption = run([
    call(1, 'read_record', { id }),
    call(2, 'record_adoption', { id, approval: '我采用这版。' }),
    call(3, 'record_adoption', { id, approval: '再次提交同一版。' }),
    call(4, 'list_records', {}),
  ]);
  assert.equal(decode(adoption[0]).body, draftText.body);
  const adopted = decode(adoption[1]);
  assert.deepEqual(decode(adoption[2]), adopted);
  assert.equal(decode(adoption[3]).records.length, 1);
  const [first, second, third] = run([
    call(1, 'read_record', { id: adopted.id }),
    call(2, 'read_record', { id }),
    call(3, 'list_records', { kind: 'all' }),
  ]);
  assert.equal(decode(first).approval, '我采用这版。');
  assert.equal(decode(first).next_question, draftText.next_question);
  assert.equal(decode(second).kind, 'draft');
  assert.equal(decode(third).records.length, 2);
  const phase = { id: 'lesson-trial', title: '测试用阶段', goal: '从识别机构线索到理解观察目的' };
  const formation = { id: 'chart-shape', course: '形态课', goal: '讲回踩时同步带出观察机构交易线索',
    leave_for_later: '为什么要跟踪机构，留给下一场投资理念课', scheduled_date: '2026-11-18' };
  const philosophy = { id: 'why-observe', course: '投资理念课', goal: '回答为什么要跟踪机构',
    leave_for_later: '具体用哪些资料追踪，后续安排确定后再讲', scheduled_date: '2026-11-19' };
  const agenda = { expected_revision: 0, phase, source: '测试任务线', tasks: [formation, philosophy] };
  const [beforePlan, badOrder, plan, stale] = run([
    call(1, 'get_agenda', {}),
    call(2, 'save_agenda', { ...agenda, tasks: [philosophy, formation] }),
    call(3, 'save_agenda', agenda),
    call(4, 'save_agenda', agenda),
  ]);
  assert.equal(decode(beforePlan).latest_adopted_lesson, null);
  assert.equal(decode(beforePlan).next_task, null);
  assert.equal(badOrder.result.isError, true);
  assert.equal(decode(plan).revision, 1);
  assert.equal(decode(plan).next_task.id, formation.id);
  assert.equal(stale.result.isError, true);

  const linked = (task) => ({ ...draftText, date: task.scheduled_date, topic: task.course,
    growth_step: task.goal, phase_id: phase.id, task_id: task.id });
  const fifthCandleLine = '第五根收回来以后，先看它能不能站得住。';
  const eveningScene = { date: formation.scheduled_date, session: 'evening' };
  const [badDate, secondDraft, firstDraft, completeFirstDraft, afterDraft] = run([
    call(1, 'save_draft', { ...linked(formation), date: philosophy.scheduled_date }),
    call(2, 'save_draft', linked(philosophy)),
    call(3, 'save_draft', { ...linked(formation), ...eveningScene,
      body: '===== David先生 =====\n\n' + fifthCandleLine }),
    call(4, 'save_draft', { ...linked(formation), lesson_scope: 'full_lesson' }),
    call(5, 'get_agenda', {}),
  ]);
  assert.equal(badDate.result.isError, true);
  assert.equal(decode(afterDraft).next_task.id, formation.id);
  const [tooEarly, adoptSection, afterSection] = run([
    call(1, 'record_adoption', { id: decode(secondDraft).id, approval: '测试采用。' }),
    call(2, 'record_adoption', { id: decode(firstDraft).id, approval: '测试采用。' }),
    call(3, 'get_agenda', {}),
  ]);
  assert.equal(tooEarly.result.isError, true);
  assert.equal(decode(afterSection).next_task.id, formation.id);
  assert.equal(decode(afterSection).latest_adopted_lesson, null);
  const [savedCandle] = run([call(1, 'save_scene_checkpoint', { ...eveningScene, expected_revision: 0,
    track: 'adopted', adopted_record_id: decode(adoptSection).id, status: 'in_progress', node: '课堂读图中段',
    unresolved: [draftText.next_question], source: { ref: '模拟科目' }, confirmation: '只确认第五根 K 线的片段。' })]);
  assert.equal(decode(savedCandle).adopted.last_spoken_line, fifthCandleLine);
  const [resumedCandle, cursorAgenda] = run([
    call(1, 'get_scene_checkpoint', eveningScene),
    call(2, 'get_agenda', {}),
  ]);
  assert.equal(decode(resumedCandle).adopted.last_spoken_line, fifthCandleLine);
  assert.deepEqual(decode(resumedCandle).adopted.unresolved, [draftText.next_question]);
  assert.equal(decode(cursorAgenda).next_task.id, formation.id);
  const [invalidCompletion, adoptFirst, beforeCompletion] = run([
    call(1, 'complete_lesson', { id: decode(adoptSection).id, confirmation: '模拟误把中段当作整课。' }),
    call(2, 'record_adoption', { id: decode(completeFirstDraft).id, approval: '测试采用完整稿。' }),
    call(3, 'get_agenda', {}),
  ]);
  assert.match(invalidCompletion.result.content[0].text, /full_lesson/);
  assert.equal(decode(beforeCompletion).next_task.id, formation.id);
  const finishFirst = { id: decode(adoptFirst).id, confirmation: '模拟用户确认第一课完整结束。' };
  const [completion, repeatedCompletion, next] = run([
    call(1, 'complete_lesson', finishFirst),
    call(2, 'complete_lesson', finishFirst),
    call(3, 'get_agenda', {}),
  ]);
  assert.equal(decode(completion).status, 'completed');
  assert.deepEqual(decode(repeatedCompletion), decode(completion));
  assert.equal(decode(next).tasks[0].adopted_record_id, decode(adoptFirst).id);
  assert.equal(decode(next).latest_adopted_lesson.id, decode(adoptFirst).id);
  assert.equal(decode(next).next_task.goal, '回答为什么要跟踪机构');
  assert.equal(decode(next).phase.id, phase.id);
  const [futureCheckpoint, futureAgenda] = run([
    call(1, 'get_scene_checkpoint', { date: philosophy.scheduled_date, session: 'evening' }),
    call(2, 'get_agenda', {}),
  ]);
  assert.equal(decode(futureCheckpoint).adopted, null);
  assert.equal(decode(futureAgenda).next_task.id, philosophy.id);

  const revisedPhilosophy = { ...philosophy, leave_for_later: '跟踪资料留到下一阶段' };
  const [planEdit, staleDraft, replacement] = run([
    call(1, 'save_agenda', { ...agenda, expected_revision: 1, tasks: [formation, revisedPhilosophy] }),
    call(2, 'record_adoption', { id: decode(secondDraft).id, approval: '测试采用。' }),
    call(3, 'save_draft', { ...linked(revisedPhilosophy), lesson_scope: 'full_lesson' }),
  ]);
  assert.equal(decode(planEdit).tasks[0].status, 'adopted');
  assert.equal(staleDraft.result.isError, true);
  const [adoptSecond, oldRecord] = run([
    call(1, 'record_adoption', { id: decode(replacement).id, approval: '测试采用。' }),
    call(2, 'read_record', { id: adopted.id }),
  ]);
  const [, done] = run([
    call(1, 'complete_lesson', { id: decode(adoptSecond).id, confirmation: '模拟用户确认第二课完成。' }),
    call(2, 'get_agenda', {}),
  ]);
  assert.equal(decode(done).tasks[1].adopted_record_id, decode(adoptSecond).id);
  assert.equal(decode(done).next_task, null);
  assert.equal(decode(done).phase.id, phase.id);
  assert.equal(decode(oldRecord).body, draftText.body);
  const plain = '有些人会先看看 BVB 的 1,25% 变化。';
  const beforeEdit = '【教学模拟】\r\n\r\n14男：我先看收盘。\r\n\r\n12男：' + plain + '\r\n\r\n37女：等确认了再看吧。';
  const revised = beforeEdit.replace(plain, '我想先看 BVB 的 1,25% 是怎么变的。');
  const edit = { original: beforeEdit, revised, editable_blocks: [2], protected_literals: ['BVB'] };
  const [precise, numberChanged, otherChanged, roleChanged, addedLine, plainEdit, deliberate, lostLiteral, invalidTarget] = run([
    call(1, 'validate_local_edit', edit),
    call(2, 'validate_local_edit', { ...edit, revised: revised.replace('1,25%', '2,15%') }),
    call(3, 'validate_local_edit', { ...edit, revised: revised.replace('等确认了再看吧。', '继续。') }),
    call(4, 'validate_local_edit', { ...edit, revised: revised.replace('12男：', '18男：') }),
    call(5, 'validate_local_edit', { ...edit, revised: revised + '\r\n\r\n37女：新增。' }),
    call(6, 'validate_local_edit', { original: plain, revised: '我先看 BVB 的 1,25%。' }),
    call(7, 'validate_local_edit', { ...edit, revised: revised.replace('1,25%', '2,15%'), allow_number_changes: true }),
    call(8, 'validate_local_edit', { ...edit, revised: revised.replace('BVB', 'BET') }),
    call(9, 'validate_local_edit', { ...edit, editable_blocks: [4] }),
  ]);
  for (const item of [precise, plainEdit, deliberate]) assert.equal(decode(item).passed, true);
  for (const [item, type] of [[numberChanged, 'number'], [otherChanged, 'outside_scope'], [roleChanged, 'role'],
    [addedLine, 'block_count'], [lostLiteral, 'literal'], [invalidTarget, 'scope']]) {
    assert.equal(decode(item).passed, false);
    assert.ok(decode(item).issues.some((issue) => issue.type === type));
  }
  const longBody = '教学示例'.repeat(1000) + '收盘才核对。';
  const [savedLong] = run([call(1, 'save_draft', { ...draftText, body: longBody })]);
  const [boundedRead] = run([call(1, 'read_record', { id: decode(savedLong).id, view: 'tail' })]);
  assert.equal(decode(boundedRead).body, undefined);
  assert.equal(decode(boundedRead).body_tail, longBody.slice(-3000));
  assert.equal(decode(boundedRead).more_before, true);
  const date = '2026-11-19';
  const scene = { date, session: 'afternoon' };
  const opening = '===== 资讯助理 =====\r\n\r\n下午好。';
  const waitingLine = '我先等那份材料。';
  const waitingBody = `【教学模拟】\r\n\r\n${opening}\r\n\r\n14男：\r\n${waitingLine}\r\n`;
  const checkpoint = { ...scene, expected_revision: 0, track: 'adopted', coverage: 'from_start', body: waitingBody,
    status: 'waiting', node: '等待美股推票材料', stop_after: '材料到之前停在此处',
    next_step: '材料到了再核对代码', unresolved: ['材料还没到'],
    source: { ref: '模拟正式文档', tab: '11 月 19 日下午', revision: 'r1' }, confirmation: '模拟用户确认采用以上两条。' };
  const [emptyScene, initialCheckpoint] = run([
    call(1, 'get_scene_checkpoint', scene),
    call(2, 'save_scene_checkpoint', checkpoint),
  ]);
  assert.equal(decode(emptyScene).revision, 0);
  assert.equal(decode(initialCheckpoint).revision, 1);
  assert.equal(decode(initialCheckpoint).sent, null);
  const [newWindow, sentCheckpoint, staleScene] = run([
    call(1, 'get_scene_checkpoint', scene),
    call(2, 'save_scene_checkpoint', { ...checkpoint, expected_revision: 1, track: 'sent', body: opening,
      status: 'in_progress', node: '已经开群', confirmation: '模拟用户只确认开场已实际发送。' }),
    call(3, 'save_scene_checkpoint', { ...checkpoint, expected_revision: 1 }),
  ]);
  const restored = decode(newWindow);
  assert.equal(restored.adopted.last_line, waitingLine);
  assert.equal(restored.adopted.last_speaker, '14男：');
  assert.equal(restored.adopted.completed_count, 2);
  assert.equal(restored.adopted.body, undefined);
  assert.equal(restored.adopted.node, '等待美股推票材料');
  assert.equal(restored.adopted.status, 'waiting');
  assert.equal(restored.adopted.stop_after, checkpoint.stop_after);
  assert.equal(restored.adopted.next_step, checkpoint.next_step);
  assert.deepEqual(restored.adopted.unresolved, checkpoint.unresolved);
  assert.deepEqual(restored.adopted.source, checkpoint.source);
  assert.equal(decode(sentCheckpoint).sent.completed_count, 1);
  assert.match(staleScene.result.content[0].text, /Revision changed/);
  const followOn = '12男：今天先不猜，我等确认。';
  const [malformedScene, appendedScene, reopenedScene, separateScene] = run([
    call(1, 'save_scene_checkpoint', { ...checkpoint, expected_revision: 2, body: '12男：' }),
    call(2, 'save_scene_checkpoint', { ...checkpoint, expected_revision: 2, mode: 'append', body: followOn }),
    call(3, 'get_scene_checkpoint', { ...scene, include_body: true }),
    call(4, 'get_scene_checkpoint', { ...scene, session: 'evening' }),
  ]);
  assert.equal(malformedScene.result.isError, true);
  assert.equal(decode(appendedScene).adopted.completed_count, 3);
  assert.equal(decode(reopenedScene).adopted.body, `${waitingBody}\n\n${followOn}`);
  assert.equal(decode(reopenedScene).sent.body, opening);
  assert.equal(decode(separateScene).revision, 0);
  const replacementSource = { ...checkpoint.source, revision: 'r2' };
  const replacementBody = waitingBody.replace(waitingLine, '我等新的材料。');
  const [stalePrefix, relabelledRev, replaced, staleAfterRebase] = run([
    call(1, 'save_scene_checkpoint', { ...checkpoint, expected_revision: 3, mode: 'append',
      body: followOn, source: replacementSource }),
    call(2, 'save_scene_checkpoint', { ...checkpoint, expected_revision: 3, body: undefined, source: replacementSource }),
    call(3, 'save_scene_checkpoint', { ...checkpoint, expected_revision: 3, body: replacementBody, source: replacementSource }),
    call(4, 'save_scene_checkpoint', { ...checkpoint, expected_revision: 4, mode: 'append', body: followOn }),
  ]);
  for (const result of [stalePrefix, relabelledRev, staleAfterRebase]) {
    assert.equal(result.result.isError, true);
    assert.match(result.result.content[0].text, /source revision changed/);
  }
  assert.equal(decode(replaced).adopted.completed_count, 2);
  assert.equal(decode(replaced).adopted.last_spoken_line, '我等新的材料。');
  assert.equal(decode(replaced).adopted.source.revision, replacementSource.revision);
  const markedSnippet = '37女：等那条正式消息再说。';
  const [snippetDraft] = run([call(1, 'save_draft', { ...draftText, ...scene, body: markedSnippet })]);
  const [snippetAdoption] = run([call(1, 'record_adoption',
    { id: decode(snippetDraft).id, approval: '模拟确认这条可以追加。' })]);
  const appendAdopted = { ...checkpoint, source: replacementSource, body: undefined,
    mode: 'append', adopted_record_id: decode(snippetAdoption).id };
  const [appendedOnce] = run([call(1, 'save_scene_checkpoint', { ...appendAdopted, expected_revision: 4 })]);
  const [retried, nextAppend, retryAfterMoreText] = run([
    call(1, 'save_scene_checkpoint', { ...appendAdopted, expected_revision: 5 }),
    call(2, 'save_scene_checkpoint', { ...checkpoint, source: replacementSource,
      expected_revision: 5, mode: 'append', body: followOn }),
    call(3, 'save_scene_checkpoint', { ...appendAdopted, expected_revision: 6 }),
  ]);
  assert.equal(decode(appendedOnce).adopted.completed_count, 3);
  assert.equal(decode(retried).revision, 5);
  assert.equal(decode(retried).unchanged, true);
  assert.equal(decode(nextAppend).adopted.completed_count, 4);
  assert.equal(decode(retryAfterMoreText).unchanged, true);
  assert.equal(decode(retryAfterMoreText).adopted.completed_count, 4);
  const [separatePublishedLine] = run([call(1, 'save_scene_checkpoint', { ...checkpoint, track: 'sent',
    expected_revision: 6, body: '===== 资讯助理 =====\n\n下一次公告是我们要继续看的。\n\n配图：https://example.com/news.jpg' })]);
  assert.equal(decode(separatePublishedLine).sent.last_line, '配图：https://example.com/news.jpg');
  assert.equal(decode(separatePublishedLine).sent.last_spoken_line, '下一次公告是我们要继续看的。');
  assert.equal(decode(separatePublishedLine).adopted.completed_count, 4);
  const published = { key: `${date}-bvb-news`, category: 'published', summary: '已发测试资讯',
    status: 'completed', source: '模拟确认' };
  const quiz = { key: `${date}-quiz`, category: 'quiz', summary: '等待 Gabriela 核对答案',
    status: 'open', source: '模拟确认' };
  const morning = { date, session: 'morning', expected_revision: 0, items: [published, quiz] };
  const exercise = { key: `${date}-exercise`, category: 'exercise', summary: '测试课后练习待反馈',
    status: 'open', source: '模拟确认' };
  const afternoon = { date, session: 'afternoon', expected_revision: 0,
    items: [{ ...quiz, status: 'completed', summary: '测试竞猜已核对' }, exercise] };
  const [morningWrite, afternoonWrite, staleHandoff, prematurePublication, morningView] = run([
    call(1, 'save_handoff', morning), call(2, 'save_handoff', afternoon),
    call(3, 'save_handoff', morning),
    call(4, 'save_handoff', { ...morning, expected_revision: 1, items: [{ ...published, status: 'open' }] }),
    call(5, 'get_handoff', { date, through_session: 'morning' }),
  ]);
  assert.equal(decode(morningWrite).revision, 1);
  assert.equal(decode(afternoonWrite).revision, 1);
  assert.equal(staleHandoff.result.isError, true);
  assert.equal(prematurePublication.result.isError, true);
  assert.equal(decode(morningView).today.length, 2);
  assert.equal(decode(morningView).today.find((item) => item.key === quiz.key).status, 'open');

  const [eveningView, tomorrow, noLookback] = run([
    call(1, 'get_handoff', { date }),
    call(2, 'get_handoff', { date: '2026-11-20', through_session: 'morning' }),
    call(3, 'get_handoff', { date: '2026-11-20', lookback_days: 0 }),
  ]);
  assert.equal(decode(eveningView).today.find((item) => item.key === quiz.key).status, 'completed');
  assert.equal(decode(eveningView).today.filter((item) => item.key === quiz.key).length, 1);
  assert.deepEqual(decode(tomorrow).carryover.map((item) => item.key), [exercise.key]);
  assert.deepEqual(decode(noLookback).carryover, []);

  const source = { publisher: '模拟来源', url: 'https://market.example/update',
    retrieved_at: `${date}T15:15:00+02:00`, published_at: `${date}T15:11:00+02:00` };
  const quote = { date, key: 'market-reading', market: 'us', session: 'premarket', expected_revision: 0,
    status: 'verified', claim: '模拟盘前报价', sources: [source], data_asof: `${date}T15:10:00+02:00` };
  const [quoteWrite, futuresWrite, noSource, noOffset, invalidUrl] = run([
    call(1, 'save_fact_check', quote),
    call(2, 'save_fact_check', { ...quote, session: 'futures', claim: '模拟期货报价' }),
    call(3, 'save_fact_check', { ...quote, key: 'no-source', sources: [] }),
    call(4, 'save_fact_check', { ...quote, key: 'no-offset', data_asof: `${date}T15:10:00` }),
    call(5, 'save_fact_check', { ...quote, key: 'invalid-url', sources: [{ ...source, url: 'file:///local' }] }),
  ]);
  assert.equal(decode(quoteWrite).revision, 1);
  assert.equal(decode(futuresWrite).revision, 1);
  assert.equal(noSource.result.isError, true);
  assert.equal(noOffset.result.isError, true);
  assert.equal(invalidUrl.result.isError, true);
  const corrected = { ...quote, expected_revision: 1, status: 'conflicting', note: '模拟来源之间存在差异' };
  const [beforeCorrection, conflict, staleFact, afterCorrection, futures, wrongDay, wrongMarket] = run([
    call(1, 'get_fact_checks', { date, market: 'us', session: 'premarket' }),
    call(2, 'save_fact_check', corrected),
    call(3, 'save_fact_check', corrected),
    call(4, 'get_fact_checks', { date, market: 'us', session: 'premarket' }),
    call(5, 'get_fact_checks', { date, market: 'us', session: 'futures' }),
    call(6, 'get_fact_checks', { date: '2026-11-20' }),
    call(7, 'get_fact_checks', { date, market: 'bvb' }),
  ]);
  assert.equal(decode(beforeCorrection).records[0].status, 'verified');
  assert.equal(decode(beforeCorrection).records[0].sources[0].published_at, source.published_at);
  assert.equal(decode(beforeCorrection).records[0].data_asof, quote.data_asof);
  assert.equal(decode(conflict).revision, 2);
  assert.equal(staleFact.result.isError, true);
  assert.equal(decode(afterCorrection).records.length, 1);
  assert.equal(decode(afterCorrection).records[0].status, 'conflicting');
  assert.equal(decode(futures).records[0].claim, '模拟期货报价');
  assert.equal(decode(wrongDay).total, 0);
  assert.equal(decode(wrongMarket).total, 0);
  assert.equal(decode(run([call(1, 'get_agenda', {})])[0]).next_task, null);
  const fullBody = '教学模拟。\n\n===== David先生 =====\n先看收盘。😊';
  const entry = (id, status, body) => [
    '<<< WESTCOTT HANDOFF >>>', `编号：${id}`, `日期：${date}`, '场次：晚间', `状态：${status}`,
    '标题：回踩课片段', '停点：先看收盘。😊', '下一步：继续解释观察线索的用途。',
    '<<< WESTCOTT BODY >>>', body, '<<< WESTCOTT END >>>',
  ].join('\n');
  const confirmed = entry('test-confirmed', '确认稿', fullBody);
  const working = entry('test-working', '草稿', '未确认内容');
  const handoffDoc = ['Westcott 手机交接箱', 'WESTCOTT-HANDOFF v1', confirmed, working].join('\n\n');
  const preview = (id, doc = handoffDoc) => ({ document_text: doc, ...(id ? { entry_id: id } : {}) });
  const [index, selected, draftPreview, duplicate, malformed] = run([
    call(1, 'preview_mobile_handoff', preview()),
    call(2, 'preview_mobile_handoff', preview('test-confirmed', handoffDoc.replaceAll('\n', '\r\n'))),
    call(3, 'preview_mobile_handoff', preview('test-working')),
    call(4, 'preview_mobile_handoff', preview(null, `${handoffDoc}\n${confirmed}`)),
    call(5, 'preview_mobile_handoff', preview(null, confirmed)),
  ]);
  assert.equal(decode(index).entries.length, 2);
  assert.equal(Object.hasOwn(decode(index).entries[0], 'body'), false);
  const selectedEntry = decode(selected).entry;
  assert.equal(selectedEntry.body, fullBody);
  assert.equal(duplicate.result.isError, true);
  assert.equal(malformed.result.isError, true);
  const importArgs = { ...preview(selectedEntry.id), fingerprint: selectedEntry.fingerprint };
  const [mobile, oldFingerprint, notConfirmed, missingPhase] = run([
    call(1, 'import_mobile_handoff', importArgs),
    call(2, 'import_mobile_handoff', { ...importArgs, document_text: handoffDoc.replace('先看收盘。😊', '先看量能。') }),
    call(3, 'import_mobile_handoff', { ...preview('test-working'), fingerprint: decode(draftPreview).entry.fingerprint }),
    call(4, 'import_mobile_handoff', { ...importArgs, phase_id: 'does-not-exist', task_id: 'fake-task' }),
  ]);
  assert.equal(decode(mobile).reused, false);
  assert.equal(oldFingerprint.result.isError, true);
  assert.equal(notConfirmed.result.isError, true);
  assert.equal(missingPhase.result.isError, true);
  const mobileId = decode(mobile).id;
  const [retry, localDraft, unchangedAgenda] = run([
    call(1, 'import_mobile_handoff', importArgs),
    call(2, 'read_record', { id: mobileId }),
    call(3, 'get_agenda', {}),
  ]);
  assert.deepEqual(decode(retry), { id: mobileId, kind: 'draft', reused: true });
  assert.equal(decode(localDraft).body, fullBody);
  assert.equal(decode(localDraft).mobile_handoff.stop, selectedEntry.stop);
  assert.deepEqual(decode(unchangedAgenda), decode(done));
  const [adoptMobile] = run([call(1, 'record_adoption', { id: mobileId, approval: '模拟认可手机中段。' })]);
  const mobilePoint = { date, session: 'evening', expected_revision: 0, track: 'adopted', status: 'in_progress',
    adopted_record_id: decode(adoptMobile).id, node: '课堂中段', unresolved: [],
    source: { ref: decode(selected).source, revision: selectedEntry.fingerprint }, confirmation: '模拟保存手机稿停点。' };
  const [wrongMobileScene, mobileScene, mobileStillPending] = run([
    call(1, 'save_scene_checkpoint', { ...mobilePoint, session: 'morning' }),
    call(2, 'save_scene_checkpoint', mobilePoint),
    call(3, 'complete_lesson', { id: decode(adoptMobile).id, confirmation: '模拟误把手机中段当整课。' }),
  ]);
  assert.equal(wrongMobileScene.result.isError, true);
  assert.equal(decode(mobileScene).adopted.last_line, selectedEntry.stop);
  assert.equal(decode(mobileScene).adopted.completed_count, null);
  assert.equal(decode(mobileScene).adopted.confirmed_count, 1);
  assert.equal(mobileStillPending.result.isError, true);
  const castSource = '模拟验收条目';
  const profile12 = { member_id: '12', expected_revision: 0, label: '12男', availability: 'active',
    voice: '通常用短句追问一个实际判断条件', sample_lines: ['那先看收盘？'], source: castSource };
  const profile51 = { ...profile12, member_id: '51', label: '51男', availability: 'archived' };
  const scriptQuestion = { member_id: '12', scope: 'script', key: 'close-condition', expected_revision: 0,
    date, session: 'evening', activity_type: 'question', status: 'open', summary: '下次先看收盘能否守住吗？', source: castSource };
  const [missingIdentity, saved12, saved51, labelMismatch, staleProfile, defaultRoster, fullRoster, noRelease] = run([
    call(1, 'save_member_activity', { ...scriptQuestion, member_id: '99' }),
    call(2, 'save_member_profile', profile12),
    call(3, 'save_member_profile', profile51),
    call(4, 'save_member_profile', { ...profile12, member_id: '37' }),
    call(5, 'save_member_profile', profile12),
    call(6, 'get_cast_context', { as_of: date }),
    call(7, 'get_cast_context', { as_of: date, include_inactive: true }),
    call(8, 'save_member_profile', { ...profile51, availability: 'active', expected_revision: 1 }),
  ]);
  assert.equal(missingIdentity.result.isError, true);
  assert.equal(decode(saved12).revision, 1);
  assert.equal(decode(saved51).availability, 'archived');
  assert.equal(labelMismatch.result.isError, true);
  assert.equal(staleProfile.result.isError, true);
  assert.equal(decode(defaultRoster).members.length, 50);
  assert.equal(decode(defaultRoster).staff.find((member) => member.label === 'David先生').name, 'David Miller');
  assert.equal(decode(fullRoster).members.length, 65);
  assert.equal(decode(fullRoster).members.find(({ profile }) => profile.member_id === '51').profile.availability, 'archived');
  assert.equal(noRelease.result.isError, true);
  const [shortlist, focusedCast] = run([
    call(1, 'get_cast_context', { as_of: date, detail: 'selection' }),
    call(2, 'get_cast_context', { as_of: date, detail: 'focused', member_ids: ['12'] }),
  ]);
  assert.equal(decode(shortlist).members.length, decode(defaultRoster).members.length);
  assert.equal(decode(shortlist).members[11].profile.voice, undefined);
  assert.ok(JSON.stringify(decode(shortlist)).length < JSON.stringify(decode(defaultRoster)).length);
  assert.deepEqual(decode(focusedCast).members.map(({ profile }) => profile.member_id), ['12']);
  assert.equal(decode(focusedCast).members[0].profile.voice, profile12.voice);
  assert.deepEqual(decode(focusedCast).script_roles.map(({ id }) => id),
    ['intuitive_retail', 'rule_explainer', 'detail_recaller']);
  assert.deepEqual(decode(shortlist).script_roles, decode(focusedCast).script_roles);
  assert.equal(decode(focusedCast).members[0].profile.script_role, undefined);
  const liveQuestion = { ...scriptQuestion, scope: 'live', summary: '真实反馈路径的测试内容' };
  const appearance = { ...scriptQuestion, key: 'shape-scene', activity_type: 'appearance',
    status: undefined, summary: '形态课发言' };
  const progress = { ...appearance, key: 'shape-progress', activity_type: 'progress', summary: '已经能先观察收盘' };
  const [saveQuestion, saveLive, saveAppearance, saveProgress, invalidStatus, preEvening] = run([
    call(1, 'save_member_activity', scriptQuestion), call(2, 'save_member_activity', liveQuestion),
    call(3, 'save_member_activity', appearance), call(4, 'save_member_activity', progress),
    call(5, 'save_member_activity', { ...appearance, status: 'open' }),
    call(6, 'get_cast_context', { as_of: date, through_session: 'afternoon', member_ids: ['12'] }),
  ]);
  for (const response of [saveQuestion, saveLive, saveAppearance, saveProgress]) assert.equal(decode(response).revision, 1);
  assert.equal(invalidStatus.result.isError, true);
  assert.equal(decode(preEvening).members[0].last_appearance, null);
  const followingDay = '2026-11-20';
  const resolution = { ...scriptQuestion, date: followingDay, session: 'morning', expected_revision: 1,
    status: 'resolved', summary: 'David 解释何时重新评估突破位' };
  const [resolveQuestion, wrongDate, oldView, nextScene, liveOnly, specificProfile] = run([
    call(1, 'save_member_activity', resolution),
    call(2, 'save_member_activity', { ...scriptQuestion, expected_revision: 2 }),
    call(3, 'get_cast_context', { as_of: date, member_ids: ['12'] }),
    call(4, 'get_cast_context', { as_of: followingDay, through_session: 'morning', member_ids: ['12'] }),
    call(5, 'get_cast_context', { as_of: followingDay, scope: 'live', member_ids: ['12'] }),
    call(6, 'get_cast_context', { as_of: date, member_ids: ['51', '99'] }),
  ]);
  assert.equal(decode(resolveQuestion).revision, 2);
  assert.equal(wrongDate.result.isError, true);
  const scriptOld = decode(oldView).members[0];
  assert.equal(scriptOld.questions[0].status, 'open');
  assert.equal(scriptOld.questions[0].latest_revision, 2);
  assert.equal(scriptOld.last_appearance.summary, appearance.summary);
  assert.equal(scriptOld.latest_progress.summary, progress.summary);
  assert.equal(decode(nextScene).members[0].questions[0].status, 'resolved');
  assert.equal(decode(liveOnly).members[0].questions[0].summary, liveQuestion.summary);
  assert.equal(decode(liveOnly).members[0].last_appearance, null);
  assert.equal(decode(liveOnly).script_roles, undefined);
  assert.equal(decode(specificProfile).members[0].profile.availability, 'archived');
  assert.deepEqual(decode(specificProfile).missing_member_ids, ['99']);
  const candles = [
    { open: 97, high: 101, low: 96, close: 100, volume: 150 },
    { open: 100, high: 105, low: 99, close: 104, volume: 260 },
    { open: 103, high: 104, low: 100, close: 101, volume: 125 },
    { open: 101, high: 102, low: 96, close: 97, volume: 300 },
    { open: 97.5, high: 103, low: 97, close: 101.5, volume: 320 },
  ];
  const kit = { adopted_id: adopted.id, learning_goal: '学会给回踩判断写反证。',
    lecturer_points: ['标记关键位。', '观察第四根 < 100 之后怎么更新判断。'],
    exercise: { prompt: '假设第五根重新站回，接下来你还要看到什么？', answer: '讲师专用测试答案' },
    chart: { title: '回踩课堂示意图', level: 100, candles, hypothetical_from: 5 } };
  const [badDraft, badCandle, badScenario, lesson, repeatLesson] = run([
    call(1, 'build_lesson_kit', { ...kit, adopted_id: id }),
    call(2, 'build_lesson_kit', { ...kit, chart: { ...kit.chart, candles: [{ ...candles[0], low: 99 }, ...candles.slice(1)] } }),
    call(3, 'build_lesson_kit', { ...kit, chart: { ...kit.chart, hypothetical_from: 6 } }),
    call(4, 'build_lesson_kit', kit), call(5, 'build_lesson_kit', kit),
  ]);
  assert.equal(badDraft.result.isError, true);
  assert.equal(badCandle.result.isError, true);
  assert.equal(badScenario.result.isError, true);
  const output = decode(lesson);
  assert.equal(output.reused, false);
  assert.deepEqual(decode(repeatLesson), { ...output, reused: true });
  assert.equal(output.files.length, 4);
  const assets = Object.fromEntries(output.files.map(({ name, path }) => [name, readFileSync(path, 'utf8')]));
  assert.match(assets['lesson-chart.svg'], /data-candle="4" data-scenario="example"/);
  assert.match(assets['lesson-chart.svg'], /data-candle="5" data-scenario="hypothetical"/);
  assert.match(assets['lesson-chart.svg'], /绿涨、红跌、灰平盘/);
  assert.match(assets['lesson.html'], /第四根 &lt; 100/);
  assert.match(assets['lesson.html'], /lesson-chart-3840x2160\.png/);
  assert.equal(assets['lesson.html'].includes(kit.exercise.answer), false);
  assert.equal(assets['exercise.md'].includes(kit.exercise.answer), false);
  assert.equal(assets['teacher-notes.md'].includes(kit.exercise.answer), true);
  const formatReference = readFileSync(new URL('../reference/speech-format.md', import.meta.url), 'utf8');
  const [newsExample, teacher] = [...formatReference.matchAll(/^~~~text\n([\s\S]*?)\n~~~$/gm)].map((match) => match[1]);
  const newsImage = 'https://cdn.example.com/events/market.jpg';
  const newsPage = 'https://example.com/market-event';
  const news = newsExample.replace('<已核实的事件配图直链>', newsImage);
  assert.ok(news && teacher);
  const opener = '===== 资讯助理 =====\n\n🌤 大家早上好！';
  const closer = '===== 资讯助理 =====\n\n上午就先聊到这里，我们下午见。';
  const mixed = [opener, news, '12男：\n那图上还要看什么？', teacher, closer].join('\n\n');
  const [newsResult, teacherResult, mixedResult, splitNews, splitTeacher, wrongCountry, oldNews, inlineTeacher,
    missingPicture, wrongPicture, legacyGap] = run([
    call(1, 'validate_speech_format', { body: news, mode: 'news', expected_image_urls: [newsImage] }),
    call(2, 'validate_speech_format', { body: teacher, mode: 'teacher' }),
    call(3, 'validate_speech_format', { body: mixed }),
    call(4, 'validate_speech_format', { body: news.replace('\n\n对罗马尼亚', '\n\n===== 资讯助理 =====\n\n对罗马尼亚') }),
    call(5, 'validate_speech_format', { body: teacher.replace('\n\n所以，', '\n\n===== David先生 =====\n\n所以，') }),
    call(6, 'validate_speech_format', { body: news.replace('🇺🇸', '🇷🇴'), mode: 'news' }),
    call(7, 'validate_speech_format', { body: news.replace('财经新闻｜', '财经资讯快报｜') }),
    call(8, 'validate_speech_format', { body: teacher.replace('\n', ' '), mode: 'teacher' }),
    call(9, 'validate_speech_format', { body: news.split('\n\n配图：')[0], mode: 'news' }),
    call(10, 'validate_speech_format', { body: news, mode: 'news', expected_image_urls: [newsPage] }),
    call(11, 'validate_speech_format', { body: teacher.replace('\n', '\n\n'), mode: 'teacher' }),
  ]);
  assert.deepEqual(decode(newsResult), { passed: true, news_count: 1, teacher_count: 0, issues: [] });
  assert.deepEqual(decode(teacherResult), { passed: true, news_count: 0, teacher_count: 1, issues: [] });
  assert.deepEqual(decode(mixedResult), { passed: true, news_count: 1, teacher_count: 1, issues: [] });
  for (const response of [splitNews, splitTeacher, wrongCountry, oldNews, inlineTeacher, missingPicture, wrongPicture]) {
    assert.equal(decode(response).passed, false);
  }
  assert.ok(decode(inlineTeacher).issues.some((issue) => issue.message.includes('角色标记与正文')));
  assert.equal(decode(legacyGap).passed, true);

  const copyLayout = { body: ['===== 资讯助理 =====\n这张图有人刚打开吗？',
    '12男：\n我看到了。刚碰过去又跌回来了？',
    '===== David先生 =====\n看右边那根，收盘还在原来的区间里。\n\n等它收在区间外，再看下一次回落有没有守住。'].join('\n'),
  session: 'evening', scope: 'partial', strict_layout: true };
  const [copyReady, inlineMember, inlineAssistant, speechGap, postLabelGap, strictNews, leadingNotice, leadingBlank] = run([
    call(1, 'validate_speech_format', copyLayout),
    call(2, 'validate_speech_format', { ...copyLayout, body: copyLayout.body.replace('12男：\n', '12男：') }),
    call(3, 'validate_speech_format', { ...copyLayout, body: copyLayout.body.replace('===== 资讯助理 =====\n', '===== 资讯助理 ===== ') }),
    call(4, 'validate_speech_format', { ...copyLayout, body: copyLayout.body.replace('\n12男：', '\n\n12男：') }),
    call(5, 'validate_speech_format', { ...copyLayout, body: copyLayout.body.replace('===== David先生 =====\n', '===== David先生 =====\n\n') }),
    call(6, 'validate_speech_format', { body: news, mode: 'news', strict_layout: true, expected_image_urls: [newsImage] }),
    call(7, 'validate_speech_format', { ...copyLayout, body: '【教学模拟｜非真实成员发言或交易记录】\n' + copyLayout.body }),
    call(8, 'validate_speech_format', { ...copyLayout, body: '\n' + copyLayout.body }),
  ]).map(decode);
  assert.equal(copyReady.passed, true);
  assert.equal(strictNews.passed, true);
  for (const report of [inlineMember, inlineAssistant, speechGap, postLabelGap, leadingNotice, leadingBlank]) {
    assert.equal(report.passed, false);
  }
  const chineseBad = [
    '===== 资讯助理 =====\n\n家人们，等着上车。',
    '12男：老师太到位了，学到了 😅🔥',
    '===== David先生 =====\n\n主力洗 盘，接着就能抄底。',
  ].join('\n\n');
  const lengthy = '37女：我还没看报告。想先看完今天的收盘数据，再回头对照前一个交易日的成交量。等报告出来我再看一次，看看这两天的波动是不是都出现在收盘之前。🙂🤔';
  const [chineseVoice, shortVoice, banAll, nonChinese, tooLong, hypeVoice, commonTerms] = run([
    call(1, 'validate_whatsapp_voice', { body: mixed }),
    call(2, 'validate_whatsapp_voice', { body: '12男：要是收盘跌到这条线下呢？' }),
    call(3, 'validate_whatsapp_voice', { body: chineseBad }),
    call(4, 'validate_whatsapp_voice', { body: '12男：I am watching the close.' }),
    call(5, 'validate_whatsapp_voice', { body: lengthy }),
    call(6, 'validate_whatsapp_voice', { body: '12男：这下肯定 to the moon! 🚀' }),
    call(7, 'validate_whatsapp_voice', { body: '37女：我看了 BVB 的 BET 和成交量。' }),
  ]);
  assert.deepEqual(decode(chineseVoice), { passed: true, checked_messages: 5, member_messages: 1,
    needs_review: false, issues: [] });
  assert.equal(decode(shortVoice).passed, true);
  assert.equal(decode(banAll).passed, false);
  for (const role of ['===== 资讯助理 =====', '12男：', '===== David先生 =====']) {
    assert.ok(decode(banAll).issues.some((issue) => issue.role === role && issue.severity === 'block'));
  }
  assert.ok(decode(banAll).issues.some((issue) => issue.term === '主力洗盘'));
  assert.ok(decode(nonChinese).issues.some((issue) => issue.type === 'language'));
  assert.ok(decode(tooLong).issues.some((issue) => issue.type === 'emoji_density'));
  assert.ok(decode(tooLong).issues.some((issue) => issue.type === 'member_length'));
  assert.equal(decode(hypeVoice).passed, false);
  assert.equal(decode(commonTerms).passed, true);
  const languageResults = run([
    call(1, 'validate_whatsapp_voice', { body: '12男：資料還沒看。' }),
    call(2, 'validate_whatsapp_voice', { body: '===== 資訊助理 =====\n请再看一眼。' }),
    call(3, 'validate_whatsapp_voice', { body: '已核对资料。\n结论已经写清楚。', mode: 'report' }),
    call(4, 'validate_whatsapp_voice', { body: '報告已完成。', mode: 'report' }),
    call(5, 'validate_whatsapp_voice', { body: 'The review has passed.', mode: 'report' }),
    call(6, 'validate_whatsapp_voice', { body: '排版通过。\nReady.', mode: 'report' }),
    call(7, 'validate_whatsapp_voice', { body: '37女：看了 BVB 的 BET，先等等。\n12男：这个我还不了解。' }),
    call(8, 'validate_whatsapp_voice', { body: '我还不瞭解。', mode: 'report' }),
    call(9, 'validate_whatsapp_voice', { body: 'Claude Code 已完成，详情见 CLAUDE.md。', mode: 'report' }),
    call(10, 'validate_whatsapp_voice', { body: '12男：我看过那本著作，瞭望台讲得挺细。' }),
    call(11, 'validate_whatsapp_voice', { body: 'English review: all good.\n\n~~~text\n12男：\n看了。\n~~~', mode: 'report' }),
    call(12, 'validate_whatsapp_voice', { body: '12男：这个 I think we should wait。' }),
    call(13, 'validate_whatsapp_voice', { body: '12男：看了 Bank of America 的财报。' }),
    call(14, 'validate_whatsapp_voice', { body: 'ALL TESTS PASSED.', mode: 'report' }),
  ]).map(decode);
  assert.deepEqual(languageResults.map(({ passed }) => passed),
    [false, false, true, false, false, false, true, false, true, true, false, false, true, false]);
  assert.equal(languageResults[0].issues[0].type, 'traditional_chinese');
  assert.equal(languageResults[5].issues[0].type, 'language');
  const monday = '2026-11-23';
  const marketSource = 'https://www.nyse.com/trade/trading-information';
  const previousSession = { previous_us_session_date: '2026-11-20', previous_us_session_source: marketSource };
  const imageCheck = { method: 'http_image', observed_url: newsImage, checked_at: '2026-11-23T11:02:00+02:00',
    content_type: 'image/jpeg', event_match: '模拟来源页将该图标为这项测试公告配图。' };
  const earlierNews = { kind: 'news', area: 'romania', title: '测试公告 A', published_at: '2026-11-23T10:00:00+02:00',
    image_url: newsImage, image_source_url: newsPage, image_check: imageCheck };
  const laterNews = { ...earlierNews, area: 'us', title: '测试公告 B', published_at: '2026-11-23T09:00:00Z' };
  const priorNight = { ...laterNews, kind: 'us_overnight_major', title: '测试前夜事件', published_at: '2026-11-22T23:10:00+02:00' };
  const priorClose = { kind: 'us_previous_session_indicators', area: 'us', title: '测试美股前一交易日收盘',
    data_asof: '2026-11-20T16:00:00-05:00' };
  const newsBatch = (entries, session = 'morning', extra = {}) => ({ date: monday, session, entries, ...extra });
  const [ordered, backwards, mondayRecap, afternoonRecap, staleOrdinary, noTime, localLate, holidayMismatch,
    foreignDate, noImage, sameAsArticle] = run([
    call(1, 'validate_news_broadcast', newsBatch([earlierNews, laterNews])),
    call(2, 'validate_news_broadcast', newsBatch([laterNews, earlierNews])),
    call(3, 'validate_news_broadcast', newsBatch([priorClose, priorNight, earlierNews],
      'morning', previousSession)),
    call(4, 'validate_news_broadcast', newsBatch([priorNight, priorClose], 'afternoon', previousSession)),
    call(5, 'validate_news_broadcast', newsBatch([{ ...priorNight, kind: 'news' }])),
    call(6, 'validate_news_broadcast', newsBatch([{ ...earlierNews, published_at: undefined }])),
    call(7, 'validate_news_broadcast', newsBatch([{ ...earlierNews, published_at: '2026-11-23T23:30:00Z' }], 'evening')),
    call(8, 'validate_news_broadcast', newsBatch([priorClose], 'morning', { ...previousSession, previous_us_session_date: '2026-11-19' })),
    call(9, 'validate_news_broadcast', newsBatch([{ ...laterNews, published_at: '2026-11-22T23:30:00-05:00' }])),
    call(10, 'validate_news_broadcast', newsBatch([{ ...earlierNews, image_url: undefined }])),
    call(11, 'validate_news_broadcast', newsBatch([{ ...earlierNews, image_url: newsPage }])),
  ]);
  assert.equal(decode(ordered).passed, true);
  assert.equal(decode(mondayRecap).passed, true);
  assert.equal(decode(foreignDate).passed, true);
  for (const result of [backwards, afternoonRecap, staleOrdinary, noTime, localLate, holidayMismatch, noImage, sameAsArticle]) {
    assert.equal(decode(result).passed, false);
  }
  const checkedImages = decode(ordered).expected_news;
  assert.deepEqual(checkedImages, [
    { country: '罗马尼亚', title: earlierNews.title, image_url: newsImage },
    { country: '美国', title: laterNews.title, image_url: newsImage },
  ]);
  const extensionless = 'https://cdn.example.com/content?image=event-a';
  const imageWithoutExtension = { ...earlierNews, image_url: extensionless,
    image_check: { ...imageCheck, observed_url: extensionless, method: 'rendered', content_type: undefined } };
  const [priorMorning, overnightEdge, dayStart, midAfter, noCheck, html, mismatchedObservation, extensionlessResult, missingCalendar] = run([
    call(1, 'validate_news_broadcast', newsBatch([{ ...priorNight, published_at: '2026-11-22T10:00:00+02:00' }])),
    call(2, 'validate_news_broadcast', newsBatch([{ ...priorNight, published_at: '2026-11-22T18:00:00+02:00' }])),
    call(3, 'validate_news_broadcast', newsBatch([{ ...priorNight, published_at: '2026-11-23T00:01:00+02:00' }])),
    call(4, 'validate_news_broadcast', newsBatch([{ ...priorNight, published_at: '2026-11-23T00:01:00+02:00', kind: 'news' }])),
    call(5, 'validate_news_broadcast', newsBatch([{ ...earlierNews, image_url: extensionless, image_check: undefined }])),
    call(6, 'validate_news_broadcast', newsBatch([{ ...earlierNews, image_check: { ...imageCheck, content_type: 'text/html' } }])),
    call(7, 'validate_news_broadcast', newsBatch([{ ...earlierNews, image_check: { ...imageCheck, observed_url: extensionless } }])),
    call(8, 'validate_news_broadcast', newsBatch([imageWithoutExtension])),
    call(9, 'validate_news_broadcast', newsBatch([priorClose], 'morning', { previous_us_session_date: '2026-11-20' })),
  ]);
  for (const result of [priorMorning, dayStart, noCheck, html, mismatchedObservation, missingCalendar]) {
    assert.equal(decode(result).passed, false);
    assert.deepEqual(decode(result).expected_news, []);
  }
  for (const result of [overnightEdge, midAfter, extensionlessResult]) assert.equal(decode(result).passed, true);
  const skippedFriday = { ...priorClose, data_asof: '2026-11-19T16:00:00-05:00' };
  const thanksgiving = '2026-11-26';
  const holidayRecap = { date: '2026-11-27', session: 'morning',
    entries: [{ ...priorClose, data_asof: '2026-11-25T16:00:00-05:00' }],
    previous_us_session_date: '2026-11-25', previous_us_session_source: marketSource };
  const [skippedTradingDay, missingHoliday, confirmedHoliday, earlyCloseReference, badHoliday] = run([
    call(1, 'validate_news_broadcast', newsBatch([skippedFriday], 'morning',
      { ...previousSession, previous_us_session_date: '2026-11-19' })),
    call(2, 'validate_news_broadcast', holidayRecap),
    call(3, 'validate_news_broadcast', { ...holidayRecap, closed_us_session_dates: [thanksgiving] }),
    call(4, 'validate_news_broadcast', { ...holidayRecap, date: '2026-11-30', previous_us_session_date: '2026-11-27',
      entries: [{ ...priorClose, data_asof: '2026-11-27T13:00:00-05:00' }] }),
    call(5, 'validate_news_broadcast', { ...holidayRecap, closed_us_session_dates: ['2026-02-30'] }),
  ]);
  assert.equal(decode(skippedTradingDay).passed, false);
  assert.equal(decode(missingHoliday).passed, false);
  assert.equal(decode(confirmedHoliday).passed, true);
  assert.equal(decode(earlyCloseReference).passed, true);
  assert.equal(badHoliday.result.isError, true);
  const bulletinA = news.replace(/🇺🇸 美国财经新闻｜[^\n]+/, '🇷🇴 罗马尼亚财经新闻｜' + earlierNews.title);
  const bulletinB = news.replace(/🇺🇸 美国财经新闻｜[^\n]+/, '🇺🇸 美国财经新闻｜' + laterNews.title)
    .replace(newsImage, extensionless);
  const approvedPair = [checkedImages[0], { ...checkedImages[1], image_url: extensionless }];
  const [matchedPair, swappedImages, swappedHeadlines] = run([
    call(1, 'validate_speech_format', { body: bulletinA + '\n\n' + bulletinB, expected_news: approvedPair }),
    call(2, 'validate_speech_format', { body: bulletinA.replace(newsImage, extensionless) + '\n\n'
      + bulletinB.replace(extensionless, newsImage), expected_news: approvedPair }),
    call(3, 'validate_speech_format', { body: bulletinB + '\n\n' + bulletinA, expected_news: approvedPair }),
  ]);
  assert.equal(decode(matchedPair).passed, true);
  assert.equal(decode(swappedImages).passed, false);
  assert.equal(decode(swappedHeadlines).passed, false);
  const [recordSent, afternoonOld, afternoonNew, optionalCutoff] = run([
    call(1, 'save_handoff', { date: monday, session: 'morning', expected_revision: 0, items: [{
      key: monday + '-test-news', category: 'published', status: 'completed',
      summary: '测试新闻已发', source: '测试原文', news_published_at: laterNews.published_at,
    }] }),
    call(2, 'validate_news_broadcast', newsBatch([earlierNews], 'afternoon')),
    call(3, 'validate_news_broadcast', newsBatch([{ ...laterNews, published_at: '2026-11-23T12:00:00+02:00' }], 'afternoon')),
    call(4, 'validate_news_broadcast', newsBatch([laterNews], 'afternoon', { as_of: '2026-11-23T10:30:00+02:00' })),
  ]);
  assert.equal(decode(recordSent).items[0].news_published_at, laterNews.published_at);
  assert.equal(decode(afternoonOld).passed, false);
  assert.equal(decode(afternoonOld).previous_broadcast_published_at, laterNews.published_at);
  assert.equal(decode(afternoonNew).passed, true);
  assert.equal(decode(optionalCutoff).passed, false);

  const openSpec = { date: monday, market: 'us', calendar_status: 'open', calendar_source: marketSource,
    as_of: '2026-11-23T16:25:00+02:00' };
  const [winterOpen, changedClock, closedMarket, calendarMissing, waitingForDelay, delayed, certified, staleSnapshot,
    bvbOpening, badWeekend] = run([
    call(1, 'plan_market_open', openSpec),
    call(2, 'plan_market_open', { ...openSpec, date: '2026-10-27', as_of: '2026-10-27T15:00:00+02:00' }),
    call(3, 'plan_market_open', { ...openSpec, date: '2026-11-26', as_of: '2026-11-26T17:00:00+02:00',
      calendar_status: 'closed' }),
    call(4, 'plan_market_open', { ...openSpec, calendar_source: undefined }),
    call(5, 'plan_market_open', { ...openSpec, as_of: '2026-11-23T16:36:00+02:00' }),
    call(6, 'plan_market_open', { ...openSpec, as_of: '2026-11-23T17:00:00+02:00' }),
    call(7, 'plan_market_open', { ...openSpec, as_of: '2026-11-23T17:00:00+02:00',
      snapshot_as_of: '2026-11-23T09:45:00-05:00', snapshot_confirmed: true }),
    call(8, 'plan_market_open', { ...openSpec, as_of: '2026-11-23T17:00:00+02:00',
      snapshot_as_of: '2026-11-23T09:25:00-05:00', snapshot_confirmed: true }),
    call(9, 'plan_market_open', { ...openSpec, market: 'bvb', as_of: '2026-11-23T10:05:00+02:00',
      calendar_source: 'https://www.bvb.ro/TradingAndStatistics/TradingSessionSchedule' }),
    call(10, 'plan_market_open', { ...openSpec, date: '2026-11-22', as_of: '2026-11-22T15:00:00+02:00' }),
  ]);
  assert.equal(decode(winterOpen).opens_bucharest, monday + 'T16:30');
  assert.equal(decode(winterOpen).status, 'waiting_for_open');
  assert.equal(decode(changedClock).opens_bucharest, '2026-10-27T15:30');
  assert.equal(decode(closedMarket).status, 'closed');
  assert.equal(decode(closedMarket).opens_bucharest, undefined);
  assert.equal(decode(calendarMissing).status, 'calendar_unverified');
  assert.equal(decode(waitingForDelay).status, 'waiting_for_delay');
  assert.equal(decode(delayed).status, 'waiting_for_snapshot');
  assert.equal(decode(certified).status, 'ready');
  assert.equal(staleSnapshot.result.isError, true);
  assert.equal(decode(bvbOpening).opens_bucharest, monday + 'T10:00');
  assert.equal(decode(bvbOpening).suggested_check_bucharest, monday + 'T10:20');
  assert.equal(badWeekend.result.isError, true);

  const sceneOf = (count, first = news) => [first, ...Array.from({ length: count - 1 }, () => '12男：\n我先等收盘。')].join('\n\n');
  const countCase = (session, count, extra = {}, first = news) => ({ session, count, extra, first });
  const countCases = [
    // 整场：上午 09:00–12:00 = 30 条，下午 14:00–17:30 = 35 条，晚间 19:30–22:30 = 30 条，各 ±2。
    [countCase('morning', 28), true], [countCase('morning', 30), true], [countCase('morning', 32), true],
    [countCase('morning', 27), false], [countCase('morning', 33), false],
    [countCase('afternoon', 33), true], [countCase('afternoon', 37), true],
    [countCase('afternoon', 32), false], [countCase('afternoon', 38), false],
    [countCase('evening', 30, {}, teacher), true], [countCase('evening', 33, {}, teacher), false],
    // 节选按起止时刻：09:00–10:20 = 80 分钟 ≈ 13 条；14:00–16:30 = 150 分钟 = 25 条。
    ...[11, 13, 15].map((n) => [countCase('morning', n, { scope: 'excerpt', start: '09:00', end: '10:20' }), true]),
    ...[10, 16].map((n) => [countCase('morning', n, { scope: 'excerpt', start: '09:00', end: '10:20' }), false]),
    [countCase('afternoon', 25, { scope: 'excerpt', start: '14:00', end: '16:30' }), true],
    [countCase('afternoon', 25, { scope: 'excerpt' }), false],
    [countCase('morning', 4, { scope: 'partial' }), true],
    [countCase('afternoon', 1, { scope: 'partial' }), true],
  ];
  const countResults = run(countCases.map(([c], index) => call(index + 1, 'validate_scene_count', {
    session: c.session, body: sceneOf(c.count, c.first), ...c.extra,
  }))).map(decode);
  for (const [index, [c, expected]] of countCases.entries()) {
    assert.equal(countResults[index].passed, expected, `${c.session} ${c.count} 条 ${JSON.stringify(c.extra)}`);
    assert.equal(countResults[index].count, c.count);
  }
  assert.deepEqual([countResults[1].expected, countResults[1].minimum, countResults[1].maximum], [30, 28, 32]);
  assert.equal(countResults[5].expected, 35);
  assert.equal(countResults[9].expected, 30);
  assert.equal(countResults[12].expected, 13);
  assert.equal(countResults[12].minutes, 80);
  assert.equal(countResults[16].expected, 25);
  assert.ok(countResults[17].issues.some((issue) => issue.message.includes('节选须给出起止时刻')));
  assert.equal(countResults[18].applied, false);
  assert.equal(countResults[19].applied, false);
  const customFull = decode(run([call(1, 'validate_scene_count', {
    session: 'morning', start: '09:00', end: '10:20', body: sceneOf(20),
  })])[0]);
  assert.equal(customFull.passed, false);
  assert.ok(customFull.issues.some((issue) => issue.message.startsWith('09:00–10:20 时段')), JSON.stringify(customFull.issues));
  const badWindows = run([
    call(1, 'validate_scene_count', { session: 'morning', scope: 'excerpt', start: '09:00', end: '08:00', body: sceneOf(5) }),
    call(2, 'validate_scene_count', { session: 'afternoon', scope: 'excerpt', start: '16:00', end: '15:00', body: sceneOf(5) }),
    call(3, 'validate_scene_count', { session: 'morning', scope: 'excerpt', start: '08:00', end: '09:30', body: sceneOf(5) }),
  ]).map(decode);
  for (const report of badWindows) {
    assert.equal(report.passed, false);
    assert.ok(report.issues.some((issue) => issue.message.includes('起止时刻须在')), JSON.stringify(report.issues));
  }
  const emptyLabel = decode(run([call(1, 'validate_scene_count', { session: 'morning', body: sceneOf(30) + '\n\n12男：' })])[0]);
  assert.equal(emptyLabel.passed, false);
  assert.equal(emptyLabel.count, 30);

  const marker = '【教学模拟｜非真实成员发言或交易记录】';
  const afternoonHello = '===== 资讯助理 =====\n\n🌤 大家下午好！欢迎回到 ELLERY WESTCOTT 社群！';
  const afternoonBye = '===== 资讯助理 =====\n\n感谢大家今天的交流。晚上我们接着看量价，欢迎回来。祝大家下午愉快，我们晚上见！';
  const memberLine = '12男：我还是想再看一下成交量。';
  const adviser = '===== Gabriela =====\n\n可以把答案发给我。';
  const testBody = [marker, afternoonHello, memberLine, afternoonBye].join('\n\n');
  const speechResults = run([
    call(1, 'validate_speech_format', { body: testBody, session: 'afternoon', scope: 'full', close: 'required' }),
    call(2, 'validate_speech_format', { body: testBody.replace(marker, ''), session: 'afternoon' }),
    call(3, 'validate_speech_format', { body: testBody.replace('大家下午好', '大家早上好'), session: 'afternoon', scope: 'full' }),
    call(4, 'validate_speech_format', { body: testBody + '\n\n' + memberLine, session: 'afternoon', close: 'required' }),
    call(5, 'validate_speech_format', { body: testBody, session: 'afternoon', close: 'forbidden' }),
    call(6, 'validate_speech_format', { body: teacher, session: 'afternoon' }),
    call(7, 'validate_speech_format', { body: teacher, session: 'afternoon', allowed_staff: ['teacher'] }),
    call(8, 'validate_speech_format', { body: adviser, session: 'evening' }),
    call(9, 'validate_speech_format', { body: adviser, session: 'evening', allowed_staff: ['adviser'] }),
    call(10, 'validate_speech_format', { body: '===== 资讯助理 =====\n\n答案是B，参加可获得5积分。', session: 'morning' }),
    call(11, 'validate_speech_format', { body: teacher + '\n请把课后观察任务交给 Gabriela。', session: 'evening', date: '2026-11-19' }),
    call(12, 'validate_speech_format', { body: teacher + '\n今晚不布置作业。', session: 'evening', date: '2026-11-19' }),
    call(13, 'validate_speech_format', { body: teacher + '\n请把课后观察任务交给 Gabriela。', session: 'evening', date: '2026-11-18' }),
    call(14, 'validate_speech_format', { body: teacher.replace('David先生', 'Jonathan先生'), session: 'evening' }),
  ]).map((response) => decode(response).passed);
  assert.deepEqual(speechResults, [true, false, false, false, false, false, false, false, true, false, false, true, true, false]);
  const roleResults = run([
    call(1, 'validate_scene_count', { session: 'morning', body: teacher }),
    call(2, 'validate_scene_count', { session: 'afternoon', body: teacher, scope: 'partial' }),
    call(3, 'validate_scene_count', { session: 'evening', body: teacher, scope: 'partial' }),
    call(4, 'validate_scene_count', { session: 'evening', body: adviser }),
    call(5, 'validate_scene_count', { session: 'evening', body: '12女：我先看。' }),
    call(6, 'validate_scene_count', { session: 'evening', body: '51男：我先看。' }),
    call(7, 'validate_scene_count', { session: 'evening', body: '51男：我先看。', scope: 'partial', allowed_member_ids: ['51'] }),
    call(8, 'validate_scene_count', { session: 'afternoon', body: '12男：先看。\v37女：还没收盘。', scope: 'partial' }),
    call(9, 'validate_scene_count', { session: 'evening', body: '51男：我先看。', scope: 'partial' }),
    call(10, 'validate_scene_count', { session: 'evening', body: '51男：我先看。', scope: 'full', allowed_member_ids: ['51'] }),
    call(11, 'validate_scene_count', { session: 'afternoon', body: teacher, scope: 'partial', allowed_staff: ['teacher'] }),
    call(12, 'validate_scene_count', { session: 'morning', body: teacher, scope: 'partial', allowed_staff: ['teacher'] }),
    call(13, 'validate_scene_count', { session: 'afternoon', body: adviser, scope: 'partial', allowed_staff: ['adviser'] }),
  ]).map(decode);
  assert.deepEqual(roleResults.map((result) => result.passed),
    [false, false, true, false, false, false, true, true, false, false, false, false, true]);
  assert.ok(roleResults[10].issues.some((issue) => issue.message.includes('0 条')));
  assert.equal(roleResults[7].count, 2);
  const forbiddenTeacherResults = run([
    call(1, 'validate_speech_format', { body: teacher, mode: 'teacher', session: 'afternoon', allowed_staff: ['teacher'] }),
    call(2, 'validate_speech_format', { body: [news, teacher].join('\n'), mode: 'news', session: 'afternoon', allowed_staff: ['teacher'] }),
    call(3, 'validate_scene_count', { body: '12男：\n我再看一下。\nDavid先生：我先讲一个条件。', session: 'afternoon', scope: 'partial', allowed_staff: ['teacher'] }),
    call(4, 'validate_scene_count', { body: '===== David =====\n先看条件。', session: 'afternoon', scope: 'partial', allowed_staff: ['teacher'] }),
    call(5, 'validate_speech_format', { body: '12男：\n我再看一下。\n大衛先生：我先讲一个条件。', session: 'afternoon', strict_layout: true, allowed_staff: ['teacher'] }),
    call(6, 'validate_scene_count', { body: sceneOf(32, teacher), session: 'afternoon', scope: 'full', allowed_staff: ['teacher'] }),
    call(7, 'validate_scene_count', { body: sceneOf(32, teacher), session: 'afternoon', scope: 'excerpt', allowed_staff: ['teacher'] }),
  ]).map(decode);
  for (const report of forbiddenTeacherResults) {
    assert.equal(report.passed, false);
    assert.ok(report.issues.some((issue) => issue.message.includes('0 条')));
  }
  const [backstageVoice, holdingsVoice] = run([
    call(1, 'validate_whatsapp_voice', { body: '12男：后台还在等图。' }),
    call(2, 'validate_whatsapp_voice', { body: '37女：我已经加仓了。' }),
  ]);
  assert.equal(decode(backstageVoice).passed, false);
  assert.equal(decode(holdingsVoice).passed, false);
  const basic = { member_id: '12', scope: 'script', expected_revision: 0, session: 'evening',
    activity_type: 'appearance', speaking_move: 'basic_question', summary: '刚开始问图上的线怎么看。', source: '测试采用稿' };
  const firstStage = { member_id: '12', scope: 'script', expected_revision: 0, session: 'evening',
    activity_type: 'progress', learner_stage: 'newcomer', summary: '刚加入，通过基础问话认图。', source: '测试采用稿' };
  const [grouped12, grouped14, grouped37, updatedVoice, firstAppearance, firstProgress, secondAppearance,
    laterBasic, watched, skeptical, liveGrowth] = run([
    call(1, 'save_member_profile', { ...profile12, expected_revision: 1, discussion_group: '观望组' }),
    call(2, 'save_member_profile', { ...profile12, member_id: '14', label: '14男', discussion_group: '质疑组' }),
    call(3, 'save_member_profile', { ...profile12, member_id: '37', label: '37女', discussion_group: '信随组' }),
    call(4, 'save_member_profile', { ...profile12, expected_revision: 2, voice: '倾向先观察一项条件' }),
    call(5, 'save_member_activity', { ...basic, date: '2026-11-21', key: 'growth-first-scene' }),
    call(6, 'save_member_activity', { ...firstStage, date: '2026-11-21', key: 'growth-first-stage' }),
    call(7, 'save_member_activity', { ...basic, date: '2026-11-22', key: 'growth-next-scene' }),
    call(8, 'get_cast_context', { as_of: '2026-11-22', member_ids: ['12'] }),
    call(9, 'get_cast_context', { as_of: '2026-11-22', discussion_group: '观望组' }),
    call(10, 'get_cast_context', { as_of: '2026-11-22', discussion_group: '质疑组' }),
    call(11, 'get_cast_context', { as_of: '2026-11-22', scope: 'live', member_ids: ['12'] }),
  ]);
  assert.equal(decode(grouped12).discussion_group, '观望组');
  assert.equal(decode(grouped14).discussion_group, '质疑组');
  assert.equal(decode(grouped37).discussion_group, '信随组');
  assert.equal(decode(updatedVoice).discussion_group, '观望组');
  assert.equal(decode(firstAppearance).speaking_move, 'basic_question');
  assert.equal(decode(firstProgress).learner_stage, 'newcomer');
  assert.equal(decode(secondAppearance).speaking_move, 'basic_question');
  const newcomer = decode(laterBasic).members[0].growth;
  assert.equal(newcomer.current_stage, 'newcomer');
  assert.equal(newcomer.review_repeated_basic_questions, true);
  assert.ok(newcomer.distinct_appearance_scenes >= 2);
  assert.deepEqual(decode(watched).members.map(({ profile }) => profile.member_id), ['12']);
  assert.deepEqual(decode(skeptical).members.map(({ profile }) => profile.member_id), ['14']);
  assert.equal(decode(liveGrowth).members[0].growth.current_stage, null);
  const laterProgress = { ...firstStage, date: monday, key: 'growth-next-stage', learner_stage: 'participating',
    summary: '自己指出回落后量变小，再提出收盘条件。' };
  const [observed, movedStage, newView, oldViewAfter, wrongKind] = run([
    call(1, 'save_member_activity', { ...basic, date: monday, key: 'growth-observation',
      speaking_move: 'observation', summary: '先说观察到回落时量变小。' }),
    call(2, 'save_member_activity', laterProgress),
    call(3, 'get_cast_context', { as_of: monday, member_ids: ['12'] }),
    call(4, 'get_cast_context', { as_of: '2026-11-22', member_ids: ['12'] }),
    call(5, 'save_member_activity', { ...basic, date: monday, key: 'bad-stage-kind', learner_stage: 'independent' }),
  ]);
  assert.equal(decode(observed).speaking_move, 'observation');
  assert.equal(decode(movedStage).learner_stage, 'participating');
  assert.equal(decode(newView).members[0].growth.current_stage, 'participating');
  assert.equal(decode(newView).members[0].growth.review_repeated_basic_questions, false);
  assert.equal(decode(oldViewAfter).members[0].growth.current_stage, 'newcomer');
  assert.equal(wrongKind.result.isError, true);
  const legacyPhase = { ...phase, id: 'legacy-fixture' };
  const legacyId = 'adopted-00000000-0000-4000-8000-000000000001';
  writeFileSync(join(project, '.westcott-state', `${legacyId}.json`), JSON.stringify({
    ...linked(formation), phase_id: legacyPhase.id, planned_task: formation, id: legacyId, kind: 'adopted',
    created_at: '2026-11-18T18:00:00Z', approval: '上一版本的测试采用',
  }));
  const [legacyPlan, legacyRestart] = run([
    call(1, 'save_agenda', { ...agenda, expected_revision: 2, phase: legacyPhase }),
    call(2, 'get_agenda', {}),
  ]);
  assert.equal(decode(legacyPlan).tasks[0].adopted_record_id, legacyId);
  assert.equal(decode(legacyRestart).next_task.id, philosophy.id);
  const [correctedLegacyDraft] = run([call(1, 'save_draft', { ...linked(formation), phase_id: legacyPhase.id,
    lesson_scope: 'full_lesson', body: '旧课稿核对后的完整修订。' })]);
  const [correctedLegacyAdoption] = run([call(1, 'record_adoption', {
    id: decode(correctedLegacyDraft).id, approval: '采用核过的修订整课稿。' })]);
  const confirmRevision = { id: decode(correctedLegacyAdoption).id, confirmation: '确认整课定稿更换为修订版。' };
  const [unconfirmedReplacement, confirmedReplacement, subsequentAgenda] = run([
    call(1, 'complete_lesson', confirmRevision),
    call(2, 'complete_lesson', { ...confirmRevision, supersedes: legacyId }),
    call(3, 'get_agenda', {}),
  ]);
  assert.match(unconfirmedReplacement.result.content[0].text, /supersedes/);
  assert.equal(decode(confirmedReplacement).adopted_record_id, confirmRevision.id);
  assert.equal(decode(subsequentAgenda).tasks[0].adopted_record_id, confirmRevision.id);
  assert.equal(decode(subsequentAgenda).next_task.id, philosophy.id);
  console.log('PASS: 26 MCP tools, including cross-scene final handoff and gold-sample storage; existing regressions passed.');
} finally {
  rmSync(project, { recursive: true, force: true });
}
