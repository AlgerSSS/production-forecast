import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { query } from "@/lib/db";
import { buildPrompt } from "@/lib/engine/prompt-engine";

interface HolidayRow {
  date: string;
  name: string;
  type: string;
  coefficient: number | null;
  note: string;
}

interface ContextEventRow {
  date: string;
  event_tag: string;
  description: string;
}

const USE_DB_PROMPT = process.env.USE_DB_PROMPT !== "false"; // default true

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "your-gemini-api-key-here") {
      return NextResponse.json(
        { error: "GEMINI_API_KEY 未配置，请在 .env 文件中设置有效的 API Key" },
        { status: 400 }
      );
    }

    const { year, month, city } = await req.json();
    if (!year || !month) {
      return NextResponse.json({ error: "缺少 year 或 month 参数" }, { status: 400 });
    }

    // 从数据库读取当月的节假日数据
    const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;
    const holidays = await query<HolidayRow>(
      "SELECT date, name, type, coefficient, note FROM holiday WHERE date LIKE ? ORDER BY date",
      [`${monthPrefix}%`]
    );

    // 同时读取前一个月和后一个月的节假日
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;

    const prevMonthPrefix = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
    const nextMonthPrefix = `${nextYear}-${String(nextMonth).padStart(2, "0")}`;

    const adjacentHolidays = await query<HolidayRow>(
      "SELECT date, name, type, note FROM holiday WHERE date LIKE ? OR date LIKE ? ORDER BY date",
      [`${prevMonthPrefix}%`, `${nextMonthPrefix}%`]
    );

    const allYearHolidays = await query<HolidayRow>(
      "SELECT date, name, type, note FROM holiday WHERE date LIKE ? ORDER BY date",
      [`${year}%`]
    );

    // 读取事件上下文
    const events = await query<ContextEventRow>(
      "SELECT date, event_tag, description FROM context_event WHERE date LIKE ? ORDER BY date",
      [`${monthPrefix}%`]
    );

    const daysInMonth = new Date(year, month, 0).getDate();
    const cityInfo = city ? `，城市：${city}` : "，城市：吉隆坡（Kuala Lumpur）";

    const typeLabels: Record<string, string> = {
      public_holiday: "法定公假",
      festival: "重要节日",
      promotion: "促销活动",
      ramadan: "斋月",
      other: "其他",
    };

    let holidayInfo = "";
    if (holidays.length > 0) {
      holidayInfo = "\n\n【当月节假日/特殊日期】\n";
      for (const h of holidays) {
        holidayInfo += `- ${h.date}：${h.name}（${typeLabels[h.type] || h.type}）`;
        if (h.note) holidayInfo += `，备注：${h.note}`;
        holidayInfo += "\n";
      }
    } else {
      holidayInfo = "\n\n当月没有录入节假日信息，请根据你对马来西亚节假日的了解补充判断。\n";
    }

    let adjacentInfo = "";
    if (adjacentHolidays.length > 0) {
      adjacentInfo = "\n【相邻月份节假日（用于节前节后影响分析）】\n";
      for (const h of adjacentHolidays) {
        adjacentInfo += `- ${h.date}：${h.name}（${typeLabels[h.type] || h.type}）`;
        if (h.note) adjacentInfo += `，备注：${h.note}`;
        adjacentInfo += "\n";
      }
    }

    let yearOverview = "";
    if (allYearHolidays.length > 0) {
      yearOverview = `\n【${year}年全年节假日概览（帮助你理解整体节日分布）】\n`;
      for (const h of allYearHolidays) {
        yearOverview += `- ${h.date}：${h.name}（${typeLabels[h.type] || h.type}）\n`;
      }
    }

    const eventsInfo = events.length > 0
      ? "\n【当月事件上下文】\n" + events.map((e) => `- ${e.date}：[${e.event_tag}] ${e.description}`).join("\n")
      : "";

    let systemInstruction: string;
    let prompt: string;
    let modelName = "gemini-2.5-flash";
    let temperature = 0.1;
    let topP = 0.85;

    if (USE_DB_PROMPT) {
      try {
        const vars: Record<string, string> = {
          year: String(year),
          month: String(month),
          monthPadded: String(month).padStart(2, "0"),
          daysInMonth: String(daysInMonth),
          cityInfo,
          holidayInfo,
          adjacentInfo,
          yearOverview,
          eventsInfo,
        };
        const built = await buildPrompt("daily_correction", vars);
        systemInstruction = built.systemInstruction;
        prompt = `请分析 ${year}年${month}月 的每一天（共${daysInMonth}天）${cityInfo}，给出每天的营业额系数。\n\n${built.prompt}`;
        modelName = built.model;
        temperature = built.temperature;
        topP = built.topP;
      } catch {
        // Fallback to hardcoded prompt if DB prompt not available
        systemInstruction = "你是一位深耕马来西亚烘焙餐饮行业的资深运营分析师，精通烘焙店（面包、蛋糕、西点、饮品）的营业额波动规律。请严格按照用户要求的 JSON 格式返回分析结果，不要输出任何非 JSON 内容。";
        prompt = buildFallbackDailyCorrectionPrompt(year, month, daysInMonth, cityInfo, yearOverview, holidayInfo, adjacentInfo);
      }
    } else {
      systemInstruction = "你是一位深耕马来西亚烘焙餐饮行业的资深运营分析师，精通烘焙店（面包、蛋糕、西点、饮品）的营业额波动规律。请严格按照用户要求的 JSON 格式返回分析结果，不要输出任何非 JSON 内容。";
      prompt = buildFallbackDailyCorrectionPrompt(year, month, daysInMonth, cityInfo, yearOverview, holidayInfo, adjacentInfo);
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction,
      generationConfig: {
        temperature,
        topP,
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    let corrections;
    try {
      corrections = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "AI 返回格式解析失败", rawText: text },
        { status: 500 }
      );
    }

    if (!Array.isArray(corrections)) {
      return NextResponse.json(
        { error: "AI 返回的不是数组格式", rawText: text },
        { status: 500 }
      );
    }

    const holidayMap = new Map(holidays.map((h) => [h.date, h]));

    const normalized = corrections.map((item: { date: string; coefficient: number; reason: string }) => {
      const dbHoliday = holidayMap.get(item.date);
      return {
        date: item.date,
        coefficient: Number(item.coefficient) || 1.0,
        reason: dbHoliday
          ? `${dbHoliday.name} — ${item.reason || "节假日"}`
          : item.reason || "无说明",
      };
    });

    return NextResponse.json({ corrections: normalized });
  } catch (error) {
    console.error("AI correction error:", error);
    return NextResponse.json(
      { error: `AI 调用失败: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

/** Fallback: 原始硬编码prompt（当DB prompt不可用时） */
function buildFallbackDailyCorrectionPrompt(
  year: number, month: number, daysInMonth: number,
  cityInfo: string, yearOverview: string, holidayInfo: string, adjacentInfo: string
): string {
  return `请分析 ${year}年${month}月 的每一天（共${daysInMonth}天）${cityInfo}，给出每天的营业额系数。

${yearOverview}${holidayInfo}${adjacentInfo}

请基于你对烘焙餐饮行业的深刻理解，综合以下因素给出每天的系数判断：

## 一、基础日型系数（无特殊事件的普通周）
- 周一至周四 = 1.0（工作日常规消费，以早餐面包、午间轻食为主）
- 周五 = 1.2（周末前夕，下午茶订单增多，部分顾客提前采购周末用糕点）
- 周六 = 1.35（家庭出行高峰，生日蛋糕订单集中，下午茶消费旺盛）
- 周日 = 1.35（与周六类似，但傍晚后略有回落）

## 二、烘焙行业特有的节日效应（这是核心，请重点分析）

### 蛋糕/礼盒类爆发节日（系数可达 1.8~2.5）：
- **情人节（2/14）**：蛋糕、巧克力礼盒爆发，前2天开始攀升
- **母亲节（5月第二个周日）**：蛋糕订单全年最高峰之一，前3-5天持续走高
- **父亲节（6月第三个周日）**：蛋糕需求明显但弱于母亲节
- **圣诞节（12/25）**：圣诞木柴蛋糕(Log Cake)、姜饼屋，前一周开始爆发
- **中秋节**：月饼/中秋礼盒，节前1-2周是销售高峰

### 马来西亚特色节日对烘焙的影响：
- **农历新年**：年饼(Cookies)、礼盒需求极大，节前2-3周是黄金期，除夕当天可能提前打烊（系数反而降低）
- **开斋节(Hari Raya Aidilfitri)**：Kuih Raya饼干需求巨大，斋月最后一周是采购高峰
- **屠妖节(Deepavali)**：印度甜点需求增加，对烘焙店有一定带动
- **哈芝节(Hari Raya Haji)**：影响较温和
- **卫塞节、国庆日等公假**：主要是休假带来的客流增加

### 斋月(Ramadan)对烘焙店的特殊影响：
- 白天：穆斯林顾客减少，但华人/印度裔顾客不受影响，整体约 0.85~0.95
- 傍晚开斋前1-2小时：外卖/打包需求激增
- 斋月最后一周：开斋节备货需求爆发，系数可达 1.3~1.6
- 开斋节当天及次日：多数人在家庆祝，门店客流反而可能下降

## 三、烘焙行业的周期性规律
- **发薪日效应**：本店所在区域的主要客群在每月7号左右发薪，发薪后2-3天（即7~10号）消费力明显提升约 0.05~0.15，尤其是蛋糕、下午茶等非刚需品类；发薪前一周（月底至月初1-6号）消费力偏弱，顾客倾向选择低单价产品
- **月末至发薪前低谷**：每月25号之后至次月6号，消费力逐步收缩，系数可下调 0.03~0.08
- **学校假期**：家庭外出增多，商场店铺客流上升约 0.1~0.15；但住宅区店铺可能下降
- **雨季影响（11-3月东北季风）**：大雨天气可能降低客流 0.05~0.1，但外卖订单可能补偿部分损失

## 四、节前/节后的烘焙消费波动
- **重大节日前3-5天**：蛋糕预订高峰，礼盒采购高峰，系数逐日攀升
- **重大节日前1天**：通常是取货高峰日，营业额可能是全月最高
- **节后第1天**：消费明显回落，尤其是长假后
- **长周末/桥假**：如公假在周四或周二，形成4天连假，旅游出行增多，商场店可能受益，社区店可能受损

## 五、输出要求
请根据以上行业知识和节假日数据，为每一天给出合理的系数。

严格返回如下 JSON 数组格式（不要有其他文字，仅返回 JSON）：
[{"date": "${year}-${String(month).padStart(2, "0")}-01", "coefficient": 1.0, "reason": "普通工作日"}, ...]

每天一条记录，共 ${daysInMonth} 条。coefficient 保留2位小数。reason 用简短中文说明（需包含具体的影响因素分析，如"母亲节前2天，蛋糕预订高峰"而非笼统的"节日影响"）。`;
}
