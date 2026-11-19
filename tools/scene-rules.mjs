import { readFileSync } from 'node:fs';

const rules = JSON.parse(readFileSync(new URL('../reference/scene-rules.json', import.meta.url), 'utf8'));
export const sessionLimits = rules.message_limits;
export const defaultCastLimit = rules.default_cast_limit;

const roster = JSON.parse(readFileSync(new URL('../reference/legacy-member-roster.json', import.meta.url), 'utf8'));
const memberGenders = new Map(roster.people.map(({ id, gender }) => [id, gender]));
export const simulationMarker = '【教学模拟｜非真实成员发言或交易记录】';
export const sceneScopeField = { type: 'string', enum: ['full', 'excerpt', 'partial'], maxLength: 15 };
export const allowedStaffField = {
  type: 'array', items: { type: 'string', enum: ['teacher', 'adviser'], maxLength: 15 }, minItems: 0, maxItems: 2,
};
export const allowedMemberField = {
  type: 'array', items: { type: 'string', pattern: '^(?:5[1-9]|6[0-5])$', maxLength: 2 }, minItems: 0, maxItems: 15,
};

const staffNames = { assistant: '资讯助理', teacher: 'David先生', adviser: 'Gabriela' };
export const sessionNames = { morning: '上午', afternoon: '下午', evening: '晚间' };

export function sceneRoleIssues(blocks, { session, allowed_staff = [], allowed_member_ids = [], scope }) {
  const never = new Set(rules.staff_never_by_session?.[session] ?? []);
  const permitted = new Set([...rules.staff_by_session[session], ...allowed_staff]);
  const issues = [];
  for (const block of blocks) {
    let message;
    if (block.role === 'member') {
      const gender = memberGenders.get(block.member_id);
      if (!gender || gender !== block.gender) message = '成员编号或性别与确认的人物表不符。';
      else if (Number(block.member_id) > defaultCastLimit
        && !(scope === 'partial' && allowed_member_ids.includes(block.member_id))) {
        message = `常规场景成员编号须在 01–${defaultCastLimit} 内，留档成员仅用于用户点名的局部修改。`;
      }
    } else if (never.has(block.role) || !permitted.has(block.role)) {
      const name = staffNames[block.role];
      message = never.has(block.role) ? `${sessionNames[session]}场 ${name} 不出场（0 条），David 只在晚间授课和周日复盘发言。`
        : name ? `${sessionNames[session]}场默认不安排 ${name} 发言，特殊出场须有用户明确安排。`
        : '无法识别该工作人员标记。请核对角色与批准的出场范围。';
    }
    if (message) issues.push({ line: block.line, message });
  }
  return issues;
}
