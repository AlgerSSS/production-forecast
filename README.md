# Production Forecast — 烘焙店排产预估系统

基于 Next.js + PostgreSQL + AI 的烘焙店每日排产预估系统，适用于马来西亚吉隆坡地区的烘焙连锁门店。系统通过历史销售数据、业务规则和 AI 智能修正，自动生成月度营业额目标 → 日营业额分配 → 单品出货建议 → 分时段排产计划的完整预测链路，并提供每日复盘、趋势分析、日历看板等运营辅助功能。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 16 + React 19 + Tailwind CSS 4 + Recharts |
| 后端 | Next.js Server Actions + API Routes |
| 数据库 | PostgreSQL (Supabase) |
| AI 引擎 | Google Gemini 2.5 Flash（自动降级 Lite） |
| 趋势预测 | Prophet (Python 微服务) |
| 数据解析 | ExcelJS（Excel 导入导出） |
| 语言 | TypeScript 5 |

## 系统架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                     前端 (Apple Design System)                        │
│  总览 │ 排产 │ 复盘 │ 时段 │ 趋势 │ 日历 │ 赋能 │ 设置              │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         ▼                  ▼                  ▼
  Server Actions       API Routes        Prophet Service
  (lib/actions.ts)     (app/api/)        (Python 微服务)
         │                  │                  │
         │          ┌───────┴───────┐          │
         │          ▼               ▼          │
         │    Gemini 2.5 Flash  Prompt Engine  │
         │    (自动降级 Lite)   (DB 模板驱动)   │
         │          │               │          │
         ▼          ▼               ▼          ▼
  ┌────────────────────────────────────────────────────┐
  │              PostgreSQL (Supabase)                  │
  │  product │ product_strategy │ holiday │ daily_revenue│
  │  daily_sales_record │ product_alias │ context_event │
  │  product_sales_baseline │ business_rule             │
  │  fixed_shipment_schedule │ timeslot_sales_record    │
  │  out_of_stock_record │ prompt_segment/template      │
  │  daily_review_result │ empowerment_event            │
  └────────────────────────────────────────────────────┘
