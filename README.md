# ELLERY WESTCOTT Claude Agent 1.7.2

这套项目面向 Claude Pro 和 Windows。日常只打开总导演，它负责使用工具、调子 Agent 及交付。模型由你的 Claude 账号运行，本地 MCP 保存任务线、课程记录、场内断点、早午晚交接、财经核查记录、手机导入的稿件与成员档案。

从旧版升级时，先关闭旧项目。把新版解压到单独目录，若旧项目有 `.westcott-state`，把整个文件夹复制到新版项目下，再启动新版。已有草稿、旧版登记为完成的课及其任务线照原记录读取。需要用旧草稿登记新完课时，核对范围后把完整版本保存为整课稿，再确认完成。若上一版自行收录过额外范文，把对应条目从旧版复制到 `reference/writing-samples/`，并把索引条目合并进新版。

## 安装一次

1. 解压完整 ZIP，把 `Westcott-Claude-Agent` 放在 Windows 本地文件夹，例如 `C:\Users\你的用户名\Documents\Westcott-Claude-Agent`。保留 `.claude`、`.mcp.json` 和 `tools`。
2. 如果尚未安装 Claude Code 和 Node.js LTS，在 PowerShell 分别运行以下命令。装完打开一个新的终端，运行 `claude --version` 和 `node --version` 确认。Claude Code 的安装替代方式在 [官方安装页](https://code.claude.com/docs/en/setup)。

   ```powershell
   winget install --exact --id Anthropic.ClaudeCode
   winget install --exact --id OpenJS.NodeJS.LTS
   ```

3. 双击 `Start-Westcott.cmd`，第一次按提示登录订阅 Pro 的 Claude 账号。只在你信任且刚解压的项目目录中批准 `westcott-state`。若已打开该目录的 PowerShell，也可执行 `claude --agent westcott-director`。
4. 在 Claude 网页的 [连接器设置](https://claude.ai/customize/connectors) 连接 Google Drive，选能读你的 Westcott 文档的 Google 账号。重新打开项目，运行 `/mcp`，确认 `westcott-state` 已连接，并查看 Google Drive 是否可用。谷歌的授权由你在官方页面完成。参考 [Claude Code MCP 文档](https://code.claude.com/docs/en/mcp) 和 [Google Drive 连接器说明](https://support.claude.com/en/articles/10166901-use-google-workspace-connectors)。

## 可选：启用 docs-readonly 页签读写

官方 Google Docs 连接器足以只读原稿。要按 tabId 精确读页签（`get_tab_text`）或把定稿追加回文档（`append_saved_script`），再启用本地 `docs-readonly`：

1. 在 Google Cloud 建一个服务账号，启用 Google Docs API，下载 JSON 密钥，放到 `C:\Users\你的用户名\AppData\Local\Westcott\google-docs-viewer.json`，或用环境变量 `DOCS_READONLY_CREDENTIALS` 指向该文件的绝对路径。密钥不要放进项目目录。
2. 在 Google 文档里把服务账号邮箱加为查看者；需要写回时加为编辑者。
3. 需要写回时，在 `tools/docs-readonly/source.json` 的 `publish_target` 填目标文档 ID 与 tabId。
4. 在 `.claude/settings.local.json` 把 `docs-readonly` 从 `disabledMcpjsonServers` 移到 `enabledMcpjsonServers`，重启项目，用 `/mcp` 确认已连接。

## 第一次运行

复制这句给总导演。它能验证调用真实子 Agent，以及课堂中段的写法，不需要真实行情。

> 今晚继续 Westcott 晚课。主课讲形态回踩，同步带出观察机构交易线索。明晚的投资理念课负责讲为什么要跟踪机构。调用编剧子 Agent，直接写一段教学模拟课堂中段，让成员顺着图提出疑问，先生接住后继续讲回踩。

如果要验证 Google Drive，另发这一句，并查看 Claude 所引用的原文。

> 读 Google Docs《===== D资讯助理 =====》11 月 17 日晚间课程，给出课程主题、一个成员问题和原文链接。只读。

若连接器只读到其他标签页，贴所需标签页链接和对应段落。原文未经确认时，总导演应明说能读到哪部分。

## 每天怎么用

- 首次确认本阶段的任务线时，发 `把我刚确认的阶段和课程顺序保存为潮汐蓝图。日期未定的先留空。`。总导演会回读并确认已保存的第一项待办。以后调整顺序或本课边界时，明确说要更新计划。
- 同一场换窗口后，从同一项目目录启动总导演，说 `继续今天下午。` 或 `继续今晚的课。`。有场内断点时，总导演读取已确认原文、条数和等待节点，再按原范围续写。开始下一课时读出任务线和上一堂完课稿。完整晚课及实质性多人教学段落会交给剧情审稿 Agent。
- `把刚才这版保存为草稿。` 让本地 MCP 写草稿。
- `这段可以用，按现在的停点保存。` 保存采用正文和同场断点，仍沿用本课待办。出现多稿时，用 ID 指明采用哪一版。
- `采用这份完整课稿，我确认本课完成，推进任务线。` 登记整课完成。只在合稿覆盖本课任务且已对应任务线时推进到下一项。
- `刚才开场的两条已发，记下实际发到哪一句。` 保存已发断点。正式稿及修订可从 Google 文档核对。采用、整课完成和已发分别保存。

## 场次交接与财经核查

上午确认实际发过的资讯和还待处理的事，就能让下午和晚间读取这些事项。例句：`记一下罗马尼亚时间今天上午：刚才那条 BVB 资讯已发，竞猜还等 Gabriela 核对。` 下午确认竞猜已核后，按同一事项更新。晚间可直接说 `接今天白天的进度，起草晚间开群。` 草稿采用和实际已发各自有据。默认交接会查看近七天仍待处理的事项。

财经核查可发 `核实这条消息并留档，写清发布时点、公告原文和行情截点。` 查同一天的盘前稿时，按准确日期和盘段读取。需要当前点位，再发起最新核查。核查记录中的历史快照应带原时间。状态为冲突或待核时，出稿注明资料不足，或暂时省去该句。

按 [运营记录](reference/operations.md) 处理开盘、休市、推荐、竞猜、作业及交接。局部改写只取指定正文和必要前文。续写先取场内断点和需要的原稿末段。Claude Code 压缩后的恢复示例见 [按任务读取与续写](reference/writing-context.md)。

新闻先选对罗马尼亚金融市场或 BVB 有重大影响的事件，再选美股重大动向。按布加勒斯特首发时点排序，核对前夜例外、事件图与原文的对应。场次及默认成员范围读取 [统一配置](reference/scene-rules.json)。详见 [新闻规则](reference/news-broadcast-policy.md)。

助理每条财经新闻一次给出三段：国家和事件标题、事实描述、关键影响与后续关注。正文下方附一行对应事件的已核配图直链。David 每次发言一次给出两段：先说明判断和证据边界，再解释逻辑及如何验证。两位各保留固定角色标记，段间空一行。详见 [助理与先生发言规范](reference/speech-format.md)。

所有角色发言用中文，采用罗马尼亚人在 WhatsApp 投资群里直接、简短、就事论事的聊天节奏。避免中式群聊套话、股票黑话及炒作。成员通常用一句短句，表情零或一个。见 [中文发言口吻](reference/whatsapp-voice.md)。

## 手机与电脑接力

1. 手机上确认一版后，按 [手机交接说明](reference/mobile-handoff.md) 的模板，把标题、停点和正文追加到指定的 Google Docs 交接箱。
2. 回电脑启动总导演，说「接手机稿，先看有哪些确认稿」。它读取交接箱，给出条目编号、正文和停点。看到想接着用的稿件，再说「把编号 `…` 导入本地草稿」。同一版和同一任务关联重复导入时返回原草稿。
3. 继续改稿或预览时保留草稿状态。确认采用片段时可保存为同场断点。需要推进任务线时，把覆盖整课的合稿保存为完整课稿，再明确确认本课完成。

## 验收跨课和独立审稿

用单独解压的目录试跑，避免把示例混入正式任务线。先让总导演保存以下两项测试计划，再开新会话，只说「继续今晚的课」。

> 测试阶段目标是让学员理解观察机构交易线索的用途。第一项是形态课，讲回踩时同步带出观察机构线索，留给下场回答为什么。第二项是投资理念课，回答为什么要跟踪机构。按这个顺序保存两项测试任务，日期先留空。

第一场应由编剧出稿，课堂正文应在读图、讲解或成员提问时带出机构线索。完整晚课应看到 `westcott-editor` 子 Agent 调用。先只采用一个中段并保存断点，另开窗口发「继续今晚的课」，应恢复该段末句，待办依然是形态课。完整形态课稿采用且明确确认本课完成后，再开下一场，应该接到「为什么要跟踪机构」。

还可以在测试目录登记一个下午断点，让它停在「等美股推票材料」。换窗口后应读出同样的末句、条数和待办，保持等待。若只确认开场已发送，查询时应分别显示已发开场和采用稿的两个停点。

试用同一采用稿编号重试追加，条数应保持不变。更新正式稿修订后，再查末句和条数，应以核对到的新正文为准。最后一条是带配图的新闻时，继续写从最后一句台词接入。

窗口内用 [压缩示例](reference/writing-context.md#压缩-claude-code-对话) 保留同一断点，再说「只继续同一场，先说接在原文哪一句后面」。核对它从已确认台词续写，待答的机构问题依然留在原排定的课次。另试「只改第二条，保留 1,25% 和其它原文」，核对输出范围和数字。

## 编剧样本库

编剧和剧情审稿会按场景查找 [写作样本](reference/writing-samples/index.md)。目前有 17 日用户认可的晚课、18 日原稿参考，以及三组新写的改前改后教学对照。已有样本可以在本地读取。要增加范文，指定认可的原稿及范围，例如「把这版晚上 20:00 之后的讨论收进编剧样本库，重点保留成员怎么接住先生的问题」。

要试验写法，发「照 17 日晚课里‘用新证据让成员重新判断’的方式，写一个新的回踩课堂中段。给一个能改变原判断的明确条件。交稿前让剧情审稿确认成长任务在对话中完成。」核对结果是否用了本场场景，是否出现具体条件，以及 Claude Code 是否调用了 `westcott-editor`。

## 成员口吻和出场管理

项目内置已确认的 65 人最终表。姓名、编号、性别和昵称从原表读取，默认出场名单按 [统一配置](reference/scene-rules.json)。编稿时只向子 Agent 传本场相关人员。

需要补写作设定时，给总导演编号和你认可的口吻，例如「确认记录 12 男的写作设定：常用一句短问追实际判断条件。例句是『那先看收盘？』」。这是教学剧本的写作设定。

你确认要留下某场记录时，可以说「在这版已采用的教学稿里，记一下 12 男在晚间问过‘下次先看收盘能不能守住吗？’，这个问题留到下一场」。下次写相关场景时，总导演会查看该成员最近出场、学到哪和问过什么，再和编剧安排怎么接话。真实群内反馈有独立查询范围。

具体字段和验收方法见 [成员口吻与出场](reference/member-cast.md)。

成员可按已确认的讨论倾向分为质疑组、观望组、信随组或其他组。新人记录按实际场次从提基础问题，逐渐过渡到说观察、用条件和自己修正判断。编剧和审稿按成员已经学到的部分安排发言。

## 课件和形态图

对一份已采用的课稿说「用这版生成课堂课件、形态图和课后练习」。总导演会读到这堂课，用 `build_lesson_kit` 生成浏览器课件、SVG 形态图、讲师提纲和学生练习。双击输出的 `lesson.html` 就能翻页，下载 3840×2160 PNG，或通过浏览器打印为 PDF。

图表用绿涨红跌。比如原课只讲到第四根 K 线跌破，第五根只是设问，图上将第五根放进标明的假设区。讲师参考答案保存在单独的 `teacher-notes.md`。

输入格式和图表示例见 [课件生成说明](reference/lesson-kit.md)。

## 分工

| 项目 | 工作 |
| --- | --- |
| 总导演 | 自己确定承接、推进点、剧情顺序和停点，按 `reference/evening/course-route.md` 排课，收各子 Agent 的稿件和结果并交付。 |
| 编剧子 Agent | 写老师和成员来回。晚课按 `reference/evening/teaching-method.md`（九步、五步）和 `interaction.md`（六种作用）推进课程知识和成长任务。 |
| 事实核查子 Agent | 用 WebSearch 和 WebFetch 验证公告、行情口径和发布时间。有实时事实才需要调用。 |
| 剧情审稿子 Agent | 检查跨场承接、任务推进、人物互动、后续边界和事实表达；晚课按 `reference/evening/review-checklist.md` 逐项验收。导演根据问题改稿并复检。 |
| 课件子 Agent | 按 `reference/courseware.md` 为已采用课稿出课件、形态图组和练习，交回图号表与制作状态。 |
| 文件与内容工具 | 本地 Read、Glob、Grep；Google Drive 已授权时读取原稿。 |
| 本地 MCP | 管理任务线、采用记录、场内断点、场次交接、财经核查、手机稿和成员档案，并生成课件。 |
| Skills | 跨晚课程任务、课堂写作、财经核查、剧情审稿四项规则。 |

## 交稿把关

`.claude/settings.json` 注册了一个 Stop hook（[delivery-gate.mjs](tools/hooks/delivery-gate.mjs)）。某一轮贴出 ```` ```text ```` 剧本代码块时，它核对同一轮是否已完成：

- 对实际贴出的正文运行 `validate_speech_format`，且校验正文与贴出版本一致；
- 运行 `validate_whatsapp_voice`；
- 15 条及以上的群稿运行 `validate_scene_count`（节选传起止时刻）；
- 调用 `westcott-editor` 独立审稿。

缺项时阻止结束，把缺项交回总导演补做；同一轮第二次触发只向你显示提醒并放行，避免工具不可用时卡死。用户消息里含「只读」「不审稿」「入库样稿」，或本轮是手机稿预览、导入时不拦截。修改 settings 后需重开项目会话才生效。

## 状态备份与恢复

`.westcott-state` 不进 git。`.claude/settings.json` 里的后台 Stop hook 每轮结束后运行 [backup-state.mjs](tools/backup-state.mjs)，内容有变化才生成快照，默认存到 `%LOCALAPPDATA%\Westcott\state-backups`，保留最近 60 份。每份快照带校验清单。要放进 Google Drive 等同步文件夹，把环境变量 `WESTCOTT_BACKUP_DIR` 设为该文件夹的绝对路径。

```powershell
node tools/backup-state.mjs --list
```

```powershell
node tools/backup-state.mjs --restore latest
```

上面第二条只预览。确认后先关闭正在运行的 Westcott 会话，再加 `--yes` 执行；也可把 `latest` 换成列表里的快照名。恢复前会先把当前状态另存为 `pre-restore` 快照，恢复错了还能退回。

## 本地检查

在该目录 PowerShell 运行 `node tools/self-test.mjs`。它使用临时目录和独立进程验证 26 个 MCP 工具，覆盖旧记录、课程完成、跨场 `final` 接力、样稿入库、场次和手机交接、局部修改范围、成员、新闻顺序、配图、开盘时区及休市处理。Claude Code 双窗口、`/compact`、连接器授权和子 Agent 实际运行须在 Windows 账号环境验收。交稿把关另跑 `node tools/hooks/delivery-gate.test.mjs`，状态备份另跑 `node tools/backup-state.test.mjs`。
