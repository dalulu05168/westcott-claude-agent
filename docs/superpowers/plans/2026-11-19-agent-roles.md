# Agent 分工与条数规则重整 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 条数改为按 6 分钟一条；旧版 2.3.2 的方法按职责补进五个 Agent（新增课件 Agent）。

**Architecture:** 条数规则落在 `reference/scene-rules.json` + `tools/scene-rules.mjs`，由 `validate_scene_count` 执行。方法类规则按「一条规则一个归属文件」放进 `reference/` 下的新文件，各 Agent 的 skill / agent 说明只放链接。旧版来源：`C:\Users\pipi0\Desktop\westcott-efficient-workflow\`。

**Tech Stack:** Node.js ESM（MCP 工具与测试）、Markdown 参考文件、Claude Code agents/skills。

**Spec:** `docs/superpowers/specs/2026-11-19-agent-roles-design.md`

## Global Constraints

- 每条约 6 分钟；上午 09:00–12:00、下午 14:00–17:30、晚间（含周日复盘）19:30–22:30；浮动 ±2 条。
- 用户最新决定优先：模拟说明在代码块外；David 白天 0 条；助理首句固定；绿涨红跌；全部简体中文。
- 每条规则只在一个归属文件写全文，其他处只放链接。
- 不搬旧版 Python 脚本；不改状态存储格式；不动交稿把关和备份的行为（门槛数值除外）。
- 完成时全仓库（除 `docs/`、`.git`）搜不到 `32–35`、`30–34`、`最多 35 条`、`不超过38`、`约 32 条`。

## Review Focus

1. 写到停点（例如下午 16:30 推票节点前停）时，总导演按起止时刻传 `excerpt`，工具应按 150 分钟算 25 条 ±2，而不是按整场 35 条判失败。→ Task 1 测试 `excerpt 14:00–16:30`。
2. 起止时刻跨出场次窗口或 `end` 早于 `start`，应报清楚的错误，不应静默按 0 条算。→ Task 1 测试。
3. 交稿把关对 15–19 条的局部稿也要求条数校验，不能因为旧门槛 20 漏查。→ Task 1 测试。
4. 旧版规则搬进新文件后与 CLAUDE.md 冲突（例如首行模拟标识），应以 CLAUDE.md 为准且新文件里不出现旧说法。→ Task 7 的冲突搜索。
5. 子 Agent 只拿到链接却读不到文件（路径写错），会退回凭记忆写。→ Task 7 的链接检查脚本。

---

### Task 1: 条数按时长计算（工具与测试）

**Files:**
- Modify: `reference/scene-rules.json`、`tools/scene-rules.mjs`、`tools/news-broadcast.mjs:55-63,147-163`
- Modify: `tools/self-test.mjs:814-863`（条数断言整段重写）
- Modify: `tools/hooks/delivery-gate.mjs`（`FULL_SCENE_MIN_SPEECHES`）、`tools/hooks/delivery-gate.test.mjs`

**Interfaces:**
- Produces: `scene-rules.json` 字段 `session_windows: { morning: ["09:00","12:00"], afternoon: ["14:00","17:30"], evening: ["19:30","22:30"] }`、`minutes_per_message: 6`、`tolerance: 2`（删除 `message_limits`）。
- Produces: `scene-rules.mjs` 导出 `sessionWindows`、`expectedRange(session: string, start?: 'HH:MM', end?: 'HH:MM') -> { start, end, minutes, expected, minimum, maximum }`；越界或 `end<=start` 抛 `Error('起止时刻须在<场次>场 HH:MM–HH:MM 内，且结束晚于开始。')`。`expected = Math.round(minutes / 6)`。
- Produces: `validate_scene_count` 入参新增可选 `start`、`end`（pattern `^([01]\d|2[0-3]):[0-5]\d$`）；`full` 用整场窗口（可被 start/end 覆盖），`excerpt` 缺 start/end 时 issue `节选须给出起止时刻（start、end）。`，`partial` 不判。返回增加 `expected`、`start`、`end`、`minutes`。`sessionField` 改用 `Object.keys(sessionWindows)`。

- [ ] **Step 1: 改写 self-test 条数段落为新断言**（`sceneOf` 沿用）
  - full 上午：28、30、32 条通过；27、33 不通过；`expected` 为 30，`[minimum,maximum]` 为 `[28,32]`。
  - full 下午：33、37 通过；32、38 不通过；`expected` 35。
  - full 晚间（含 teacher 首条）：30 通过、33 不通过。
  - excerpt 上午 `start:'09:00', end:'10:20'`：11、13、15 通过，10、16 不通过，`expected` 13。
  - excerpt 下午 `14:00`–`16:30`：25 通过，`expected` 25。
  - excerpt 缺起止：不通过，issue 含「节选须给出起止时刻」。
  - excerpt `end:'08:00'` 或 `start:'16:00', end:'15:00'`：`result.isError` 为 true 或 issue 含「起止时刻须在」。
  - partial：任意条数 `passed: true, applied: false`。
  - 空标记行仍不通过、`count` 正确。
- [ ] **Step 2: 运行 `node tools/self-test.mjs`，预期因旧逻辑失败**
- [ ] **Step 3: 按 Interfaces 实现 `expectedRange` 和新 `validate_scene_count`，更新工具描述为「按 6 分钟一条：整场上午 30、下午 35、晚间 30，±2；节选按 start–end 计算；partial 只报数」**
- [ ] **Step 4: 交稿把关门槛改为 15；在 delivery-gate.test.mjs 加测试「15 条局部稿缺条数校验时阻止」并让 22 条用例仍通过**
- [ ] **Step 5: 运行三套测试全部 PASS**：`node tools/self-test.mjs`、`node tools/hooks/delivery-gate.test.mjs`、`node tools/backup-state.test.mjs`
- [ ] **Step 6: 提交** `git commit -m "条数改为按 6 分钟一条计算"`

### Task 2: 文档里的条数说法统一

**Files:** Modify `CLAUDE.md`（「写上午场」「写下午场」默认执行、下午场段落）、`.claude/skills/westcott-script/SKILL.md:11,65-69`、`reference/member-cast.md:94-100`、`reference/operations.md`（条数相关行）、`.claude/agents/westcott-director.md:27`、`reference/news-broadcast-policy.md:35` 附近、`README.md`（如有条数）。

- [ ] **Step 1:** 每处改为同一句：「条数按每 6 分钟一条计算：整场上午 30、下午 35、晚间 30（周日复盘同晚间），可浮动 2 条；写到停点或节选按实际起止时刻计算，并在 `validate_scene_count` 传 `start`、`end`。」归属文件是 `reference/operations.md`，其他处可只写一句加链接。
- [ ] **Step 2:** 运行 `grep -rnE "32–35|30–34|最多 ?35|不超过3[58]|约 ?32 条|32 条左右" --exclude-dir=.git --exclude-dir=docs .`，预期无输出。
- [ ] **Step 3: 提交**

### Task 3: 晚课方法补进编剧（授课与互动）

**Files:**
- Create: `reference/evening/teaching-method.md`（来源：旧 `evening/teacher.md`、`part-02.md` 2.1–2.4、`part-04.md` 4.1–4.5、`teacher.md`）
- Create: `reference/evening/interaction.md`（来源：旧 `evening/interaction.md`、`part-04.md` 4.6–4.7、`writer.md` 多人对话检查、`writing-examples.md` 语义检查）
- Modify: `.claude/skills/westcott-script/SKILL.md`（David 一节链接 teaching-method；成员一节链接 interaction）、`.claude/agents/westcott-writer.md`

- [ ] **Step 1:** teaching-method.md 必含小节：技术课九步、理念课五步、可能性表达（事实→解释与线索→缺口与待验证条件）、教学图与实际案例分离、收尾（一个原则、一个误区、一个承接；周二四无作业）。
- [ ] **Step 2:** interaction.md 必含：六种作用（疑惑、误解、追问、连接、反思、承接）、误解须合理可纠正、追问紧扣图号或条件、交付形式（插入位置—作用—台词—先生回应要点，台词版不含功能表）。模拟标识按 CLAUDE.md 放块外，不写首行标识。
- [ ] **Step 3:** 每个新文件顶部一行注明来源与「旧版 2.3.2，2026-11-19 并入」。
- [ ] **Step 4:** `grep -n "教学模拟｜" reference/evening/*.md` 无输出；`grep -c "九步\|五步\|疑惑" reference/evening/*.md` 各有命中。
- [ ] **Step 5: 提交**

### Task 4: 课程路线补进总导演

**Files:**
- Create: `reference/evening/course-route.md`（来源：旧 `evening/control.md`、`part-01.md`、`part-03.md` 四阶段、`part-06.md` 模块交接、`part-07.md` 输出要求、`progress.md`）
- Modify: `.claude/skills/westcott-continuity/SKILL.md`、`.claude/agents/westcott-director.md`（新增「派活对照表」：编剧带 teaching-method + interaction；审稿带 review-checklist；课件带 courseware；核查带 news-broadcast-policy 核查一节）

- [ ] **Step 1:** course-route.md 必含：四阶段及各阶段技术重点与理念重点、「四周是排课窗口不是硬性四周」、按星期分配技术/理念课、单课方案字段（核心知识点、判断能力、误区、前后承接、理念推进点）、进度登记改用 `save_agenda` / `complete_lesson`。
- [ ] **Step 2:** 总导演说明里的派活表列出五个 Agent 与各自归属文件链接。
- [ ] **Step 3:** 提交

### Task 5: 白天规则补缺（总导演与核查）

**Files:** Modify `reference/operations.md`、`reference/news-broadcast-policy.md`、`.claude/skills/westcott-facts/SKILL.md`

- [ ] **Step 1:** operations.md 补：周二四下午盘前写到 16:50；BVB 休市日处理（来源旧 `director.md` 第 3 条，含罗马尼亚法定假日清单）；BVB 开市但美股休市时周一三五推票节点先问用户；周一三五下午 3 条资讯发齐后不硬加第 4 条；上午闭群和下午开群的竞猜提醒句；周日复盘完整流程。已有的不重复。
- [ ] **Step 2:** news-broadcast-policy.md 分「编剧写法」「核查要求」两节；核查节补：每场选题必看布伦特/WTI、天然气、霍尔木兹等航运标题并注明来源可靠度；截图算术核验与独立来源分开记录；盘中不写具体时刻；数字写法全稿统一（小数点，币种写法一致）；推票卡片逐字核对并直接改正说明。
- [ ] **Step 3:** westcott-facts skill 链接上述核查节。
- [ ] **Step 4:** 提交

### Task 6: 审稿清单与课件 Agent

**Files:**
- Create: `reference/evening/review-checklist.md`（来源：旧 `evening/review.md`、`part-08.md`、`part-09.md`、`contracts.md` 中不依赖 Python 的检查项）
- Modify: `.claude/skills/westcott-review/SKILL.md`、`.claude/agents/westcott-editor.md`（链接清单）
- Create: `.claude/agents/westcott-courseware.md`（tools: Read, Glob, Grep, Write, mcp__westcott-state__build_lesson_kit, mcp__westcott-state__read_record；model: inherit）
- Create: `reference/courseware.md`（来源：旧 `evening/courseware.md`、`part-05.md`）
- Create: `reference/assets/westcott-logo-original.png`、`reference/assets/logo-metadata.json`、`reference/assets/chart-spec.json`（从旧版复制）

- [ ] **Step 1:** review-checklist.md 按「课程逻辑、技术/理念呼应、图表课件、授课逻辑、理念植入、表达边界、成员互动」列必过项和典型不通过情况。
- [ ] **Step 2:** courseware.md 写清：教学图与实际行情分离、统一尺寸画质、左上角 Logo 位置边距比例背景遮挡规则、绿涨红跌、确认/失效标注、交付物（`build_lesson_kit` 产出 + 图号表）；旧版 DOCX 写成交付规范，不承诺自动生成。
- [ ] **Step 3:** 课件 Agent 说明：只按已采用课稿出图，不编行情；输出图号表与制作状态交回总导演。
- [ ] **Step 4:** 提交

### Task 7: CLAUDE.md 精简为总规则与分工索引，整体验收

**Files:** Modify `CLAUDE.md`、`README.md`（分工表加课件 Agent）、`docs/superpowers/specs/2026-11-19-agent-roles-design.md`（附录 C 去向表）

- [ ] **Step 1:** CLAUDE.md 保留：语言、时区、角色红线、交付排版、审稿与校验要求、条数一句话、五个 Agent 职责与归属文件链接表；方法细节换成链接。不删除任何仍有效的规则，只移到归属文件。
- [ ] **Step 2:** 附录 C 去向表：旧版每个文件一行（去向文件或舍弃理由）。
- [ ] **Step 3:** 链接检查：用 node 脚本扫描 `CLAUDE.md`、`.claude/**/*.md`、`reference/**/*.md` 中的相对链接，全部指向存在的文件，预期输出 `0 broken`。
- [ ] **Step 4:** 冲突搜索：`grep -rn "教学模拟｜\|不超过3[58]\|五个分工是同一助手" --exclude-dir=.git --exclude-dir=docs CLAUDE.md .claude reference` 只允许出现在 `tools`/`scene-rules.mjs` 的既有常量，文档中无输出。
- [ ] **Step 5:** 三套测试全部 PASS。
- [ ] **Step 6:** 调用 `westcott-writer` 写一段晚课中段（教学模拟），再交 `westcott-editor` 按 review-checklist 审，确认九步与互动作用被用上；结论写进交付说明。
- [ ] **Step 7:** 提交
