import { beforeEach, describe, expect, it } from 'vitest';
import {
  countRecordsByPlot,
  createPlot,
  createRecord,
  deletePlot,
  deleteRecord,
  exportAll,
  getRecord,
  getStats,
  importData,
  listPlots,
  listRecords,
  updatePlot,
  updateRecord
} from '../src/db.js';
import { toISODate } from '../src/bbch.js';

const today = toISODate(new Date());
let plotA;
let plotB;

async function makePlot(name, variety = '霞多丽') {
  return createPlot({ name, variety, elevation_m: 2100, row_note: 'A 行' });
}

async function makeRecord(plotId, overrides = {}) {
  return createRecord({
    plot_id: plotId,
    stage_code: '65',
    date: today,
    lat: 27.82,
    lon: 98.95,
    accuracy_m: 5,
    note: '盛花期观测',
    ...overrides
  });
}

beforeEach(async () => {
  plotA = await makePlot('东坡 A3');
  plotB = await makePlot('西坡 B1', '赤霞珠');
});

describe('地块 CRUD', () => {
  it('创建时修剪文本并四舍五入海拔', async () => {
    const plot = await createPlot({ name: '  河滩 C2  ', variety: ' 品丽珠 ', elevation_m: '2050.26' });
    expect(plot.name).toBe('河滩 C2');
    expect(plot.variety).toBe('品丽珠');
    expect(plot.elevation_m).toBe(2050.3);
    expect(plot.id).toMatch(/^plot_/);
  });

  it('拒绝空名称与非法海拔', async () => {
    await expect(createPlot({ name: '   ' })).rejects.toThrow('名称不能为空');
    await expect(createPlot({ name: 'X', elevation_m: 'abc' })).rejects.toThrow('海拔');
    await expect(createPlot({ name: 'X', elevation_m: 9000 })).rejects.toThrow('0–7000');
  });

  it('重命名并保留 created_at', async () => {
    const updated = await updatePlot(plotA.id, { name: '东坡 A4' });
    expect(updated.name).toBe('东坡 A4');
    expect(updated.created_at).toBe(plotA.created_at);
    expect((await listPlots()).map((plot) => plot.name)).toContain('东坡 A4');
  });

  it('删除地块会级联删除其记录，保留其他地块', async () => {
    await makeRecord(plotA.id);
    await makeRecord(plotA.id, { stage_code: '71' });
    const keep = await makeRecord(plotB.id);
    const removed = await deletePlot(plotA.id);
    expect(removed).toBe(2);
    expect((await listPlots()).map((plot) => plot.id)).toEqual([plotB.id]);
    const records = (await listRecords()).items;
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe(keep.id);
  });

  it('统计每地块记录数', async () => {
    await makeRecord(plotA.id);
    await makeRecord(plotA.id);
    await makeRecord(plotB.id);
    expect(await countRecordsByPlot()).toEqual({ [plotA.id]: 2, [plotB.id]: 1 });
  });
});

