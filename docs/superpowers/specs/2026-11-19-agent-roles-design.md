# Westcott Agent 分工与条数规则重整 设计

日期：2026-11-19 · 状态：用户已批准（2026-11-19）

## 1. 目的

现在的 Westcott 项目（1.7.2）由总导演、编剧、核查、审稿四个子 Agent 组成，但旧版 `westcott-efficient-workflow` 2.3.2 里不少已确认的方法没有搬过来，尤其是晚课教学方法、课件规范和部分白天场次规定。用户要搭建的是真正分工的 Agent 体系，要把旧版内容按职责补进对应的 Agent，让每个 Agent 拿到自己那一块的完整方法，后续才能各自深化。

同时，条数规则统一改为按时长计算：每 6 分钟一条，之前所有固定条数规定作废。

## 2. 目标、非目标、反目标

**目标**
- 五个 Agent 各有清楚的职责边界和自己的参考资料；总导演只读自己需要的部分，派活时把对应资料交给子 Agent。
- 旧版已确认、新版缺失的规则全部有去处，不丢。
- 条数在 CLAUDE.md、配置、校验工具、skill、Agent 说明和测试里只有一种说法：按 6 分钟一条。

**非目标**
- 不重写成员口吻规则（新版已基本照搬旧版，只补缺口）。
- 不改 MCP 状态工具的存储格式，不动已有的交稿把关和状态备份。
- 不搬旧版的 Python 脚本（`review_draft.py`、`check_scene.py`、`memory_store.py` 等）；它们的功能已由 `westcott-state` 的校验和存储工具取代。

**反目标（做到了也算失败）**
- 旧版的过时规定混回来，和用户新决定打架（例如旧条数、代码块首行写模拟标识、「五项职责是同一个助手」的说法）。
- 把全部旧规则堆进 CLAUDE.md，导致每个 Agent 都背着整套规则。
- 同一条规则在多个文件里各写一遍、写法不一致。

## 3. 约束

- 用户最新决定优先于旧版：模拟说明放在代码块外；David 白天 0 条；助理开群首句固定；绿涨红跌；全部简体中文。
- 冲突按日期取较新的用户决定；无法判断时列出来问用户，不自行取舍。
- 每条规则只在一个「归属文件」里写全文，其他地方只放链接。
- 现有 `node tools/self-test.mjs`、交稿把关测试、备份测试必须继续通过（条数相关断言按新规则改写）。

## 4. 考虑过的做法

| 做法 | 取舍 | 结论 |
| --- | --- | --- |
| A. 按职责把旧版内容拆进各 Agent 的 skill 和参考文件，新增课件 Agent | 改动面最大，但职责清楚、每个 Agent 只读自己的资料 | **用户选定** |
| B. 把旧版整包装成项目 skill，让各 Agent 去读 | 改动小，但旧条数、旧标识等过时规定会和新规则冲突，且职责仍混在一起 | 不采用 |
| C. 全部写进 CLAUDE.md | 最直接，但篇幅过长，每个 Agent 都要读全部规则，职责不清 | 不采用 |

## 5. 设计

### 5.1 五个 Agent 与旧版内容的对应

