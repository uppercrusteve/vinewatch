import { BBCH_GROUPS, getStage, toISODate, validateDate } from './bbch.js';
import {
  createPlot,
  createRecord,
  deletePlot,
  deleteRecord,
  getStats,
  importData,
  listPlots,
  listRecords,
  countRecordsByPlot,
  clearAll,
  deleteRecord as removeRecord,
  exportAll,
  updatePlot,
  updateRecord
} from './db.js';
import { compressImage, formatBytes } from './photo.js';
import { filename, parseImportText, toCSV, toGeoJSON, toJSON } from './export.js';
import { loadDemo } from './seed.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  tab: 'records',
  editingRecord: null,
  editingPlot: null,
  photo: null,
  gps: null,
  query: '',
  filterPlot: '',
  filterStage: '',
  records: [],
  plots: [],
  counts: {},
  stats: null,
  busy: false
};

let toastTimer = null;
let searchTimer = null;

function toast(message, kind = 'ok') {
  const el = $('#toast');
  el.textContent = message;
  el.dataset.kind = kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, kind === 'error' ? 5200 : 3200);
}

function showError(target, message) {
  const el = $(target);
  el.textContent = message;
  el.hidden = !message;
}

function tomorrowISO() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return toISODate(date);
}

/* ---------------- tabs ---------------- */

function activateTab(name, { focus = false } = {}) {
  if (!['records', 'plots', 'export'].includes(name)) name = 'records';
  state.tab = name;
  $$('.tab').forEach((tab) => {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  });
  $$('.panel').forEach((panel) => {
    panel.hidden = panel.id !== `panel-${name}`;
  });
  if (name === 'export') renderExport();
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
}

function bindTabs() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
    tab.addEventListener('keydown', (event) => {
      const names = ['records', 'plots', 'export'];
      const index = names.indexOf(state.tab);
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        activateTab(names[(index + 1) % names.length], { focus: true });
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        activateTab(names[(index + names.length - 1) % names.length], { focus: true });
      } else if (event.key === 'Home') {
        event.preventDefault();
        activateTab(names[0], { focus: true });
      } else if (event.key === 'End') {
        event.preventDefault();
        activateTab(names[names.length - 1], { focus: true });
      }
    });
  });
  $$('[data-go]').forEach((button) => {
    button.addEventListener('click', () => activateTab(button.dataset.go, { focus: true }));
  });
}

/* ---------------- stage picker ---------------- */

function buildStagePicker() {
  const picker = $('#stage-picker');
  const fragment = document.createDocumentFragment();
  BBCH_GROUPS.forEach((group) => {
    const wrap = document.createElement('div');
    wrap.className = 'stage-group';
    wrap.style.setProperty('--group-color', group.color);
    const head = document.createElement('p');
    head.className = 'stage-group-head';
    head.textContent = `${group.label} · ${group.stages.length}`;
    const chips = document.createElement('div');
    chips.className = 'stage-chips';
    group.stages.forEach((stage) => {
      const label = document.createElement('label');
      label.className = 'stage-chip';
      label.style.setProperty('--stage-color', group.color);
      label.title = stage.description;
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'stage_code';
      input.value = stage.code;
      input.setAttribute('aria-label', `${stage.code} ${stage.short}：${stage.description}`);
      const text = document.createElement('span');
      const code = document.createElement('b');
      code.textContent = stage.code;
      text.append(code, document.createTextNode(stage.short));
      label.append(input, text);
      chips.append(label);
    });
    wrap.append(head, chips);
    fragment.append(wrap);
  });
  picker.append(fragment);

  picker.addEventListener('change', (event) => {
    if (event.target.name !== 'stage_code') return;
    const stage = getStage(event.target.value);
    const preview = $('#stage-preview');
    preview.textContent = stage
      ? `${stage.code} ${stage.short}（${stage.groupLabel}）：${stage.description}`
      : '尚未选择阶段。';
    preview.style.borderLeftColor = stage ? stage.color : '';
  });
}

function renderStageSelect() {
  const select = $('#filter-stage');
  const current = select.value;
  select.innerHTML = '<option value="">全部阶段</option>';
  for (const group of BBCH_GROUPS) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.label;
    for (const stage of group.stages) {
      const option = document.createElement('option');
      option.value = stage.code;
      option.textContent = `${stage.code} ${stage.short}`;
      optgroup.append(option);
    }
    select.append(optgroup);
  }
  select.value = current;
}

/* ---------------- rendering ---------------- */

