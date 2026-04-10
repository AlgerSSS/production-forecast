import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { query } from "@/lib/db";
import { buildPrompt } from "@/lib/engine/prompt-engine";
import { generateWithRetry } from "@/lib/gemini-retry";

const USE_DB_PROMPT = process.env.USE_DB_PROMPT !== "false";

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "your-gemini-api-key-here") {
      return NextResponse.json({ error: "GEMINI_API_KEY 未配置" }, { status: 400 });
    }

    const { eventId } = await req.json();
    if (!eventId) {
      return NextResponse.json({ error: "缺少 eventId 参数" }, { status: 400 });
    }

    // 读取赋能事件
    const events = await query<{
      id: number; event_name: string; event_type: string;
      start_date: string; end_date: string; target_products: string;
      platform: string; exposure_count: number; click_count: number; cost: number;
      operation_type: string; operation_detail: string;
    }>("SELECT * FROM empowerment_event WHERE id = ?", [eventId]);

    if (events.length === 0) {
      return NextResponse.json({ error: "赋能事件不存在" }, { status: 404 });
    }
    const event = events[0];

    // 基线期：活动前14天
    const baselineStart = new Date(event.start_date);
    baselineStart.setDate(baselineStart.getDate() - 14);
    const baselineStartStr = baselineStart.toISOString().slice(0, 10);

    // 后效期：活动后7天
    const afterEnd = new Date(event.end_date);
    afterEnd.setDate(afterEnd.getDate() + 7);
    const afterEndStr = afterEnd.toISOString().slice(0, 10);

    // 读取基线期、活动期、后效期的销售数据
    const salesData = await query<{ date: string; product_name: string; quantity: number }>(
      `SELECT date, standard_name as product_name, SUM(quantity) as quantity
       FROM daily_sales_record
       WHERE date >= ? AND date <= ?
       GROUP BY date, standard_name`,
      [baselineStartStr, afterEndStr]
    );

    // 按时期分组
    const baseline: Record<string, number[]> = {};
    const during: Record<string, number[]> = {};
    const after: Record<string, number[]> = {};

    for (const row of salesData) {
      const bucket = row.date < event.start_date ? baseline
        : row.date <= event.end_date ? during
        : after;
      if (!bucket[row.product_name]) bucket[row.product_name] = [];
      bucket[row.product_name].push(row.quantity);
    }

    const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

    const baselineSales = Object.fromEntries(Object.entries(baseline).map(([k, v]) => [k, avg(v)]));
    const periodSales = Object.fromEntries(Object.entries(during).map(([k, v]) => [k, avg(v)]));
    const afterSales = Object.fromEntries(Object.entries(after).map(([k, v]) => [k, avg(v)]));

    // Build event info text
    const eventInfoText = `- 活动名称：${event.event_name}
- 类型：${event.event_type === "market" ? "市场赋能" : "营运赋能"}
- 时间：${event.start_date} ~ ${event.end_date}
- 关联产品：${event.target_products || "全部"}
${event.event_type === "market" ? `- 平台：${event.platform}\n- 曝光数据：${event.exposure_count}次曝光，${event.click_count}次点击\n- 投入费用：RM ${event.cost}` : `- 营运类型：${event.operation_type}\n- 详情：${event.operation_detail}`}`;

    // Hardcoded fallback prompt
    const fallbackPrompt = `你是烘焙店的市场/营运分析师。请分析以下赋能活动的效果。

【赋能活动信息】
${eventInfoText}

【基线数据（活动前2周平均日销量）】
${JSON.stringify(baselineSales)}

【活动期间数据（平均日销量）】
${JSON.stringify(periodSales)}

【活动后1周数据（平均日销量）】
${JSON.stringify(afterSales)}

请输出JSON：
{
  "roi": {
    "revenueIncrease": 5000,
    "costEfficiency": 2.5,
    "rating": "高效/一般/低效"
  },
  "productImpact": [
    {"product": "蛋挞", "beforeAvg": 150, "duringAvg": 185, "changeRate": "+23%", "confidence": "高"}
  ],
  "insights": ["洞察1"],
  "recommendations": ["建议1"]
}`;

    let systemInstruction = "你是烘焙店的市场/营运分析师，擅长ROI分析和归因。只返回JSON。";
    let prompt = fallbackPrompt;
    let modelName = "gemini-2.5-flash";
    let temperature = 0.1;
    let topP = 0.85;

    if (USE_DB_PROMPT) {
      try {
        const vars: Record<string, string> = {
          eventInfo: eventInfoText,
          baselineSales: JSON.stringify(baselineSales),
          periodSales: JSON.stringify(periodSales),
          afterSales: JSON.stringify(afterSales),
        };
        const built = await buildPrompt("empowerment_review", vars);
        systemInstruction = built.systemInstruction;
        prompt = built.prompt;
        modelName = built.model;
        temperature = built.temperature;
        topP = built.topP;
      } catch (e) {
        console.warn("buildPrompt failed for empowerment_review, using fallback:", e);
      }
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

    // 保存复盘结果
    await query(
      "UPDATE empowerment_event SET review_json = $1, reviewed_at = NOW() WHERE id = $2",
      [JSON.stringify(parsed), eventId]
    );

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("Empowerment review error:", error);
    return NextResponse.json(
      { error: `AI 调用失败: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
