/**
 * Prompt迁移脚本：将现有3个AI路由中的硬编码prompt拆解为数据库中的积木块
 * 执行：npx tsx scripts/migrate-prompts.ts
 */
import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
const sql = postgres(url);

interface Segment {
  segment_key: string;
  category: string;
  title: string;
  content: string;
  variables: string;
  sort_order: number;
}

interface Template {
  template_key: string;
  title: string;
  system_instruction_key: string;
  segment_keys: string;
  model: string;
  temperature: number;
  top_p: number;
}

// ========== Prompt Segments ==========
const segments: Segment[] = [
  // --- Role definitions ---
  {
    segment_key: "role.bakery_analyst",
    category: "role",
    title: "角色-烘焙运营分析师",
    content: "你是一位深耕马来西亚烘焙餐饮行业的资深运营分析师，精通烘焙店（面包、蛋糕、西点、饮品）的营业额波动规律。请严格按照用户要求的 JSON 格式返回分析结果，不要输出任何非 JSON 内容。",
    variables: "",
    sort_order: 1,
  },
  {
    segment_key: "role.production_expert",
    category: "role",
    title: "角色-排产专家",
    content: "你是一个马来西亚烘焙店的排产专家。请根据历史销售数据对单品出货建议进行校正，严格遵循总金额守恒原则，只返回 JSON。",
    variables: "",
    sort_order: 2,
  },
  {
    segment_key: "role.timeslot_expert",
    category: "role",
    title: "角色-分时段排产专家",
    content: "你是一个马来西亚烘焙店的排产专家，擅长根据历史销售规律制定分时段出货计划。请严格按照用户要求的 JSON 格式返回分析结果，不要输出任何非 JSON 内容。",
    variables: "",
    sort_order: 3,
  },
  {
    segment_key: "role.review_analyst",
    category: "role",
    title: "角色-复盘分析师",
    content: "你是马来西亚烘焙店的运营分析师，负责每日经营复盘和次日预估建议。请严格按照用户要求的 JSON 格式返回分析结果。",
    variables: "",
    sort_order: 4,
  },

  // --- Knowledge segments ---
  {
    segment_key: "knowledge.day_type_base",
    category: "knowledge",
    title: "基础日型系数",
    content: `## 一、基础日型系数（无特殊事件的普通周）
- 周一至周四 = 1.0（工作日常规消费，以早餐面包、午间轻食为主）
- 周五 = 1.2（周末前夕，下午茶订单增多，部分顾客提前采购周末用糕点）
- 周六 = 1.35（家庭出行高峰，生日蛋糕订单集中，下午茶消费旺盛）
- 周日 = 1.35（与周六类似，但傍晚后略有回落）`,
    variables: "",
    sort_order: 1,
  },
  {
    segment_key: "knowledge.holiday_cake_effect",
    category: "knowledge",
    title: "蛋糕/礼盒类爆发节日",
    content: `## 二、烘焙行业特有的节日效应（这是核心，请重点分析）

### 蛋糕/礼盒类爆发节日（系数可达 1.8~2.5）：
- **情人节（2/14）**：蛋糕、巧克力礼盒爆发，前2天开始攀升
- **母亲节（5月第二个周日）**：蛋糕订单全年最高峰之一，前3-5天持续走高
- **父亲节（6月第三个周日）**：蛋糕需求明显但弱于母亲节
- **圣诞节（12/25）**：圣诞木柴蛋糕(Log Cake)、姜饼屋，前一周开始爆发
- **中秋节**：月饼/中秋礼盒，节前1-2周是销售高峰`,
    variables: "",
    sort_order: 2,
  },
  {
    segment_key: "knowledge.malaysia_holidays",
    category: "knowledge",
    title: "马来西亚特色节日",
    content: `### 马来西亚特色节日对烘焙的影响：
- **农历新年**：年饼(Cookies)、礼盒需求极大，节前2-3周是黄金期，除夕当天可能提前打烊（系数反而降低）
- **开斋节(Hari Raya Aidilfitri)**：Kuih Raya饼干需求巨大，斋月最后一周是采购高峰
- **屠妖节(Deepavali)**：印度甜点需求增加，对烘焙店有一定带动
- **哈芝节(Hari Raya Haji)**：影响较温和
- **卫塞节、国庆日等公假**：主要是休假带来的客流增加`,
    variables: "",
    sort_order: 3,
  },
  {
    segment_key: "knowledge.ramadan_effect",
    category: "knowledge",
    title: "斋月特殊影响",
    content: `### 斋月(Ramadan)对烘焙店的特殊影响：
- 白天：穆斯林顾客减少，但华人/印度裔顾客不受影响，整体约 0.85~0.95
- 傍晚开斋前1-2小时：外卖/打包需求激增
- 斋月最后一周：开斋节备货需求爆发，系数可达 1.3~1.6
- 开斋节当天及次日：多数人在家庆祝，门店客流反而可能下降`,
    variables: "",
    sort_order: 4,
  },
  {
    segment_key: "knowledge.payday_cycle",
    category: "knowledge",
    title: "发薪日周期规律",
    content: `## 三、烘焙行业的周期性规律
- **发薪日效应**：本店所在区域的主要客群在每月7号左右发薪，发薪后2-3天（即7~10号）消费力明显提升约 0.05~0.15，尤其是蛋糕、下午茶等非刚需品类；发薪前一周（月底至月初1-6号）消费力偏弱，顾客倾向选择低单价产品
- **月末至发薪前低谷**：每月25号之后至次月6号，消费力逐步收缩，系数可下调 0.03~0.08
- **学校假期**：家庭外出增多，商场店铺客流上升约 0.1~0.15；但住宅区店铺可能下降`,
    variables: "",
    sort_order: 5,
  },
  {
    segment_key: "knowledge.weather_season",
    category: "knowledge",
    title: "天气季节影响",
    content: `- **雨季影响（11-3月东北季风）**：大雨天气可能降低客流 0.05~0.1，但外卖订单可能补偿部分损失`,
    variables: "",
    sort_order: 6,
  },
  {
    segment_key: "knowledge.pre_post_holiday",
    category: "knowledge",
    title: "节前/节后波动",
    content: `## 四、节前/节后的烘焙消费波动
- **重大节日前3-5天**：蛋糕预订高峰，礼盒采购高峰，系数逐日攀升
- **重大节日前1天**：通常是取货高峰日，营业额可能是全月最高
- **节后第1天**：消费明显回落，尤其是长假后
- **长周末/桥假**：如公假在周四或周二，形成4天连假，旅游出行增多，商场店可能受益，社区店可能受损`,
    variables: "",
    sort_order: 7,
  },
  {
    segment_key: "knowledge.cold_hot_balance",
    category: "knowledge",
    title: "冷热品平衡",
    content: `【冷热品平衡原则】
- 热品占60-70%为宜，冷品集中出货，热品频繁补货
- TOP品优先保量≥历史均值，潜在TOP次之`,
    variables: "",
    sort_order: 8,
  },
  {
    segment_key: "knowledge.timeslot_pattern",
    category: "knowledge",
    title: "分时段消费规律",
    content: `【分时段消费规律】
- 上午（10:00-12:00）是出货高峰，应分配较多
- 热品需要更频繁补货，冷品可以集中出货
- TOP品应优先保证早高峰供应充足
- 下午时段（14:00-16:00）有第二波消费高峰
- 晚间时段（18:00-19:00）出货量应较少`,
    variables: "",
    sort_order: 9,
  },
  {
    segment_key: "knowledge.top_product_priority",
    category: "knowledge",
    title: "TOP产品优先策略",
    content: `【TOP产品优先策略】
- TOP品优先增加：TOP定位产品应优先保障，数量不低于历史均值
- 减少时优先减少"其他"定位的低销量产品，或历史均值远低于当前建议的产品
- 增加时优先增加TOP品和潜在TOP品`,
    variables: "",
    sort_order: 10,
  },

  // --- Rule segments ---
  {
    segment_key: "rule.total_amount_conservation",
    category: "rule",
    title: "总金额守恒约束",
    content: `【核心校正原则——总金额守恒】
你必须同时调整多个产品，使校正后的总金额（所有产品的 数量×单价 之和）尽量接近目标出货金额 \${shipmentAmount}。
- 增加某个产品的数量时，必须相应减少其他产品的数量来平衡金额
- 减少时优先减少"其他"定位的低销量产品，或历史均值远低于当前建议的产品
- 增加时优先增加TOP品和潜在TOP品`,
    variables: "shipmentAmount",
    sort_order: 1,
  },
  {
    segment_key: "rule.pack_multiple_constraint",
    category: "rule",
    title: "包装倍数约束",
    content: `- 包装倍数约束：整批产品的数量必须是packMultiple的整数倍`,
    variables: "",
    sort_order: 2,
  },
  {
    segment_key: "rule.timeslot_sum_constraint",
    category: "rule",
    title: "时段总量约束",
    content: `- 每个产品的各时段数量之和必须等于该产品的总量
- 整批产品（类型=整批）的每个时段数量必须是倍数的整数倍
- 按个产品的数量为整数即可`,
    variables: "",
    sort_order: 3,
  },
  {
    segment_key: "rule.coefficient_range",
    category: "rule",
    title: "系数输出规则",
    content: `## 五、输出要求
请根据以上行业知识和节假日数据，为每一天给出合理的系数。
coefficient 保留2位小数。reason 用简短中文说明（需包含具体的影响因素分析，如"母亲节前2天，蛋糕预订高峰"而非笼统的"节日影响"）。`,
    variables: "",
    sort_order: 4,
  },

  // --- Format segments ---
  {
    segment_key: "format.daily_correction",
    category: "format",
    title: "日系数输出格式",
    content: `严格返回如下 JSON 数组格式（不要有其他文字，仅返回 JSON）：
[{"date": "\${year}-\${monthPadded}-01", "coefficient": 1.0, "reason": "普通工作日"}, ...]

每天一条记录，共 \${daysInMonth} 条。`,
    variables: "year,monthPadded,daysInMonth",
    sort_order: 1,
  },
  {
    segment_key: "format.product_correction",
    category: "format",
    title: "单品校正输出格式",
    content: `你必须返回所有产品的校正后数量（不只是变化的产品），严格返回如下 JSON 格式：
{
  "analysis": "先输出整体校正分析：你打算增加哪些品、减少哪些品、各自增减多少金额、如何保持总金额平衡（150字以内）",
  "corrections": [
    {"productName": "产品名", "suggestedQuantity": 10, "reason": "增加/减少原因"}
  ]
}

corrections 数组必须包含所有 \${productCount} 个产品，每个产品都要给出 suggestedQuantity。`,
    variables: "productCount",
    sort_order: 2,
  },
  {
    segment_key: "format.timeslot_allocation",
    category: "format",
    title: "时段分配输出格式",
    content: `严格返回如下 JSON 格式（不要有其他文字，仅返回 JSON）：
{
  "suggestions": [
    {"productName": "产品名", "timeSlot": "11:00", "quantity": 10, "reason": "早高峰主力出货"}
  ],
  "analysis": "整体分析说明（100字以内）"
}

suggestions 数组中，只需要包含数量>0的记录。每个产品至少有1条记录。`,
    variables: "",
    sort_order: 3,
  },
  {
    segment_key: "format.daily_review",
    category: "format",
    title: "每日复盘输出格式",
    content: `请严格返回JSON格式：
{
  "review": {
    "summary": "一句话总结",
    "highlights": ["亮点1", "亮点2"],
    "painPoints": ["痛点1", "痛点2"],
    "stockoutAnalysis": [{"product": "xxx", "lossQty": 10, "lossAmount": 50, "suggestion": "明日增产20%"}],
    "timeslotInsights": ["时段洞察1"]
  },
  "tomorrowSuggestions": {
    "overallCoefficientAdjust": 1.05,
    "reason": "原因",
    "productAdjustments": [
      {"productName": "xxx", "adjustRatio": 1.15, "reason": "今日15:00断货"}
    ],
    "timeslotAdjustments": [
      {"productName": "xxx", "timeSlot": "14:00", "adjustRatio": 1.2, "reason": "该时段供应不足"}
    ]
  }
}`,
    variables: "",
    sort_order: 4,
  },

  // --- Context segments (runtime-filled) ---
  {
    segment_key: "context.year_overview",
    category: "context",
    title: "全年节假日概览",
    content: `\${yearOverview}`,
    variables: "yearOverview",
    sort_order: 1,
  },
  {
    segment_key: "context.current_month_holidays",
    category: "context",
    title: "当月节假日",
    content: `\${holidayInfo}`,
    variables: "holidayInfo",
    sort_order: 2,
  },
  {
    segment_key: "context.adjacent_holidays",
    category: "context",
    title: "相邻月节假日",
    content: `\${adjacentInfo}`,
    variables: "adjacentInfo",
    sort_order: 3,
  },
  {
    segment_key: "context.events",
    category: "context",
    title: "事件上下文",
    content: `\${eventsInfo}`,
    variables: "eventsInfo",
    sort_order: 4,
  },
  {
    segment_key: "context.product_data",
    category: "context",
    title: "产品数据上下文",
    content: `\${productContext}`,
    variables: "productContext",
    sort_order: 5,
  },
  {
    segment_key: "context.timeslot_history",
    category: "context",
    title: "时段历史数据",
    content: `\${timeslotContext}`,
    variables: "timeslotContext",
    sort_order: 6,
  },
];