| Agent | 职责 | 接手的旧版内容 | 归属文件（新建或扩充） |
| --- | --- | --- | --- |
| 总导演 `westcott-director` | 定范围、排课、选角、派活、收稿交付、状态登记 | `director.md` 场次固定写法；晚课 `control.md`、`part-01`、`part-03` 四阶段路线、`part-06` 模块交接、`part-07` 输出要求、`progress.md` | `reference/operations.md`（补白天缺口）、新建 `reference/evening/course-route.md`、`westcott-continuity` skill |
| 编剧 `westcott-writer` | 写助理、David、成员台词 | `writer.md`、`teacher.md`；晚课 `teacher.md`、`interaction.md`、`part-02` 可能性表达、`part-04` 授课与互动、`writing-examples.md` | 新建 `reference/evening/teaching-method.md`、`reference/evening/interaction.md`；`westcott-script` skill 链接它们 |
| 核查 `westcott-verifier` | 核新闻、行情、日期、配图 | `assistant.md` 资讯部分：能源与地缘必查、官方配图、时间顺序、截图算术、数字写法、推票卡片核对 | `westcott-facts` skill、`reference/news-broadcast-policy.md` |
| 审稿 `westcott-editor` | 独立审稿 | `contracts.md`；晚课 `review.md`、`part-08` 验收标准、`part-09` 检查重点 | 新建 `reference/evening/review-checklist.md`；`westcott-review` skill 链接 |
| **课件 `westcott-courseware`（新增）** | 课件、形态图、Logo、练习 | 晚课 `courseware.md`、`part-05` 图表与课件标准、`assets/` 正式 Logo 与元数据、`chart-spec.json` | 新建 `.claude/agents/westcott-courseware.md`、`reference/courseware.md`、`reference/assets/`；沿用 `build_lesson_kit` 工具 |

总导演派活时只把对应归属文件的链接交给子 Agent，不转述整套规则。

### 5.2 旧版内容的处理规则

- **照搬**：与新版无冲突、新版缺失的规则（九步、五步、四阶段、六种互动作用、可能性表达、16:50 停点、能源地缘必查、数字写法、周日复盘细则等），按原意改写成新版文风后放入归属文件，注明来源与日期。
- **改写**：旧版里依赖 Python 脚本或「同一助手五项职责」的表述，改成对应的 MCP 工具和子 Agent 名称。
- **舍弃**：旧条数（≤35、≤38）、代码块首行【教学模拟】标识、旧版 memory/session 脚本流程。舍弃清单写进设计附录，方便日后查。
- **新版独有、保留**：讨论分组、场内分工、新人成长阶段、跨场钩子、`final` 接力、交稿把关、状态备份。

### 5.3 条数规则

- 每条约 6 分钟。整场条数 = 场次时长 ÷ 6：上午 09:00–12:00 为 30 条，下午 14:00–17:30 为 35 条，晚间 19:30–22:30 为 30 条。
- 周日 19:30 复盘按晚间窗口计算。
- 允许上下浮动 2 条（上午、晚间 28–32，下午 33–37），避免为凑整数硬加无效发言。
- 写到停点或只写一段时，按实际覆盖的起止时刻计算，例如 09:00 写到 10:20 为 80 分钟，约 13 条（11–15 条通过）。
- 所有出场角色都计入，计法沿用现有「一处角色标记加正文算一条」。
- 实现：`reference/scene-rules.json` 的 `message_limits` 改为 `session_windows`（各场起止时刻）、`minutes_per_message: 6`、`tolerance: 2`。`validate_scene_count` 新增可选 `start`、`end`（`HH:MM`）；`full` 用场次窗口，`excerpt` 必须给起止时刻，`partial` 只报数不判通过。工具描述、CLAUDE.md、`westcott-script`、`member-cast.md`、`operations.md`、总导演说明、`news-broadcast-policy.md` 里的旧条数一并改掉。
- 交稿把关里「20 条及以上视为整场」的门槛改为「达到所在场次整场条数的一半」，与新条数一致。

### 5.4 CLAUDE.md 的调整

CLAUDE.md 只保留总规则和分工索引：语言、时区、角色红线、交付排版、五个 Agent 各自负责什么及归属文件链接、条数一句话规则。具体方法移到归属文件，避免重复。

## 6. 验收

- 旧版每个模块在附录「去向表」里都有落点：照搬到哪、改写成什么、或为何舍弃。
- 全仓库搜不到旧条数（32–35、30–34、最多 35、不超过 38）。
- `validate_scene_count` 新测试覆盖：整场上午 30 条通过、27 条不通过、下午 37 条通过、38 条不通过、09:00–10:20 节选 13 条通过、节选缺起止时刻报错。
- 三套测试全部通过。
- 用 `westcott-editor` 审一段按新分工写的晚课中段样稿（教学模拟），确认九步、互动作用、口吻规则被实际用上。

