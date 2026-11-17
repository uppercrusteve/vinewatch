/** Demo dataset (合成演示, not observed). 12 records over a fictional high-elevation site. */
import { createPlot, listPlots, createRecord, listRecords } from './db.js';

function svgPhoto({ sky, hill, sun, label }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/>
  </linearGradient></defs>
  <rect width="480" height="360" fill="url(#sky)"/>
  <circle cx="372" cy="78" r="38" fill="${sun}" opacity=".85"/>
  <path d="M0 205 Q110 140 220 198 T480 176 V360 H0Z" fill="${hill[0]}"/>
  <path d="M0 252 Q140 206 280 250 T480 236 V360 H0Z" fill="${hill[1]}"/>
  <g stroke="#2f4423" stroke-width="5" fill="none" opacity=".7">
    <path d="M40 360 Q100 300 170 282"/><path d="M150 360 Q200 306 268 286"/>
    <path d="M268 360 Q312 312 372 292"/><path d="M368 360 Q408 320 462 302"/>
  </g>
  <g fill="#3f5c2c"><circle cx="172" cy="276" r="18"/><circle cx="270" cy="282" r="16"/><circle cx="374" cy="288" r="15"/></g>
  <rect x="18" y="20" width="232" height="34" rx="8" fill="#16220f" opacity=".55"/>
  <text x="34" y="43" font-family="sans-serif" font-size="17" fill="#f4efe2">${label}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const PHOTOS = {
  flower: svgPhoto({ sky: ['#bfd6e8', '#e8ecd9'], hill: ['#7f9364', '#5f7346'], sun: '#f2d38a', label: '演示 · 盛花期' }),
  fruit: svgPhoto({ sky: ['#9fc4dd', '#dfe7cf'], hill: ['#6d8a50', '#4f6838'], sun: '#f0c96f', label: '演示 · 封穗期' }),
  harvest: svgPhoto({ sky: ['#d8c7a8', '#efe4cd'], hill: ['#8b7a46', '#6b5a30'], sun: '#e3a34c', label: '演示 · 采收成熟' })
};

const DAY = 24 * 60 * 60 * 1000;

function isoOffset(days) {
  return new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
}

export async function loadDemo() {
  const existing = await listPlots();
  if (existing.length || (await listRecords({ limit: 1 })).length) {
    return { loaded: false, plots: 0, records: 0 };
  }
  const baseLat = 27.821;
  const baseLon = 98.952;
  const plots = [];
  plots.push(
    await createPlot({
      name: '东坡梯田 A3',
      variety: '霞多丽',
      elevation_m: 2210,
      row_note: '行向东南，滴灌 2 区'
    })
  );
  plots.push(
    await createPlot({
      name: '西坡台地 B1',
      variety: '赤霞珠',
      elevation_m: 2360,
      row_note: '坡度 18°，风大'
    })
  );
  plots.push(
    await createPlot({
      name: '河谷试验 C2',
      variety: '品丽珠',
      elevation_m: 2050,
      row_note: '对照区，不上棚'
    })
  );

  const entries = [
    { p: 0, code: '60', d: 152, note: '演示：首花开放，约 5% 花帽脱落。' },
    { p: 1, code: '65', d: 145, note: '演示：盛花期，天气晴，蜜蜂活动频繁。', photo: PHOTOS.flower },
    { p: 0, code: '69', d: 136, note: '演示：开花结束，记录残留花帽。' },
    { p: 2, code: '71', d: 123, note: '演示：幼果形成，坐果不均，标记弱穗。' },
    { p: 1, code: '75', d: 109, note: '演示：果粒一半豌豆大，开始第一次疏果。' },
    { p: 0, code: '79', d: 97, note: '演示：封穗完成；同日下行喷施波尔多液。', photo: PHOTOS.fruit },
    { p: 2, code: '81', d: 74, note: '演示：少数果穗开始转色，糖度待测。' },
    { p: 1, code: '85', d: 60, note: '演示：果粒整体软化，鸟害加重。' },
    { p: 0, code: '89', d: 42, note: '演示：达到目标糖度，安排采收。', photo: PHOTOS.harvest },
    { p: 2, code: '89', d: 35, note: '演示：对照区采收；无 GPS 读数（山谷遮挡）。', noGps: true },
    { p: 1, code: '91', d: 30, note: '演示：采后灌溉，树势正常。' },
    { p: 0, code: '97', d: 19, note: '演示：落叶约 60%，进入休眠准备。' }
  ];

  for (const [index, entry] of entries.entries()) {
    const jitterLat = ((index % 5) - 2) * 0.00035;
    const jitterLon = ((index % 4) - 1.5) * 0.00042;
    await createRecord({
      plot_id: plots[entry.p].id,
      stage_code: entry.code,
      date: isoOffset(entry.d),
      lat: entry.noGps ? null : baseLat + entry.p * 0.0042 + jitterLat,
      lon: entry.noGps ? null : baseLon + entry.p * 0.0051 + jitterLon,
      accuracy_m: entry.noGps ? null : 4 + (index % 6),
      photo: entry.photo || null,
      note: entry.note,
      demo: true
    });
  }
  return { loaded: true, plots: plots.length, records: entries.length };
}
