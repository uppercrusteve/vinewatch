import { describe, expect, it } from 'vitest';
import {
  CSV_HEADERS,
  csvEscape,
  filename,
  parseImportText,
  toCSV,
  toGeoJSON,
  toJSON,
  stamp
} from '../src/export.js';

const plots = [{ id: 'p1', name: '东坡, "A3"', variety: '霞多丽', elevation_m: 2200 }];
const records = [
  {
    id: 'r1',
    plot_id: 'p1',
    stage_code: '65',
    stage_label: '盛花',
    date: '2026-06-10',
    lat: 27.82,
    lon: 98.95,
    accuracy_m: 4,
    note: '第一行\n含 "引号", 逗号',
    demo: true,
    created_at: '2026-06-10T08:00:00.000Z',
    updated_at: '2026-06-10T08:00:00.000Z'
  },
  {
    id: 'r2',
    plot_id: 'p1',
    stage_code: '71',
    stage_label: '坐果',
    date: '2026-06-20',
    lat: null,
    lon: null,
    note: '无坐标',
    demo: false
  }
];

describe('CSV', () => {
  it('转义逗号、引号和换行', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    expect(csvEscape('plain')).toBe('plain');
  });

  it('以 UTF-8 BOM 开头、CRLF 分行并含表头', () => {
    const csv = toCSV(records, plots);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.startsWith(`﻿${CSV_HEADERS[0]}`)).toBe(true);
    expect(csv).toContain('\r\n');
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(3);
  });

  it('正确合并地块信息并标记演示数据', () => {
    const csv = toCSV(records, plots);
    expect(csv).toContain('"东坡, ""A3"""');
    expect(csv).toContain('霞多丽');
    expect(csv).toContain('"第一行\n含 ""引号"", 逗号"');
    expect(csv).toContain(',是,');
    expect(csv).toContain(',否,');
    expect(csv).not.toContain('undefined');
  });

  it('空记录仍输出表头与 BOM', () => {
    const csv = toCSV([], []);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.trim().split('\r\n')).toHaveLength(1);
  });
});

describe('GeoJSON', () => {
  it('只保留有坐标的记录并使用 [lon, lat]', () => {
    const geo = toGeoJSON(records, plots);
    expect(geo.type).toBe('FeatureCollection');
    expect(geo.features).toHaveLength(1);
    expect(geo.features[0].geometry.coordinates).toEqual([98.95, 27.82]);
    expect(geo.features[0].properties.stage_code).toBe('65');
    expect(geo.features[0].properties.demo).toBe(true);
  });

  it('过滤越界坐标与缺失坐标', () => {
    const geo = toGeoJSON(
      [
        { ...records[0], id: 'x', lat: 91, lon: 0 },
        { ...records[0], id: 'y', lat: 0, lon: 181 },
        { ...records[0], id: 'z', lat: null, lon: 0 },
        { ...records[0], id: 'ok', lat: -33.9, lon: 151.2 }
      ],
      plots
    );
    expect(geo.features.map((feature) => feature.properties.id)).toEqual(['ok']);
  });

  it('坐标必须是数字而非字符串', () => {
    const geo = toGeoJSON([{ ...records[0], lat: '27.8', lon: '98.9' }], plots);
    expect(geo.features).toHaveLength(0);
  });
});

describe('JSON 备份与解析', () => {
  it('生成带 schema、版本和计数的信封', () => {
    const payload = toJSON(plots, records);
    expect(payload.schema).toBe('vinewatch-export');
    expect(payload.version).toBe(1);
    expect(payload.counts).toEqual({ plots: 1, records: 2 });
    expect(payload.exported_at).toMatch(/Z$/);
  });

  it('parseImportText 区分语法错误与错误 schema', () => {
    expect(() => parseImportText('{broken')).toThrow('语法');
    expect(() => parseImportText('[]')).toThrow('对象');
    expect(() => parseImportText('{"schema":"nope"}')).toThrow('schema');
    expect(parseImportText('{"schema":"vinewatch-export","records":[],"plots":[]}').schema).toBe(
      'vinewatch-export'
    );
  });

  it('文件名带稳定时间戳', () => {
    const date = new Date(2026, 10, 17, 9, 5);
    expect(stamp(date)).toBe('20261117-0905');
    expect(filename('csv', date)).toBe('vinewatch-20261117-0905.csv');
  });
});
