# Production Forecast — 烘焙店排产预估系统

基于 Next.js + PostgreSQL + AI 的烘焙店每日排产预估系统，适用于马来西亚吉隆坡地区的烘焙连锁门店。系统通过历史销售数据、业务规则和 AI 智能修正，自动生成月度营业额目标 → 日营业额分配 → 单品出货建议 → 分时段排产计划的完整预测链路。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 16 + React 19 + Tailwind CSS 4 |
| 后端 | Next.js Server Actions + API Routes |
| 数据库 | PostgreSQL (Supabase) |
| AI 引擎 | Google Gemini 2.5 Flash |
| 数据解析 | ExcelJS（Excel 导入导出） |
| 语言 | TypeScript 5 |

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (app/page.tsx)                    │
│  数据导入 → 月目标 → 日目标 → 单品建议 → 分时段 → 导出       │
└────────────────────────┬────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
  Server Actions    API Routes     AI Correction
  (lib/actions.ts)  (app/api/)    (Gemini 2.5 Flash)
         │               │               │
         ▼               ▼               ▼
  ┌──────────────────────────────────────────────┐
  │       PostgreSQL (Supabase)                  │
  │  product │ product_strategy │ holiday        │
  │  daily_sales_record │ product_alias          │
  │  product_sales_baseline │ business_rule      │
  │  fixed_shipment_schedule │ timeslot_sales    │
  └──────────────────────────────────────────────┘
```

## 核心功能模块

### 1. 数据导入（数据导入 Tab）

从 `data/` 目录下的 Excel 文件批量导入：

| 文件 | 用途 |
|------|------|
| `产品价格信息与倍数.xlsx` | 产品基本信息：品类、品名、单价、包装倍数、出货单位 |
| `产品销售策略.xlsx` | 产品定位（TOP/潜在TOP/其他）、冷热属性、销售占比、目标TC |
| `单品销售数量1.1-4.2.xlsx` | 历史每日单品销量数据（1月1日 ~ 4月2日） |
| `kl陈列满柜单品数量.xlsx` | 各产品陈列满柜数量 |
| `时段销售/` | 分时段单品销售数据（按日期类型分类） |

导入时自动完成：
- 产品名称别名映射（通过 `config/product-aliases.json`，100+ 条映射规则）
- 按日期类型（周一至周四 / 周五 / 周末）计算销售基线
- 非烘焙类产品自动过滤（咖啡、饮品、周边等）

### 2. 月度营业额目标（月目标 Tab）

基于业务规则计算全年12个月的营业额目标：

```
月营业额 = 首月基础营业额 × 月度系数 × (1 + 运营提升 + 市场提升)
```

- 月度系数可在 UI 中手动调整，编辑后自动保存到数据库
- 支持 AI 修正：调用 Gemini 模型根据节假日分析自动建议每日系数

### 3. 日营业额分配（日目标 Tab）

将月度目标按权重分配到每一天：

| 日期类型 | 默认权重 |
|----------|----------|
| 周一至周四 | 1.0 |
| 周五 | 1.2 |
| 周末 | 1.35 |

**AI 智能修正**：系统将节假日信息传递给 Gemini AI，由 AI 综合分析以下因素后自主判断每日系数：

- 节假日当天影响（根据节日类型和重要程度）
- 节前效应（重大节日前1-3天消费提前上升）
- 节后效应（长假结束后的消费回落）
- 长周末 / 桥假效应
- 发薪日效应（月初月中消费略高）
- 斋月（Ramadan）期间的消费模式变化
- 相邻月份节假日的跨月影响

### 4. 单品出货建议（单品建议 Tab）

根据销售基线和产品策略生成每日单品出货量：

- 基线数据按日期类型（周一至四 / 周五 / 周末）分别计算平均销量
- 优先使用分时段历史数据汇总，回退到 `product_sales_baseline` 表
- TOP 产品加权 +10~15%（按日期类型差异化），潜在TOP 加权 +5~8%
- 按包装倍数取整（整批产品向上取整，按个产品四舍五入）
- 按目标营业额等比缩放，确保总出货金额匹配日目标
- 支持手动调整单品数量
- AI 修正：Gemini 在保持总金额守恒的前提下优化产品组合

### 5. 分时段排产（分时段 Tab）

基于历史分时段销售数据，将单品日总量智能分配到各时段（10:00 ~ 19:00）：

- 使用历史时段销售比例进行数据驱动分配
- 考虑产品冷热属性和消费高峰时段
- 支持固定出货时间表配置
- 余量优先分配给较早的时段
- 展示预计销售和预计剩余（累计计算）
- AI 建议：Gemini 根据历史销售模式生成最优时段分配方案
- 导出为与页面一致的二维表格（含颜色标记）

### 6. 数据导出（导出 Tab）

将排产结果导出为 Excel 文件，包含多个工作表：
- 月度营业额目标
- 日营业额目标
- 单品出货建议（含手动调整记录）
- 分时段排产表（带颜色标记的二维表格）

## 数据库表结构

| 表名 | 用途 |
|------|------|
| `product` | 产品信息（品名、价格、倍数、满柜数量） |
| `product_strategy` | 产品销售策略（定位、冷热、占比、排序） |
| `daily_sales_record` | 历史每日单品销量记录 |
| `product_sales_baseline` | 按日期类型计算的销售基线缓存 |
| `product_alias` | 产品名称别名映射 |
| `business_rule` | 业务规则 (Key-Value JSON 存储) |
| `holiday` | 节假日/特殊日期信息（AI 动态判断系数） |
| `fixed_shipment_schedule` | 固定出货时间表 |
| `timeslot_sales_record` | 分时段单品销售记录（按日期类型） |

### 节假日管理

`holiday` 表仅存储节日的基本信息（日期、名称、类型、备注），**不固定系数**。系数由 AI 在每次预测时根据节日类型、节前节后影响等因素动态判断。已录入 2026 年马来西亚全部法定公假（共18个节日）。

## 快速开始

### 环境要求

- Node.js 18+
- PostgreSQL 8.0+（推荐使用 Supabase）
- Google Gemini API Key

### 安装与配置

```bash
# 1. 克隆项目
git clone https://github.com/your-username/production-forecast.git
cd production-forecast

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env .env.local
# 编辑 .env.local，填写数据库连接和 Gemini API Key
```

`.env.local` 配置示例：

```env
# 数据库连接（PostgreSQL / Supabase）
DATABASE_URL="postgresql://user:password@host:port/database"

