/**
 * Minimal IndexedDB wrapper. No external library.
 * Every record write validates foreign keys and dates so exports stay clean.
 */
import { getStage, isStageCode, validateDate, toISODate } from './bbch.js';

export const DB_NAME = 'vinewatch';
export const DB_VERSION = 1;
const PLOTS = 'plots';
const RECORDS = 'records';

let dbHandle = null;

export function newId(prefix = 'id') {
  const uuid =
    globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${uuid}`;
}

export function openDB() {
  if (dbHandle) return Promise.resolve(dbHandle);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PLOTS)) {
        const store = db.createObjectStore(PLOTS, { keyPath: 'id' });
        store.createIndex('name', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains(RECORDS)) {
        const store = db.createObjectStore(RECORDS, { keyPath: 'id' });
        store.createIndex('plot_id', 'plot_id', { unique: false });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('stage_code', 'stage_code', { unique: false });
      }
    };
    request.onsuccess = () => {
      dbHandle = request.result;
      dbHandle.onversionchange = () => {
        dbHandle.close();
        dbHandle = null;
      };
      resolve(dbHandle);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function resetDB() {
  if (dbHandle) {
    dbHandle.close();
    dbHandle = null;
  }
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

function waitTx(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('事务已中止'));
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function cleanText(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function parseElevation(value) {
  if (value === '' || value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return NaN;
  return Math.round(num * 10) / 10;
}

function parseCoord(value) {
  if (value === '' || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

function normalizePlot(input, id = newId('plot')) {
  const name = cleanText(input.name, 60);
  if (!name) throw new Error('地块名称不能为空');
  const elevation = parseElevation(input.elevation_m);
  if (Number.isNaN(elevation)) throw new Error('海拔必须是数字');
  if (elevation !== null && (elevation < 0 || elevation > 7000)) {
    throw new Error('海拔应在 0–7000 m 之间');
  }
  const now = new Date().toISOString();
  return {
    id,
    name,
    variety: cleanText(input.variety, 60),
    elevation_m: elevation,
    row_note: cleanText(input.row_note, 80),
    created_at: input.created_at || now
  };
}

export async function listPlots() {
  const db = await openDB();
  const tx = db.transaction(PLOTS, 'readonly');
  const plots = await requestToPromise(tx.objectStore(PLOTS).getAll());
  return plots.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function getPlot(id) {
  const db = await openDB();
  return requestToPromise(db.transaction(PLOTS, 'readonly').objectStore(PLOTS).get(id));
}

export async function createPlot(input) {
  const plot = normalizePlot(input);
  const db = await openDB();
  const tx = db.transaction(PLOTS, 'readwrite');
  tx.objectStore(PLOTS).add(plot);
  await waitTx(tx);
  return plot;
}

export async function updatePlot(id, patch) {
  const existing = await getPlot(id);
  if (!existing) throw new Error('地块不存在');
  const merged = normalizePlot({ ...existing, ...patch }, id);
  merged.created_at = existing.created_at;
  const db = await openDB();
  const tx = db.transaction(PLOTS, 'readwrite');
  tx.objectStore(PLOTS).put(merged);
  await waitTx(tx);
  return merged;
}

/** Deletes a plot and all of its records in one transaction. */
export async function deletePlot(id) {
  const db = await openDB();
  const tx = db.transaction([PLOTS, RECORDS], 'readwrite');
  const records = tx.objectStore(RECORDS);
  const index = records.index('plot_id');
  let removed = 0;
  await new Promise((resolve, reject) => {
    const cursorReq = index.openKeyCursor(IDBKeyRange.only(id));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) {
        resolve();
        return;
      }
      records.delete(cursor.primaryKey);
      removed += 1;
      cursor.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
  tx.objectStore(PLOTS).delete(id);
  await waitTx(tx);
  return removed;
}

function normalizeRecord(input, id = newId('rec')) {
  const plotId = cleanText(input.plot_id, 80);
  if (!plotId) throw new Error('请选择地块');
  const stageCode = String(input.stage_code ?? '');
  const stage = getStage(stageCode);
  if (!stage) throw new Error('请选择有效的 BBCH 阶段');
  const dateCheck = validateDate(input.date);
  if (!dateCheck.ok) throw new Error(dateCheck.reason);

  const lat = parseCoord(input.lat);
  const lon = parseCoord(input.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) throw new Error('经纬度必须是数字');
  if ((lat === null) !== (lon === null)) throw new Error('经纬度必须同时提供');
  if (lat !== null && (lat < -90 || lat > 90)) throw new Error('纬度应在 -90–90 之间');
  if (lon !== null && (lon < -180 || lon > 180)) throw new Error('经度应在 -180–180 之间');

  const accuracy = parseCoord(input.accuracy_m);
  if (Number.isNaN(accuracy)) throw new Error('定位精度必须是数字');

  const photo = typeof input.photo === 'string' && input.photo.startsWith('data:image/')
    ? input.photo
    : null;
  if (photo && photo.length > 4_000_000) throw new Error('照片过大，请重新压缩');

  const now = new Date().toISOString();
  return {
    id,
    plot_id: plotId,
    stage_code: stage.code,
    stage_label: stage.short,
    date: dateCheck.value,
    lat,
    lon,
    accuracy_m: accuracy === null ? null : Math.round(accuracy),
    photo,
    note: cleanText(input.note, 1200),
    demo: Boolean(input.demo),
    created_at: input.created_at || now,
    updated_at: now
  };
}

export async function createRecord(input) {
  const record = normalizeRecord(input);
  const db = await openDB();
  const tx = db.transaction([RECORDS, PLOTS], 'readwrite');
  const plot = await requestToPromise(tx.objectStore(PLOTS).get(record.plot_id));
  if (!plot) {
    tx.abort();
    await waitTx(tx).catch(() => {});
    throw new Error('所选地块不存在');
  }
  tx.objectStore(RECORDS).add(record);
  await waitTx(tx);
  return record;
}

export async function updateRecord(id, patch) {
  const db = await openDB();
  // Read and write inside one readwrite transaction. IndexedDB serialises
  // readwrite transactions on the same stores, so a concurrent edit from
  // another tab can no longer overwrite fields it never touched.
  const tx = db.transaction([RECORDS, PLOTS], 'readwrite');
  const store = tx.objectStore(RECORDS);
  const existing = await requestToPromise(store.get(id));
  if (!existing) {
    tx.abort();
    await waitTx(tx).catch(() => {});
    throw new Error('记录不存在');
  }
  const plotId = patch.plot_id || existing.plot_id;
  const plot = await requestToPromise(tx.objectStore(PLOTS).get(plotId));
  if (!plot) {
    tx.abort();
    await waitTx(tx).catch(() => {});
    throw new Error('所选地块不存在');
  }
  const merged = normalizeRecord({ ...existing, ...patch, plot_id: plotId }, id);
  merged.created_at = existing.created_at;
  merged.demo = patch.demo ?? existing.demo;
  store.put(merged);
  await waitTx(tx);
  return merged;
}

export async function getRecord(id) {
  const db = await openDB();
  return requestToPromise(db.transaction(RECORDS, 'readonly').objectStore(RECORDS).get(id));
}

export async function deleteRecord(id) {
  const db = await openDB();
  const tx = db.transaction(RECORDS, 'readwrite');
  tx.objectStore(RECORDS).delete(id);
  await waitTx(tx);
}

/**
 * Lists records newest-first with optional search and filters.
 * Search covers plot name, variety, stage label, note and date.
 * @returns {Promise<{items: object[], total: number}>} the requested page
 *   plus the total number of matches, so callers can show what was cut off.
 */
export async function listRecords({ query = '', plotId = '', stageCode = '', limit = 500 } = {}) {
  const [plots, records] = await Promise.all([
    listPlots(),
    (async () => {
      const db = await openDB();
      return requestToPromise(db.transaction(RECORDS, 'readonly').objectStore(RECORDS).getAll());
    })()
  ]);
  const plotMap = new Map(plots.map((plot) => [plot.id, plot]));
  const needle = String(query).trim().toLowerCase();
  const withPlot = records
    .filter((record) => {
      if (plotId && record.plot_id !== plotId) return false;
      if (stageCode && record.stage_code !== stageCode) return false;
      if (!needle) return true;
      const plot = plotMap.get(record.plot_id);
      const haystack = [
        plot?.name,
        plot?.variety,
        record.stage_label,
        record.stage_code,
        record.note,
        record.date
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    })
    .map((record) => {
      const plot = plotMap.get(record.plot_id);
      return {
        ...record,
        plot_name: plot ? plot.name : '（地块已删除）',
        plot_variety: plot ? plot.variety : '',
        stage_color: getStage(record.stage_code)?.color || '#777'
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
  return { items: withPlot.slice(0, limit), total: withPlot.length };
}

export async function countRecordsByPlot() {
  const db = await openDB();
  const tx = db.transaction(RECORDS, 'readonly');
  const index = tx.objectStore(RECORDS).index('plot_id');
  const counts = {};
  await new Promise((resolve, reject) => {
    const request = index.openKeyCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      counts[cursor.key] = (counts[cursor.key] || 0) + 1;
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
  return counts;
}

export async function getStats(today = toISODate(new Date())) {
  const db = await openDB();
  const tx = db.transaction(RECORDS, 'readonly');
  const all = await requestToPromise(tx.objectStore(RECORDS).getAll());
  const plots = new Set(all.map((record) => record.plot_id));
  let latest = null;
  for (const record of all) {
    if (!getStage(record.stage_code)) continue;
    if (!latest) {
      latest = record;
      continue;
    }
    // Same day: the row entered later wins, matching what the user just saw.
    if (record.date !== latest.date) {
      if (record.date > latest.date) latest = record;
    } else if (String(record.created_at) > String(latest.created_at)) {
      latest = record;
    }
  }
  return {
    total: all.length,
    today: all.filter((record) => record.date === today).length,
    plots: plots.size,
    latestStage: latest ? getStage(latest.stage_code) : null,
    latestDate: latest ? latest.date : null
  };
}

export async function exportAll() {
  const [plots, records] = await Promise.all([
    listPlots(),
    (async () => {
      const db = await openDB();
      return requestToPromise(db.transaction(RECORDS, 'readonly').objectStore(RECORDS).getAll());
    })()
  ]);
  records.sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at));
  return { plots, records };
}

function photoKey(photo) {
  // Full data URLs reach megabytes, so fingerprints keep only the length and
  // both ends. Two different photos matching all three is vanishingly rare.
  if (!photo) return '';
  return `${photo.length}:${photo.slice(0, 32)}:${photo.slice(-32)}`;
}

export function fingerprint(record) {
  return [
    record.plot_id,
    record.stage_code,
    record.date,
    record.lat ?? '',
    record.lon ?? '',
    record.accuracy_m ?? '',
    photoKey(record.photo),
    String(record.note ?? '').trim()
  ].join('|');
}

/**
 * Validates and merges a JSON backup. Duplicate ids and duplicate
 * (plot, stage, date, coordinates, note) fingerprints are skipped.
 * @returns {Promise<{imported:number, skipped:number, plotsAdded:number, errors:string[]}>}
 */
export async function importData(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('导入文件不是对象');
  if (payload.schema !== 'vinewatch-export') throw new Error('不是 vinewatch 导出文件');
  if (!Array.isArray(payload.records)) throw new Error('缺少 records 数组');
  if (!Array.isArray(payload.plots)) throw new Error('缺少 plots 数组');

  const errors = [];
  const existing = await exportAll();
  const plotMap = new Map(existing.plots.map((plot) => [plot.id, plot]));
  const recordIds = new Set(existing.records.map((record) => record.id));
  const fingerprints = new Set(existing.records.map(fingerprint));
  let plotsAdded = 0;

  const acceptedPlots = [];
  payload.plots.forEach((raw, index) => {
    try {
      if (!raw || typeof raw !== 'object') throw new Error('地块不是对象');
      if (raw.id && plotMap.has(String(raw.id))) return;
      const plot = normalizePlot(raw, raw.id ? String(raw.id) : newId('plot'));
      if ([...plotMap.values()].some((item) => item.name === plot.name)) {
        // Keep distinct plots even with equal names, but reuse the id only when explicit.
      }
      plotMap.set(plot.id, plot);
      acceptedPlots.push(plot);
      plotsAdded += 1;
    } catch (error) {
      errors.push(`地块 #${index + 1}：${error.message}`);
    }
  });

  const acceptedRecords = [];
  let skipped = 0;
  payload.records.forEach((raw, index) => {
    try {
      if (!raw || typeof raw !== 'object') throw new Error('记录不是对象');
      const plotId = String(raw.plot_id ?? '');
      if (!plotMap.has(plotId)) throw new Error('引用的地块不存在');
      if (raw.id && recordIds.has(String(raw.id))) {
        skipped += 1;
        return;
      }
      const record = normalizeRecord({ ...raw, plot_id: plotId }, raw.id ? String(raw.id) : newId('rec'));
      if (recordIds.has(record.id)) {
        skipped += 1;
        return;
      }
      const fp = fingerprint(record);
      if (fingerprints.has(fp)) {
        skipped += 1;
        return;
      }
      recordIds.add(record.id);
      fingerprints.add(fp);
      acceptedRecords.push(record);
    } catch (error) {
      errors.push(`记录 #${index + 1}：${error.message}`);
    }
  });

  if (acceptedPlots.length || acceptedRecords.length) {
    const db = await openDB();
    const tx = db.transaction([PLOTS, RECORDS], 'readwrite');
    const plotStore = tx.objectStore(PLOTS);
    const recordStore = tx.objectStore(RECORDS);
    for (const plot of acceptedPlots) plotStore.put(plot);
    for (const record of acceptedRecords) recordStore.put(record);
    await waitTx(tx);
  }

  return {
    imported: acceptedRecords.length,
    skipped,
    plotsAdded: acceptedPlots.length,
    errors: errors.slice(0, 50)
  };
}

export async function clearAll() {
  const db = await openDB();
  const tx = db.transaction([PLOTS, RECORDS], 'readwrite');
  tx.objectStore(PLOTS).clear();
  tx.objectStore(RECORDS).clear();
  await waitTx(tx);
}
