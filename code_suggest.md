# Code Review Suggestions

本次审查的前提是: 保留你当前的业务逻辑和产品设计，不改“预测链路”和页面交互方向，只指出会影响正确性、稳定性、性能和后续维护成本的问题。

审查范围:
- 核心前端: `app/page.tsx`
- 核心服务端: `lib/actions.ts`, `lib/engine/forecast-engine.ts`, `lib/parsers/excel-parser.ts`, `lib/db.ts`
- AI/API: `app/api/*.ts`
- 数据结构: `sql/init.sql`
- 额外验证: `npm run lint` 通过，`npm run build` 因 `next/font/google` 拉取 `Geist`/`Geist Mono` 失败而中断

## 高优先级

### 1. 产品别名的“设置页配置”没有真正参与导入链路
- 位置: `lib/parsers/excel-parser.ts:3-13`, `lib/actions.ts:687-705`, `app/page.tsx:1121-1154`
- 问题:
  当前解析器只读取 `config/product-aliases.json` 里的静态映射，`product_alias` 表和设置页里的“产品别名”增删改并不会影响 `parseSalesData` / `parseTimeslotSalesData` / `parseDisplayFullQuantity`。
- 影响:
  业务上看起来“别名已经保存”，但重新导入时完全不生效，容易导致未匹配商品、基线缺失、分时段历史缺失。
- 建议:
  保留现有别名管理方式，但导入时应合并 `config` 和 DB 映射，或者明确只保留一种来源，避免双真相源。

### 2. 断货复盘链路是半成品，当前保存的数据无法支撑“理想营业额”和损失还原
- 位置: `app/page.tsx:1832-1841`, `app/page.tsx:1856-1860`, `lib/actions.ts:860-871`, `lib/engine/forecast-engine.ts:171-190`
- 问题:
  前端提交断货记录时把 `dayType` 写死成 `mondayToThursday`，`estimatedLossQty` / `estimatedLossAmount` 也始终保存为 `0`；而真正用于损失估算的 `calculateStockoutLoss` 并没有接入这条 UI 提交流程。
- 影响:
  `out_of_stock_record` 表虽然有数据，但对基线修复、历史趋势、理想营业额几乎不起作用。周五/周末的断货数据还会被错误归类。
- 建议:
  不改复盘入口设计，但在提交前就把真实 `dayType` 和损失金额算出来，至少保证保存到库里的记录是可用的。

### 3. 复盘重复提交会不断累加同一天的断货记录
- 位置: `app/page.tsx:1856-1860`, `lib/actions.ts:860-871`
- 问题:
  提交复盘前没有调用 `deleteOutOfStockByDate`，`saveOutOfStockRecords` 也没有 upsert/去重逻辑。
- 影响:
  用户修改同一天复盘并重新提交后，断货记录会重复累积，后续任何基于断货的分析都会被放大。
- 建议:
  保留当前交互，提交当天复盘前先按日期清空旧记录，或者给 `out_of_stock_record` 增加可去重约束。

### 4. 分时段规则生成在“没有固定出货时间表”时会把商品全部压到 `11:00`
- 位置: `lib/engine/forecast-engine.ts:501-515`
- 问题:
  `targetSlots` 默认值是 `["11:00"]`，这意味着只要某个商品没有配置 `fixed_shipment_schedule`，再完整的历史时段数据也不会被使用。
- 影响:
  这和 README 里“基于历史分时段销售比例进行分配”的描述冲突，也会让规则引擎的结果严重偏向单时段。
- 建议:
  保留“固定时间表优先”逻辑，但无固定时间表时应回退到全时段历史分配，而不是单点出货。

### 5. 首次点击”计算日目标”时存在状态竞态，可能需要点第二次才真正生成
- 位置: `app/page.tsx:325-341`
- 问题:
  `handleGenerateDaily` 在 `monthlyTargets` 为空时先 `await handleGenerateMonthly()`，但后面仍然读取当前闭包里的旧 `monthlyTargets`。
- 影响:
  首次使用流程时很容易出现“月目标已经算了，但日目标没出来”的假死体验。