describe('记录 CRUD 与筛选', () => {
  it('创建记录时填入阶段标签与时间戳', async () => {
    const record = await makeRecord(plotA.id, { stage_code: '79' });
    expect(record.stage_label).toBe('封穗');
    expect(record.created_at).toBeTruthy();
    expect(record.updated_at).toBeTruthy();
    expect(record.demo).toBe(false);
  });

  it('要求有效阶段、已有地块与合法日期', async () => {
    await expect(makeRecord(plotA.id, { stage_code: '99' })).rejects.toThrow('BBCH');
    await expect(makeRecord('plot_missing')).rejects.toThrow('地块不存在');
    await expect(makeRecord(plotA.id, { date: '2026-13-01' })).rejects.toThrow();
  });

  it('经纬度必须成对且在范围内', async () => {
    await expect(makeRecord(plotA.id, { lon: null })).rejects.toThrow('同时');
    await expect(makeRecord(plotA.id, { lat: 91 })).rejects.toThrow('纬度');
    await expect(makeRecord(plotA.id, { lat: null, lon: null, accuracy_m: null })).resolves.toBeTruthy();
  });

  it('列表按日期倒序并附带地块信息', async () => {
    await makeRecord(plotA.id, { date: '2026-06-01' });
    await makeRecord(plotB.id, { date: '2026-08-01' });
    await makeRecord(plotA.id, { date: '2026-07-01' });
    const records = (await listRecords()).items;
    expect(records.map((record) => record.date)).toEqual(['2026-08-01', '2026-07-01', '2026-06-01']);
    expect(records[0].plot_name).toBe('西坡 B1');
    expect(records[0].stage_color).toMatch(/^#/);
  });

  it('按地块、阶段与关键词筛选，搜索不区分大小写', async () => {
    await makeRecord(plotA.id, { note: 'Powdery mildew 初现' });
    await makeRecord(plotB.id, { stage_code: '81', note: '开始转色' });
    expect((await listRecords({ plotId: plotB.id })).items).toHaveLength(1);
    expect((await listRecords({ stageCode: '65' })).items).toHaveLength(1);
    expect((await listRecords({ query: 'POWDERY' })).items).toHaveLength(1);
    expect((await listRecords({ query: '西坡' })).items).toHaveLength(1);
    expect((await listRecords({ query: '不存在' })).items).toHaveLength(0);
  });

  it('更新记录写入新值并刷新 updated_at', async () => {
    const record = await makeRecord(plotA.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = await updateRecord(record.id, { note: '更正：实际为初花', stage_code: '60' });
    expect(updated.note).toContain('初花');
    expect(updated.stage_label).toBe('初花');
    expect(updated.updated_at >= record.updated_at).toBe(true);
    expect(updated.created_at).toBe(record.created_at);
  });

  it('拒绝把记录改到不存在的地块', async () => {
    const record = await makeRecord(plotA.id);
    await expect(updateRecord(record.id, { plot_id: 'plot_ghost' })).rejects.toThrow('地块不存在');
    expect((await getRecord(record.id)).plot_id).toBe(plotA.id);
  });

  it('删除单条记录后不再返回', async () => {
    const record = await makeRecord(plotA.id);
    await deleteRecord(record.id);
    expect(await getRecord(record.id)).toBeUndefined();
    expect((await listRecords()).items).toHaveLength(0);
  });

  it('统计返回总数、今日、地块数与最近阶段', async () => {
    await makeRecord(plotA.id, { stage_code: '65', date: '2026-06-01' });
    await makeRecord(plotB.id, { stage_code: '89', date: '2026-09-01' });
    await makeRecord(plotA.id, { stage_code: '91', date: '2026-10-01' });
    const stats = await getStats(today);
    expect(stats.total).toBe(3);
    expect(stats.today).toBe(0);
    expect(stats.plots).toBe(2);
    expect(stats.latestStage.code).toBe('91');
  });

  it('同一天取后录入的记录作为最近阶段', async () => {
    await makeRecord(plotA.id, { stage_code: '65', date: '2026-08-01' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await makeRecord(plotA.id, { stage_code: '89', date: '2026-08-01' });
    const stats = await getStats(today);
    expect(stats.latestStage.code).toBe('89');
  });
});

describe('JSON 导入', () => {
  it('备份可完整回灌并全部按重复跳过', async () => {
    await makeRecord(plotA.id);
    await makeRecord(plotB.id, { stage_code: '85' });
    const backup = await exportAll();
    const payload = { schema: 'vinewatch-export', version: 1, plots: backup.plots, records: backup.records };
    const result = await importData(payload);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(2);
    expect((await listRecords()).items).toHaveLength(2);
  });

  it('跳过无效记录并返回逐行原因', async () => {
    const payload = {
      schema: 'vinewatch-export',
      version: 1,
      plots: [],
      records: [
        { plot_id: plotA.id, stage_code: '99', date: today },
        { plot_id: 'plot_missing', stage_code: '65', date: today },
        { plot_id: plotA.id, stage_code: '65', date: '2026-02-30' }
      ]
    };
    const result = await importData(payload);
    expect(result.imported).toBe(0);
    expect(result.errors).toHaveLength(3);
    expect(result.errors[0]).toContain('BBCH');
    expect(result.errors[1]).toContain('地块不存在');
  });

  it('可导入新地块和新记录', async () => {
    const payload = {
      schema: 'vinewatch-export',
      version: 1,
      plots: [{ id: 'plot_imported', name: '南坡 D4', variety: '马瑟兰', elevation_m: 2400 }],
      records: [
        { id: 'rec_imported', plot_id: 'plot_imported', stage_code: '73', date: '2026-07-05' }
      ]
    };
    const result = await importData(payload);
    expect(result.imported).toBe(1);
    expect(result.plotsAdded).toBe(1);
    expect(result.errors).toEqual([]);
    const records = (await listRecords()).items;
    expect(records[0].plot_name).toBe('南坡 D4');
  });

  it('拒绝错误 schema 与缺失数组', async () => {
    await expect(importData({ schema: 'other', records: [], plots: [] })).rejects.toThrow('vinewatch');
    await expect(importData({ schema: 'vinewatch-export', plots: [] })).rejects.toThrow('records');
  });
});

describe('导入去重指纹', () => {
  it('保留仅照片或定位精度不同的两条记录', async () => {
    const base = {
      plot_id: plotA.id,
      stage_code: '65',
      date: today,
      lat: 27.8,
      lon: 98.9,
      note: '同备注'
    };
    const payload = {
      schema: 'vinewatch-export',
      version: 1,
      plots: [],
      records: [
        { ...base, id: 'rec_photo_a', accuracy_m: 3, photo: 'data:image/jpeg;base64,AAA' },
        { ...base, id: 'rec_photo_b', accuracy_m: 25, photo: 'data:image/jpeg;base64,BBB' }
      ]
    };
    const result = await importData(payload);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
    expect((await listRecords()).total).toBe(2);
  });

  it('同一份备份重复导入仍按指纹跳过', async () => {
    const payload = {
      schema: 'vinewatch-export',
      version: 1,
      plots: [],
      records: [{ id: 'rec_once', plot_id: plotA.id, stage_code: '65', date: today, note: '唯一' }]
    };
    expect((await importData(payload)).imported).toBe(1);
    const second = await importData(payload);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);
  });
});