function renderStats() {
  const stats = state.stats || { total: 0, today: 0, plots: 0, latestStage: null, latestDate: null };
  $('#stat-total').textContent = String(stats.total);
  $('#stat-today').textContent = String(stats.today);
  $('#stat-plots').textContent = String(stats.plots);
  const latestEl = $('#stat-latest');
  latestEl.textContent = stats.latestStage
    ? `${stats.latestStage.code} ${stats.latestStage.short}`
    : '—';
  latestEl.style.color = stats.latestStage ? stats.latestStage.color : '';
  $('#stat-latest-date').textContent = stats.latestDate ? `最近记录于 ${stats.latestDate}` : '尚无记录';
}

function renderPlotOptions() {
  const recordSelect = $('#record-plot');
  const filterSelect = $('#filter-plot');
  const recordCurrent = recordSelect.value;
  const filterCurrent = state.filterPlot;

  recordSelect.innerHTML = '<option value="">— 请选择地块 —</option>';
  filterSelect.innerHTML = '<option value="">全部地块</option>';
  for (const plot of state.plots) {
    const option = document.createElement('option');
    option.value = plot.id;
    option.textContent = plot.variety ? `${plot.name}（${plot.variety}）` : plot.name;
    recordSelect.append(option);
    filterSelect.append(option.cloneNode(true));
  }
  if (state.plots.some((plot) => plot.id === recordCurrent)) recordSelect.value = recordCurrent;
  if (state.plots.some((plot) => plot.id === filterCurrent)) filterSelect.value = filterCurrent;
  else state.filterPlot = '';
}

function renderPlotList() {
  const list = $('#plot-list');
  list.textContent = '';
  for (const plot of state.plots) {
    const item = document.createElement('li');
    item.className = 'plot';

    const info = document.createElement('div');
    info.className = 'plot-info';
    const name = document.createElement('p');
    name.className = 'plot-name';
    name.textContent = plot.name;
    info.append(name);
    const bits = [plot.variety, plot.elevation_m !== null ? `${plot.elevation_m} m` : '', plot.row_note]
      .filter(Boolean)
      .join(' · ');
    if (bits) {
      const sub = document.createElement('p');
      sub.className = 'plot-sub';
      sub.textContent = bits;
      info.append(sub);
    }
    const count = document.createElement('p');
    count.className = 'plot-count';
    count.textContent = `记录 ${state.counts[plot.id] || 0} 条`;
    info.append(count);

    const actions = document.createElement('div');
    actions.className = 'plot-actions';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'icon-btn';
    editBtn.setAttribute('aria-label', `编辑地块 ${plot.name}`);
    editBtn.innerHTML = '<svg aria-hidden="true"><use href="#i-edit"/></svg>';
    editBtn.addEventListener('click', () => startPlotEdit(plot));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'icon-btn';
    delBtn.setAttribute('aria-label', `删除地块 ${plot.name}`);
    delBtn.innerHTML = '<svg aria-hidden="true"><use href="#i-trash"/></svg>';
    delBtn.addEventListener('click', () => removePlot(plot));

    actions.append(editBtn, delBtn);
    item.append(info, actions);
    list.append(item);
  }
  $('#plot-count').textContent = String(state.plots.length);
  $('#plot-empty').hidden = state.plots.length > 0;
}

