import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { query } from "@/lib/db";

interface BaselineRow {
  product_name: string;
  avg_monday_to_thursday: number;
  avg_friday: number;
  avg_weekend: number;
}

interface TimeslotRow {
  product_name: string;
  time_slot: string;
  avg_quantity: number;
}

interface ProductInput {
  productName: string;
  price: number;
  packMultiple: number;
  unitType: "batch" | "individual";
  positioning: string;
  coldHot: string;
  roundedQuantity: number;
  adjustedQuantity?: number;
}

const DAY_TYPE_LABELS: Record<string, string> = {
  mondayToThursday: "周一至周四",
  friday: "周五",
  weekend: "周六周日",
};

const DAY_TYPE_COL: Record<string, string> = {
  mondayToThursday: "avg_monday_to_thursday",
  friday: "avg_friday",
  weekend: "avg_weekend",
};

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "your-gemini-api-key-here") {
      return NextResponse.json(
        { error: "GEMINI_API_KEY 未配置，请在 .env 文件中设置有效的 API Key" },
        { status: 400 }
      );
    }
    const { dayType, date, shipmentAmount, productSuggestions } = await req.json();
    if (!dayType || !productSuggestions || !shipmentAmount) {
      return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
    }

    // Fetch historical baselines
    const baselines = await query<BaselineRow>(
      "SELECT product_name, avg_monday_to_thursday, avg_friday, avg_weekend FROM product_sales_baseline"
    );
    const baselineMap = new Map<string, number>();
    const col = DAY_TYPE_COL[dayType] || "avg_monday_to_thursday";
    for (const row of baselines) {
      baselineMap.set(row.product_name, row[col as keyof BaselineRow] as number);
    }

    // Fetch timeslot distribution for reference
    const timeslotData = await query<TimeslotRow>(
      "SELECT product_name, time_slot, avg_quantity FROM timeslot_sales_record WHERE day_type = ? ORDER BY product_name, time_slot",
      [dayType]
    );
    const timeslotMap: Record<string, { timeSlot: string; avgQty: number }[]> = {};
    for (const row of timeslotData) {
      if (!timeslotMap[row.product_name]) timeslotMap[row.product_name] = [];
      timeslotMap[row.product_name].push({ timeSlot: row.time_slot, avgQty: row.avg_quantity });
    }

    // Build prompt context — include current total for AI reference
    const dayLabel = DAY_TYPE_LABELS[dayType] || dayType;
    const products = productSuggestions as ProductInput[];

    let currentTotal = 0;
    let productContext = "";
    for (const p of products) {
      const qty = p.adjustedQuantity ?? p.roundedQuantity;
      const amount = qty * p.price;
      currentTotal += amount;
      const hist = baselineMap.get(p.productName);
      const histStr = hist !== undefined ? `历史日均销量=${hist.toFixed(1)}` : "无历史数据";
      productContext += `- ${p.productName}：数量=${qty}，单价=${p.price}，金额=${amount}，定位=${p.positioning}，冷热=${p.coldHot}，倍数=${p.packMultiple}，类型=${p.unitType === "batch" ? "整批" : "按个"}，${histStr}\n`;
    }

    let timeslotContext = "";
    if (timeslotData.length > 0) {
      timeslotContext = "\n【分时段消费分布参考】\n";
      for (const [name, slots] of Object.entries(timeslotMap)) {
        timeslotContext += `${name}：${slots.map(s => `${s.timeSlot}=${s.avgQty}`).join(", ")}\n`;
      }
    }

    const prompt = `请根据历史销售数据，对当前的单品出货建议进行校正。

当前日期：${date || "未知"}
日期类型：${dayLabel}
目标出货金额：${shipmentAmount}
当前建议总金额：${currentTotal}

【当前系统建议方案】
${productContext}
${timeslotContext}
【核心校正原则——总金额守恒】
你必须同时调整多个产品，使校正后的总金额（所有产品的 数量×单价 之和）尽量接近目标出货金额 ${shipmentAmount}。
- 增加某个产品的数量时，必须相应减少其他产品的数量来平衡金额
- 减少时优先减少"其他"定位的低销量产品，或历史均值远低于当前建议的产品
- 增加时优先增加TOP品和潜在TOP品

【其他校正原则】
1. TOP品优先增加：TOP定位产品应优先保障，数量不低于历史均值
2. 冷热平衡：热品占60-70%为宜
3. 日型特征：${dayLabel}的消费特征需体现
4. 包装倍数约束：整批产品的数量必须是packMultiple的整数倍
5. 历史参考：当前建议与历史均值偏差大的产品应重点关注

你必须返回所有产品的校正后数量（不只是变化的产品），严格返回如下 JSON 格式：
{
  "analysis": "先输出整体校正分析：你打算增加哪些品、减少哪些品、各自增减多少金额、如何保持总金额平衡（150字以内）",
  "corrections": [
    {"productName": "产品名", "suggestedQuantity": 10, "reason": "增加/减少原因"}
  ]
}

corrections 数组必须包含所有 ${products.length} 个产品，每个产品都要给出 suggestedQuantity。`;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: "你是一个马来西亚烘焙店的排产专家。请根据历史销售数据对单品出货建议进行校正，严格遵循总金额守恒原则，只返回 JSON。",
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

    if (!parsed.corrections || !Array.isArray(parsed.corrections)) {
      return NextResponse.json(
        { error: "AI 返回的 corrections 格式不正确", rawText: text },
        { status: 500 }
      );
    }

    // Post-process: enforce packMultiple for batch products
    const productMap = new Map<string, ProductInput>();
    for (const p of productSuggestions as ProductInput[]) {
      productMap.set(p.productName, p);
    }

    const corrections = parsed.corrections.map((c: { productName: string; suggestedQuantity: number; reason: string }) => {
      const product = productMap.get(c.productName);
      let qty = Math.max(0, Math.round(c.suggestedQuantity));
      if (product && product.unitType === "batch" && product.packMultiple > 1) {
        qty = Math.round(qty / product.packMultiple) * product.packMultiple;
      }
      return {
        productName: c.productName,
        suggestedQuantity: qty,
        reason: c.reason || "",
      };
    });

    // Calculate corrected total amount
    const correctionMap = new Map<string, number>();
    for (const c of corrections) {
      correctionMap.set(c.productName, c.suggestedQuantity);
    }
    let correctedTotal = 0;
    for (const p of products) {
      const qty = correctionMap.get(p.productName) ?? (p.adjustedQuantity ?? p.roundedQuantity);
      correctedTotal += qty * p.price;
    }

    // 金额兜底：如果 AI 校正后总金额偏差超过 2%，微调 TOP/潜在TOP 品来缩小差距
    const diff = shipmentAmount - correctedTotal;
    const tolerance = shipmentAmount * 0.02;
    if (Math.abs(diff) > tolerance) {
      // 按定位优先级排序：TOP > 潜在TOP > 其他，同级按单价从高到低
      const adjustable = corrections
        .map((c: { productName: string; suggestedQuantity: number; reason: string }) => ({
          correction: c,
          product: productMap.get(c.productName),
        }))
        .filter((x: { product: ProductInput | undefined }) => x.product)
        .sort((a: { product: ProductInput }, b: { product: ProductInput }) => {
          const posOrder: Record<string, number> = { "TOP": 0, "潜在TOP": 1, "其他": 2 };
          const pa = posOrder[a.product.positioning] ?? 2;
          const pb = posOrder[b.product.positioning] ?? 2;
          if (pa !== pb) return pa - pb;
          return b.product.price - a.product.price;
        });

      let remaining = diff;
      for (const { correction: c, product: p } of adjustable) {
        if (Math.abs(remaining) <= tolerance) break;
        if (!p) continue;
        const unit = (p.unitType === "batch" && p.packMultiple > 1) ? p.packMultiple : 1;
        const stepAmount = unit * p.price;
        if (remaining > 0 && stepAmount <= remaining * 1.5) {
          // 需要增加金额 → 增加数量
          c.suggestedQuantity += unit;
          remaining -= stepAmount;
          correctionMap.set(c.productName, c.suggestedQuantity);
        } else if (remaining < 0 && c.suggestedQuantity > unit) {
          // 需要减少金额 → 减少数量（但不减到 0）
          c.suggestedQuantity -= unit;
          remaining += stepAmount;
          correctionMap.set(c.productName, c.suggestedQuantity);
        }
      }
      // Recalculate
      correctedTotal = 0;
      for (const p of products) {
        const qty = correctionMap.get(p.productName) ?? (p.adjustedQuantity ?? p.roundedQuantity);
        correctedTotal += qty * p.price;
      }
    }

    return NextResponse.json({
      corrections,
      analysis: parsed.analysis || "",
      correctedTotal,
      targetAmount: shipmentAmount,
    });
  } catch (error) {
    console.error("AI product correction error:", error);
    return NextResponse.json(
      { error: `AI 调用失败: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
