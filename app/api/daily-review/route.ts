import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { query } from "@/lib/db";
import { buildPrompt } from "@/lib/engine/prompt-engine";
import { generateWithRetry } from "@/lib/gemini-retry";
import dayjs from "dayjs";

const USE_DB_PROMPT = process.env.USE_DB_PROMPT !== "false";

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "your-gemini-api-key-here") {
      return NextResponse.json(
        { error: "GEMINI_API_KEY 未配置" },
        { status: 400 }
      );
    }

    const { feedData } = await req.json();
    if (!feedData || !feedData.date) {
      return NextResponse.json({ error: "缺少 feedData 参数" }, { status: 400 });
    }

    // 获取明日信息
    const tomorrow = dayjs(feedData.date).add(1, "day").format("YYYY-MM-DD");
    const tomorrowDow = dayjs(tomorrow).day();
    let tomorrowDayType = "mondayToThursday";
    if (tomorrowDow === 0 || tomorrowDow === 6) tomorrowDayType = "weekend";
    else if (tomorrowDow === 5) tomorrowDayType = "friday";

    // 读取明日事件
    const tomorrowEvents = await query<{ event_tag: string; description: string }>(
      "SELECT event_tag, description FROM context_event WHERE date = ?",
      [tomorrow]
    );

    const tomorrowEventsStr = tomorrowEvents.length > 0
      ? tomorrowEvents.map((e) => `[${e.event_tag}] ${e.description}`).join("; ")
      : "无已录入事件";

    // 读取今日和明日的节日信息
    const holidays = await query<{ date: string; name: string; type: string; note: string }>(
      "SELECT date, name, type, note FROM holiday WHERE date IN (?, ?) ORDER BY date",
      [feedData.date, tomorrow]
    );
    const todayHoliday = holidays.filter((h) => h.date === feedData.date);
    const tomorrowHoliday = holidays.filter((h) => h.date === tomorrow);
    const todayHolidayStr = todayHoliday.length > 0
      ? todayHoliday.map((h) => `[${h.type}] ${h.name}${h.note ? `（${h.note}）` : ""}`).join("; ")
      : "无";
    const tomorrowHolidayStr = tomorrowHoliday.length > 0
      ? tomorrowHoliday.map((h) => `[${h.type}] ${h.name}${h.note ? `（${h.note}）` : ""}`).join("; ")
      : "无";

    // 查询近7天客单数据
    const txStart = dayjs(feedData.date).subtract(6, "day").format("YYYY-MM-DD");
    const txRows = await query<{ date: string; revenue: number; transaction_count: number | null; avg_transaction_value: number | null }>(
      "SELECT date, revenue, transaction_count, avg_transaction_value FROM daily_revenue WHERE date >= ? AND date <= ? ORDER BY date",
      [txStart, feedData.date]
    );
    const transactionData = txRows.length > 0
      ? txRows.map((r) => `${r.date}: 营业额=${r.revenue}, 客单数=${r.transaction_count ?? "N/A"}, 客单价=${r.avg_transaction_value ?? "N/A"}`).join("\n")
      : "暂无客单数据";

    // 构建今日 vs 历史对比
    const todayTxCount = feedData.transactionCount || null;
    const todayAvgTxValue = feedData.avgTransactionValue || null;
    const todayRevenue = feedData.actualRevenue || 0;
    const historyWithTx = txRows.filter((r) => r.transaction_count != null && r.date !== feedData.date);
    let transactionComparison = "";
    if (todayTxCount && historyWithTx.length > 0) {
      const avgHistTxCount = historyWithTx.reduce((s, r) => s + (r.transaction_count || 0), 0) / historyWithTx.length;
      const avgHistAvgTxValue = historyWithTx.reduce((s, r) => s + (r.avg_transaction_value || 0), 0) / historyWithTx.length;
      const avgHistRevenue = historyWithTx.reduce((s, r) => s + r.revenue, 0) / historyWithTx.length;
      const txCountChange = avgHistTxCount > 0 ? ((todayTxCount - avgHistTxCount) / avgHistTxCount * 100).toFixed(1) : "N/A";
      const avgTxValueChange = avgHistAvgTxValue > 0 && todayAvgTxValue ? ((todayAvgTxValue - avgHistAvgTxValue) / avgHistAvgTxValue * 100).toFixed(1) : "N/A";
      const revenueChange = avgHistRevenue > 0 ? ((todayRevenue - avgHistRevenue) / avgHistRevenue * 100).toFixed(1) : "N/A";
      transactionComparison = `【今日客单指标 vs 历史对比】
- 今日客单数: ${todayTxCount}，历史${historyWithTx.length}天均值: ${avgHistTxCount.toFixed(0)}，变化: ${txCountChange}%
- 今日客单价: ${todayAvgTxValue ?? "N/A"}，历史均值: ${avgHistAvgTxValue.toFixed(2)}，变化: ${avgTxValueChange}%
- 今日营业额: ${todayRevenue}，历史均值: ${avgHistRevenue.toFixed(0)}，变化: ${revenueChange}%
- 营业额拆解: ${todayRevenue} = ${todayTxCount}笔 × ${todayAvgTxValue ?? (todayTxCount > 0 ? (todayRevenue / todayTxCount).toFixed(2) : "N/A")}元/笔`;
    }

    const weatherSection = feedData.weatherCondition ? `\n【天气状况】\n${feedData.weatherCondition}` : "";
    const notesSection = feedData.specialNotes ? `\n【特别备注】\n${feedData.specialNotes}` : "";

    // 查询TOP产品近14天销售趋势（按日型分组计算均值）
    const trendStart = dayjs(feedData.date).subtract(13, "day").format("YYYY-MM-DD");
    const topProducts = await query<{ standard_name: string }>(
      `SELECT standard_name FROM daily_sales_record
       WHERE date >= ? AND date <= ?
       GROUP BY standard_name
       ORDER BY SUM(quantity) DESC LIMIT 10`,
      [trendStart, feedData.date]
    );
    let productTrendData = "暂无产品趋势数据";
    if (topProducts.length > 0) {
      const topNames = topProducts.map((p) => p.standard_name);
      const placeholders = topNames.map((_, i) => `$${i + 3}`).join(", ");
      const trendRows = await query<{ standard_name: string; day_of_week: number; avg_qty: number }>(
        `SELECT standard_name, day_of_week, AVG(quantity) AS avg_qty
         FROM daily_sales_record
         WHERE date >= $1 AND date <= $2 AND standard_name IN (${placeholders})
         GROUP BY standard_name, day_of_week
         ORDER BY standard_name, day_of_week`,
        [trendStart, feedData.date, ...topNames]
      );
      // Group by product, then by day type
      const trendMap = new Map<string, { monThu: number[]; fri: number[]; weekend: number[] }>();
      for (const row of trendRows) {
        if (!trendMap.has(row.standard_name)) {
          trendMap.set(row.standard_name, { monThu: [], fri: [], weekend: [] });
        }
        const entry = trendMap.get(row.standard_name)!;
        const dow = row.day_of_week;
        if (dow === 0 || dow === 6) entry.weekend.push(Number(row.avg_qty));
        else if (dow === 5) entry.fri.push(Number(row.avg_qty));
        else entry.monThu.push(Number(row.avg_qty));
      }
      const lines: string[] = [];
      for (const [name, data] of trendMap) {
        const avg = (arr: number[]) => arr.length > 0 ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : "N/A";
        lines.push(`${name}: 周中均值=${avg(data.monThu)}, 周五均值=${avg(data.fri)}, 周末均值=${avg(data.weekend)}`);
      }
      productTrendData = lines.join("\n");
    }

    // 构建prompt
    const dayTypeLabels: Record<string, string> = {
      mondayToThursday: "周中(周一至周四)",
      friday: "周五",
      weekend: "周末",
    };

    let systemInstruction: string;
    let prompt: string;
    let modelName = "gemini-2.5-flash";
    let temperature = 0.1;
    let topP = 0.85;

    // Hardcoded fallback prompt (used when DB prompt is disabled or fails)
    const reviewPromptBody = `你是马来西亚烘焙店的运营分析师。以下是今天的完整经营数据，请完成两项任务：

【任务一：今日复盘】
分析今天的经营表现，重点关注：
1. 营业额达成情况及原因分析
2. 客单数/客单价拆解分析（营业额=客单数×客单价，判断是客流还是消费力变化）
3. 断货产品的损失评估（哪些产品断货最严重，损失了多少）
4. 哪些产品表现超预期/低于预期
5. 时段销售分布是否合理（是否有某时段供应不足）
6. 外部事件（天气/活动/竞品）对今天的实际影响

【任务二：明日预估调整建议】
基于今天的复盘和明天的已知信息（日期类型、已录入事件），输出：
1. 明日整体营业额系数建议（相对基线的调整）
2. 需要增产的产品及建议增幅
3. 需要减产的产品及建议减幅
4. 分时段调整建议（如某产品应提前/延后出货）

【今日数据】
${JSON.stringify(feedData, null, 2)}

【近7天客单数据】
${transactionData}

【TOP产品近期销售趋势（按日型分类均值）】
${productTrendData}

【今日节日信息（来自数据库，请严格基于此数据分析，不要编造节日）】
${todayHolidayStr}

【明日已知信息】
- 日期：${tomorrow}
- 日期类型：${dayTypeLabels[tomorrowDayType] || tomorrowDayType}
- 已录入事件：${tomorrowEventsStr}
- 节日信息：${tomorrowHolidayStr}
${transactionComparison ? `\n${transactionComparison}` : ""}${weatherSection}${notesSection}

重要提示：分析时只能引用上面提供的节日和事件数据，不要自行编造或假设任何节日、活动信息。

请严格返回JSON格式：
{
  "review": {
    "summary": "一句话总结",
    "highlights": ["亮点1", "亮点2"],
    "painPoints": ["痛点1", "痛点2"],
    "stockoutAnalysis": [{"product": "xxx", "lossQty": 10, "lossAmount": 50, "suggestion": "明日增产20%"}],
    "timeslotInsights": ["时段洞察1"],
    "transactionAnalysis": "客单数/客单价对比历史的分析（如有客单数据则必填，无则留空字符串）"
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
}`;

    if (USE_DB_PROMPT) {
      try {
        const vars: Record<string, string> = {
          feedData: JSON.stringify(feedData, null, 2),
          tomorrowDate: tomorrow,
          tomorrowDayType: dayTypeLabels[tomorrowDayType] || tomorrowDayType,
          eventsInfo: tomorrowEventsStr,
          todayHoliday: todayHolidayStr,
          tomorrowHoliday: tomorrowHolidayStr,
          transactionData,
          productTrendData,
          transactionComparison: transactionComparison || "无客单对比数据",
          weatherCondition: feedData.weatherCondition || "未填写",
          specialNotes: feedData.specialNotes || "无",
        };
        const built = await buildPrompt("daily_review", vars);
        systemInstruction = built.systemInstruction;
        prompt = built.prompt;
        modelName = built.model;
        temperature = built.temperature;
        topP = built.topP;
      } catch {
        systemInstruction = "你是马来西亚烘焙店的运营分析师，负责每日经营复盘和次日预估建议。请严格按照用户要求的 JSON 格式返回分析结果。";
        prompt = reviewPromptBody;
      }
    } else {
      systemInstruction = "你是马来西亚烘焙店的运营分析师，负责每日经营复盘和次日预估建议。请严格按照用户要求的 JSON 格式返回分析结果。";
      prompt = reviewPromptBody;
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction,
      generationConfig: { temperature, topP, responseMimeType: "application/json" },
    });

    const text = await generateWithRetry(model, prompt);

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "AI 返回格式解析失败", rawText: text }, { status: 500 });
    }

    if (!parsed.review || !parsed.tomorrowSuggestions) {
      return NextResponse.json({ error: "AI 返回结构不完整", rawText: text }, { status: 500 });
    }

    // 保存到数据库
    await query(
      `INSERT INTO daily_review (date, review_json, suggestions_json)
       VALUES ($1, $2, $3)
       ON CONFLICT (date) DO UPDATE SET review_json = EXCLUDED.review_json, suggestions_json = EXCLUDED.suggestions_json, adopted = false`,
      [feedData.date, JSON.stringify(parsed.review), JSON.stringify(parsed.tomorrowSuggestions)]
    );

    return NextResponse.json({
      review: parsed.review,
      tomorrowSuggestions: parsed.tomorrowSuggestions,
    });
  } catch (error) {
    console.error("Daily review error:", error);
    return NextResponse.json(
      { error: `AI 调用失败: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