function recordListItem(record) {
  const item = document.createElement('li');
  item.className = 'record';
  item.style.setProperty('--stage-color', record.stage_color || '#777');

  const main = document.createElement('div');
  main.className = 'record-main';
  const top = document.createElement('div');
  top.className = 'record-top';
  const date = document.createElement('time');
  date.className = 'record-date';
  date.dateTime = record.date;
  date.textContent = record.date;
  const badge = document.createElement('span');
  badge.className = 'stage-badge';
  const code = document.createElement('code');
  code.textContent = record.stage_code;
  badge.append(code, document.createTextNode(record.stage_label));
  top.append(date, badge);
  if (record.demo) {
    const demo = document.createElement('span');
    demo.className = 'demo-tag';
    demo.textContent = '演示';
    top.append(demo);
  }

  const actions = document.createElement('div');
  actions.className = 'record-actions';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'icon-btn';
  editBtn.setAttribute('aria-label', `编辑 ${record.date} 的记录`);
  editBtn.innerHTML = '<svg aria-hidden="true"><use href="#i-edit"/></svg>';
  editBtn.addEventListener('click', () => startRecordEdit(record));
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'icon-btn';
  delBtn.setAttribute('aria-label', `删除 ${record.date} 的记录`);
  delBtn.innerHTML = '<svg aria-hidden="true"><use href="#i-trash"/></svg>';
  delBtn.addEventListener('click', () => removeRecordConfirm(record));
  actions.append(editBtn, delBtn);
  top.append(actions);
  main.append(top);

  const plot = document.createElement('p');
  plot.className = 'record-plot';
  plot.textContent = record.plot_name;
  if (record.plot_variety) {
    const variety = document.createElement('span');
    variety.className = 'record-variety';
    variety.textContent = ` · ${record.plot_variety}`;
    plot.append(variety);
  }
  main.append(plot);

  if (record.note) {
    const note = document.createElement('p');
    note.className = 'record-note';
    note.textContent = record.note;
    main.append(note);
  }

  const meta = document.createElement('div');
  meta.className = 'record-meta';
  meta.append(
    Object.assign(document.createElement('span'), {
      textContent: record.lat !== null && record.lon !== null
        ? `${record.lat.toFixed(4)}, ${record.lon.toFixed(4)}${record.accuracy_m !== null ? ` · ±${record.accuracy_m} m` : ''}`
        : '无坐标'
    })
  );
  if (record.photo) {
    meta.append(Object.assign(document.createElement('span'), { textContent: '含照片' }));
  }
  main.append(meta);

  item.append(main);

  if (record.photo) {
    const thumb = document.createElement('img');
    thumb.className = 'record-thumb';
    thumb.src = record.photo;
    thumb.alt = `${record.plot_name} ${record.date} 照片`;
    thumb.loading = 'lazy';
    item.append(thumb);
  }

  return item;
}

function renderRecords() {
  const list = $('#record-list');
  list.textContent = '';
  for (const record of state.records) list.append(recordListItem(record));
  $('#record-count').textContent = String(state.records.length);
  $('#record-empty').hidden = state.records.length > 0;
  if (!state.records.length) {
    $('#record-empty').textContent = state.stats?.total
      ? '没有匹配的记录，试试重置筛选。'
      : '还没有记录。';
  }
}

function renderExport() {
  const total = state.stats?.total || 0;
  const plots = state.plots.length;
  $('#export-summary').textContent = `${total} 条记录 · ${plots} 个地块`;
  $('#export-csv').disabled = total === 0;
  $('#export-geojson').disabled = total === 0;
  $('#export-json').disabled = total === 0 && plots === 0;
}

function renderWelcome() {
  $('#welcome').hidden = !(state.stats && state.stats.total === 0 && state.plots.length === 0);
}

async function refresh({ keepFocus = false } = {}) {
  const focusedId = keepFocus ? document.activeElement?.id : null;
  const [plots, records, counts, stats] = await Promise.all([
    listPlots(),
    listRecords({
      query: state.query,
      plotId: state.filterPlot,
      stageCode: state.filterStage
    }),
    countRecordsByPlot(),
    getStats()
  ]);
  state.plots = plots;
  state.records = records;
  state.counts = counts;
  state.stats = stats;
  renderPlotOptions();
  renderPlotList();
  renderRecords();
  renderStats();
  renderWelcome();
  renderExport();
  if (focusedId) document.getElementById(focusedId)?.focus();
}

/* ---------------- record form ---------------- */

function selectedStage() {
  return $('input[name="stage_code"]:checked')?.value || '';
}

function resetGps() {
  state.gps = null;
  $('#gps-status').textContent = '坐标可留空（无信号时）。';
  $('.gps-row').dataset.state = '';
  $('#gps-clear')?.remove();
}

function setGps(lat, lon, accuracy) {
  state.gps = { lat, lon, accuracy };
  const row = $('.gps-row');
  row.dataset.state = 'ok';
  $('#gps-status').textContent = `已记录 ${lat.toFixed(5)}, ${lon.toFixed(5)}${accuracy ? `（±${Math.round(accuracy)} m）` : ''}`;
  if (!$('#gps-clear')) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn btn-ghost';
    clear.id = 'gps-clear';
    clear.textContent = '清除';
    clear.addEventListener('click', resetGps);
    row.append(clear);
  }
}

function resetPhoto() {
  state.photo = null;
  $('#record-photo').value = '';
  $('#photo-preview').hidden = true;
  $('#photo-thumb').removeAttribute('src');
  $('#photo-status').textContent = '尚未选择照片';
  $('#photo-meta').textContent = '';
}