```

## 核心功能模块

系统包含 8 个主要页面，覆盖从预测到复盘的完整运营闭环。

### 1. 总览看板（Overview）

运营数据一览：
- 今日/昨日营业额目标与实际对比
- 昨日复盘摘要（亮点、痛点、建议）
- 快速导航至各功能模块

### 2. 排产预测（Production）

完整的排产预测链路：

**月度营业额目标**
```
月营业额 = 首月基础营业额 × 月度系数 × (1 + 运营提升 + 市场提升)
```
- 月度系数可在 UI 中手动调整，编辑后自动保存到数据库
- 支持 AI 修正：调用 Gemini 模型根据节假日分析自动建议系数

**日营业额分配**

将月度目标按权重分配到每一天：

| 日期类型 | 默认权重 |
|----------|----------|
| 周一至周四 | 1.0 |
| 周五 | 1.2 |
| 周末 | 1.35 |

AI 智能修正综合分析：节假日影响、节前/节后效应、长周末/桥假、发薪日效应、斋月消费模式变化、相邻月份跨月影响等。

**单品出货建议**
- 基线数据按日期类型（周一至四 / 周五 / 周末）分别计算平均销量
- TOP 产品加权 +10~15%，潜在TOP 加权 +5~8%
- 按包装倍数取整，按目标营业额等比缩放
- 支持手动调整 + AI 修正（保持总金额守恒）

### 3. 每日复盘（Review）

AI 驱动的每日经营复盘：
- 自动拉取昨日实际营业额与客单数据
- Gemini 分析亮点、痛点、改进建议
- 复盘结果持久化存储，支持历史回顾
- 复盘数据同步至总览看板

### 4. 分时段排产（Timeslots）

基于历史分时段销售数据，将单品日总量智能分配到各时段（10:00 ~ 19:00）：
- 使用历史时段销售比例进行数据驱动分配
- 考虑产品冷热属性和消费高峰时段
- 支持固定出货时间表配置
- 展示预计销售和预计剩余（累计计算）
- AI 建议：Gemini 根据历史销售模式生成最优时段分配方案
- 导出为与页面一致的二维表格（含颜色标记）

### 5. 趋势分析（Trends）

多产品销售趋势可视化：
- 双轴图表（销量 vs 营业额）
- Prophet 时间序列预测（Python 微服务）
- 支持多产品对比和时间范围筛选

### 6. 日历看板（Calendar）

月度日历视图：
- 每日目标营业额与实际营业额对比
- 节假日标注
- 缺货事件记录与损失金额计算

### 7. 赋能分析（Empowerment）

运营/市场活动效果追踪：
- 记录赋能事件（营销活动、运营优化等）
- AI 分析活动对营业额的影响
- 量化赋能效果

### 8. 系统设置（Settings）

通过 UI 配置以下内容：
- 业务规则（基础营业额、提升率、日期权重等）
- 产品别名映射
- 出货时间表
- 节假日管理（录入节日信息，AI 自动判断系数影响）
- 数据导入（从 Excel 批量导入产品、销售、策略数据）
- Prompt 模板管理

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
| `daily_revenue` | 每日实际营业额记录 |
| `out_of_stock_record` | 缺货事件记录与损失金额 |
| `context_event` | 运营/市场上下文事件 |
| `prompt_segment` | AI Prompt 可复用片段 |
| `prompt_template` | AI Prompt 模板（引用 segment 占位符） |
| `daily_review_result` | 每日复盘结果存储 |
| `empowerment_event` | 赋能活动事件追踪 |

### 节假日管理

`holiday` 表仅存储节日的基本信息（日期、名称、类型、备注），**不固定系数**。系数由 AI 在每次预测时根据节日类型、节前节后影响等因素动态判断。已录入 2026 年马来西亚全部法定公假（共18个节日）。

## 快速开始

### 环境要求

- Node.js 18+
- PostgreSQL 8.0+（推荐使用 Supabase）
- Google Gemini API Key
- Python 3.10+（可选，Prophet 趋势预测服务）

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
│   ├── page.tsx                    # 主入口
│   ├── layout.tsx                  # 全局布局
│   ├── globals.css                 # 全局样式（Tailwind）
│   └── api/
│       ├── ai-correction/          # AI 日系数修正
│       ├── ai-product-correction/  # AI 单品出货修正
│       ├── ai-timeslot/            # AI 分时段建议
│       ├── daily-review/           # 每日复盘 AI 分析
│       ├── empowerment-review/     # 赋能效果 AI 分析
│       └── prophet-trend/          # Prophet 趋势预测代理
├── components/
│   ├── app-shell.tsx               # 应用外壳（导航 + 页面路由）
│   ├── pages/                      # 8 个主页面组件
│   │   ├── overview-page.tsx       # 总览看板
│   │   ├── production-page.tsx     # 排产预测
│   │   ├── review-page.tsx         # 每日复盘
│   │   ├── timeslots-page.tsx      # 分时段排产
│   │   ├── trends-page.tsx         # 趋势分析
│   │   ├── calendar-page.tsx       # 日历看板
│   │   ├── empowerment-page.tsx    # 赋能分析
│   │   └── settings-page.tsx       # 系统设置
│   ├── domain/                     # 领域组件
│   │   ├── timeslot-table.tsx      # 时段分配表格
│   │   └── trend-chart.tsx         # 趋势图表
│   ├── nav/
│   │   └── top-nav.tsx             # 顶部导航（Apple 风格毛玻璃）
│   ├── providers/
│   │   ├── forecast-provider.tsx   # 全局预测状态 Context
│   │   └── toast-provider.tsx      # Toast 通知
│   └── shared/                     # 通用 UI 组件
├── hooks/                          # 自定义 React Hooks
│   ├── use-ai.ts                   # AI 调用逻辑
│   ├── use-calendar.ts             # 日历数据
│   ├── use-empowerment.ts          # 赋能分析
│   ├── use-export.ts               # Excel 导出
│   ├── use-forecast.ts             # 预测状态
│   ├── use-review.ts               # 每日复盘
│   ├── use-settings.ts             # 设置管理
│   ├── use-toast.ts                # Toast 通知
│   └── use-trends.ts               # 趋势分析
├── lib/
│   ├── actions.ts                  # Server Actions（数据库 CRUD）
│   ├── db.ts                       # PostgreSQL 连接
│   ├── gemini-retry.ts             # Gemini API 重试与降级
│   ├── engine/
│   │   ├── forecast-engine.ts      # 核心预测引擎
│   │   └── prompt-engine.ts        # Prompt 模板引擎（DB 驱动）
│   ├── parsers/
│   │   └── excel-parser.ts         # Excel 文件解析器
│   └── types/
│       └── index.ts                # TypeScript 类型定义
├── constants/
│   └── index.ts                    # 常量定义（时段、颜色、页面 ID）
├── config/
│   ├── business-rules.json         # 业务规则配置
│   ├── planning-rules.json         # 排产规则配置
│   └── product-aliases.json        # 产品名称别名映射（100+条）
├── scripts/                        # 工具脚本
│   ├── seed.ts                     # 数据库种子数据
│   ├── import-daily-revenue.ts     # 导入每日营业额
│   ├── import-sales-data.ts        # 导入销售数据
│   ├── insert-stockout.ts          # 插入缺货记录
│   └── migrate-prompts.ts          # 迁移 Prompt 模板到 DB
├── prophet-service/                # Prophet 趋势预测微服务
│   ├── main.py                     # FastAPI 入口
│   ├── models/
│   │   └── trend_predictor.py      # Prophet 预测模型
│   ├── requirements.txt
│   └── Dockerfile
├── data/                           # Excel 源数据文件
├── sql/
│   ├── init.sql                    # 数据库初始化脚本
│   ├── seed-holidays-2026.sql      # 2026 年节假日数据
│   └── migrate-dev-plans.sql       # 开发迁移脚本
└── package.json
```

## 业务规则配置

通过设置页面可配置以下内容：

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

## AI Prompt 管理

系统采用数据库驱动的 Prompt 模板架构：

- `prompt_segment` 表存储可复用的 Prompt 片段（系统角色、数据格式、分析维度等）
- `prompt_template` 表通过占位符引用 segment，组装完整 Prompt
- `prompt-engine.ts` 在运行时从 DB 加载模板并渲染
- 支持通过设置页面在线编辑 Prompt，无需改代码

## 设计风格

采用 Apple Design System 设计语言：
- 毛玻璃导航栏（backdrop-blur）
- SF Pro 字体风格
- Apple Blue (#0071e3) 主色调
- 纯黑 + 浅灰配色方案
- 响应式布局（移动端 → 桌面端）
