import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { query } from "@/lib/db";

interface TimeslotSalesRow {
  product_name: string;
  day_type: string;
  time_slot: string;
  avg_quantity: number;
  sample_count: number;
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "your-gemini-api-key-here") {
      return NextResponse.json(
        { error: "GEMINI_API_KEY 未配置，请在 .env 文件中设置有效的 API Key" },
        { status: 400 }
      );
    }

    const { dayType, productSuggestions, timeSlots } = await req.json();
    if (!dayType || !productSuggestions || !timeSlots) {
      return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
    }

    // PLACEHOLDER_TIMESLOT_DATA_QUERY
    const timeslotData = await query<TimeslotSalesRow>(
      "SELECT product_name, day_type, time_slot, avg_quantity, sample_count FROM timeslot_sales_record WHERE day_type = ? ORDER BY product_name, time_slot",
      [dayType]
    );

    const dayTypeLabels: Record<string, string> = {
      mondayToThursday: "周一至周四",
      friday: "周五",
      weekend: "周六周日",
    };

    // Build per-product timeslot history summary
    const productTimeslotMap: Record<string, { timeSlot: string; avgQty: number }[]> = {};
    for (const row of timeslotData) {
      if (!productTimeslotMap[row.product_name]) {
        productTimeslotMap[row.product_name] = [];
      }
      productTimeslotMap[row.product_name].push({
        timeSlot: row.time_slot,
        avgQty: row.avg_quantity,
      });
    }

    // PLACEHOLDER_BUILD_PROMPT
    const hasHistoricalData = timeslotData.length > 0;

    let historicalContext = "";
    if (hasHistoricalData) {
      historicalContext = "\n\n【历史分时段销售数据】\n";
      historicalContext += `日期类型：${dayTypeLabels[dayType] || dayType}\n\n`;
      for (const [name, slots] of Object.entries(productTimeslotMap)) {
        historicalContext += `${name}：`;
        historicalContext += slots.map((s) => `${s.timeSlot}=${s.avgQty}`).join(", ");
        historicalContext += "\n";
      }
    } else {
      historicalContext = "\n\n当前没有历史分时段销售数据，请根据烘焙行业经验和产品属性进行合理分配。\n";
    }

    // Build product info for prompt
    let productInfo = "\n【当日产品出货建议】\n";
    for (const p of productSuggestions) {
      const qty = p.adjustedQuantity ?? p.roundedQuantity;
      productInfo += `- ${p.productName}：总量=${qty}，单价=${p.price}，`;
      productInfo += `定位=${p.positioning}，冷热=${p.coldHot}，倍数=${p.packMultiple}，`;
      productInfo += `类型=${p.unitType === "batch" ? "整批" : "按个"}\n`;
    }

    const prompt = `当前日期类型：${dayTypeLabels[dayType] || dayType}
可用时段：${timeSlots.join(", ")}
${productInfo}${historicalContext}

请为每个产品制定分时段出货方案。要求：

1. **每个产品的各时段数量之和必须等于该产品的总量**
2. **整批产品（类型=整批）的每个时段数量必须是倍数的整数倍**
3. **按个产品的数量为整数即可**
4. **考虑以下因素**：
   - 烘焙店上午（10:00-12:00）是出货高峰，应分配较多
   - 热品需要更频繁补货，冷品可以集中出货
   - TOP品应优先保证早高峰供应充足
   - 下午时段（14:00-16:00）有第二波消费高峰
   - 晚间时段（18:00-19:00）出货量应较少
${hasHistoricalData ? "5. **优先参考历史分时段销售数据的分布规律**" : "5. **根据烘焙行业通用经验进行分配**"}

严格返回如下 JSON 格式（不要有其他文字，仅返回 JSON）：
{
  "suggestions": [
    {"productName": "产品名", "timeSlot": "11:00", "quantity": 10, "reason": "早高峰主力出货"}
  ],
  "analysis": "整体分析说明（100字以内）"
}

suggestions 数组中，只需要包含数量>0的记录。每个产品至少有1条记录。`;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: "你是一个马来西亚烘焙店的排产专家，擅长根据历史销售规律制定分时段出货计划。请严格按照用户要求的 JSON 格式返回分析结果，不要输出任何非 JSON 内容。",
      generationConfig: {
        temperature: 0.1,
        topP: 0.85,
        responseMimeType: "application/json",
      },
    });
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // Parse JSON — responseMimeType 保证返回纯 JSON
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "AI 返回格式解析失败", rawText: text },
        { status: 500 }
      );
    }

    if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) {
      return NextResponse.json(
        { error: "AI 返回的 suggestions 格式不正确", rawText: text },
        { status: 500 }
      );
    }

    // Validate and add amount
    const productPriceMap = new Map<string, number>();
    for (const p of productSuggestions) {
      productPriceMap.set(p.productName, p.price);
    }

    const normalized = parsed.suggestions.map((s: { productName: string; timeSlot: string; quantity: number; reason: string }) => ({
      productName: s.productName,
      timeSlot: s.timeSlot,
      quantity: Math.max(0, Math.round(s.quantity)),
      amount: Math.round(Math.max(0, Math.round(s.quantity)) * (productPriceMap.get(s.productName) || 0)),
      reason: s.reason || "",
    }));

    return NextResponse.json({
      suggestions: normalized,
      analysis: parsed.analysis || "",
    });
  } catch (error) {
    console.error("AI timeslot error:", error);
    return NextResponse.json(
      { error: `AI 调用失败: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}