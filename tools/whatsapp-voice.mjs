import { getBlocks, transcriptBreak } from './speech-format.mjs';
import { scriptLanguageIssues } from './script-language.mjs';

const chineseCliches = [
  '兄弟们', '家人们', '各位老铁', '老师辛苦了', '太到位了', '干货满满', '受益匪浅',
  '我悟了', '老师说得太好了', '收获满满', '格局打开', '这个逻辑没毛病', '逻辑拉满', '闭眼冲', '冲冲冲',
  '坐等起飞', '稳稳的幸福', '泼天富贵',
];
const chineseMarketSlang = [
  '割韭菜', '韭菜', '接盘侠', '庄家控盘', '庄股', '妖股', '主力洗盘', '洗盘', '护盘', '吸筹', '拉盘', '砸盘',
  '拉爆', '抬轿', '大肉', '吃肉', '吃面', '挂山顶', '上车', '下车', '梭哈', '抄底', '抄作业',
  '回血', '躺赢', '打板', '连板', '闷杀', '追高', '天地板', '地天板', '砸开',
];
const colloquial = ['抬杠', '杠精', '割肉', '躺平', '谁还敢追', '拉升', '说拉就拉', '卡死', '庄家',
  '接盘', '满仓干', '套牢', '被套', '解套', '踏空', '牛市来了', '涨停', '跌停', '龙头股', '题材股',
  '国家队', '大A', 'A股', '小散', '镰刀', '老铁', '大佬', '小白', '翻车', '踩雷', '上岸', '起飞',
  '真香', '佛系', '内卷', '绝绝子', '破防', '摆烂', '打工人'];
const colloquialPatterns = [[/(?<![站企走持守])稳了/u, '稳了'], [/主力(?!合约|产品|业务|车型)/u, '主力'],
  [/出货(?!量)/u, '出货']];
const idioms = ['事后诸葛亮', '马后炮', '落袋为安', '见好就收', '高开低走', '低开高走', '醍醐灌顶',
  '茅塞顿开', '守株待兔', '亡羊补牢', '塞翁失马', '纸上谈兵', '画蛇添足', '临时抱佛脚', '稳扎稳打',
  '一针见血', '胸有成竹', '未雨绸缪', '水涨船高', '顺藤摸瓜', '火中取栗', '不见兔子不撒鹰',
  '天上掉馅饼', '豁然开朗', '恍然大悟'];
const chineseContext = ['人民币', '微信', '支付宝', '余额宝', '红包', '春节', '国庆', '双十一', '茅台',
  '上证', '沪深', '创业板', '北向资金', '港股通'];
const dramatic = ['出大事', '出了大事', '大事了', '炸了', '炸锅', '重磅', '血洗', '史诗级',
  '暴击', '王炸', '惊天', '震惊', '疯狂', '狂飙', '血亏', '暴雷'];
const praise = ['讲得太好', '讲得真好', '讲得好', '太厉害', '太专业', '太准了', '神了', '跟着先生',
  '多亏先生', '多亏了先生', '佩服', '膜拜', '大师', '先生说的都对', '听先生的准没错'];
const filler = ['学到了', '学到啦', '记下了', '原来是这样', '这个懂', '我懂了', '懂了', '谢谢先生',
  '回去试试', '再看一遍', '明天来听', '收藏了', '涨知识'];
const holdings = /我(?:已经|刚|今天)?(?:买了|买入|加仓|建仓|满仓|持有|卖了|清仓)|(?:我|已经).{0,5}(?:赚了|亏了)\s*\d|收益\s*\d+%/u;
const implicitHoldings = /我.{0,8}(?:买的|买进的|卖早了|卖掉了)|我(?:手里|手上|仓里|账户里)(?:的|有|那)|我的(?:仓位|成本|持仓)|已经赚了|赚了不少|亏了不少|回本了/u;
const backstage = /开了没|数据还得等|等核对|核对完|核完再报|等截图|等图|等点位|数据延[时迟]|稿子|后台/u;
const hype = /(?<![\p{L}\p{N}])(?:yyds|666|to the moon|all[- ]in|hodl|diamond hands|paper hands|pump(?: and| &) dump|următoarea rachetă|profit garantat|bani siguri)(?![\p{L}\p{N}])/iu;
const pictographic = /[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Presentation}]/u;
const graphemes = new Intl.Segmenter('ro', { granularity: 'grapheme' });
const normalize = (body) => body.normalize('NFKC').replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
  .replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, '');