// ========== Prompt Templates ==========
const templates: Template[] = [
  {
    template_key: "daily_correction",
    title: "日系数AI校正",
    system_instruction_key: "role.bakery_analyst",
    segment_keys: "knowledge.day_type_base,knowledge.holiday_cake_effect,knowledge.malaysia_holidays,knowledge.ramadan_effect,knowledge.payday_cycle,knowledge.weather_season,knowledge.pre_post_holiday,context.year_overview,context.current_month_holidays,context.adjacent_holidays,context.events,rule.coefficient_range,format.daily_correction",
    model: "gemini-2.5-flash",
    temperature: 0.1,
    top_p: 0.85,
  },
  {
    template_key: "product_correction",
    title: "单品校正",
    system_instruction_key: "role.production_expert",
    segment_keys: "context.product_data,context.timeslot_history,rule.total_amount_conservation,knowledge.top_product_priority,knowledge.cold_hot_balance,rule.pack_multiple_constraint,format.product_correction",
    model: "gemini-2.5-flash",
    temperature: 0.1,
    top_p: 0.85,
  },
  {
    template_key: "timeslot_allocation",
    title: "时段分配",
    system_instruction_key: "role.timeslot_expert",
    segment_keys: "context.product_data,context.timeslot_history,knowledge.timeslot_pattern,rule.timeslot_sum_constraint,rule.pack_multiple_constraint,format.timeslot_allocation",
    model: "gemini-2.5-flash",
    temperature: 0.1,
    top_p: 0.85,
  },
  {
    template_key: "daily_review",
    title: "每日复盘",
    system_instruction_key: "role.review_analyst",
    segment_keys: "context.events,knowledge.payday_cycle,knowledge.day_type_base,format.daily_review",
    model: "gemini-2.5-flash",
    temperature: 0.1,
    top_p: 0.85,
  },
];

