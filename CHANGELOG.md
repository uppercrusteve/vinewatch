# 变更日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的结构，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-11-17

### 新增

- 离线优先的单页 PWA：记录、地块、导出三个标签页。
- 23 个葡萄 BBCH 关键阶段，按萌芽、展叶、花序、开花、坐果、转色、成熟、衰老 8 组呈现，每个阶段附一句田间说明。
- 记录字段：地块、品种、BBCH 阶段、日期、可选 GPS 坐标与定位精度、单张照片、备注。
- 浏览器内照片压缩：长边上限 1280 px，JPEG 质量 0.82，不放大原图；输入上限 25 MB。
- IndexedDB 本地存储（`vinewatch` v1）：地块表与记录表，地块删除时级联删除其记录。
- 记录搜索、按地块/阶段筛选、编辑与确认删除。
- 导出 UTF-8 BOM CSV（14 列、CRLF、引号转义）、仅含有坐标记录的 GeoJSON、含照片的 JSON 全量备份。
- JSON 备份导入：schema 校验、逐行校验、按 ID 与内容指纹去重，只合并不覆盖。
- 服务 Worker 预缓存应用外壳，断网刷新可用；同源请求缓存优先。
- 深浅色跟随系统、响应式移动布局、键盘可操作的标签页与阶段选择器。
- 12 条明确标注的合成演示记录与 3 个虚构地块，可一键载入/清空。
- Vitest + jsdom + fake-indexeddb 测试 44 项。
- esbuild 生产构建与 GitHub Pages 部署工作流。

[0.1.0]: https://github.com/uppercrusteve/vinewatch/releases/tag/v0.1.0
