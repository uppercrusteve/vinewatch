import { describe, expect, it } from 'vitest';
import {
  BBCH_GROUPS,
  BBCH_STAGES,
  compareStages,
  getStage,
  isStageCode,
  latestStage,
  stageSortKey,
  toISODate,
  validateDate
} from '../src/bbch.js';

const TODAY = new Date(2026, 10, 17);

describe('BBCH 阶段表', () => {
  it('按 brief 提供 8 组共 23 个阶段', () => {
    expect(BBCH_GROUPS.map((group) => group.label)).toEqual([
      '萌芽', '展叶', '花序', '开花', '坐果', '转色', '成熟', '衰老'
    ]);
    expect(BBCH_STAGES).toHaveLength(23);
  });

  it('每个阶段都有说明、颜色和唯一编码', () => {
    const codes = new Set(BBCH_STAGES.map((stage) => stage.code));
    expect(codes.size).toBe(23);
    for (const stage of BBCH_STAGES) {
      expect(stage.description.length).toBeGreaterThan(4);
      expect(stage.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('阶段按数字化排序，07 在 01 之后、10 之前', () => {
    const sorted = ['81', '07', '65', '01'].sort(compareStages);
    expect(sorted).toEqual(['01', '07', '65', '81']);
    expect(stageSortKey('07')).toBe(7);
    expect(stageSortKey('bad')).toBe(999);
  });

  it('getStage 与 isStageCode 只接受已知编码', () => {
    expect(getStage('65').short).toBe('盛花');
    expect(getStage('66')).toBeNull();
    expect(isStageCode('89')).toBe(true);
    expect(isStageCode('99')).toBe(false);
  });

  it('latestStage 返回物候最靠后的有效阶段', () => {
    expect(latestStage(['07', '89', '65', 'oops']).code).toBe('89');
    expect(latestStage([])).toBeNull();
  });
});

describe('日期校验', () => {
  it('接受今天与闰日', () => {
    expect(validateDate('2026-11-17', TODAY).ok).toBe(true);
    expect(validateDate('2024-02-29', TODAY).ok).toBe(true);
    expect(toISODate(TODAY)).toBe('2026-11-17');
  });

  it('拒绝错误格式、假日期、过早与过远未来', () => {
    expect(validateDate('17/11/2026', TODAY)).toMatchObject({ ok: false });
    expect(validateDate('2023-02-29', TODAY).reason).toContain('日历');
    expect(validateDate('1999-12-31', TODAY).reason).toContain('2000');
    expect(validateDate('2026-11-20', TODAY).reason).toContain('明天');
  });

  it('允许明天作为时区缓冲，拒绝空值', () => {
    expect(validateDate('2026-11-18', TODAY).ok).toBe(true);
    expect(validateDate('', TODAY).ok).toBe(false);
    expect(validateDate(null, TODAY).ok).toBe(false);
  });
});