// ========== Migration Execution ==========
async function migrate() {
  console.log("Starting prompt migration...");

  // Insert segments
  for (const seg of segments) {
    await sql`
      INSERT INTO prompt_segment (segment_key, category, title, content, variables, sort_order, is_active, version)
      VALUES (${seg.segment_key}, ${seg.category}, ${seg.title}, ${seg.content}, ${seg.variables}, ${seg.sort_order}, true, 1)
      ON CONFLICT (segment_key) DO UPDATE SET
        category = EXCLUDED.category, title = EXCLUDED.title, content = EXCLUDED.content,
        variables = EXCLUDED.variables, sort_order = EXCLUDED.sort_order
    `;
    console.log(`  ✓ Segment: ${seg.segment_key}`);
  }
  console.log(`Inserted ${segments.length} segments.`);

  // Insert templates
  for (const tpl of templates) {
    await sql`
      INSERT INTO prompt_template (template_key, title, system_instruction_key, segment_keys, model, temperature, top_p, is_active)
      VALUES (${tpl.template_key}, ${tpl.title}, ${tpl.system_instruction_key}, ${tpl.segment_keys}, ${tpl.model}, ${tpl.temperature}, ${tpl.top_p}, true)
      ON CONFLICT (template_key) DO UPDATE SET
        title = EXCLUDED.title, system_instruction_key = EXCLUDED.system_instruction_key,
        segment_keys = EXCLUDED.segment_keys, model = EXCLUDED.model,
        temperature = EXCLUDED.temperature, top_p = EXCLUDED.top_p
    `;
    console.log(`  ✓ Template: ${tpl.template_key}`);
  }
  console.log(`Inserted ${templates.length} templates.`);

  console.log("Migration complete!");
  await sql.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