# AI 引擎
GEMINI_API_KEY=your-gemini-api-key-here
```

### 初始化数据库

```bash
# 创建数据库和表
psql $DATABASE_URL < sql/init.sql

# 导入 2026 年马来西亚公共假期
psql $DATABASE_URL < sql/seed-holidays-2026.sql
```

### 启动

```bash
# 开发模式
npm run dev

# 生产构建
npm run build
npm start
```

打开 [http://localhost:3000](http://localhost:3000) 访问系统。

### 使用流程

1. **数据导入** — 点击「一键导入」从 `data/` 目录加载 Excel 数据
2. **月目标** — 查看/调整月度系数，生成全年营业额目标
3. **日目标** — 选择月份，点击「AI 修正」让 AI 分析节假日影响并调整每日系数
4. **单品建议** — 选择日期，查看每个产品的建议出货量，可手动微调
5. **分时段** — 查看基于历史数据的智能时段分配方案
6. **导出** — 导出 Excel 排产表供门店使用

## 项目结构

```
production-forecast/
├── app/
│   ├── page.tsx                    # 主页面（6个 Tab UI）
│   ├── layout.tsx                  # 全局布局
│   ├── globals.css                 # 全局样式（Tailwind）
│   └── api/
│       ├── ai-correction/route.ts          # AI 日系数修正接口
│       ├── ai-product-correction/route.ts  # AI 单品出货修正接口
│       └── ai-timeslot/route.ts            # AI 分时段出货建议接口
├── lib/
│   ├── actions.ts                  # Server Actions（数据库 CRUD）
│   ├── db.ts                       # PostgreSQL 连接（postgres 驱动）
│   ├── engine/
│   │   └── forecast-engine.ts      # 核心预测引擎
│   ├── parsers/
│   │   └── excel-parser.ts         # Excel 文件解析器
│   └── types/
│       └── index.ts                # TypeScript 类型定义
├── config/
│   ├── business-rules.json         # 业务规则配置
│   ├── planning-rules.json         # 排产规则配置
│   └── product-aliases.json        # 产品名称别名映射（100+条）
├── data/                           # Excel 源数据文件
│   ├── 时段销售/                   # 分时段销售数据
│   └── 真实排产案例/               # 真实排产参考案例
├── sql/
│   ├── init.sql                    # 数据库初始化脚本（PostgreSQL）
│   ├── seed-holidays-2026.sql      # 2026 年节假日数据
│   └── migrate-dev-plans.sql       # 开发迁移脚本
└── package.json
```

## 业务规则配置

通过 UI 的「规则管理」面板可配置以下内容：

| 规则 | 说明 |
|------|------|
| 首月基础营业额 | 全年计算的基准值（默认 RM 1,640,000） |
| 运营提升率 | 月度运营增长（默认 2%） |
| 市场提升率 | 市场推广增长（默认 4%） |
| 日期权重 | 周一至四 / 周五 / 周末的权重系数 |
| 出货公式 | 试吃损耗率 6%、水吧占比 11%、出货率 95% |
| 产品别名 | 原始数据品名 → 标准品名的映射 |
| 出货时间表 | 各产品的固定出货时段 |
| 节假日管理 | 录入节日信息，AI 自动判断系数影响 |