function resetRecordForm() {
  state.editingRecord = null;
  $('#record-form').reset();
  $('#record-date').value = toISODate();
  $('#record-date').max = tomorrowISO();
  $('#form-title').textContent = '新增记录';
  $('#submit-btn').innerHTML = '<svg aria-hidden="true"><use href="#i-check"/></svg>保存记录';
  $('#cancel-edit').hidden = true;
  $('#edit-flag').hidden = true;
  $('#stage-preview').textContent = '尚未选择阶段。';
  $('#stage-preview').style.borderLeftColor = '';
  showError('#form-error', '');
  resetPhoto();
  resetGps();
}

async function startRecordEdit(record) {
  activateTab('records', { focus: true });
  await refresh();
  state.editingRecord = record;
  $('#record-plot').value = record.plot_id;
  $('#record-variety').value = record.plot_variety || '';
  $('#record-date').value = record.date;
  $('#record-note').value = record.note || '';
  const radio = $(`input[name="stage_code"][value="${record.stage_code}"]`);
  if (radio) {
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (record.photo) {
    state.photo = record.photo;
    $('#photo-thumb').src = record.photo;
    $('#photo-preview').hidden = false;
    $('#photo-status').textContent = '已保留原照片';
    $('#photo-meta').textContent = '重新选图可替换';
  } else {
    resetPhoto();
  }
  if (record.lat !== null && record.lon !== null) setGps(record.lat, record.lon, record.accuracy_m);
  else resetGps();
  $('#form-title').textContent = '编辑记录';
  $('#submit-btn').innerHTML = '<svg aria-hidden="true"><use href="#i-check"/></svg>更新记录';
  $('#cancel-edit').hidden = false;
  $('#edit-flag').hidden = false;
  showError('#form-error', '');
  $('#record-form').scrollIntoView({ block: 'start' });
}

function recordPayload() {
  return {
    plot_id: $('#record-plot').value,
    stage_code: selectedStage(),
    date: $('#record-date').value,
    lat: state.gps ? state.gps.lat : null,
    lon: state.gps ? state.gps.lon : null,
    accuracy_m: state.gps ? state.gps.accuracy : null,
    photo: state.photo,
    note: $('#record-note').value,
    demo: state.editingRecord?.demo || false
  };
}

function validateRecordForm(payload) {
  if (!payload.plot_id) return '请选择地块。';
  if (!payload.stage_code) return '请选择 BBCH 阶段。';
  const dateCheck = validateDate(payload.date);
  if (!dateCheck.ok) return dateCheck.reason;
  return '';
}

async function submitRecord(event) {
  event.preventDefault();
  if (state.busy) return;
  const payload = recordPayload();
  const problem = validateRecordForm(payload);
  if (problem) {
    showError('#form-error', problem);
    return;
  }
  showError('#form-error', '');
  state.busy = true;
  $('#submit-btn').disabled = true;
  try {
    if (state.editingRecord) {
      await updateRecord(state.editingRecord.id, payload);
      toast('记录已更新');
    } else {
      await createRecord(payload);
      toast('记录已保存到本机');
    }
    const plotId = payload.plot_id;
    resetRecordForm();
    await refresh();
    $('#record-plot').value = plotId;
    if (plotId) autoFillVariety();
  } catch (error) {
    showError('#form-error', error.message);
  } finally {
    state.busy = false;
    $('#submit-btn').disabled = false;
  }
}

async function removeRecordConfirm(record) {
  if (!window.confirm(`删除 ${record.date} 的「${record.plot_name}」记录？此操作不可撤销。`)) return;
  try {
    await removeRecord(record.id);
    if (state.editingRecord?.id === record.id) resetRecordForm();
    toast('记录已删除');
    await refresh();
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ---------------- plot form ---------------- */

function autoFillVariety() {
  const plot = state.plots.find((item) => item.id === $('#record-plot').value);
  const variety = $('#record-variety');
  const previous = state.plots.find((item) => item.variety === variety.value);
  if (plot && (!variety.value || previous)) variety.value = plot.variety || '';
  if (!plot && previous) variety.value = '';
}

function resetPlotForm() {
  state.editingPlot = null;
  $('#plot-form').reset();
  $('#plot-form-title').textContent = '新增地块';
  $('#plot-submit').innerHTML = '<svg aria-hidden="true"><use href="#i-plus"/></svg>保存地块';
  $('#plot-cancel').hidden = true;
  $('#plot-edit-flag').hidden = true;
  showError('#plot-error', '');
}

function startPlotEdit(plot) {
  state.editingPlot = plot;
  $('#plot-name').value = plot.name;
  $('#plot-variety').value = plot.variety || '';
  $('#plot-elevation').value = plot.elevation_m ?? '';
  $('#plot-row').value = plot.row_note || '';
  $('#plot-form-title').textContent = '编辑地块';
  $('#plot-submit').innerHTML = '<svg aria-hidden="true"><use href="#i-check"/></svg>更新地块';
  $('#plot-cancel').hidden = false;
  $('#plot-edit-flag').hidden = false;
  showError('#plot-error', '');
  $('#plot-form').scrollIntoView({ block: 'start' });
}

async function submitPlot(event) {
  event.preventDefault();
  const payload = {
    name: $('#plot-name').value,
    variety: $('#plot-variety').value,
    elevation_m: $('#plot-elevation').value,
    row_note: $('#plot-row').value
  };
  if (!payload.name.trim()) {
    showError('#plot-error', '地块名称不能为空。');
    return;
  }
  showError('#plot-error', '');
  try {
    if (state.editingPlot) {
      await updatePlot(state.editingPlot.id, payload);
      toast('地块已更新');
    } else {
      const plot = await createPlot(payload);
      toast('地块已建立');
      resetPlotForm();
      await refresh();
      $('#record-plot').value = plot.id;
      autoFillVariety();
      return;
    }
    resetPlotForm();
    await refresh();
  } catch (error) {
    showError('#plot-error', error.message);
  }
}

async function removePlot(plot) {
  const count = state.counts[plot.id] || 0;
  const message = count
    ? `删除地块「${plot.name}」及其 ${count} 条记录？此操作不可撤销。`
    : `删除地块「${plot.name}」？`;
  if (!window.confirm(message)) return;
  try {
    const removed = await deletePlot(plot.id);
    if (state.editingPlot?.id === plot.id) resetPlotForm();
    if (state.editingRecord?.plot_id === plot.id) resetRecordForm();
    toast(`地块已删除${removed ? `，连带 ${removed} 条记录` : ''}`);
    await refresh();
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ---------------- gps ---------------- */

function readGps() {
  if (!navigator.geolocation) {
    $('.gps-row').dataset.state = 'error';
    $('#gps-status').textContent = '此浏览器不支持定位，可手动留空。';
    return;
  }
  const button = $('#gps-btn');
  button.disabled = true;
  $('#gps-status').textContent = '正在定位…（户外可能需要 30 秒）';
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      setGps(latitude, longitude, accuracy);
      toast('GPS 坐标已记录');
      button.disabled = false;
    },
    (error) => {
      const reasons = {
        1: '定位权限被拒绝，可在浏览器设置中开启。',
        2: '暂时无法获取位置，请到开阔处重试。',
        3: '定位超时，请重试或留空。'
      };
      $('.gps-row').dataset.state = 'error';
      $('#gps-status').textContent = reasons[error.code] || '定位失败，可留空。';
      button.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 25000, maximumAge: 30000 }
  );
}

/* ---------------- photo ---------------- */

async function onPhotoChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const submit = $('#submit-btn');
  submit.disabled = true;
  $('#photo-status').textContent = '正在压缩照片…';
  try {
    const result = await compressImage(file);
    state.photo = result.dataUrl;
    $('#photo-thumb').src = result.dataUrl;
    $('#photo-preview').hidden = false;
    $('#photo-status').textContent = result.scaled
      ? `已缩放至 ${result.width}×${result.height}`
      : '照片未超出尺寸上限，已重新编码';
    $('#photo-meta').textContent = `${formatBytes(result.originalBytes)} → ${formatBytes(result.bytes)}`;
    toast('照片已压缩并暂存');
  } catch (error) {
    state.photo = null;
    $('#photo-preview').hidden = true;
    $('#photo-status').textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}

/* ---------------- export / import ---------------- */

function download(content, name, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function exportCSV() {
  const { plots, records } = await exportAll();
  if (!records.length) return toast('没有可导出的记录', 'error');
  download(`﻿${toCSV(records, plots).replace(/^﻿/, '')}`, filename('csv'), 'text/csv;charset=utf-8');
  toast(`已导出 ${records.length} 条记录`);
}

async function exportGeoJSON() {
  const { plots, records } = await exportAll();
  const geo = toGeoJSON(records, plots);
  if (!geo.features.length) return toast('没有带坐标的记录', 'error');
  download(JSON.stringify(geo, null, 2), filename('geojson'), 'application/geo+json');
  toast(`已导出 ${geo.features.length} 个点`);
}

async function exportJSON() {
  const { plots, records } = await exportAll();
  download(JSON.stringify(toJSON(plots, records), null, 2), filename('json'), 'application/json');
  toast(`已备份 ${records.length} 条记录与 ${plots.length} 个地块`);
}

async function onImport(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const status = $('#import-status');
  status.textContent = '正在校验…';
  try {
    const text = await file.text();
    const payload = parseImportText(text);
    const result = await importData(payload);
    const parts = [`导入 ${result.imported} 条记录，新增 ${result.plotsAdded} 个地块`];
    if (result.skipped) parts.push(`跳过重复 ${result.skipped} 条`);
    if (result.errors.length) parts.push(`跳过无效 ${result.errors.length} 条`);
    status.textContent = parts.join('；');
    if (result.errors.length) status.textContent += `\n${result.errors.slice(0, 3).join('\n')}`;
    toast(result.imported ? '导入完成' : '没有新增记录', result.imported ? 'ok' : 'error');
    await refresh();
  } catch (error) {
    status.textContent = error.message;
    toast(error.message, 'error');
  }
}

async function loadDemoData() {
  try {
    const result = await loadDemo();
    if (!result.loaded) {
      toast('已有数据，请先清空再加演示数据', 'error');
      return;
    }
    toast('已载入 12 条演示记录');
    await refresh();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function clearEverything() {
  const confirmed = window.confirm('清空全部地块、记录和照片？建议先导出 JSON 备份。');
  if (!confirmed) return;
  await clearAll();
  resetRecordForm();
  resetPlotForm();
  toast('已清空全部数据');
  await refresh();
}

/* ---------------- service worker / connectivity ---------------- */

function updateOnlineStatus() {
  const online = navigator.onLine;
  const pill = $('#storage-status');
  pill.dataset.state = online ? 'local' : 'offline';
  $('#storage-text').textContent = online ? '本机存储' : '离线可用';
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!/^https?:$/.test(location.protocol)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

async function persistStorage() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    /* best effort */
  }
}

/* ---------------- wiring ---------------- */

function bindForms() {
  $('#record-form').addEventListener('submit', submitRecord);
  $('#cancel-edit').addEventListener('click', resetRecordForm);
  $('#gps-btn').addEventListener('click', readGps);
  $('#record-photo').addEventListener('change', onPhotoChange);
  $('#photo-clear').addEventListener('click', resetPhoto);
  $('#record-plot').addEventListener('change', autoFillVariety);

  $('#plot-form').addEventListener('submit', submitPlot);
  $('#plot-cancel').addEventListener('click', resetPlotForm);

  $('#export-csv').addEventListener('click', exportCSV);
  $('#export-geojson').addEventListener('click', exportGeoJSON);
  $('#export-json').addEventListener('click', exportJSON);
  $('#import-file').addEventListener('change', onImport);
  $('#demo-btn').addEventListener('click', loadDemoData);
  $('#welcome-demo').addEventListener('click', loadDemoData);
  $('#clear-btn').addEventListener('click', clearEverything);

  $('#search-input').addEventListener('input', (event) => {
    state.query = event.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => refresh({ keepFocus: true }), 160);
  });
  $('#filter-plot').addEventListener('change', (event) => {
    state.filterPlot = event.target.value;
    refresh();
  });
  $('#filter-stage').addEventListener('change', (event) => {
    state.filterStage = event.target.value;
    refresh();
  });
  $('#filter-reset').addEventListener('click', () => {
    state.query = '';
    state.filterPlot = '';
    state.filterStage = '';
    $('#search-input').value = '';
    $('#filter-plot').value = '';
    $('#filter-stage').value = '';
    refresh();
  });
}

async function init() {
  buildStagePicker();
  renderStageSelect();
  bindTabs();
  bindForms();
  bindForms.date = null;
  $('#record-date').value = toISODate();
  $('#record-date').min = '2000-01-01';
  $('#record-date').max = tomorrowISO();
  updateOnlineStatus();
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  registerServiceWorker();
  persistStorage();

  const hash = location.hash.replace('#', '');
  activateTab(['records', 'plots', 'export'].includes(hash) ? hash : 'records');

  try {
    await refresh();
  } catch (error) {
    toast(`数据库打开失败：${error.message}`, 'error');
    return;
  }

  if (state.stats?.total === 0 && state.plots.length > 0) {
    $('#record-plot').value = state.plots[0].id;
    autoFillVariety();
  }
}

init();
