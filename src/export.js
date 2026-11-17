/** CSV / GeoJSON / JSON serializers. Pure functions, safe to unit test. */
import { getStage } from './bbch.js';

export const CSV_HEADERS = [
  '记录ID',
  '地块',
  '品种',
  '海拔(m)',
  'BBCH编码',
  '阶段',
  '日期',
  '纬度',
  '经度',
  '定位精度(m)',
  '备注',
  '演示数据',
  '创建时间',
  '更新时间'
];

export function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(text) || /^\s|\s$/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function plotMapOf(plots) {
  return new Map((plots || []).map((plot) => [plot.id, plot]));
}

/** UTF-8 BOM makes Excel open the file as Unicode. */
export function toCSV(records, plots) {
  const plotMap = plotMapOf(plots);
  const lines = [CSV_HEADERS.map(csvEscape).join(',')];
  for (const record of records) {
    const plot = plotMap.get(record.plot_id);
    lines.push(
      [
        record.id,
        plot?.name ?? record.plot_name ?? '',
        plot?.variety ?? record.plot_variety ?? '',
        plot?.elevation_m ?? '',
        record.stage_code,
        record.stage_label || getStage(record.stage_code)?.short || '',
        record.date,
        record.lat ?? '',
        record.lon ?? '',
        record.accuracy_m ?? '',
        record.note ?? '',
        record.demo ? '是' : '否',
        record.created_at ?? '',
        record.updated_at ?? ''
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function hasUsableCoordinates(record) {
  return (
    Number.isFinite(record.lat) &&
    Number.isFinite(record.lon) &&
    record.lat >= -90 &&
    record.lat <= 90 &&
    record.lon >= -180 &&
    record.lon <= 180
  );
}

export function toGeoJSON(records, plots) {
  const plotMap = plotMapOf(plots);
  const features = records.filter(hasUsableCoordinates).map((record) => {
    const plot = plotMap.get(record.plot_id);
    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [record.lon, record.lat]
      },
      properties: {
        id: record.id,
        plot_id: record.plot_id,
        plot: plot?.name ?? record.plot_name ?? '',
        variety: plot?.variety ?? record.plot_variety ?? '',
        elevation_m: plot?.elevation_m ?? null,
        stage_code: record.stage_code,
        stage_label: record.stage_label || getStage(record.stage_code)?.short || '',
        date: record.date,
        accuracy_m: record.accuracy_m ?? null,
        note: record.note ?? '',
        demo: Boolean(record.demo)
      }
    };
  });
  return {
    type: 'FeatureCollection',
    features
  };
}

export function toJSON(plots, records) {
  return {
    schema: 'vinewatch-export',
    version: 1,
    app: 'vinewatch',
    exported_at: new Date().toISOString(),
    counts: { plots: plots.length, records: records.length },
    plots,
    records
  };
}

export function parseImportText(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('JSON 语法错误，无法解析');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('文件内容不是对象');
  }
  if (payload.schema !== 'vinewatch-export') {
    throw new Error('不是 vinewatch 备份文件（缺少 schema 标记）');
  }
  return payload;
}

export function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}`;
}

export function filename(extension, date = new Date()) {
  return `vinewatch-${stamp(date)}.${extension}`;
}
