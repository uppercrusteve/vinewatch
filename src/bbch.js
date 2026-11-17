/**
 * BBCH phenology key stages for grapevine (Vitis vinifera).
 * Principal growth stages follow the extended BBCH scale
 * (Lancashire et al. 1991; Coombe 1995). Only key codes are offered
 * so field entry stays fast.
 */

export const BBCH_SOURCE =
  'Lancashire, P.D. et al. (1991) A uniform decimal code for growth stages of crops and weeds. Ann. Appl. Biol. 119: 561–601; Coombe, B.G. (1995) Adoption of a system for identifying grapevine growth stages. Aust. J. Grape Wine Res. 1: 104–110.';

export const BBCH_GROUPS = [
  {
    id: 'budburst',
    label: '萌芽',
    color: '#7c9a3f',
    stages: [
      { code: '01', short: '芽膨大', description: '芽眼开始膨大，鳞片分离，仍包裹绒毛。' },
      { code: '07', short: '萌芽', description: '芽眼绽裂，绿色组织初露；记录出芽整齐度。' }
    ]
  },
  {
    id: 'leaf',
    label: '展叶',
    color: '#4f8a3d',
    stages: [
      { code: '09', short: '展叶', description: '第一片叶展开，叶片与嫩梢可见。' },
      { code: '13', short: '3 叶', description: '新梢约 3 片叶展开，进入快速生长期。' },
      { code: '15', short: '5 叶', description: '新梢约 5 片叶展开，留意霜霉病初侵染。' },
      { code: '17', short: '7 叶', description: '新梢约 7 片叶展开，可开始梢尖管理。' },
      { code: '19', short: '9 叶以上', description: '新梢 9 片叶以上，花序原基分化进行中。' }
    ]
  },
  {
    id: 'inflorescence',
    label: '花序',
    color: '#8a9a2e',
    stages: [
      { code: '53', short: '花序可见', description: '花序从叶幕中露出，清晰可辨。' },
      { code: '57', short: '花序发育完全', description: '花序充分伸长，花蕾紧密排列，尚未分离。' }
    ]
  },
  {
    id: 'flowering',
    label: '开花',
    color: '#d9a227',
    stages: [
      { code: '60', short: '初花', description: '首朵花开放，可见花帽脱落。' },
      { code: '65', short: '盛花', description: '约半数花开放，为授粉关键窗口。' },
      { code: '68', short: '落花末期', description: '多数花帽脱落，子房开始膨大。' },
      { code: '69', short: '开花结束', description: '开花结束，残留花帽与花丝可见。' }
    ]
  },
  {
    id: 'fruit',
    label: '坐果',
    color: '#5b8c5a',
    stages: [
      { code: '71', short: '坐果', description: '子房开始膨大，幼果形成。' },
      { code: '73', short: '果粒豌豆大', description: '果粒直径约 6–8 mm，疏果窗口开启。' },
      { code: '75', short: '果粒一半豌豆大', description: '果粒约为豌豆一半大小，果穗继续伸长。' },
      { code: '77', short: '果粒接触', description: '同一果穗内相邻果粒开始接触。' },
      { code: '79', short: '封穗', description: '果穗结构封闭，进入膨大与防病关键期。' }
    ]
  },
  {
    id: 'veraison',
    label: '转色',
    color: '#7a4b8c',
    stages: [
      { code: '81', short: '转色开始', description: '果皮开始着色或变软，糖分积累启动。' },
      { code: '85', short: '软化', description: '果粒明显软化，多数果穗已完成转色。' }
    ]
  },
  {
    id: 'ripening',
    label: '成熟',
    color: '#a8435c',
    stages: [
      { code: '89', short: '采收成熟', description: '达到目标成熟度，可安排采样与采收。' }
    ]
  },
  {
    id: 'senescence',
    label: '衰老',
    color: '#8a6b4f',
    stages: [
      { code: '91', short: '采收后', description: '采收完成，树体进入采后恢复阶段。' },
      { code: '97', short: '落叶', description: '叶片黄化脱落，进入休眠准备期。' }
    ]
  }
];

export const BBCH_STAGES = BBCH_GROUPS.flatMap((group) =>
  group.stages.map((stage) => ({
    ...stage,
    groupId: group.id,
    groupLabel: group.label,
    color: group.color
  }))
);

const STAGE_MAP = new Map(BBCH_STAGES.map((stage) => [stage.code, stage]));

export function getStage(code) {
  return STAGE_MAP.get(String(code)) || null;
}

export function isStageCode(code) {
  return STAGE_MAP.has(String(code));
}

/** Numeric sort key so "07" follows "01" regardless of string order. */
export function stageSortKey(code) {
  const parsed = Number.parseInt(code, 10);
  return Number.isFinite(parsed) ? parsed : 999;
}

export function compareStages(a, b) {
  return stageSortKey(a) - stageSortKey(b);
}

export function latestStage(codes = []) {
  let best = null;
  for (const code of codes) {
    if (!isStageCode(code)) continue;
    if (!best || stageSortKey(code) > stageSortKey(best)) best = code;
  }
  return best ? getStage(best) : null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MIN_RECORD_DATE = '2000-01-01';

/**
 * Validates a YYYY-MM-DD field date.
 * Rejects malformed strings, impossible calendar dates, dates before 2000,
 * and dates more than one day in the future (timezone slack).
 * @returns {{ok: true, value: string} | {ok: false, reason: string}}
 */
export function validateDate(value, today = new Date()) {
  const text = String(value ?? '').trim();
  const match = ISO_DATE.exec(text);
  if (!match) return { ok: false, reason: '日期格式应为 YYYY-MM-DD' };
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return { ok: false, reason: '日期在日历上不存在' };
  }
  if (text < MIN_RECORD_DATE) return { ok: false, reason: `日期不能早于 ${MIN_RECORD_DATE}` };
  const todayISO = toISODate(today);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  if (text > toISODate(tomorrow)) return { ok: false, reason: '日期不能晚于明天' };
  return { ok: true, value: text };
}

export function toISODate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
