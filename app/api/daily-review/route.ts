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

    const reviewPromptBody = `你是马来西亚烘焙店的运营分析师。以下是今天的完整经营数据，请完成两项任务：

【任务一：今日复盘】
分析今天的经营表现，重点关注：
1. 营业额达成情况及原因分析
2. 断货产品的损失评估（哪些产品断货最严重，损失了多少）
3. 哪些产品表现超预期/低于预期
4. 时段销售分布是否合理（是否有某时段供应不足）
5. 外部事件（天气/活动/竞品）对今天的实际影响

【任务二：明日预估调整建议】
基于今天的复盘和明天的已知信息（日期类型、已录入事件），输出：
1. 明日整体营业额系数建议（相对基线的调整）
2. 需要增产的产品及建议增幅
3. 需要减产的产品及建议减幅
4. 分时段调整建议（如某产品应提前/延后出货）

【今日数据】
${JSON.stringify(feedData, null, 2)}

【明日已知信息】
- 日期：${tomorrow}
- 日期类型：${dayTypeLabels[tomorrowDayType] || tomorrowDayType}
- 已录入事件：${tomorrowEventsStr}

请严格返回JSON格式：
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
}`;

    if (USE_DB_PROMPT) {
      try {
        const vars: Record<string, string> = {
          eventsInfo: tomorrowEventsStr,
        };
        const built = await buildPrompt("daily_review", vars);
        systemInstruction = built.systemInstruction;
        prompt = reviewPromptBody;
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