- 建议:
  不改流程，只需要让 `handleGenerateMonthly` 返回 targets，或者在 `handleGenerateDaily` 内直接用返回值继续算。

### 6. 销售导入把未匹配商品也写进了 `daily_sales_record`，后续趋势因子会被脏数据污染
- 位置: `lib/parsers/excel-parser.ts:149-159`, `lib/actions.ts:230-255`, `lib/actions.ts:503-535`, `app/api/prophet-trend/route.ts:17-48`
- 问题:
  `parseSalesData` 发现未匹配商品时只是记录到 `unmatchedProducts`，但仍然把记录 push 进结果集。之后导入会落库，历史趋势和 Prophet 接口又直接按 `SUM(quantity)` 汇总全表。
- 影响:
  未映射商品、错误别名、停产商品会进入趋势计算，导致日目标趋势因子和 Prophet 输入都被污染。
- 建议:
  保留“展示未匹配列表”的设计，但未匹配记录不应进入正式销售事实表，至少要隔离到单独的异常表或跳过。

## 中优先级

### 7. 导入链路没有事务保护，而且大量使用逐行写库
- 位置: `lib/actions.ts:196-218`, `lib/actions.ts:221-258`, `lib/actions.ts:261-289`, `lib/actions.ts:291-429`, `lib/actions.ts:860-867`
- 问题:
  导入流程基本都是 `DELETE` 后再逐条 `INSERT/UPDATE`。中途任何一步失败，数据库会停在部分清空、部分写入的中间态。
- 影响:
  数据一致性差，且导入量一大就会因为大量 round-trip 明显变慢。
- 建议:
  保留现有导入逻辑，外面包事务；同时把逐条写入改成批量写入，至少把 product/strategy/baseline/timeslot 这些批处理掉。

### 8. `importTimeslotSalesData` 仍然残留 MySQL 语法，在 PostgreSQL 下会直接报错
- 位置: `lib/actions.ts:795-805`
- 问题:
  这里使用的是 `ON DUPLICATE KEY UPDATE`，而项目数据库明确是 PostgreSQL / Supabase。
- 影响:
  该函数一旦被调用，会在生产环境直接失败。
- 建议:
  与其他写法保持一致，改成 `ON CONFLICT (...) DO UPDATE` 即可，不影响业务行为。

### 9. 日期处理混用了 `new Date(...).toISOString()` 和字符串比较，存在时区偏移风险
- 位置: `lib/parsers/excel-parser.ts:134-147`, `lib/parsers/excel-parser.ts:270-281`, `lib/actions.ts:498-500`, `app/api/prophet-trend/route.ts:14-16`, `app/api/empowerment-review/route.ts:31-39`, `sql/init.sql:41`, `sql/init.sql:86`, `sql/init.sql:123`, `sql/init.sql:140`, `sql/init.sql:153`, `sql/init.sql:195`, `sql/init.sql:205-206`
- 问题:
  代码里大量把本地日期转成 ISO 字符串再截断，并且数据库把日期字段都存成 `VARCHAR(10)`。
- 影响:
  在非 UTC 环境、服务器迁移、DST 区域或 Excel 日期解析差异下，很容易出现前后差一天的问题；同时也失去了数据库原生日期比较和索引优化能力。
- 建议:
  不改你现在的日期口径，但应统一成“显式本地日期字符串”或真正的 `DATE` 字段，不要把时区问题交给 `Date` 默认行为。

### 10. 自动导入分时段数据时只读取了目录中的第一个 Excel 文件
- 位置: `lib/actions.ts:402-418`, `README.md:51`
- 问题:
  README 写的是 `时段销售/` 目录，代码却只读 `files[0]`。
- 影响:
  只要目录里按日期类型、月份或来源拆成多个文件，导入结果就会不完整。
- 建议:
  保留目录导入设计，但应遍历全部文件并合并结果，或者明确约束目录中只能有一个源文件。