## 7. 留给实施者的

- 旧版晚课 `part-*` 文件约 3.5 万字，按归属拆分时可合并重复段落，保留原意即可。
- 课件 Agent 使用的工具以现有 `build_lesson_kit` 为准；旧版 DOCX 流程如无对应工具，写成「交付规范」，不承诺自动生成 DOCX。
- 资讯助理的写法归编剧，选题与核实归核查，两边在 `news-broadcast-policy.md` 用小节分开。

## 附录 A：用户本轮决定

- 2026-11-19：每个时段条数按 6 分钟一条计算，之前的条数规则作废。
- 2026-11-19：工作分配采用真正的子 Agent，把旧版内容按职责补进对应 Agent；采用方案 A，新增课件 Agent。

## 附录 B：设计者自行决定、请用户核对

- 浮动范围定为上下 2 条。
- 节选必须给起止时刻才判通过与否。
- 周日复盘沿用晚间 19:30–22:30 窗口。
- 课件职责单独成为第五个 Agent，而不是并入总导演。
- 旧版 Python 脚本不搬，功能由现有 MCP 工具承担。

## 附录 C：旧版 2.3.2 各文件去向

| 旧版文件 | 去向 |
| --- | --- |
| `SKILL.md` | 任务分流由总导演说明与 CLAUDE.md 承担；「五个分工是同一助手」改为五个真实 Agent。 |
| `references/members.md` | 已在 `reference/member-cast.md`（此前已照搬），本次未改动内容。 |
| `references/writer.md` | `reference/evening/interaction.md`「多人对话自检」；局部编辑规则已在 `westcott-script`。 |
| `references/director.md` | `reference/operations.md`（场次固定写法、16:50、休市与法定假日、周日复盘、竞猜提醒）；条数规定作废，改为每 6 分钟一条。 |
| `references/assistant.md` | `reference/news-broadcast-policy.md`「核查要求」与「编剧写法」两节、`westcott-facts`。 |
| `references/teacher.md` | `reference/evening/teaching-method.md`「先生的说话方式」。 |
| `references/writing-examples.md` | 口吻对照已在 `reference/gold-samples.md`；语义检查并入 `reference/evening/interaction.md`。 |
| `references/contracts.md` | 机器检查由 `validate_*` 工具承担；人工检查项并入 `reference/evening/review-checklist.md`。 |
| `references/evening.md`、`evening/contract.md` | 入口与优先关系由 CLAUDE.md「五个 Agent 的分工」承担。 |
| `evening/control.md`、`part-01`、`part-03`、`part-06`、`part-07`、`progress.md` | `reference/evening/course-route.md`；进度改用 `save_agenda`、`complete_lesson`。 |
| `evening/teacher.md`、`part-02`、`part-04`（4.1–4.5） | `reference/evening/teaching-method.md`。 |
| `evening/interaction.md`、`part-04`（4.6–4.7） | `reference/evening/interaction.md`。 |
| `evening/review.md`、`part-08`、`part-09` | `reference/evening/review-checklist.md`。 |
| `evening/courseware.md`、`part-05` | `reference/courseware.md`；新增 `westcott-courseware` Agent。 |
| `part-10.md` | 总纲并入 `course-route.md` 开头；所提两份后续成果不搬。 |
| `assets/westcott-logo-original.png`、`logo-metadata.json` | 复制到 `reference/assets/`，校验值一致。 |
| `chart-spec.json` | 不搬：实为 11-30 起罗马尼亚语课程的视频图表数据，不是图表规范。 |
| `scripts/*.py`、`tests/*.py`、`*.cjs`、`*.py` 根目录脚本 | 不搬：功能由 `westcott-state` 的 MCP 工具与本项目测试承担。 |
| 首行【教学模拟】标识规则 | 舍弃：按 CLAUDE.md，模拟说明放在代码块外。 |