function inspectVoice({ body, mode = 'dialogue' }) {
  const lines = body.split(transcriptBreak);
  const issues = scriptLanguageIssues(lines);
  if (mode === 'report') {
    return { passed: issues.length === 0, checked_messages: lines.filter((line) => line.trim()).length,
      member_messages: 0, needs_review: false, issues };
  }
  const segments = getBlocks(body);
  const blocks = segments.length ? segments : [{ line: 1, label: '', role: 'other', lines: [body] }];
  let checked = 0;
  let members = 0;
  const memberIds = [];
  const praiseBlocks = [];
  const fillerBlocks = [];
  function issue(block, severity, type, message, term) {
    issues.push({ line: block.line, role: block.label || block.role, severity, type, message, ...(term ? { term } : {}) });
  }

  for (const block of blocks) {
    const message = block.lines.filter((line) => !/^\s*配图[：:]/u.test(line)).join('\n').trim();
    if (!message) continue;
    checked += 1;
    const normalized = normalize(message);
    for (const [type, terms, label] of [
      ['chinese_cliche', chineseCliches, '中文群聊套话'],
      ['market_slang', chineseMarketSlang, '股票黑话'],
      ['hype', dramatic, '渲染性措辞'],
    ]) {
      const hits = terms.filter((term) => normalized.includes(term));
      const distinct = hits.filter((term) => !hits.some((other) => other !== term && other.includes(term)));
      for (const term of distinct) issue(block, 'block', type, `请用本场可核实的具体表达替换${label}。`, term);
    }
    const catchphrase = hype.exec(normalized);
    if (catchphrase) issue(block, 'block', 'hype', '请用具体的事实、条件或观察代替炒作和收益口号。', catchphrase[0]);
    if (/@\s*\d{2}\s*[男女]/u.test(message)) issue(block, 'block', 'number_mention', '群里提及成员用姓名，避免直接 @ 编号。');
    if (/飘绿|翻绿|翻红|红盘|绿盘|满屏红|满屏绿|一片红|一片绿|绿油油|涨红|跌绿/u.test(normalized)
      || /(?:盘中|还没收盘|尚未收盘|开盘后).{0,30}(?:收绿|收红)/u.test(normalized)) {
      issue(block, 'review', 'market_colours', '核对绿涨红跌。盘中用见绿、飘红，收盘后才用收绿、收红。');
    }
    const additionalSlang = [...colloquial.filter((term) => normalized.includes(term)),
      ...colloquialPatterns.filter(([pattern]) => pattern.test(normalized)).map(([, term]) => term)];
    if (additionalSlang.length) {
      issue(block, block.role === 'member' ? 'block' : 'review', 'legacy_slang', '请改为自然或正式的金融用语。', additionalSlang.join('、'));
    }
    if (block.role !== 'member') {
      if (['assistant', 'teacher', 'adviser'].includes(block.role) && /学员|同学/u.test(normalized)) {
        issue(block, 'block', 'address_members', '工作人员称呼群内人员用「成员」。');
      }
      if (block.role === 'teacher' && /答案是/u.test(normalized)) {
        issue(block, 'block', 'activity_answer', '先生讲清相关原理，活动答案留给顾问核对。');
      }
      if (block.role === 'teacher' && /这只票|那只票|个票|抽水|加仓|减仓|满仓|清仓|空仓/u.test(normalized)) {
        issue(block, 'review', 'teacher_terms', '先生讲课用正式的金融术语。');
      }
      if (block.role === 'assistant' && /(?:截至|截止)\s*\d{1,2}[:：点]\d{0,2}|\d{1,2}[:：]\d{2}\s*(?:的|时)?\s*(?:行情|数据|报价)/u.test(message)) {
        issue(block, 'review', 'quote_clock', '群内盘中表述用上午、盘中或开盘后不久。准确截点留在核查记录。');
      }
      if (block.role === 'assistant' && backstage.test(normalized)) issue(block, 'block', 'backstage', '助理正文省去延时、等核对和等截图等内部安排。');
      continue;
    }
    members += 1;
    memberIds.push(block.member_id);
    if (/老师/u.test(normalized)) issue(block, 'block', 'address_teacher', '成员称呼 David 用名字或姓氏加「先生」。');
    if (backstage.test(normalized)) issue(block, 'block', 'backstage', '成员台词只使用已公开的内容。');
    const idiom = idioms.find((term) => normalized.includes(term));
    if (idiom) issue(block, 'block', 'chinese_idiom', '换成贴合罗马尼亚群聊的直接说法。', idiom);
    const context = chineseContext.find((term) => normalized.includes(term));
    if (context) issue(block, 'review', 'chinese_context', '核对本轮是否确实涉及该背景。', context);
    if (holdings.test(normalized)) issue(block, 'block', 'personal_holdings', '新编发言改用条件问法，实际持仓或盈亏另按用户资料核对。');
    else if (implicitHoldings.test(normalized)) issue(block, 'review', 'implicit_holdings', '核对是否暗示了未经证实的个人持仓或盈亏。');
    if (praise.some((term) => normalized.includes(term))) praiseBlocks.push(block);
    if (filler.some((term) => normalized.includes(term))) fillerBlocks.push(block);
    const emojis = [...graphemes.segment(message)].filter(({ segment }) => pictographic.test(segment));
    if (emojis.length > 1) issue(block, 'review', 'emoji_density', '成员短句一般用零或一个自然表情，检查多余的表情。');
    if (emojis.some(({ segment }) => /[🚀💰🤑]/u.test(segment))) {
      issue(block, 'review', 'hype_emoji', '检查这里的表情是否给价量观察加上了不必要的炒作意味。');
    }
    const length = (message.match(/\p{Script=Han}/gu)?.length ?? 0) + (message.match(/\b[\p{Script=Latin}\d]+\b/gu)?.length ?? 0);
    if (length > 60) {
      issue(block, 'review', 'member_length', '这条较长，请按人物语境核对聊天感。');
    }
  }
  if (praiseBlocks.length) issue(praiseBlocks[0], praiseBlocks.length >= 3 ? 'block' : 'review', 'praise',
    praiseBlocks.length >= 3 ? '同场有三条或以上集中夸奖，请按实际问题重排。' : '检查这句是否有实际讨论价值。');
  if (fillerBlocks.length > 2) issue(fillerBlocks[0], 'review', 'filler', '同场已有两条以上空表态，检查重复。');
  const occurrences = new Map();
  for (const id of memberIds) occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
  if (members >= 8 && [...occurrences.values()].filter((count) => count === 1).length >= members * .9) {
    issue(blocks.find((block) => block.role === 'member'), 'review', 'queued_members', '成员几乎都只出现一次，检查是否排队发言。');
  }
  return { passed: !issues.some((entry) => entry.severity === 'block'), checked_messages: checked,
    member_messages: members, needs_review: issues.some((entry) => entry.severity === 'review'), issues };
}

export function createWhatsAppVoiceTool({ text, schema }) {
  const definition = {
    name: 'validate_whatsapp_voice',
    description: 'Reject Traditional Chinese and foreign prose. Check final dialogue voice in dialogue mode and user-facing status, review or delivery notes in report mode.',
    inputSchema: schema({ body: text(160000), mode: { type: 'string', enum: ['dialogue', 'report'], maxLength: 8 } }, ['body']),
    annotations: { readOnlyHint: true, openWorldHint: false },
  };
  return { definitions: [definition], handlers: { validate_whatsapp_voice: inspectVoice } };
}