### 11. ~~每日复盘的 Prompt 模板系统接入不完整~~ [已验证：误报]
- 位置: `app/api/daily-review/route.ts:102-123`
- 实际情况:
  经核实，`buildPrompt(“daily_review”, vars)` 的返回值（`systemInstruction`, `prompt`, `modelName`, `temperature`, `topP`）在第 111-115 行已被正确赋值并传入模型调用。`reviewPromptBody` 仅作为 `USE_DB_PROMPT=false` 或 `buildPrompt` 抛异常时的 fallback。
- 结论:
  该条建议不成立，daily-review 的 prompt 模板系统已正确接入，无需修改。

## 低优先级

### 12. `app/page.tsx` 已经成为单文件巨型组件，状态、导出、表格和业务逻辑耦合过深
- 位置: `app/page.tsx` 全文件，当前约 2739 行
- 问题:
  单文件里同时处理 dashboard、forecast、review、calendar、empowerment、settings、导出逻辑和大量派生计算。
- 影响:
  现在还能跑，但任何一次局部修改都很容易牵连别处。Lint 里已经出现一批未使用状态和导入，这是典型的结构开始失控的信号。
- 建议:
  不改变 UI 和流程，只做组件拆分: `ForecastTargetsPanel`、`ProductSuggestionTable`、`ReviewPanel`、`SettingsPanel`、`ExportBuilder` 这类按业务块拆出去。

### 13. 时间表页面和 Excel 导出都存在大量重复的 `filter/reduce/find`
- 位置: `app/page.tsx:695-827`, `app/page.tsx:2563-2681`
- 问题:
  对 `timeSlotSuggestions` / `timeslotSalesRecords` 的遍历是重复嵌套的，很多统计在一次渲染或一次导出里被反复全量扫描。
- 影响:
  当前数据量不大时只是“写得重”，后面 SKU 和时段维度再涨，渲染和导出都会明显变慢。
- 建议:
  保留展示结构，先把 `product -> slot`、`slot -> amount`、`slot -> estimatedSales` 这些映射预计算成 Map，再复用。

### 14. 赋能事件新建表单绕开了 React 状态管理
- 位置: `app/page.tsx:2005-2012`
- 问题:
  这里直接用 `document.getElementById(...)` 取值。
- 影响:
  这会让组件行为更难测试，也容易在重构、条件渲染或复用时出现取不到 DOM 的问题。
- 建议:
  保留现有交互，把这几个输入转成受控或半受控状态即可。

### 15. 字体依赖外部网络，导致受限环境下无法完成生产构建
- 位置: `app/layout.tsx:1-13`
- 问题:
  `next/font/google` 在构建期需要访问 Google Fonts；本地构建时已经因为这一点失败。
- 影响:
  在无外网、公司代理或 CI 限网环境中会直接阻塞发布。
- 建议:
  视觉设计不需要改，但部署敏感环境下更稳妥的做法是改为本地字体或确保构建网络可达。

## 建议的处理顺序

1. 先修正数据可信度问题:
   别名来源统一、断货损失链路打通、未匹配销售不入正式事实表。
2. 再修正明显功能 bug:
   首次生成日目标竞态、无固定时间表时默认全压 `11:00`、分时段导入只读首文件。
3. 然后补稳定性:
   导入事务、批量写库、`importTimeslotSalesData` 的 PostgreSQL 语法修正。
4. 最后做可维护性治理:
   拆分 `app/page.tsx`、去掉 DOM 直读、收敛重复统计逻辑。

## 验证记录

- `npm run lint`: 通过，只有未使用变量类 warning。
- `npm run build`: 未能完成。阻塞原因不是业务代码报错，而是 `app/layout.tsx` 使用的 Google 字体在当前受限网络环境下无法拉取。
- 代码核对验证（Claude Code 2026-04-10）:
  - 第 1-10、12-15 条建议经代码核实全部成立，行号基本准确（第 5 条实际位置为 325-341，已修正）。
  - 第 11 条为误报：`buildPrompt` 返回值已在 `daily-review/route.ts:111-115` 正确赋值并使用，`reviewPromptBody` 仅作为 fallback。
