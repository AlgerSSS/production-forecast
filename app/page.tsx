"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  autoImportFromDataDir,
  generateMonthlyTargets,
  generateMonthlyTargetsWithCustomCoefficients,
  generateDailyTargets,
  generateProductSuggestions,
  generateTimeSlotSuggestions,
  getProducts,
  getStrategies,
  getSalesBaselines,
  getFixedShipmentSchedules,
  getBusinessRulesFromDB,
  updateBusinessRule,
  getProductAliases,
  updateProductAlias,
  deleteProductAlias,
  updateFixedShipmentSchedule,
  deleteFixedShipmentSchedule,
  getHolidays,
  addHoliday,
  deleteHoliday,
  getTimeslotSalesRecords,
  getContextEvents,
  addContextEvent,
  deleteContextEvent,
  getDailyReview,
  adoptDailyReview,
  saveOutOfStockRecords,
  getOutOfStockRecords,
  getEmpowermentEvents,
  addEmpowermentEvent,
  deleteEmpowermentEvent,
  getPromptSegments,
  getPromptTemplates,
  upsertPromptSegment,
  upsertPromptTemplate,
  getDailySalesTotal,
} from "@/lib/actions";
import {
  parseStockoutLine,
  calculateLossSlots,
  calculateStockoutLoss,
} from "@/lib/engine/forecast-engine";
import type {
  MonthlyTarget,
  DailyTarget,
  ProductSuggestion,
  TimeSlotSuggestion,
  Product,
  ProductStrategy,
  ProductSalesBaseline,
  ImportResult,
  DailyAICorrection,
  BusinessRules,
  Holiday,
  AIProductCorrection,
  TimeslotSalesRecord,
  ContextEvent,
  DailyReviewResult,
  OutOfStockRecord,
  EmpowermentEvent,
  PromptSegment,
  PromptTemplate,
} from "@/lib/types";
import dayjs from "dayjs";

// ========== Tab Components ==========
type TabId = "dashboard" | "forecast" | "review" | "calendar" | "empowerment" | "settings";

const TABS: { id: TabId; label: string }[] = [
  { id: "dashboard", label: "今日看板" },
  { id: "forecast", label: "排产预估" },
  { id: "review", label: "每日复盘" },
  { id: "calendar", label: "事件日历" },
  { id: "empowerment", label: "赋能分析" },
  { id: "settings", label: "设置" },
];

const DAY_TYPE_LABELS: Record<string, string> = {
  mondayToThursday: "周一至周四",
  friday: "周五",
  weekend: "周末",
};

const DOW_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [loading, setLoading] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [importStatus, setImportStatus] = useState<{
    products?: ImportResult;
    sales?: ImportResult;
    strategy?: ImportResult;
    timeslot?: ImportResult;
  }>({});

  // V2: Forecast step flow
  const [forecastStep, setForecastStep] = useState<"targets" | "products" | "timeslots" | "export">("targets");

  // V2: Toast notification
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // V2: Dashboard state
  const [dashboardReview, setDashboardReview] = useState<DailyReviewResult | null>(null);
  const [dashboardEvents, setDashboardEvents] = useState<ContextEvent[]>([]);
  const [yesterdaySales, setYesterdaySales] = useState<number | null>(null);

  // V2: Review state
  const [reviewDate, setReviewDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [reviewActualRevenue, setReviewActualRevenue] = useState("");
  const [stockoutText, setStockoutText] = useState("");
  const [parsedStockouts, setParsedStockouts] = useState<OutOfStockRecord[]>([]);
  const [reviewResult, setReviewResult] = useState<DailyReviewResult | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  // V2: Calendar state
  const [calendarMonth, setCalendarMonth] = useState(dayjs().month());
  const [calendarYear, setCalendarYear] = useState(dayjs().year());
  const [calendarEvents, setCalendarEvents] = useState<ContextEvent[]>([]);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState("");
  const [newEventTag, setNewEventTag] = useState("");
  const [newEventType, setNewEventType] = useState<ContextEvent["eventType"]>("other");
  const [newEventDesc, setNewEventDesc] = useState("");

  // V2: Empowerment state
  const [empowermentEvents, setEmpowermentEvents] = useState<EmpowermentEvent[]>([]);
  const [showNewEmpowerment, setShowNewEmpowerment] = useState(false);

  // V2: Settings sub-tab
  const [settingsTab, setSettingsTab] = useState<"data" | "business" | "schedule" | "alias" | "holiday">("data");

  const [year, setYear] = useState(2026);
  const [selectedMonth, setSelectedMonth] = useState(4);
  const [selectedDate, setSelectedDate] = useState("");

  const [monthlyTargets, setMonthlyTargets] = useState<MonthlyTarget[]>([]);
  const [dailyTargets, setDailyTargets] = useState<DailyTarget[]>([]);
  const [productSuggestions, setProductSuggestions] = useState<ProductSuggestion[]>([]);
  const [timeSlotSuggestions, setTimeSlotSuggestions] = useState<TimeSlotSuggestion[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [strategies, setStrategies] = useState<ProductStrategy[]>([]);
  const [baselines, setBaselines] = useState<ProductSalesBaseline[]>([]);
  const [businessRulesState, setBusinessRulesState] = useState<BusinessRules | null>(null);

  // Manual adjustments tracking
  const [adjustedQuantities, setAdjustedQuantities] = useState<Record<string, number>>({});

  // Fixed shipment schedule from DB
  const [fixedSchedule, setFixedSchedule] = useState<Record<string, string[]>>({});

  // AI Correction state
  const [aiCorrections, setAiCorrections] = useState<DailyAICorrection[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  // AI Timeslot state
  const [aiTimeSlotSuggestions, setAiTimeSlotSuggestions] = useState<TimeSlotSuggestion[]>([]);
  const [aiTimeSlotAnalysis, setAiTimeSlotAnalysis] = useState("");
  const [aiTimeSlotLoading, setAiTimeSlotLoading] = useState(false);
  const [aiTimeSlotError, setAiTimeSlotError] = useState("");
  const [aiTimeSlotAdopted, setAiTimeSlotAdopted] = useState(false);

  // AI Product Correction state
  const [aiProductCorrections, setAiProductCorrections] = useState<AIProductCorrection[]>([]);
  const [aiProductAnalysis, setAiProductAnalysis] = useState("");
  const [aiProductCorrectionLoading, setAiProductCorrectionLoading] = useState(false);
  const [aiProductCorrectionError, setAiProductCorrectionError] = useState("");
  const [aiProductCorrectionAdopted, setAiProductCorrectionAdopted] = useState(false);

  // Timeslot sales records for estimated sales display
  const [timeslotSalesRecords, setTimeslotSalesRecords] = useState<TimeslotSalesRecord[]>([]);

  // Rules management state
  const [showRulesPanel, setShowRulesPanel] = useState(false);
  const [rulesTab, setRulesTab] = useState<"business" | "schedule" | "alias" | "holiday">("business");
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [newAliasKey, setNewAliasKey] = useState("");
  const [newAliasValue, setNewAliasValue] = useState("");
  const [editingScheduleProduct, setEditingScheduleProduct] = useState("");
  const [editingScheduleSlots, setEditingScheduleSlots] = useState("");
  const [rulesSaving, setRulesSaving] = useState(false);

  // Holiday management state
  const [holidaysList, setHolidaysList] = useState<Holiday[]>([]);
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [newHolidayName, setNewHolidayName] = useState("");
  const [newHolidayType, setNewHolidayType] = useState<Holiday["type"]>("public_holiday");
  const [newHolidayNote, setNewHolidayNote] = useState("");

  // Monthly coefficients - editable
  const DEFAULT_COEFFICIENTS: Record<string, number> = {
    "1": 1.00, "2": 0.98, "3": 0.87, "4": 1.02, "5": 1.10, "6": 1.05,
    "7": 0.98, "8": 1.00, "9": 0.94, "10": 1.04, "11": 1.12, "12": 1.45,
  };
  const [monthlyCoefficients, setMonthlyCoefficients] = useState<Record<string, number>>(DEFAULT_COEFFICIENTS);
  const [editingCoefficients, setEditingCoefficients] = useState(false);
  const coefficientsLoadedRef = useRef(false);

  // ========== 月度系数修改后自动保存到数据库（防抖 800ms） ==========
  useEffect(() => {
    // 跳过初始加载和从 DB 恢复时的触发
    if (!coefficientsLoadedRef.current) return;
    const timer = setTimeout(() => {
      updateBusinessRule("monthlyCoefficients", monthlyCoefficients);
    }, 800);
    return () => clearTimeout(timer);
  }, [monthlyCoefficients]);

  // ========== 页面加载时自动从数据库读取数据 ==========
  useEffect(() => {
    async function loadFromDB() {
      setLoading(true);
      try {
        const [prods, strats, bls, sched, rules, al] = await Promise.all([
          getProducts(),
          getStrategies(),
          getSalesBaselines(),
          getFixedShipmentSchedules(),
          getBusinessRulesFromDB(),
          getProductAliases(),
        ]);
        setProducts(prods);
        setStrategies(strats);
        setBaselines(bls);
        setFixedSchedule(sched);
        setBusinessRulesState(rules);
        setAliases(al);

        // 用 DB 中的月度系数覆盖默认值
        if (rules.monthlyCoefficients && Object.keys(rules.monthlyCoefficients).length > 0) {
          setMonthlyCoefficients(rules.monthlyCoefficients);
        }
        // 标记加载完成，之后的系数变更才触发自动保存
        setTimeout(() => { coefficientsLoadedRef.current = true; }, 0);

        setDataLoaded(true);

        // V2: Load dashboard data
        try {
          const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD");
          const today = dayjs().format("YYYY-MM-DD");
          const [review, events, ySales] = await Promise.all([
            getDailyReview(yesterday),
            getContextEvents(today),
            getDailySalesTotal(yesterday),
          ]);
          if (review) setDashboardReview(review);
          setDashboardEvents(events);
          setYesterdaySales(ySales);
        } catch {
          // Dashboard data is optional
        }
      } catch (err) {
        console.error("从数据库加载数据失败:", err);
      }
      setLoading(false);
    }
    loadFromDB();
  }, []);

  // V2: Load calendar events when switching to calendar tab or changing month
  useEffect(() => {
    if (activeTab !== "calendar") return;
    const start = `${calendarYear}-${String(calendarMonth + 1).padStart(2, "0")}-01`;
    const end = dayjs().year(calendarYear).month(calendarMonth).endOf("month").format("YYYY-MM-DD");
    getContextEvents(undefined, start, end).then(setCalendarEvents).catch(() => {});
  }, [activeTab, calendarYear, calendarMonth]);

  // V2: Load empowerment events when switching to empowerment tab
  useEffect(() => {
    if (activeTab !== "empowerment") return;
    getEmpowermentEvents().then(setEmpowermentEvents).catch(() => {});
  }, [activeTab]);

  // ========== 从 Excel 重新导入（覆盖DB数据） ==========
  const handleAutoImport = useCallback(async () => {
    setLoading(true);
    try {
      const result = await autoImportFromDataDir();
      setImportStatus(result);

      // 导入完成后，从 DB 重新加载所有数据
      const [prods, strats, bls, sched, rules, al] = await Promise.all([
        getProducts(),
        getStrategies(),
        getSalesBaselines(),
        getFixedShipmentSchedules(),
        getBusinessRulesFromDB(),
        getProductAliases(),
      ]);
      setProducts(prods);
      setStrategies(strats);
      setBaselines(bls);
      setFixedSchedule(sched);
      setBusinessRulesState(rules);
      setAliases(al);

      if (rules.monthlyCoefficients && Object.keys(rules.monthlyCoefficients).length > 0) {
        setMonthlyCoefficients(rules.monthlyCoefficients);
      }
      setDataLoaded(true);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }, []);

  // ========== Generate Monthly Targets ==========
  const handleGenerateMonthly = useCallback(async () => {
    setLoading(true);
    const targets = await generateMonthlyTargetsWithCustomCoefficients(year, monthlyCoefficients);
    setMonthlyTargets(targets);
    setLoading(false);
  }, [year, monthlyCoefficients]);

  // ========== Generate Daily Targets ==========
  const handleGenerateDaily = useCallback(async () => {
    if (monthlyTargets.length === 0) {
      await handleGenerateMonthly();
    }
    setLoading(true);
    const target = monthlyTargets.find((t) => t.month === selectedMonth);
    if (target) {
      const dailies = await generateDailyTargets(target);
      setDailyTargets(dailies);
      if (dailies.length > 0 && !selectedDate) {
        setSelectedDate(dailies[0].date);
      }
    }
    setLoading(false);
  }, [monthlyTargets, selectedMonth, selectedDate, handleGenerateMonthly]);

  // ========== Generate Product Suggestions ==========
  const handleGenerateProducts = useCallback(async () => {
    if (!selectedDate || dailyTargets.length === 0) return;
    setLoading(true);
    const dayTarget = dailyTargets.find((d) => d.date === selectedDate);
    if (dayTarget) {
      const suggestions = await generateProductSuggestions(dayTarget);
      setProductSuggestions(suggestions);
      setAdjustedQuantities({});
      // Reset AI product correction state
      setAiProductCorrections([]);
      setAiProductAnalysis("");
      setAiProductCorrectionError("");
      setAiProductCorrectionAdopted(false);
    }
    setLoading(false);
  }, [selectedDate, dailyTargets]);

  // ========== Generate Time Slot Suggestions ==========
  const handleGenerateTimeSlots = useCallback(async () => {
    if (productSuggestions.length === 0) return;
    setLoading(true);
    const dayTarget = dailyTargets.find((d) => d.date === selectedDate);
    if (dayTarget) {
      const [slots, records] = await Promise.all([
        generateTimeSlotSuggestions(productSuggestions, dayTarget),
        getTimeslotSalesRecords(dayTarget.dayType),
      ]);
      setTimeSlotSuggestions(slots);
      setTimeslotSalesRecords(records);
    }
    setLoading(false);
  }, [productSuggestions, dailyTargets, selectedDate]);

  // ========== AI Timeslot Suggestions ==========
  const handleFetchAITimeSlot = useCallback(async () => {
    if (productSuggestions.length === 0) return;
    const dayTarget = dailyTargets.find((d) => d.date === selectedDate);
    if (!dayTarget) return;

    setAiTimeSlotLoading(true);
    setAiTimeSlotError("");
    setAiTimeSlotAdopted(false);
    // Fetch timeslot sales records for estimated sales display
    getTimeslotSalesRecords(dayTarget.dayType).then(setTimeslotSalesRecords);
    try {
      const res = await fetch("/api/ai-timeslot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayType: dayTarget.dayType,
          productSuggestions: productSuggestions.map((p) => ({
            productName: p.productName,
            price: p.price,
            packMultiple: p.packMultiple,
            unitType: p.unitType,
            positioning: p.positioning,
            coldHot: p.coldHot,
            roundedQuantity: p.roundedQuantity,
            adjustedQuantity: p.adjustedQuantity,
          })),
          timeSlots: ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiTimeSlotError(data.error || "AI 调用失败");
        return;
      }
      setAiTimeSlotSuggestions(data.suggestions || []);
      setAiTimeSlotAnalysis(data.analysis || "");
    } catch (err) {
      setAiTimeSlotError(String(err));
    } finally {
      setAiTimeSlotLoading(false);
    }
  }, [productSuggestions, dailyTargets, selectedDate]);

  const handleAdoptAITimeSlot = useCallback(() => {
    if (aiTimeSlotSuggestions.length === 0) return;
    setTimeSlotSuggestions(aiTimeSlotSuggestions);
    setAiTimeSlotAdopted(true);
  }, [aiTimeSlotSuggestions]);

  // ========== AI Product Correction ==========
  const handleFetchAIProductCorrection = useCallback(async () => {
    if (productSuggestions.length === 0) return;
    const dayTarget = dailyTargets.find((d) => d.date === selectedDate);
    if (!dayTarget) return;

    setAiProductCorrectionLoading(true);
    setAiProductCorrectionError("");
    setAiProductCorrectionAdopted(false);
    try {
      const res = await fetch("/api/ai-product-correction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayType: dayTarget.dayType,
          date: selectedDate,
          shipmentAmount: dayTarget.shipmentAmount,
          productSuggestions: productSuggestions.map((p) => ({
            productName: p.productName,
            price: p.price,
            packMultiple: p.packMultiple,
            unitType: p.unitType,
            positioning: p.positioning,
            coldHot: p.coldHot,
            roundedQuantity: p.roundedQuantity,
            adjustedQuantity: p.adjustedQuantity,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiProductCorrectionError(data.error || "AI 调用失败");
        return;
      }
      setAiProductCorrections(data.corrections || []);
      const totalInfo = data.correctedTotal && data.targetAmount
        ? `\n校正后总金额: ${data.correctedTotal.toLocaleString()} | 目标: ${data.targetAmount.toLocaleString()} | 偏差: ${(data.correctedTotal - data.targetAmount > 0 ? "+" : "")}${(data.correctedTotal - data.targetAmount).toLocaleString()}`
        : "";
      setAiProductAnalysis((data.analysis || "") + totalInfo);
    } catch (err) {
      setAiProductCorrectionError(String(err));
    } finally {
      setAiProductCorrectionLoading(false);
    }
  }, [productSuggestions, dailyTargets, selectedDate]);

  const handleAdoptAIProductCorrection = useCallback(() => {
    if (aiProductCorrections.length === 0) return;
    const correctionMap = new Map<string, AIProductCorrection>();
    for (const c of aiProductCorrections) {
      correctionMap.set(c.productName, c);
    }
    const newAdjusted = { ...adjustedQuantities };
    setProductSuggestions((prev) =>
      prev.map((s) => {
        const correction = correctionMap.get(s.productName);
        if (correction) {
          newAdjusted[s.productName] = correction.suggestedQuantity;
          return {
            ...s,
            adjustedQuantity: correction.suggestedQuantity,
            adjustReason: `AI校正: ${correction.reason}`,
            totalAmount: Math.round(correction.suggestedQuantity * s.price),
          };
        }
        return s;
      })
    );
    setAdjustedQuantities(newAdjusted);
    setAiProductCorrectionAdopted(true);
  }, [aiProductCorrections, adjustedQuantities]);

  // ========== Handle Manual Quantity Adjustment ==========
  const handleQuantityChange = (productName: string, newQty: number) => {
    setAdjustedQuantities((prev) => ({ ...prev, [productName]: newQty }));
    setProductSuggestions((prev) =>
      prev.map((s) => {
        if (s.productName === productName) {
          return {
            ...s,
            adjustedQuantity: newQty,
            adjustReason: "手动调整",
            totalAmount: Math.round(newQty * s.price),
          };
        }
        return s;
      })
    );
  };

  // ========== Export to Excel ==========
  const handleExport = useCallback(async () => {
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();

    // Monthly targets sheet
    if (monthlyTargets.length > 0) {
      const ws1 = wb.addWorksheet("月营业额目标");
      ws1.columns = [
        { header: "月份", key: "month", width: 10 },
        { header: "系数", key: "coefficient", width: 10 },
        { header: "基础营业额", key: "baseRevenue", width: 15 },
        { header: "含赋能营业额", key: "enhancedRevenue", width: 18 },
      ];
      for (const t of monthlyTargets) {
        ws1.addRow(t);
      }
    }

    // Daily targets sheet
    if (dailyTargets.length > 0) {
      const ws2 = wb.addWorksheet("日营业额目标");
      ws2.columns = [
        { header: "日期", key: "date", width: 12 },
        { header: "星期", key: "dow", width: 8 },
        { header: "类型", key: "dayType", width: 12 },
        { header: "权重", key: "weight", width: 8 },
        { header: "营业额", key: "revenue", width: 12 },
        { header: "出货金额", key: "shipmentAmount", width: 12 },
      ];
      for (const d of dailyTargets) {
        ws2.addRow({
          date: d.date,
          dow: `周${DOW_LABELS[d.dayOfWeek]}`,
          dayType: DAY_TYPE_LABELS[d.dayType],
          weight: d.weight,
          revenue: d.revenue,
          shipmentAmount: d.shipmentAmount,
        });
      }
    }

    // Product suggestions sheet
    if (productSuggestions.length > 0) {
      const ws3 = wb.addWorksheet(`单品建议_${selectedDate}`);
      ws3.columns = [
        { header: "品名", key: "productName", width: 25 },
        { header: "定位", key: "positioning", width: 10 },
        { header: "冷/热", key: "coldHot", width: 8 },
        { header: "单价", key: "price", width: 8 },
        { header: "倍数", key: "packMultiple", width: 8 },
        { header: "历史基线", key: "baselineQuantity", width: 10 },
        { header: "建议数量", key: "roundedQuantity", width: 10 },
        { header: "调整数量", key: "adjustedQuantity", width: 10 },
        { header: "金额", key: "totalAmount", width: 12 },
      ];
      for (const s of productSuggestions) {
        ws3.addRow({
          ...s,
          adjustedQuantity: s.adjustedQuantity || s.roundedQuantity,
        });
      }
    }

    // Time slot sheet — full production estimate format
    if (timeSlotSuggestions.length > 0) {
      const ws4 = wb.addWorksheet(`分时段_${selectedDate}`);
      const ALL_SLOTS = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"];
      const slotHeaders = ALL_SLOTS.map((s) => s.replace(":00", "点"));

      // Columns: 品名 | 定位 | 冷/热 | 单价 | 倍数 | 满柜 | 总数 | 金额 | 10点~19点(数量) | 10点~19点(金额) | 试吃量 | 试吃金额 | 加货数量 | 加货备注 | 减货数量 | 减货备注
      const COL_OFFSET_QTY = 9; // slot quantity columns start at col 9
      ws4.columns = [
        { width: 22 },  // A: 品名
        { width: 8 },   // B: 定位
        { width: 6 },   // C: 冷/热
        { width: 8 },   // D: 单价
        { width: 6 },   // E: 倍数
        { width: 6 },   // F: 满柜
        { width: 8 },   // G: 总数
        { width: 10 },  // H: 金额
        ...ALL_SLOTS.map(() => ({ width: 7 })),  // I-R: 10点~19点 数量
        ...ALL_SLOTS.map(() => ({ width: 8 })),  // S-AB: 10点~19点 金额
        { width: 8 },   // AC: 试吃量
        { width: 8 },   // AD: 试吃金额
        { width: 8 },   // AE: 加货数量
        { width: 12 },  // AF: 加货备注
        { width: 8 },   // AG: 减货数量
        { width: 12 },  // AH: 减货备注
      ];

      // Colors
      const headerFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF3F4F6" } };
      const fixedSlotFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF7E1E2" } };
      const sumRowFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFCE4E5" } };
      const salesRowFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFEFF6FF" } };
      const remainRowFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF9FAFB" } };
      const thinBorder = {
        top: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
        bottom: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
        left: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
        right: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
      };
      const titleFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFDBEAFE" } };

      // ---- Header info rows ----
      const currentDayTarget = dailyTargets.find((d) => d.date === selectedDate);
      const shipmentAmount = currentDayTarget?.shipmentAmount ?? 0;
      const dayRevenue = currentDayTarget?.revenue ?? 0;
      const dayOfWeek = currentDayTarget ? `周${DOW_LABELS[currentDayTarget.dayOfWeek]}` : "";
      const dayTypeLabel = currentDayTarget ? DAY_TYPE_LABELS[currentDayTarget.dayType] : "";
      const tastingWasteAmount = Math.round(shipmentAmount * 0.06);

      // Row 1: Title
      const titleRow = ws4.addRow(["生产预估单"]);
      ws4.mergeCells(1, 1, 1, 8);
      titleRow.getCell(1).font = { bold: true, size: 14 };
      titleRow.getCell(1).fill = titleFill;
      titleRow.getCell(1).alignment = { horizontal: "center" };

      // Row 2: Date & basic info
      const infoRow = ws4.addRow([
        `日期：${selectedDate}`, "", `${dayOfWeek}（${dayTypeLabel}）`, "",
        "业绩预估", dayRevenue, "出货金额", shipmentAmount,
      ]);
      infoRow.eachCell((cell) => {
        cell.font = { size: 10 };
        cell.border = thinBorder;
      });
      infoRow.getCell(5).font = { bold: true, size: 10 };
      infoRow.getCell(6).font = { bold: true, size: 10, color: { argb: "FFDC2626" } };
      infoRow.getCell(7).font = { bold: true, size: 10 };
      infoRow.getCell(8).font = { bold: true, size: 10, color: { argb: "FFDC2626" } };

      // Row 3: Tasting/waste info
      const infoRow2 = ws4.addRow([
        "", "", "", "",
        "试吃+排产", tastingWasteAmount, "试吃占比", "6%",
      ]);
      infoRow2.eachCell((cell) => {
        cell.font = { size: 10 };
        cell.border = thinBorder;
      });

      // Row 4: Empty separator
      ws4.addRow([]);

      // ---- Column header row ----
      const headerRow = ws4.addRow([
        "品名", "定位", "冷/热", "单价", "倍数", "满柜", "总数", "金额",
        ...slotHeaders.map((s) => `${s}出货`),
        ...slotHeaders.map((s) => `${s}金额`),
        "试吃量", "试吃金额", "加货数量", "加货备注", "减货数量", "减货备注",
      ]);
      headerRow.eachCell((cell) => {
        cell.fill = headerFill;
        cell.font = { bold: true, size: 9, color: { argb: "FF6B7280" } };
        cell.border = thinBorder;
        cell.alignment = { horizontal: "center" };
      });
      headerRow.getCell(1).alignment = { horizontal: "left" };

      // Build pivot data
      const productNames = [...new Set(productSuggestions.map((p) => p.productName))];
      const slotMap = new Map<string, Map<string, TimeSlotSuggestion>>();
      for (const s of timeSlotSuggestions) {
        if (!slotMap.has(s.productName)) slotMap.set(s.productName, new Map());
        slotMap.get(s.productName)!.set(s.timeSlot, s);
      }

      // Build product info map from productSuggestions
      const productInfoMap = new Map<string, ProductSuggestion>();
      for (const p of productSuggestions) productInfoMap.set(p.productName, p);

      // Build displayFullQuantity map from products state
      const fullQtyMap = new Map<string, number>();
      for (const p of products) fullQtyMap.set(p.name, p.displayFullQuantity);

      // ---- Product rows ----
      for (const name of productNames) {
        const info = productInfoMap.get(name);
        const schedule = fixedSchedule[name] || [];
        const productSlots = timeSlotSuggestions.filter((s) => s.productName === name);
        const totalQty = productSlots.reduce((sum, s) => sum + s.quantity, 0);
        const totalAmount = productSlots.reduce((sum, s) => sum + s.amount, 0);
        const slotQtyValues = ALL_SLOTS.map((slot) => {
          const data = slotMap.get(name)?.get(slot);
          return data && data.quantity > 0 ? data.quantity : "";
        });
        const slotAmtValues = ALL_SLOTS.map((slot) => {
          const data = slotMap.get(name)?.get(slot);
          return data && data.amount > 0 ? data.amount : "";
        });
        const row = ws4.addRow([
          name,
          info?.positioning ?? "",
          info?.coldHot ?? "",
          info?.price ?? "",
          info?.packMultiple ?? "",
          fullQtyMap.get(name) ?? "",
          totalQty,
          totalAmount,
          ...slotQtyValues,
          ...slotAmtValues,
          "", "", // 试吃量、试吃金额 (filled later or empty)
          "", "", "", "", // 加货/减货 empty columns
        ]);
        row.eachCell((cell, colNumber) => {
          cell.border = thinBorder;
          cell.alignment = { horizontal: colNumber <= 1 ? "left" : "center" };
          cell.font = { size: 10 };
        });
        // Highlight fixed shipment slots
        ALL_SLOTS.forEach((slot, idx) => {
          if (schedule.includes(slot)) {
            const cell = row.getCell(COL_OFFSET_QTY + idx);
            cell.fill = fixedSlotFill;
            cell.font = { bold: true, size: 10 };
          }
        });
      }

      // ---- 合计 row ----
      const sumSlotQtyValues = ALL_SLOTS.map((slot) =>
        timeSlotSuggestions.filter((s) => s.timeSlot === slot).reduce((sum, s) => sum + s.quantity, 0) || ""
      );
      const sumSlotAmtValues = ALL_SLOTS.map((slot) =>
        timeSlotSuggestions.filter((s) => s.timeSlot === slot).reduce((sum, s) => sum + s.amount, 0) || ""
      );
      const sumRow = ws4.addRow([
        "合计", "", "", "", "", "",
        timeSlotSuggestions.reduce((s, item) => s + item.quantity, 0),
        timeSlotSuggestions.reduce((s, item) => s + item.amount, 0),
        ...sumSlotQtyValues,
        ...sumSlotAmtValues,
      ]);
      sumRow.eachCell((cell) => {
        cell.fill = sumRowFill;
        cell.font = { bold: true, size: 10 };
        cell.border = thinBorder;
        cell.alignment = { horizontal: "center" };
      });
      sumRow.getCell(1).alignment = { horizontal: "left" };

      // ---- 预计销售 row ----
      const priceMap = new Map<string, number>();
      for (const p of productSuggestions) priceMap.set(p.productName, p.price);
      let estimatedSalesTotal = 0;
      const salesSlotValues = ALL_SLOTS.map((slot) => {
        if (slot < "12:00") return "";
        const amt = Math.round(
          timeslotSalesRecords
            .filter((r) => r.timeSlot === slot)
            .reduce((sum, r) => sum + r.avgQuantity * (priceMap.get(r.productName) ?? 0), 0)
        );
        estimatedSalesTotal += amt;
        return amt || "";
      });
      const salesRow = ws4.addRow([
        "预计销售", "", "", "", "", "", "", estimatedSalesTotal || "",
        ...salesSlotValues,
      ]);
      salesRow.eachCell((cell) => {
        cell.fill = salesRowFill;
        cell.font = { size: 10, color: { argb: "FF1D4ED8" } };
        cell.border = thinBorder;
        cell.alignment = { horizontal: "center" };
      });
      salesRow.getCell(1).alignment = { horizontal: "left" };

      // ---- 预计剩余 row (cumulative) ----
      const shipmentTotal = timeSlotSuggestions.reduce((s, item) => s + item.amount, 0);
      let cumulativeShipment = 0;
      let cumulativeSales = 0;
      const remainSlotValues = ALL_SLOTS.map((slot, idx) => {
        const slotShipment = timeSlotSuggestions.filter((s) => s.timeSlot === slot).reduce((sum, s) => sum + s.amount, 0);
        cumulativeShipment += slotShipment;
        const salesVal = typeof salesSlotValues[idx] === "number" ? salesSlotValues[idx] as number : 0;
        cumulativeSales += salesVal;
        if (cumulativeShipment === 0 && cumulativeSales === 0) return "";
        return cumulativeShipment - cumulativeSales;
      });
      const remainRow = ws4.addRow([
        "预计剩余", "", "", "", "", "", "", shipmentTotal - estimatedSalesTotal,
        ...remainSlotValues,
      ]);
      remainRow.eachCell((cell, colNumber) => {
        cell.fill = remainRowFill;
        cell.border = thinBorder;
        cell.alignment = { horizontal: "center" };
        const val = cell.value as number;
        if (colNumber >= 8 && typeof val === "number") {
          cell.font = { size: 10, color: { argb: val < 0 ? "FFEF4444" : "FF16A34A" } };
        } else {
          cell.font = { size: 10 };
        }
      });
      remainRow.getCell(1).alignment = { horizontal: "left" };

      // ---- 门店陈列 row (displayFullQuantity × price per slot) ----
      const displaySlotValues = ALL_SLOTS.map((slot) => {
        const slotAmt = timeSlotSuggestions
          .filter((s) => s.timeSlot === slot)
          .reduce((sum, s) => {
            const fq = fullQtyMap.get(s.productName) ?? 0;
            const price = priceMap.get(s.productName) ?? 0;
            return sum + fq * price;
          }, 0);
        return slotAmt > 0 ? slotAmt : "";
      });
      const displayTotal = products.reduce((sum, p) => sum + p.displayFullQuantity * p.price, 0);
      const displayRow = ws4.addRow([
        "门店陈列(满柜金额)", "", "", "", "", "", "", displayTotal || "",
        ...displaySlotValues,
      ]);
      displayRow.eachCell((cell) => {
        cell.fill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF0FDF4" } };
        cell.font = { size: 10, color: { argb: "FF16A34A" } };
        cell.border = thinBorder;
        cell.alignment = { horizontal: "center" };
      });
      displayRow.getCell(1).alignment = { horizontal: "left" };

      // ========== 试吃报废表格 ==========
      const tastingProducts = [
        { name: "蛋挞", keyword: "蛋挞", rate: 0.015 },
        { name: "马卡龙", keyword: "马卡龙", rate: 0.015 },
        { name: "坚果棒", keyword: "坚果棒", rate: 0.01 },
      ];
      const wasteRate = 0.02;
      const tastingFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFFFBEB" } };

      // Step 1: Compute each tasting product's sales per slot (≥12:00)
      const activeSlots = ALL_SLOTS.filter((s) => s >= "12:00");
      const productSlotSales: Record<string, Record<string, number>> = {};
      for (const tp of tastingProducts) {
        productSlotSales[tp.name] = {};
        for (const slot of activeSlots) {
          const sales = timeslotSalesRecords
            .filter((r) => r.timeSlot === slot && r.productName.includes(tp.keyword))
            .reduce((sum, r) => sum + r.avgQuantity * (priceMap.get(r.productName) ?? 0), 0);
          productSlotSales[tp.name][slot] = sales;
        }
      }

      // Step 2: For each active slot, find the best tasting product
      const slotAssignment: Record<string, string> = {}; // slot -> product name
      for (const slot of activeSlots) {
        let bestProduct = "";
        let bestSales = 0;
        for (const tp of tastingProducts) {
          const sales = productSlotSales[tp.name][slot];
          if (sales > bestSales) {
            bestSales = sales;
            bestProduct = tp.name;
          }
        }
        if (bestProduct) slotAssignment[slot] = bestProduct;
      }

      // Step 3: Group slots by assigned product, compute proportional allocation
      // salesSlotValues is indexed by ALL_SLOTS, values are number or ""
      const getSalesForSlot = (slot: string): number => {
        const idx = ALL_SLOTS.indexOf(slot);
        const v = salesSlotValues[idx];
        return typeof v === "number" ? v : 0;
      };

      const productAssignedSlots: Record<string, string[]> = {};
      for (const tp of tastingProducts) productAssignedSlots[tp.name] = [];
      for (const [slot, pName] of Object.entries(slotAssignment)) {
        productAssignedSlots[pName].push(slot);
      }

      // Handle unassigned products: distribute their budget evenly across all active slots with sales
      for (const tp of tastingProducts) {
        if (productAssignedSlots[tp.name].length === 0) {
          const slotsWithSales = activeSlots.filter((s) => getSalesForSlot(s) > 0);
          productAssignedSlots[tp.name] = slotsWithSales.length > 0 ? slotsWithSales : activeSlots;
        }
      }

      // Compute per-slot tasting amounts
      const tastingSlotAmounts: Record<string, Record<string, number>> = {};
      for (const tp of tastingProducts) {
        tastingSlotAmounts[tp.name] = {};
        const totalBudget = Math.round(shipmentAmount * tp.rate);
        const slots = productAssignedSlots[tp.name];
        const slotSalesSum = slots.reduce((sum, s) => sum + getSalesForSlot(s), 0);
        for (const slot of slots) {
          const slotSales = getSalesForSlot(slot);
          tastingSlotAmounts[tp.name][slot] = slotSalesSum > 0
            ? Math.round(totalBudget * slotSales / slotSalesSum)
            : Math.round(totalBudget / slots.length);
        }
      }

      // Empty separator row
      ws4.addRow([]);

      // "试吃分配" header row — aligned with new column layout
      const tastingHeaderRow = ws4.addRow(["试吃分配", "", "", "", "", "", "", "", ...slotHeaders]);
      tastingHeaderRow.eachCell((cell) => {
        cell.fill = tastingFill;
        cell.font = { bold: true, size: 10 };
        cell.border = thinBorder;
        cell.alignment = { horizontal: "center" };
      });
      tastingHeaderRow.getCell(1).alignment = { horizontal: "left" };

      // Find unit price for each tasting product via fuzzy match
      const tastingPriceMap: Record<string, number> = {};
      for (const tp of tastingProducts) {
        const match = productSuggestions.find((p) => p.productName.includes(tp.keyword));
        tastingPriceMap[tp.name] = match?.price ?? 0;
      }

      // Product tasting rows (amount + quantity)
      for (const tp of tastingProducts) {
        const totalBudget = Math.round(shipmentAmount * tp.rate);
        const unitPrice = tastingPriceMap[tp.name];
        const slotValues = ALL_SLOTS.map((slot) => {
          const amt = tastingSlotAmounts[tp.name][slot];
          return amt && amt > 0 ? amt : "";
        });
        const row = ws4.addRow([tp.name, "", "", "", "", "", "", totalBudget, ...slotValues]);
        row.eachCell((cell, colNumber) => {
          cell.fill = tastingFill;
          cell.font = { size: 10 };
          cell.border = thinBorder;
          cell.alignment = { horizontal: colNumber <= 1 ? "left" : "center" };
        });

        // Quantity row
        const totalQty = unitPrice > 0 ? Math.ceil(totalBudget / unitPrice) : 0;
        const qtySlotValues = ALL_SLOTS.map((slot) => {
          const amt = tastingSlotAmounts[tp.name][slot];
          if (!amt || amt <= 0 || unitPrice <= 0) return "";
          return Math.ceil(amt / unitPrice);
        });
        const qtyRow = ws4.addRow([`${tp.name}(个数)`, "", "", "", "", "", "", totalQty || "", ...qtySlotValues]);
        qtyRow.eachCell((cell, colNumber) => {
          cell.fill = tastingFill;
          cell.font = { size: 10, color: { argb: "FF6B7280" } };
          cell.border = thinBorder;
          cell.alignment = { horizontal: colNumber <= 1 ? "left" : "center" };
        });
      }

      // 试吃小计 row
      const tastingSubtotal = Math.round(shipmentAmount * 0.04);
      const subtotalSlotValues = ALL_SLOTS.map((slot) => {
        const total = tastingProducts.reduce((sum, tp) => {
          const amt = tastingSlotAmounts[tp.name][slot];
          return sum + (amt && amt > 0 ? amt : 0);
        }, 0);
        return total > 0 ? total : "";
      });
      const subtotalRow = ws4.addRow(["试吃小计", "", "", "", "", "", "", tastingSubtotal, ...subtotalSlotValues]);
      subtotalRow.eachCell((cell, colNumber) => {
        cell.fill = tastingFill;
        cell.font = { bold: true, size: 10 };
        cell.border = thinBorder;
        cell.alignment = { horizontal: colNumber <= 1 ? "left" : "center" };
      });

      // 该时段预计销售 row
      const tastingSalesRow = ws4.addRow(["该时段预计销售", "", "", "", "", "", "", estimatedSalesTotal || "", ...salesSlotValues]);
      tastingSalesRow.eachCell((cell, colNumber) => {
        cell.fill = tastingFill;
        cell.font = { size: 10, color: { argb: "FF1D4ED8" } };
        cell.border = thinBorder;
        cell.alignment = { horizontal: colNumber <= 1 ? "left" : "center" };
      });

      // 排产报废 row
      const wasteAmount = Math.round(shipmentAmount * wasteRate);
      const wasteRow = ws4.addRow(["排产报废", "", "", "", "", "", "", wasteAmount]);
      wasteRow.eachCell((cell, colNumber) => {
        cell.fill = tastingFill;
        cell.font = { size: 10 };
        cell.border = thinBorder;
        cell.alignment = { horizontal: colNumber <= 1 ? "left" : "center" };
      });

      // 损耗合计 row
      const totalLoss = Math.round(shipmentAmount * 0.06);
      const lossRow = ws4.addRow(["损耗合计", "", "", "", "", "", "", totalLoss]);
      lossRow.eachCell((cell, colNumber) => {
        cell.fill = tastingFill;
        cell.font = { bold: true, size: 10 };
        cell.border = thinBorder;
        cell.alignment = { horizontal: colNumber <= 1 ? "left" : "center" };
      });
    }

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `排产预估_${year}_${selectedMonth}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }, [monthlyTargets, dailyTargets, productSuggestions, timeSlotSuggestions, timeslotSalesRecords, fixedSchedule, products, year, selectedMonth, selectedDate]);

  // ========== AI Correction ==========
  const handleFetchAICorrection = useCallback(async () => {
    if (dailyTargets.length === 0) return;
    setAiLoading(true);
    setAiError("");
    try {
      const res = await fetch("/api/ai-correction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month: selectedMonth }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiError(data.error || "AI 调用失败");
        return;
      }

      const monthlyTarget = monthlyTargets.find((t) => t.month === selectedMonth);
      const shipmentRate = 0.95; // default

      // Calculate AI-corrected revenue based on new weights
      // Use AI's total weight as denominator so monthly total is preserved:
      // sum of all (monthRevenue × aiCoeff / aiTotalWeight) === monthRevenue
      const corrections: DailyAICorrection[] = [];
      const aiTotalWeight = (data.corrections as { coefficient: number }[])
        .reduce((s: number, c: { coefficient: number }) => s + (Number(c.coefficient) || 1.0), 0);
      const monthRevenue = monthlyTarget?.enhancedRevenue || 0;

      for (const c of data.corrections as { date: string; coefficient: number; reason: string }[]) {
        const aiRevenue = aiTotalWeight > 0
          ? Math.round((monthRevenue * c.coefficient) / aiTotalWeight)
          : 0;
        corrections.push({
          date: c.date,
          aiCoefficient: c.coefficient,
          aiRevenue,
          aiShipmentAmount: Math.round(aiRevenue * shipmentRate),
          reason: c.reason,
          adopted: false,
        });
      }
      setAiCorrections(corrections);
    } catch (err) {
      setAiError(String(err));
    } finally {
      setAiLoading(false);
    }
  }, [dailyTargets, year, selectedMonth, monthlyTargets]);

  const handleAdoptAI = useCallback((date: string) => {
    const correction = aiCorrections.find((c) => c.date === date);
    if (!correction) return;
    const monthlyTarget = monthlyTargets.find((t) => t.month === selectedMonth);
    const monthRevenue = monthlyTarget?.enhancedRevenue || 0;
    const shipmentRate = businessRulesState?.shipmentFormula?.shipmentRate || 0.95;

    setAiCorrections((prev) =>
      prev.map((c) => (c.date === date ? { ...c, adopted: true } : c))
    );
    // Recalculate all daily targets to preserve monthly total
    setDailyTargets((prev) => {
      const updated = prev.map((d) =>
        d.date === date ? { ...d, weight: correction.aiCoefficient } : d
      );
      const newTotalWeight = updated.reduce((s, d) => s + d.weight, 0);
      return updated.map((d) => {
        const rev = newTotalWeight > 0 ? Math.round((monthRevenue * d.weight) / newTotalWeight) : 0;
        return { ...d, revenue: rev, shipmentAmount: Math.round(rev * shipmentRate) };
      });
    });
  }, [aiCorrections, monthlyTargets, selectedMonth, businessRulesState]);

  const handleAdoptAllAI = useCallback(() => {
    const correctionMap = new Map(aiCorrections.map((c) => [c.date, c]));
    const monthlyTarget = monthlyTargets.find((t) => t.month === selectedMonth);
    const monthRevenue = monthlyTarget?.enhancedRevenue || 0;
    const shipmentRate = businessRulesState?.shipmentFormula?.shipmentRate || 0.95;

    setAiCorrections((prev) => prev.map((c) => ({ ...c, adopted: true })));
    setDailyTargets((prev) => {
      const updated = prev.map((d) => {
        const c = correctionMap.get(d.date);
        return c ? { ...d, weight: c.aiCoefficient } : d;
      });
      const newTotalWeight = updated.reduce((s, d) => s + d.weight, 0);
      return updated.map((d) => {
        const rev = newTotalWeight > 0 ? Math.round((monthRevenue * d.weight) / newTotalWeight) : 0;
        return { ...d, revenue: rev, shipmentAmount: Math.round(rev * shipmentRate) };
      });
    });
  }, [aiCorrections, monthlyTargets, selectedMonth, businessRulesState]);

  // ========== Rules Management ==========
  const loadRulesData = useCallback(async () => {
    const [sched, al, hols] = await Promise.all([
      getFixedShipmentSchedules(),
      getProductAliases(),
      getHolidays(),
    ]);
    setFixedSchedule(sched);
    setAliases(al);
    setHolidaysList(hols);
  }, []);

  const handleSaveBusinessRule = useCallback(async (key: string, value: unknown) => {
    setRulesSaving(true);
    try {
      await updateBusinessRule(key, value);
      // 保存后刷新本地状态
      const rules = await getBusinessRulesFromDB();
      setBusinessRulesState(rules);
      if (rules.monthlyCoefficients && Object.keys(rules.monthlyCoefficients).length > 0) {
        setMonthlyCoefficients(rules.monthlyCoefficients);
      }
    } finally {
      setRulesSaving(false);
    }
  }, []);

  const handleSaveAlias = useCallback(async () => {
    if (!newAliasKey || !newAliasValue) return;
    setRulesSaving(true);
    try {
      await updateProductAlias(newAliasKey, newAliasValue);
      setAliases((prev) => ({ ...prev, [newAliasKey]: newAliasValue }));
      setNewAliasKey("");
      setNewAliasValue("");
    } finally {
      setRulesSaving(false);
    }
  }, [newAliasKey, newAliasValue]);

  const handleDeleteAlias = useCallback(async (alias: string) => {
    setRulesSaving(true);
    try {
      await deleteProductAlias(alias);
      setAliases((prev) => {
        const next = { ...prev };
        delete next[alias];
        return next;
      });
    } finally {
      setRulesSaving(false);
    }
  }, []);

  // ========== Holiday Management ==========
  const handleAddHoliday = useCallback(async () => {
    if (!newHolidayDate || !newHolidayName) return;
    setRulesSaving(true);
    try {
      await addHoliday({
        date: newHolidayDate,
        name: newHolidayName,
        type: newHolidayType,
        note: newHolidayNote,
      });
      const updated = await getHolidays();
      setHolidaysList(updated);
      setNewHolidayDate("");
      setNewHolidayName("");
      setNewHolidayType("public_holiday");
      setNewHolidayNote("");
    } finally {
      setRulesSaving(false);
    }
  }, [newHolidayDate, newHolidayName, newHolidayType, newHolidayNote]);

  const handleDeleteHoliday = useCallback(async (id: number) => {
    setRulesSaving(true);
    try {
      await deleteHoliday(id);
      setHolidaysList((prev) => prev.filter((h) => h.id !== id));
    } finally {
      setRulesSaving(false);
    }
  }, []);

  const handleSaveSchedule = useCallback(async () => {
    if (!editingScheduleProduct) return;
    setRulesSaving(true);
    try {
      const slots = editingScheduleSlots.split(",").map((s) => s.trim()).filter(Boolean);
      if (slots.length === 0) {
        await deleteFixedShipmentSchedule(editingScheduleProduct);
        setFixedSchedule((prev) => {
          const next = { ...prev };
          delete next[editingScheduleProduct];
          return next;
        });
      } else {
        await updateFixedShipmentSchedule(editingScheduleProduct, slots);
        setFixedSchedule((prev) => ({ ...prev, [editingScheduleProduct]: slots }));
      }
      setEditingScheduleProduct("");
      setEditingScheduleSlots("");
    } finally {
      setRulesSaving(false);
    }
  }, [editingScheduleProduct, editingScheduleSlots]);

  // ========== Computed values ==========
  const totalSuggestedAmount = productSuggestions.reduce(
    (sum, s) => sum + s.totalAmount,
    0
  );
  const currentDayTarget = dailyTargets.find((d) => d.date === selectedDate);
  const amountDiff = currentDayTarget
    ? totalSuggestedAmount - currentDayTarget.shipmentAmount
    : 0;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="pt-8 pb-2 px-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[#1F2937] tracking-tight">
            排产预估系统
          </h1>
          <div className="flex items-center gap-3 text-sm text-[#9CA3AF]">
            <span className="font-medium text-[#1F2937]">{year}年</span>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="bg-white border-0 rounded-xl px-3 py-1.5 text-sm text-[#1F2937] shadow-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200"
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}月
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* Floating Pill Tab Navigation */}
      <nav className="py-4 px-4">
        <div className="max-w-fit mx-auto bg-white rounded-full shadow-[0_2px_20px_rgba(0,0,0,0.06)] p-1.5 flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-2 text-sm font-medium rounded-full transition-all duration-300 ${
                activeTab === tab.id
                  ? "bg-[#F7E1E2] text-[#1F2937] shadow-sm"
                  : "text-[#9CA3AF] hover:text-[#1F2937] hover:bg-gray-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Loading indicator */}
      {loading && (
        <div className="max-w-6xl mx-auto px-4">
          <div className="bg-[#F7E1E2]/40 rounded-2xl px-4 py-2.5 text-sm text-[#1F2937] text-center font-medium">
            处理中...
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-6xl mx-auto px-4 py-6 w-full">

        {/* ===== DASHBOARD TAB ===== */}
        {activeTab === "dashboard" && (
          <div className="space-y-6 animate-fade-slide-up">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-3xl shadow-[0_4px_40px_rgba(0,0,0,0.03)] p-6">
                <p className="text-xs text-[#9CA3AF] mb-1">昨日营业额</p>
                <p className="text-xl font-bold text-[#1F2937]">
                  {yesterdaySales !== null ? (yesterdaySales > 0 ? `RM ${yesterdaySales.toLocaleString()}` : "暂无数据") : "—"}
                </p>
              </div>
              <div className="bg-white rounded-3xl shadow-[0_4px_40px_rgba(0,0,0,0.03)] p-6">
                <p className="text-xs text-[#9CA3AF] mb-1">昨日达成率</p>
                <p className="text-xl font-bold text-[#1F2937]">{(() => {
                  if (yesterdaySales === null) return "—";
                  const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD");
                  const yTarget = dailyTargets.find((d) => d.date === yesterday);
                  if (!yTarget || !yTarget.revenue) return "暂无目标";
                  const rate = ((yesterdaySales / yTarget.revenue) * 100).toFixed(1);
                  return `${rate}%`;
                })()}</p>
              </div>
              <div className="bg-white rounded-3xl shadow-[0_4px_40px_rgba(0,0,0,0.03)] p-6">
                <p className="text-xs text-[#9CA3AF] mb-1">今日目标</p>
                <p className="text-xl font-bold text-[#1F2937]">
                  {currentDayTarget ? `RM ${currentDayTarget.revenue.toLocaleString()}` : "—"}
                </p>
              </div>
              <div className="bg-white rounded-3xl shadow-[0_4px_40px_rgba(0,0,0,0.03)] p-6">
                <p className="text-xs text-[#9CA3AF] mb-1">今日出货</p>
                <p className="text-xl font-bold text-[#1F2937]">
                  {currentDayTarget ? `RM ${currentDayTarget.shipmentAmount.toLocaleString()}` : "—"}
                </p>
              </div>
            </div>

            {/* AI Review Summary */}
            {dashboardReview && (
              <div className="bg-[#F7E1E2]/20 rounded-2xl p-6">
                <h3 className="text-sm font-semibold text-[#1F2937] mb-3">AI 昨日复盘摘要</h3>
                <p className="text-sm text-[#4B5563] mb-3">{dashboardReview.review?.summary || "暂无复盘数据"}</p>
                {dashboardReview.review?.highlights && dashboardReview.review.highlights.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {dashboardReview.review.highlights.map((h: string, i: number) => (
                      <span key={i} className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded-lg">✓ {h}</span>
                    ))}
                  </div>
                )}
                {dashboardReview.review?.painPoints && dashboardReview.review.painPoints.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {dashboardReview.review.painPoints.map((p: string, i: number) => (
                      <span key={i} className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded-lg">✗ {p}</span>
                    ))}
                  </div>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={() => setActiveTab("review")}
                    className="text-xs text-[#6B7280] hover:text-[#1F2937] transition-colors"
                  >
                    查看完整复盘 →
                  </button>
                  {!dashboardReview.adopted && (
                    <button
                      onClick={async () => {
                        const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD");
                        await adoptDailyReview(yesterday);
                        setDashboardReview({ ...dashboardReview, adopted: true });
                        showToast("已采纳AI今日策略", "success");
                      }}
                      className="text-xs bg-[#F7E1E2] text-[#1F2937] px-3 py-1 rounded-lg font-medium hover:bg-[#F7E1E2]/80 transition-colors"
                    >
                      采纳AI今日策略 ✓
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Today Events */}
            <div className="bg-white rounded-3xl shadow-[0_4px_40px_rgba(0,0,0,0.03)] p-6">
              <h3 className="text-sm font-semibold text-[#1F2937] mb-3">今日事件提醒</h3>
              {dashboardEvents.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {dashboardEvents.map((e, i) => (
                    <span key={i} className="text-xs bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg">
                      {e.eventTag} {e.description && `— ${e.description}`}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[#9CA3AF]">今日暂无事件</p>
              )}
              <button
                onClick={() => { setActiveTab("calendar"); setSelectedCalendarDate(dayjs().format("YYYY-MM-DD")); }}
                className="mt-3 text-xs text-[#6B7280] hover:text-[#1F2937] transition-colors"
              >
                + 添加今日事件
              </button>
            </div>

            {/* Quick Actions */}
            <div className="bg-white rounded-3xl shadow-[0_4px_40px_rgba(0,0,0,0.03)] p-6">
              <h3 className="text-sm font-semibold text-[#1F2937] mb-3">快捷操作</h3>
              <div className="flex gap-3">
                <button
                  onClick={() => { setActiveTab("forecast"); setForecastStep("targets"); }}
                  className="px-4 py-2 bg-[#F7E1E2] text-[#1F2937] rounded-xl text-sm font-medium hover:bg-[#F7E1E2]/80 transition-colors"
                >
                  生成今日排产单
                </button>
                <button
                  onClick={() => setActiveTab("review")}
                  className="px-4 py-2 bg-gray-100 text-[#1F2937] rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors"
                >
                  录入昨日数据
                </button>
                <button
                  onClick={() => { setActiveTab("forecast"); setForecastStep("export"); }}
                  className="px-4 py-2 bg-gray-100 text-[#1F2937] rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors"
                >
                  导出Excel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===== FORECAST TAB (合并原 monthly + daily + products + timeslots + export) ===== */}
        {activeTab === "forecast" && (
          <div className="space-y-6 animate-fade-slide-up">
            {/* Step Indicator */}
            <div className="bg-white rounded-3xl shadow-[0_4px_40px_rgba(0,0,0,0.03)] p-4">
              <div className="flex items-center justify-center gap-2">
                {(["targets", "products", "timeslots", "export"] as const).map((step, i) => {
                  const labels = ["月/日目标", "单品建议", "分时段", "导出"];
                  const isActive = forecastStep === step;
                  const stepOrder = ["targets", "products", "timeslots", "export"];
                  const isDone = stepOrder.indexOf(forecastStep) > i;
                  return (
                    <div key={step} className="flex items-center">
                      {i > 0 && <div className={`w-8 h-0.5 mx-1 ${isDone ? "bg-[#F7E1E2]" : "bg-gray-200"}`} />}
                      <button
                        onClick={() => setForecastStep(step)}
                        className={`px-4 py-2 text-sm font-medium rounded-full transition-all duration-300 ${
                          isActive ? "bg-[#F7E1E2] text-[#1F2937] shadow-sm" :
                          isDone ? "bg-[#F7E1E2]/50 text-[#1F2937]" :
                          "text-[#9CA3AF] hover:text-[#1F2937] hover:bg-gray-50"
                        }`}
                      >
                        {isDone ? "✓ " : `${i + 1}. `}{labels[i]}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Step 1: Monthly + Daily Targets */}
            {forecastStep === "targets" && (
              <>
                {/* 月度系数配置 */}
                <div className="bg-white rounded-3xl shadow-[0_4px_40px_rgba(0,0,0,0.03)] p-8">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold text-[#1F2937]">月度系数配置</h2>
                      {editingCoefficients && (
                        <span className="text-xs text-[#9CA3AF]">修改后自动保存</span>
                      )}
                    </div>
                    <button
                      onClick={() => setEditingCoefficients(!editingCoefficients)}
                      className="text-sm text-[#1F2937] bg-gray-50 hover:bg-gray-100 px-4 py-1.5 rounded-xl font-medium hover:scale-[1.03] active:scale-[0.97] transition-all duration-200"
                    >
                      {editingCoefficients ? "收起编辑" : "修改系数"}
                    </button>
                  </div>
                  {editingCoefficients && (
                    <div className="grid grid-cols-6 gap-3 mb-4">
                      {Array.from({ length: 12 }, (_, i) => {
                        const key = String(i + 1);
                        return (
                          <div key={key} className="flex flex-col">
                            <label className="text-xs text-[#9CA3AF] mb-1">{i + 1}月</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={monthlyCoefficients[key] ?? 1}
                              onChange={(e) =>
                                setMonthlyCoefficients((prev) => ({
                                  ...prev,
                                  [key]: Number(e.target.value) || 0,
                                }))
                              }
                              className="border-0 bg-gray-50 rounded-xl px-2 py-1.5 text-sm text-center w-full focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200"
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {!editingCoefficients && (
                    <div className="flex gap-2 flex-wrap text-xs text-[#9CA3AF]">
                      {Array.from({ length: 12 }, (_, i) => (
                        <span key={i} className="bg-[#F7E1E2]/30 px-2.5 py-1 rounded-full">
                          {i + 1}月: {monthlyCoefficients[String(i + 1)]}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* 月营业额目标 */}
                <div className="bg-white rounded-3xl shadow-[0_4px_40px_rgba(0,0,0,0.03)] p-8">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-[#1F2937]">月营业额目标 ({year}年)</h2>
                    <button
                      onClick={handleGenerateMonthly}
                      disabled={loading}
                      className="bg-[#F7E1E2] text-[#1F2937] px-6 py-2.5 rounded-xl hover:bg-[#EBCDCF] hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 text-sm font-medium transition-all duration-200"
                    >
                      计算月目标
                    </button>
                  </div>
                  {monthlyTargets.length > 0 && (
                    <div className="overflow-x-auto rounded-xl">
                      <table className="min-w-full text-sm">
                        <thead className="bg-gray-50/50">
                          <tr>
                            <th className="px-3 py-2 text-left text-[#9CA3AF] font-medium text-xs">月份</th>
                            <th className="px-3 py-2 text-right text-[#9CA3AF] font-medium text-xs">系数</th>
                            <th className="px-3 py-2 text-right text-[#9CA3AF] font-medium text-xs">基础营业额</th>
                            <th className="px-3 py-2 text-right text-[#9CA3AF] font-medium text-xs">含赋能营业额</th>
                          </tr>
                        </thead>
                        <tbody>
                          {monthlyTargets.map((t) => (
                            <tr
                              key={t.month}
                              className={`hover:bg-[#F7E1E2]/20 cursor-pointer transition-colors duration-200 border-b border-gray-50 ${
                                t.month === selectedMonth ? "bg-[#F7E1E2]/30" : ""
                              }`}
                              onClick={() => setSelectedMonth(t.month)}
                            >
                              <td className="px-3 py-2 font-medium">{t.month}月</td>
                              <td className="px-3 py-2 text-right">{t.coefficient}</td>
                              <td className="px-3 py-2 text-right">{t.baseRevenue.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right font-semibold text-[#1F2937]">{t.enhancedRevenue.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-[#F7E1E2]/20 font-semibold">
                          <tr>
                            <td className="px-3 py-2">合计</td>
                            <td className="px-3 py-2 text-right">-</td>
                            <td className="px-3 py-2 text-right">{monthlyTargets.reduce((s, t) => s + t.baseRevenue, 0).toLocaleString()}</td>
                            <td className="px-3 py-2 text-right text-[#1F2937]">{monthlyTargets.reduce((s, t) => s + t.enhancedRevenue, 0).toLocaleString()}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>

                {/* 日营业额目标 */}
                <div className="bg-white rounded-3xl shadow-[0_4px_40px_rgba(0,0,0,0.03)] p-8">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-[#1F2937]">{selectedMonth}月 日营业额目标</h2>
                    <div className="flex gap-2">
                      <button onClick={handleFetchAICorrection} disabled={aiLoading || dailyTargets.length === 0} className="bg-gray-50 text-[#1F2937] px-4 py-2.5 rounded-xl hover:bg-gray-100 hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 text-sm font-medium transition-all duration-200">
                        {aiLoading ? "AI分析中..." : "获取AI修正建议"}
                      </button>
                      {aiCorrections.length > 0 && (
                        <button onClick={handleAdoptAllAI} className="bg-gray-50 text-[#1F2937] px-4 py-2.5 rounded-xl hover:bg-gray-100 hover:scale-[1.03] active:scale-[0.97] text-sm font-medium transition-all duration-200">
                          一键采用全部AI建议
                        </button>
                      )}
                      <button onClick={handleGenerateDaily} disabled={loading} className="bg-[#F7E1E2] text-[#1F2937] px-6 py-2.5 rounded-xl hover:bg-[#EBCDCF] hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 text-sm font-medium transition-all duration-200">
                        计算日目标
                      </button>
                    </div>
                  </div>
                  {aiError && <div className="mb-4 p-3 rounded-2xl bg-red-50/70 text-red-700 text-sm">{aiError}</div>}
                  {dailyTargets.length > 0 && (
                    <>
                      <div className="grid grid-cols-4 gap-4 mb-6">
                        <SummaryCard label="月总营业额" value={dailyTargets.reduce((s, d) => s + d.revenue, 0).toLocaleString()} />
                        <SummaryCard label="月总出货金额" value={dailyTargets.reduce((s, d) => s + d.shipmentAmount, 0).toLocaleString()} />
                        <SummaryCard label="工作日均" value={Math.round(dailyTargets.filter((d) => d.dayType === "mondayToThursday").reduce((s, d) => s + d.revenue, 0) / (dailyTargets.filter((d) => d.dayType === "mondayToThursday").length || 1)).toLocaleString()} />
                        <SummaryCard label="周末日均" value={Math.round(dailyTargets.filter((d) => d.dayType === "weekend").reduce((s, d) => s + d.revenue, 0) / (dailyTargets.filter((d) => d.dayType === "weekend").length || 1)).toLocaleString()} />
                      </div>
                      <div className="overflow-x-auto rounded-xl">
                        <table className="min-w-full text-sm">
                          <thead className="bg-gray-50/50">
                            <tr>
                              <th className="px-3 py-2 text-left text-[#9CA3AF] font-medium text-xs">日期</th>
                              <th className="px-3 py-2 text-center text-[#9CA3AF] font-medium text-xs">星期</th>
                              <th className="px-3 py-2 text-center text-[#9CA3AF] font-medium text-xs">类型</th>
                              <th className="px-3 py-2 text-right text-[#9CA3AF] font-medium text-xs">原权重</th>
                              <th className="px-3 py-2 text-right text-[#9CA3AF] font-medium text-xs">营业额</th>
                              <th className="px-3 py-2 text-right text-[#9CA3AF] font-medium text-xs">出货金额</th>
                              {aiCorrections.length > 0 && (
                                <>
                                  <th className="px-3 py-2 text-right bg-[#F7E1E2]/20 text-[#9CA3AF] font-medium text-xs">AI系数</th>
                                  <th className="px-3 py-2 text-right bg-[#F7E1E2]/20 text-[#9CA3AF] font-medium text-xs">AI营业额</th>
                                  <th className="px-3 py-2 text-left bg-[#F7E1E2]/20 text-[#9CA3AF] font-medium text-xs">AI理由</th>
                                  <th className="px-3 py-2 text-center bg-[#F7E1E2]/20 text-[#9CA3AF] font-medium text-xs">操作</th>
                                </>
                              )}
                              <th className="px-3 py-2 text-center text-[#9CA3AF] font-medium text-xs">查看</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dailyTargets.map((d) => {
                              const aiC = aiCorrections.find((c) => c.date === d.date);
                              return (
                                <tr key={d.date} className={`hover:bg-[#F7E1E2]/20 transition-colors duration-200 border-b border-gray-50 ${d.date === selectedDate ? "bg-[#F7E1E2]/30" : ""} ${d.dayType === "weekend" ? "bg-orange-50/30" : d.dayType === "friday" ? "bg-yellow-50/30" : ""}`}>
                                  <td className="px-3 py-2 font-medium">{d.date}</td>
                                  <td className="px-3 py-2 text-center">周{DOW_LABELS[d.dayOfWeek]}</td>
                                  <td className="px-3 py-2 text-center">
                                    <span className={`px-2 py-0.5 rounded-full text-xs ${d.dayType === "weekend" ? "bg-orange-100 text-orange-700" : d.dayType === "friday" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-700"}`}>
                                      {DAY_TYPE_LABELS[d.dayType]}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-right">{d.weight}</td>
                                  <td className="px-3 py-2 text-right">{d.revenue.toLocaleString()}</td>
                                  <td className="px-3 py-2 text-right font-semibold">{d.shipmentAmount.toLocaleString()}</td>
                                  {aiCorrections.length > 0 && (
                                    <>
                                      <td className={`px-3 py-2 text-right bg-[#F7E1E2]/10 ${aiC && aiC.aiCoefficient !== d.weight ? "font-bold text-[#d4727a]" : ""}`}>{aiC ? aiC.aiCoefficient : "-"}</td>
                                      <td className="px-3 py-2 text-right bg-[#F7E1E2]/10">{aiC ? aiC.aiRevenue.toLocaleString() : "-"}</td>
                                      <td className="px-3 py-2 text-left bg-[#F7E1E2]/10 text-xs max-w-[200px] truncate" title={aiC?.reason}>{aiC?.reason || "-"}</td>
                                      <td className="px-3 py-2 text-center bg-[#F7E1E2]/10">
                                        {aiC && !aiC.adopted ? (
                                          <button onClick={() => handleAdoptAI(d.date)} className="text-[#d4727a] hover:text-[#1F2937] text-xs font-medium transition-colors duration-200">采用</button>
                                        ) : aiC?.adopted ? (
                                          <span className="text-green-600 text-xs">已采用</span>
                                        ) : null}
                                      </td>
                                    </>
                                  )}
                                  <td className="px-3 py-2 text-center">
                                    <button onClick={() => { setSelectedDate(d.date); setForecastStep("products"); }} className="text-[#d4727a] hover:text-[#1F2937] text-xs transition-colors duration-200">查看单品</button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>

                {/* Step Navigation */}
                <div className="flex justify-end">
                  <button onClick={() => setForecastStep("products")} className="bg-[#F7E1E2] text-[#1F2937] px-6 py-2.5 rounded-xl hover:bg-[#EBCDCF] text-sm font-medium transition-all duration-200">
                    下一步：单品建议 →
                  </button>
                </div>
              </>
            )}

            {/* Step 2: Product Suggestions */}
            {forecastStep === "products" && (
              <>
                <div className="bg-white rounded-3xl shadow-[0_4px_40px_rgba(0,0,0,0.03)] p-8">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-lg font-semibold text-[#1F2937]">单品出货建议</h2>
                      <p className="text-sm text-[#9CA3AF] mt-1">日期：{selectedDate || "请先选择日期"} | 目标出货金额：{currentDayTarget?.shipmentAmount?.toLocaleString() || "-"}</p>
                    </div>
                    <div className="flex gap-2">
                      <select value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="border-0 bg-gray-50 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200">
                        <option value="">选择日期</option>
                        {dailyTargets.map((d) => (<option key={d.date} value={d.date}>{d.date} (周{DOW_LABELS[d.dayOfWeek]})</option>))}
                      </select>
                      <button onClick={handleFetchAIProductCorrection} disabled={aiProductCorrectionLoading || productSuggestions.length === 0} className="bg-gray-50 text-[#1F2937] px-4 py-2.5 rounded-xl hover:bg-gray-100 hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 text-sm font-medium transition-all duration-200">
                        {aiProductCorrectionLoading ? "AI 分析中..." : "AI 智能校正"}
                      </button>
                      <button onClick={handleGenerateProducts} disabled={loading || !selectedDate} className="bg-[#F7E1E2] text-[#1F2937] px-6 py-2.5 rounded-xl hover:bg-[#EBCDCF] hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 text-sm font-medium transition-all duration-200">
                        生成建议
                      </button>
                    </div>
                  </div>
                  {productSuggestions.length > 0 && (
                    <div className={`mb-4 p-3 rounded-2xl text-sm ${Math.abs(amountDiff) < 1000 ? "bg-green-50/70 text-green-800" : Math.abs(amountDiff) < 5000 ? "bg-amber-50/70 text-amber-800" : "bg-red-50/70 text-red-800"}`}>
                      <span className="font-medium">金额偏差：</span>建议总金额 {totalSuggestedAmount.toLocaleString()} | 目标 {currentDayTarget?.shipmentAmount?.toLocaleString()} | 偏差 {amountDiff > 0 ? "+" : ""}{amountDiff.toLocaleString()} ({currentDayTarget?.shipmentAmount ? ((amountDiff / currentDayTarget.shipmentAmount) * 100).toFixed(1) : 0}%)
                    </div>
                  )}
                  {aiProductCorrectionError && <div className="mb-4 p-3 bg-red-50/70 text-red-700 rounded-2xl text-sm">{aiProductCorrectionError}</div>}
                  {aiProductAnalysis && !aiProductCorrectionAdopted && (
                    <div className="mb-4 p-4 bg-[#F7E1E2]/30 rounded-2xl">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-[#1F2937]">AI 校正分析</span>
                        <button onClick={handleAdoptAIProductCorrection} className="bg-[#F7E1E2] text-[#1F2937] px-4 py-1.5 rounded-xl text-sm hover:bg-[#EBCDCF] hover:scale-[1.03] active:scale-[0.97] font-medium transition-all duration-200">采纳 AI 建议</button>
                      </div>
                      <p className="text-sm text-[#1F2937]/70">{aiProductAnalysis}</p>
                    </div>
                  )}
                  {aiProductCorrectionAdopted && <div className="mb-4 p-3 bg-green-50/70 text-green-700 rounded-2xl text-sm">已采纳 AI 单品校正建议</div>}
                  {productSuggestions.length > 0 && (
                    <div className="overflow-x-auto rounded-xl">
                      <table className="min-w-full text-sm">
                        <thead className="bg-gray-50/50">
                          <tr>
                            <th className="px-3 py-2 text-left text-[#9CA3AF] font-medium text-xs">品名</th>
                            <th className="px-3 py-2 text-center text-[#9CA3AF] font-medium text-xs">定位</th>
                            <th className="px-3 py-2 text-center text-[#9CA3AF] font-medium text-xs">冷/热</th>
                            <th className="px-3 py-2 text-right text-[#9CA3AF] font-medium text-xs">单价</th>
                            <th className="px-3 py-2 text-right text-[#9CA3AF] font-medium text-xs">倍数</th>
                            <th className="px-3 py-2 text-right text-[#9CA3AF] font-medium text-xs">历史基线</th>
                            <th className="px-3 py-2 text-right text-[#9CA3AF] font-medium text-xs">建议数量</th>
                            {aiProductCorrections.length > 0 && !aiProductCorrectionAdopted && <th className="px-3 py-2 text-right text-[#9CA3AF] font-medium text-xs">AI建议</th>}
                            {aiProductCorrections.length > 0 && !aiProductCorrectionAdopted && <th className="px-3 py-2 text-left text-[#9CA3AF] font-medium text-xs">AI理由</th>}
                            <th className="px-3 py-2 text-right text-[#9CA3AF] font-medium text-xs">调整数量</th>
                            <th className="px-3 py-2 text-right text-[#9CA3AF] font-medium text-xs">金额</th>
                          </tr>
                        </thead>
                        <tbody>
                          {productSuggestions.map((s) => (
                            <tr key={s.productName} className={`hover:bg-[#F7E1E2]/20 transition-colors duration-200 border-b border-gray-50 ${s.positioning === "TOP" ? "bg-red-50/20" : s.positioning === "潜在TOP" ? "bg-amber-50/20" : ""}`}>
                              <td className="px-3 py-2 font-medium">{s.productName}</td>
                              <td className="px-3 py-2 text-center"><span className={`px-2 py-0.5 rounded-full text-xs ${s.positioning === "TOP" ? "bg-red-100 text-red-700" : s.positioning === "潜在TOP" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-700"}`}>{s.positioning}</span></td>
                              <td className="px-3 py-2 text-center"><span className={`px-2 py-0.5 rounded-full text-xs ${s.coldHot === "热" ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"}`}>{s.coldHot}</span></td>
                              <td className="px-3 py-2 text-right">{s.price}</td>
                              <td className="px-3 py-2 text-right">{s.packMultiple}</td>
                              <td className="px-3 py-2 text-right">{s.baselineQuantity}</td>
                              <td className="px-3 py-2 text-right">{s.roundedQuantity}</td>
                              {aiProductCorrections.length > 0 && !aiProductCorrectionAdopted && (() => {
                                const c = aiProductCorrections.find((x) => x.productName === s.productName);
                                return (<><td className="px-3 py-2 text-right font-medium text-[#d4727a]">{c ? c.suggestedQuantity : "-"}</td><td className="px-3 py-2 text-left text-xs text-[#1F2937]/60 max-w-[200px] truncate">{c ? c.reason : "-"}</td></>);
                              })()}
                              <td className="px-3 py-2 text-right">
                                <input type="number" value={adjustedQuantities[s.productName] ?? s.adjustedQuantity ?? s.roundedQuantity} onChange={(e) => handleQuantityChange(s.productName, Number(e.target.value))} className="w-20 border-0 bg-gray-50 rounded-xl px-2 py-1 text-right text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200" min={0} step={s.packMultiple} />
                              </td>
                              <td className="px-3 py-2 text-right font-semibold">{s.totalAmount.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-[#F7E1E2]/20 font-semibold">
                          <tr>
                            <td className="px-3 py-2" colSpan={aiProductCorrections.length > 0 && !aiProductCorrectionAdopted ? 10 : 8}>合计</td>
                            <td className="px-3 py-2 text-right">{totalSuggestedAmount.toLocaleString()}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
                <div className="flex justify-between">
                  <button onClick={() => setForecastStep("targets")} className="text-[#9CA3AF] hover:text-[#1F2937] px-4 py-2.5 text-sm font-medium transition-colors">← 月/日目标</button>
                  <button onClick={() => setForecastStep("timeslots")} className="bg-[#F7E1E2] text-[#1F2937] px-6 py-2.5 rounded-xl hover:bg-[#EBCDCF] text-sm font-medium transition-all duration-200">下一步：分时段 →</button>
                </div>
              </>
            )}

            {/* Step 3: Time Slots */}
            {forecastStep === "timeslots" && (
              <>
                <div className="bg-white rounded-3xl shadow-[0_4px_40px_rgba(0,0,0,0.03)] p-8">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-[#1F2937]">分时段出货建议 - {selectedDate}</h2>
                    <div className="flex gap-2">
                      <button onClick={handleFetchAITimeSlot} disabled={aiTimeSlotLoading || productSuggestions.length === 0} className="bg-[#F7E1E2] text-[#1F2937] px-6 py-2.5 rounded-xl hover:bg-[#EBCDCF] hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 text-sm font-medium transition-all duration-200">
                        {aiTimeSlotLoading ? "AI 分析中..." : "AI 智能分配"}
                      </button>
                      <button onClick={handleGenerateTimeSlots} disabled={loading || productSuggestions.length === 0} className="bg-gray-50 text-[#1F2937] px-4 py-2.5 rounded-xl hover:bg-gray-100 hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 text-sm font-medium transition-all duration-200">
                        规则生成
                      </button>
                    </div>
                  </div>
                  {aiTimeSlotError && <div className="mb-4 p-3 bg-red-50/70 text-red-700 rounded-2xl text-sm">{aiTimeSlotError}</div>}
                  {aiTimeSlotAnalysis && !aiTimeSlotAdopted && (
                    <div className="mb-4 p-4 bg-[#F7E1E2]/30 rounded-2xl">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-[#1F2937]">AI 分析结果</span>
                        <button onClick={handleAdoptAITimeSlot} className="bg-[#F7E1E2] text-[#1F2937] px-4 py-1.5 rounded-xl text-sm hover:bg-[#EBCDCF] hover:scale-[1.03] active:scale-[0.97] font-medium transition-all duration-200">采纳 AI 建议</button>
                      </div>
                      <p className="text-sm text-[#1F2937]/70">{aiTimeSlotAnalysis}</p>
                    </div>
                  )}
                  {aiTimeSlotAdopted && <div className="mb-4 p-3 bg-green-50/70 text-green-700 rounded-2xl text-sm">已采纳 AI 分时段建议</div>}
                  {timeSlotSuggestions.length > 0 && (
                    <div className="overflow-x-auto rounded-xl">
                      <TimeSlotTable suggestions={timeSlotSuggestions} productSuggestions={productSuggestions} fixedSchedule={fixedSchedule} timeslotSalesRecords={timeslotSalesRecords} />
                    </div>
                  )}
                </div>
                <div className="flex justify-between">
                  <button onClick={() => setForecastStep("products")} className="text-[#9CA3AF] hover:text-[#1F2937] px-4 py-2.5 text-sm font-medium transition-colors">← 单品建议</button>
                  <button onClick={() => setForecastStep("export")} className="bg-[#F7E1E2] text-[#1F2937] px-6 py-2.5 rounded-xl hover:bg-[#EBCDCF] text-sm font-medium transition-all duration-200">下一步：导出 →</button>
                </div>
              </>
            )}

            {/* Step 4: Export */}
            {forecastStep === "export" && (
              <>
                <div className="bg-white rounded-3xl shadow-[0_4px_40px_rgba(0,0,0,0.03)] p-8">
                  <h2 className="text-lg font-semibold text-[#1F2937] mb-4">导出 Excel</h2>
                  <p className="text-sm text-[#9CA3AF] mb-4">导出当前月度目标、日目标、单品建议和分时段数据。</p>
                  <button onClick={handleExport} disabled={monthlyTargets.length === 0 && dailyTargets.length === 0} className="bg-[#F7E1E2] text-[#1F2937] px-6 py-2.5 rounded-xl hover:bg-[#EBCDCF] hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 font-medium transition-all duration-200">
                    导出 Excel 文件
                  </button>
                </div>
                <div className="flex justify-start">
                  <button onClick={() => setForecastStep("timeslots")} className="text-[#9CA3AF] hover:text-[#1F2937] px-4 py-2.5 text-sm font-medium transition-colors">← 分时段</button>
                </div>
              </>
            )}
          </div>
        )}
        {/* ===== REVIEW TAB ===== */}
        {activeTab === "review" && (
          <div className="space-y-6 animate-fade-slide-up">
            <div className="bg-white rounded-3xl shadow-[0_4px_40px_rgba(0,0,0,0.03)] p-8">
              <h2 className="text-lg font-semibold text-[#1F2937] mb-4">每日复盘</h2>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-sm font-medium text-[#1F2937]">复盘日期</label>
                  <input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} className="mt-1 w-full border-0 bg-gray-50 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200" />
                </div>
                <div>
                  <label className="text-sm font-medium text-[#1F2937]">实际营业额 (RM)</label>
                  <input type="number" value={reviewActualRevenue} onChange={(e) => setReviewActualRevenue(e.target.value)} placeholder="如 58000" className="mt-1 w-full border-0 bg-gray-50 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200" />
                </div>
              </div>
              <div className="mb-4">
                <label className="text-sm font-medium text-[#1F2937]">断货记录（每行一个：产品名 时间）</label>
                <textarea value={stockoutText} onChange={(e) => {
                  setStockoutText(e.target.value);
                  const lines = e.target.value.split("\n").filter(Boolean);
                  const parsed = lines.map((line) => {
                    const result = parseStockoutLine(line);
                    if (!result) return null;
                    const lossSlots = calculateLossSlots(result.soldoutTime);
                    const soldoutSlot = `${result.soldoutTime.split(":")[0]}:00`;
                    return { productName: result.inputName, inputName: result.inputName, soldoutTime: result.soldoutTime, soldoutSlot, date: reviewDate, lossSlots, dayType: "mondayToThursday" as OutOfStockRecord["dayType"], estimatedLossQty: 0, estimatedLossAmount: 0 } satisfies OutOfStockRecord;
                  }).filter((x): x is OutOfStockRecord => x !== null);
                  setParsedStockouts(parsed);
                }} placeholder={"奶油泡芙 3点\n巧克力蛋糕 下午2点\n抹茶卷 14:00"} rows={5} className="mt-1 w-full border-0 bg-gray-50 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200 font-mono" />
              </div>
              {parsedStockouts.length > 0 && (
                <div className="mb-4 p-3 bg-[#F7E1E2]/20 rounded-2xl">
                  <p className="text-xs font-medium text-[#1F2937] mb-2">解析预览：</p>
                  <div className="flex flex-wrap gap-2">
                    {parsedStockouts.map((s, i) => (
                      <span key={i} className="text-xs bg-white px-2 py-1 rounded-lg shadow-sm">
                        {s.productName} {s.soldoutTime} → 损失时段: {s.lossSlots.join(", ") || "无"}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={async () => {
                setReviewLoading(true);
                try {
                  if (parsedStockouts.length > 0) await saveOutOfStockRecords(parsedStockouts.map((s) => ({ ...s, date: reviewDate })));
                  const res = await fetch("/api/daily-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedData: { date: reviewDate, actualRevenue: Number(reviewActualRevenue) || 0, stockoutRecords: parsedStockouts } }) });
                  const data = await res.json();
                  if (res.ok) { setReviewResult(data); showToast("AI 复盘完成", "success"); }
                  else showToast(data.error || "复盘失败", "error");
                } catch (err) { showToast(String(err), "error"); }
                finally { setReviewLoading(false); }
              }} disabled={reviewLoading} className="bg-[#F7E1E2] text-[#1F2937] px-6 py-2.5 rounded-xl hover:bg-[#EBCDCF] hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 font-medium transition-all duration-200">
                {reviewLoading ? "AI 分析中..." : "提交复盘"}
              </button>
            </div>
            {reviewResult && (
              <div className="bg-white rounded-3xl shadow-[0_4px_40px_rgba(0,0,0,0.03)] p-8">
                <h3 className="text-md font-semibold text-[#1F2937] mb-3">AI 复盘结果</h3>
                <p className="text-sm text-[#4B5563] mb-3">{reviewResult.review?.summary || ""}</p>
                {reviewResult.review?.highlights && reviewResult.review.highlights.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {reviewResult.review.highlights.map((h: string, i: number) => (<span key={i} className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded-lg">✓ {h}</span>))}
                  </div>
                )}
                {reviewResult.review?.painPoints && reviewResult.review.painPoints.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {reviewResult.review.painPoints.map((p: string, i: number) => (<span key={i} className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded-lg">✗ {p}</span>))}
                  </div>
                )}
                {reviewResult.tomorrowSuggestions && (
                  <div className="mt-4 p-4 bg-blue-50/50 rounded-2xl">
                    <p className="text-sm font-medium text-blue-800 mb-2">明日建议</p>
                    <p className="text-sm text-blue-700">{reviewResult.tomorrowSuggestions.reason}</p>
                  </div>
                )}
                {!reviewResult.adopted && (
                  <button onClick={async () => { await adoptDailyReview(reviewDate); setReviewResult({ ...reviewResult, adopted: true }); showToast("已采纳复盘建议", "success"); }} className="mt-4 bg-[#F7E1E2] text-[#1F2937] px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#EBCDCF] transition-all duration-200">采纳建议</button>
                )}
                {reviewResult.adopted && <p className="mt-4 text-sm text-green-600 font-medium">已采纳</p>}
              </div>
            )}
          </div>
        )}
        {/* ===== CALENDAR TAB ===== */}
        {activeTab === "calendar" && (
          <div className="space-y-6 animate-fade-slide-up">
            <div className="bg-white rounded-3xl shadow-[0_4px_40px_rgba(0,0,0,0.03)] p-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-[#1F2937]">事件日历 {calendarYear}年{calendarMonth + 1}月</h2>
                <div className="flex gap-2">
                  <button onClick={() => { const d = dayjs().year(calendarYear).month(calendarMonth).subtract(1, "month"); setCalendarYear(d.year()); setCalendarMonth(d.month()); }} className="text-sm text-[#9CA3AF] hover:text-[#1F2937] px-3 py-1.5 rounded-xl hover:bg-gray-50 transition-all">← 上月</button>
                  <button onClick={() => { const d = dayjs().year(calendarYear).month(calendarMonth).add(1, "month"); setCalendarYear(d.year()); setCalendarMonth(d.month()); }} className="text-sm text-[#9CA3AF] hover:text-[#1F2937] px-3 py-1.5 rounded-xl hover:bg-gray-50 transition-all">下月 →</button>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-1 mb-4">
                {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
                  <div key={d} className="text-center text-xs text-[#9CA3AF] py-2 font-medium">{d}</div>
                ))}
                {(() => {
                  const firstDay = dayjs().year(calendarYear).month(calendarMonth).startOf("month");
                  const daysInMonth = firstDay.daysInMonth();
                  const startDow = firstDay.day();
                  const cells = [];
                  for (let i = 0; i < startDow; i++) cells.push(<div key={`empty-${i}`} />);
                  for (let d = 1; d <= daysInMonth; d++) {
                    const dateStr = firstDay.date(d).format("YYYY-MM-DD");
                    const dayEvents = calendarEvents.filter((e) => e.date === dateStr);
                    const isSelected = selectedCalendarDate === dateStr;
                    const isToday = dateStr === dayjs().format("YYYY-MM-DD");
                    cells.push(
                      <button key={d} onClick={() => setSelectedCalendarDate(dateStr)} className={`p-2 rounded-xl text-sm min-h-[60px] flex flex-col items-center transition-all duration-200 ${isSelected ? "bg-[#F7E1E2] shadow-sm" : isToday ? "bg-[#F7E1E2]/30" : "hover:bg-gray-50"}`}>
                        <span className={`font-medium ${isSelected ? "text-[#1F2937]" : "text-[#4B5563]"}`}>{d}</span>
                        {dayEvents.length > 0 && <div className="flex gap-0.5 mt-1 flex-wrap justify-center">{dayEvents.slice(0, 2).map((ev, i) => (<span key={i} className="w-1.5 h-1.5 rounded-full bg-[#d4727a]" />))}</div>}
                      </button>
                    );
                  }
                  return cells;
                })()}
              </div>
            </div>
            {selectedCalendarDate && (
              <div className="bg-white rounded-3xl shadow-[0_4px_40px_rgba(0,0,0,0.03)] p-8">
                <h3 className="text-md font-semibold text-[#1F2937] mb-3">{selectedCalendarDate} 事件</h3>
                {calendarEvents.filter((e) => e.date === selectedCalendarDate).length > 0 ? (
                  <div className="space-y-2 mb-4">
                    {calendarEvents.filter((e) => e.date === selectedCalendarDate).map((e, i) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                        <div>
                          <span className="text-sm font-medium text-[#1F2937]">{e.eventTag}</span>
                          {e.description && <span className="text-xs text-[#9CA3AF] ml-2">{e.description}</span>}
                          <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${e.eventType === "promotion" ? "bg-[#F7E1E2] text-[#1F2937]" : e.eventType === "competition" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-700"}`}>{e.eventType}</span>
                        </div>
                        <button onClick={async () => { if (e.id) { await deleteContextEvent(e.id); setCalendarEvents((prev) => prev.filter((x) => x.id !== e.id)); showToast("已删除", "info"); } }} className="text-red-400 text-xs hover:text-red-600 transition-colors">删除</button>
                      </div>
                    ))}
                  </div>
                ) : (<p className="text-sm text-[#9CA3AF] mb-4">该日暂无事件</p>)}
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="text-xs text-[#9CA3AF]">事件标签</label>
                    <input value={newEventTag} onChange={(e) => setNewEventTag(e.target.value)} className="w-full border-0 bg-gray-50 rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200" placeholder="如: 开斋节" />
                  </div>
                  <div>
                    <label className="text-xs text-[#9CA3AF]">类型</label>
                    <select value={newEventType} onChange={(e) => setNewEventType(e.target.value as ContextEvent["eventType"])} className="border-0 bg-gray-50 rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200">
                      <option value="internal">内部活动</option>
                      <option value="promotion">促销</option>
                      <option value="weather">天气</option>
                      <option value="competition">竞品</option>
                      <option value="other">其他</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-[#9CA3AF]">描述</label>
                    <input value={newEventDesc} onChange={(e) => setNewEventDesc(e.target.value)} className="w-full border-0 bg-gray-50 rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200" placeholder="可选" />
                  </div>
                  <button onClick={async () => {
                    if (!newEventTag) return;
                    await addContextEvent({ date: selectedCalendarDate, eventTag: newEventTag, eventType: newEventType, description: newEventDesc, impactProducts: "", createdBy: "user" });
                    const events = await getContextEvents(undefined, `${calendarYear}-${String(calendarMonth + 1).padStart(2, "0")}-01`, dayjs().year(calendarYear).month(calendarMonth).endOf("month").format("YYYY-MM-DD"));
                    setCalendarEvents(events);
                    setNewEventTag(""); setNewEventDesc("");
                    showToast("事件已添加", "success");
                  }} className="bg-[#F7E1E2] text-[#1F2937] px-4 py-1.5 rounded-xl text-sm hover:bg-[#EBCDCF] font-medium transition-all duration-200">添加</button>
                </div>
              </div>
            )}
          </div>
        )}
        {/* ===== EMPOWERMENT TAB ===== */}
        {activeTab === "empowerment" && (
          <div className="space-y-6 animate-fade-slide-up">
            <div className="bg-white rounded-3xl shadow-[0_4px_40px_rgba(0,0,0,0.03)] p-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-[#1F2937]">赋能分析</h2>
                <button onClick={() => setShowNewEmpowerment(!showNewEmpowerment)} className="bg-[#F7E1E2] text-[#1F2937] px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#EBCDCF] transition-all duration-200">
                  {showNewEmpowerment ? "取消" : "+ 新增赋能事件"}
                </button>
              </div>
              {showNewEmpowerment && (
                <div className="mb-6 p-4 bg-gray-50 rounded-2xl space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div><label className="text-xs text-[#9CA3AF]">事件名称</label><input id="emp-name" className="w-full border-0 bg-white rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none" placeholder="如: 新品上市推广" /></div>
                    <div><label className="text-xs text-[#9CA3AF]">开始日期</label><input id="emp-start" type="date" className="w-full border-0 bg-white rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none" /></div>
                    <div><label className="text-xs text-[#9CA3AF]">结束日期</label><input id="emp-end" type="date" className="w-full border-0 bg-white rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-xs text-[#9CA3AF]">类型</label><select id="emp-type" className="w-full border-0 bg-white rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none"><option value="market">市场赋能</option><option value="operation">运营赋能</option></select></div>
                    <div><label className="text-xs text-[#9CA3AF]">投入成本 (RM)</label><input id="emp-cost" type="number" className="w-full border-0 bg-white rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none" placeholder="0" /></div>
                  </div>
                  <button onClick={async () => {
                    const name = (document.getElementById("emp-name") as HTMLInputElement)?.value;
                    const startDate = (document.getElementById("emp-start") as HTMLInputElement)?.value;
                    const endDate = (document.getElementById("emp-end") as HTMLInputElement)?.value;
                    const eventType = (document.getElementById("emp-type") as HTMLSelectElement)?.value as "market" | "operation";
                    const cost = Number((document.getElementById("emp-cost") as HTMLInputElement)?.value) || 0;
                    if (!name || !startDate || !endDate) { showToast("请填写完整信息", "error"); return; }
                    await addEmpowermentEvent({ eventName: name, startDate, endDate, eventType, cost, targetProducts: "", platform: "", exposureCount: 0, clickCount: 0, operationType: "", operationDetail: "" });
                    const events = await getEmpowermentEvents();
                    setEmpowermentEvents(events);
                    setShowNewEmpowerment(false);
                    showToast("赋能事件已添加", "success");
                  }} className="bg-[#F7E1E2] text-[#1F2937] px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#EBCDCF] transition-all duration-200">保存</button>
                </div>
              )}
              {empowermentEvents.length === 0 ? (
                <p className="text-sm text-[#9CA3AF]">暂无赋能事件，点击上方按钮添加</p>
              ) : (
                <div className="space-y-4">
                  {empowermentEvents.map((ev) => (
                    <div key={ev.id} className="p-4 bg-gray-50 rounded-2xl">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span className="text-sm font-semibold text-[#1F2937]">{ev.eventName}</span>
                          <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-[#F7E1E2] text-[#1F2937]">{ev.eventType}</span>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={async () => {
                            const res = await fetch("/api/empowerment-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: ev.id }) });
                            if (res.ok) { const events = await getEmpowermentEvents(); setEmpowermentEvents(events); showToast("ROI 分析完成", "success"); } else showToast("分析失败", "error");
                          }} className="text-xs text-[#d4727a] hover:text-[#1F2937] font-medium transition-colors">AI 分析 ROI</button>
                          <button onClick={async () => { if (ev.id) { await deleteEmpowermentEvent(ev.id); setEmpowermentEvents((prev) => prev.filter((x) => x.id !== ev.id)); showToast("已删除", "info"); } }} className="text-xs text-red-400 hover:text-red-600 transition-colors">删除</button>
                        </div>
                      </div>
                      <p className="text-xs text-[#9CA3AF]">{ev.startDate} ~ {ev.endDate} | 投入: RM {ev.cost?.toLocaleString() || 0}</p>
                      {ev.reviewJson && (
                        <div className="mt-3 p-3 bg-white rounded-xl text-xs text-[#4B5563]">
                          <p className="font-medium text-[#1F2937] mb-1">ROI 分析结果</p>
                          <p>{typeof ev.reviewJson === "string" ? ev.reviewJson : JSON.stringify(ev.reviewJson, null, 2)}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {/* ===== SETTINGS TAB ===== */}
        {activeTab === "settings" && (
          <div className="space-y-6 animate-fade-slide-up">
            <div className="bg-white rounded-3xl shadow-[0_4px_40px_rgba(0,0,0,0.03)] p-4">
              <div className="flex gap-1 bg-gray-50 rounded-full p-1 w-fit mx-auto">
                {([["data", "数据导入"], ["business", "业务规则"], ["schedule", "出货时间表"], ["alias", "产品别名"], ["holiday", "节假日"]] as const).map(([id, label]) => (
                  <button key={id} onClick={() => { setSettingsTab(id); if (id !== "data") loadRulesData(); }} className={`px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-300 ${settingsTab === id ? "bg-[#F7E1E2] text-[#1F2937] shadow-sm" : "text-[#9CA3AF] hover:text-[#1F2937]"}`}>{label}</button>
                ))}
              </div>
            </div>

            {settingsTab === "data" && (
              <>
                <div className="bg-white rounded-3xl shadow-[0_4px_40px_rgba(0,0,0,0.03)] p-8">
                  <h2 className="text-lg font-semibold text-[#1F2937] mb-4">数据库状态</h2>
                  {dataLoaded ? (
                    <div className="bg-green-50/70 rounded-2xl p-4">
                      <p className="text-green-800 font-medium text-sm">数据已从数据库加载</p>
                      <div className="mt-2 grid grid-cols-3 gap-4 text-sm text-green-700">
                        <div>产品: <span className="font-semibold">{products.length}</span> 个</div>
                        <div>策略: <span className="font-semibold">{strategies.length}</span> 个</div>
                        <div>基线: <span className="font-semibold">{baselines.length}</span> 个</div>
                      </div>
                    </div>
                  ) : loading ? (
                    <div className="bg-[#F7E1E2]/30 rounded-2xl p-4"><p className="text-[#1F2937] text-sm">正在从数据库加载数据...</p></div>
                  ) : (
                    <div className="bg-amber-50/70 rounded-2xl p-4"><p className="text-amber-800 text-sm">数据库暂无数据，请先从 Excel 导入。</p></div>
                  )}
                </div>
                <div className="bg-white rounded-3xl shadow-[0_4px_40px_rgba(0,0,0,0.03)] p-8">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-lg font-semibold text-[#1F2937]">从 Excel 重新导入</h2>
                      <p className="text-sm text-[#9CA3AF] mt-1">从 data 目录重新导入产品价格、销售数据和策略数据到数据库（将覆盖现有数据）。</p>
                    </div>
                    <button onClick={handleAutoImport} disabled={loading} className="bg-[#F7E1E2] text-[#1F2937] px-6 py-2.5 rounded-xl hover:bg-[#EBCDCF] hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 font-medium transition-all duration-200">从 Excel 重新导入</button>
                  </div>
                  {importStatus.products && (
                    <div className="mt-6 space-y-3">
                      <ImportResultCard title="产品价格" result={importStatus.products} />
                      <ImportResultCard title="销售策略" result={importStatus.strategy!} />
                      <ImportResultCard title="销售数据" result={importStatus.sales!} />
                      {importStatus.timeslot && <ImportResultCard title="分时段销售" result={importStatus.timeslot} />}
                    </div>
                  )}
                </div>
                {products.length > 0 && (
                  <div className="bg-white rounded-3xl shadow-[0_4px_40px_rgba(0,0,0,0.03)] p-8">
                    <h3 className="text-md font-semibold text-[#1F2937] mb-3">已导入产品 ({products.length} 个)</h3>
                    <div className="overflow-x-auto rounded-xl">
                      <table className="min-w-full text-sm">
                        <thead className="bg-gray-50/50">
                          <tr>
                            <th className="px-3 py-2 text-left text-[#9CA3AF] font-medium text-xs">品类</th>
                            <th className="px-3 py-2 text-left text-[#9CA3AF] font-medium text-xs">品名</th>
                            <th className="px-3 py-2 text-right text-[#9CA3AF] font-medium text-xs">单价</th>
                            <th className="px-3 py-2 text-right text-[#9CA3AF] font-medium text-xs">倍数</th>
                            <th className="px-3 py-2 text-center text-[#9CA3AF] font-medium text-xs">类型</th>
                          </tr>
                        </thead>
                        <tbody>
                          {products.map((p) => (
                            <tr key={p.id} className="hover:bg-[#F7E1E2]/20 transition-colors duration-200 border-b border-gray-50">
                              <td className="px-3 py-2">{p.category}</td>
                              <td className="px-3 py-2 font-medium">{p.name}</td>
                              <td className="px-3 py-2 text-right">{p.price}</td>
                              <td className="px-3 py-2 text-right">{p.packMultiple}</td>
                              <td className="px-3 py-2 text-center"><span className={`px-2 py-0.5 rounded-full text-xs ${p.unitType === "batch" ? "bg-[#F7E1E2] text-[#1F2937]" : "bg-green-100 text-green-700"}`}>{p.unitType === "batch" ? "整批" : "按个"}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
                  {settingsTab === "business" && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-sm font-medium text-[#1F2937]">首月基础营业额</label>
                          <input
                            type="number"
                            key={`rev-${businessRulesState?.firstMonthRevenue}`}
                            defaultValue={businessRulesState?.firstMonthRevenue ?? 1640000}
                            onBlur={(e) => handleSaveBusinessRule("firstMonthRevenue", Number(e.target.value))}
                            className="mt-1 w-full border-0 bg-gray-50 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200"
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium text-[#1F2937]">总赋能增幅</label>
                          <input
                            type="number"
                            step="0.01"
                            key={`enh-${businessRulesState?.totalEnhancement}`}
                            defaultValue={businessRulesState?.totalEnhancement ?? 0.06}
                            onBlur={(e) => handleSaveBusinessRule("totalEnhancement", Number(e.target.value))}
                            className="mt-1 w-full border-0 bg-gray-50 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-[#1F2937]">日权重配置</label>
                        <div className="grid grid-cols-3 gap-3 mt-1">
                          <div>
                            <span className="text-xs text-[#9CA3AF]">周一至周四</span>
                            <input type="number" step="0.01"
                              key={`wt-mtd-${businessRulesState?.weekdayWeights?.mondayToThursday}`}
                              defaultValue={businessRulesState?.weekdayWeights?.mondayToThursday ?? 1.0}
                              onBlur={(e) => {
                                const w = businessRulesState?.weekdayWeights ?? { mondayToThursday: 1.0, friday: 1.2, weekend: 1.35 };
                                handleSaveBusinessRule("weekdayWeights", { ...w, mondayToThursday: Number(e.target.value) });
                              }}
                              className="w-full border-0 bg-gray-50 rounded-xl px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200" />
                          </div>
                          <div>
                            <span className="text-xs text-[#9CA3AF]">周五</span>
                            <input type="number" step="0.01"
                              key={`wt-fri-${businessRulesState?.weekdayWeights?.friday}`}
                              defaultValue={businessRulesState?.weekdayWeights?.friday ?? 1.2}
                              onBlur={(e) => {
                                const w = businessRulesState?.weekdayWeights ?? { mondayToThursday: 1.0, friday: 1.2, weekend: 1.35 };
                                handleSaveBusinessRule("weekdayWeights", { ...w, friday: Number(e.target.value) });
                              }}
                              className="w-full border-0 bg-gray-50 rounded-xl px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200" />
                          </div>
                          <div>
                            <span className="text-xs text-[#9CA3AF]">周末</span>
                            <input type="number" step="0.01"
                              key={`wt-wkd-${businessRulesState?.weekdayWeights?.weekend}`}
                              defaultValue={businessRulesState?.weekdayWeights?.weekend ?? 1.35}
                              onBlur={(e) => {
                                const w = businessRulesState?.weekdayWeights ?? { mondayToThursday: 1.0, friday: 1.2, weekend: 1.35 };
                                handleSaveBusinessRule("weekdayWeights", { ...w, weekend: Number(e.target.value) });
                              }}
                              className="w-full border-0 bg-gray-50 rounded-xl px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200" />
                          </div>
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-[#1F2937]">出货公式</label>
                        <div className="grid grid-cols-3 gap-3 mt-1">
                          <div>
                            <span className="text-xs text-[#9CA3AF]">品鉴损耗率</span>
                            <input type="number" step="0.01"
                              key={`sf-tw-${businessRulesState?.shipmentFormula?.tastingWasteRate}`}
                              defaultValue={businessRulesState?.shipmentFormula?.tastingWasteRate ?? 0.06}
                              onBlur={(e) => {
                                const sf = businessRulesState?.shipmentFormula ?? { tastingWasteRate: 0.06, waterBarRate: 0.11, shipmentRate: 0.95 };
                                handleSaveBusinessRule("shipmentFormula", { ...sf, tastingWasteRate: Number(e.target.value) });
                              }}
                              className="w-full border-0 bg-gray-50 rounded-xl px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200" />
                          </div>
                          <div>
                            <span className="text-xs text-[#9CA3AF]">水吧占比</span>
                            <input type="number" step="0.01"
                              key={`sf-wb-${businessRulesState?.shipmentFormula?.waterBarRate}`}
                              defaultValue={businessRulesState?.shipmentFormula?.waterBarRate ?? 0.11}
                              onBlur={(e) => {
                                const sf = businessRulesState?.shipmentFormula ?? { tastingWasteRate: 0.06, waterBarRate: 0.11, shipmentRate: 0.95 };
                                handleSaveBusinessRule("shipmentFormula", { ...sf, waterBarRate: Number(e.target.value) });
                              }}
                              className="w-full border-0 bg-gray-50 rounded-xl px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200" />
                          </div>
                          <div>
                            <span className="text-xs text-[#9CA3AF]">出货率</span>
                            <input type="number" step="0.01"
                              key={`sf-sr-${businessRulesState?.shipmentFormula?.shipmentRate}`}
                              defaultValue={businessRulesState?.shipmentFormula?.shipmentRate ?? 0.95}
                              onBlur={(e) => {
                                const sf = businessRulesState?.shipmentFormula ?? { tastingWasteRate: 0.06, waterBarRate: 0.11, shipmentRate: 0.95 };
                                handleSaveBusinessRule("shipmentFormula", { ...sf, shipmentRate: Number(e.target.value) });
                              }}
                              className="w-full border-0 bg-gray-50 rounded-xl px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200" />
                          </div>
                        </div>
                      </div>
                      {rulesSaving && <p className="text-sm text-[#d4727a] font-medium">保存中...</p>}
                    </div>
                  )}

                  {/* Fixed Shipment Schedule Editor */}
                  {settingsTab === "schedule" && (
                    <div className="space-y-3">
                      <div className="flex gap-2 items-end">
                        <div className="flex-1">
                          <label className="text-xs text-[#9CA3AF]">产品名</label>
                          <input
                            value={editingScheduleProduct}
                            onChange={(e) => setEditingScheduleProduct(e.target.value)}
                            className="w-full border-0 bg-gray-50 rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200"
                            placeholder="产品名称"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-xs text-[#9CA3AF]">时段（逗号分隔）</label>
                          <input
                            value={editingScheduleSlots}
                            onChange={(e) => setEditingScheduleSlots(e.target.value)}
                            className="w-full border-0 bg-gray-50 rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200"
                            placeholder="11:00, 15:00, 18:00"
                          />
                        </div>
                        <button
                          onClick={handleSaveSchedule}
                          disabled={rulesSaving}
                          className="bg-[#F7E1E2] text-[#1F2937] px-4 py-1.5 rounded-xl text-sm hover:bg-[#EBCDCF] hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 font-medium transition-all duration-200"
                        >
                          保存
                        </button>
                      </div>
                      <div className="max-h-80 overflow-y-auto rounded-xl">
                        <table className="min-w-full text-sm">
                          <thead className="bg-gray-50/50 sticky top-0">
                            <tr>
                              <th className="px-3 py-2 text-left text-[#9CA3AF] font-medium text-xs">产品</th>
                              <th className="px-3 py-2 text-left text-[#9CA3AF] font-medium text-xs">出货时段</th>
                              <th className="px-3 py-2 text-center text-[#9CA3AF] font-medium text-xs">操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(fixedSchedule).map(([name, slots]) => (
                              <tr key={name} className="hover:bg-[#F7E1E2]/20 transition-colors duration-200 border-b border-gray-50">
                                <td className="px-3 py-1.5 font-medium text-xs">{name}</td>
                                <td className="px-3 py-1.5 text-xs text-[#9CA3AF]">{slots.join(", ")}</td>
                                <td className="px-3 py-1.5 text-center">
                                  <button
                                    onClick={() => { setEditingScheduleProduct(name); setEditingScheduleSlots(slots.join(", ")); }}
                                    className="text-[#1F2937] text-xs hover:text-[#d4727a] transition-colors duration-200"
                                  >
                                    编辑
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Product Alias Editor */}
                  {settingsTab === "alias" && (
                    <div className="space-y-3">
                      <div className="flex gap-2 items-end">
                        <div className="flex-1">
                          <label className="text-xs text-[#9CA3AF]">别名</label>
                          <input
                            value={newAliasKey}
                            onChange={(e) => setNewAliasKey(e.target.value)}
                            className="w-full border-0 bg-gray-50 rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200"
                            placeholder="销售系统中的名称"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-xs text-[#9CA3AF]">标准名</label>
                          <input
                            value={newAliasValue}
                            onChange={(e) => setNewAliasValue(e.target.value)}
                            className="w-full border-0 bg-gray-50 rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200"
                            placeholder="对应的标准产品名"
                          />
                        </div>
                        <button
                          onClick={handleSaveAlias}
                          disabled={rulesSaving}
                          className="bg-[#F7E1E2] text-[#1F2937] px-4 py-1.5 rounded-xl text-sm hover:bg-[#EBCDCF] hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 font-medium transition-all duration-200"
                        >
                          添加
                        </button>
                      </div>
                      <div className="max-h-80 overflow-y-auto rounded-xl">
                        <table className="min-w-full text-sm">
                          <thead className="bg-gray-50/50 sticky top-0">
                            <tr>
                              <th className="px-3 py-2 text-left text-[#9CA3AF] font-medium text-xs">别名</th>
                              <th className="px-3 py-2 text-left text-[#9CA3AF] font-medium text-xs">标准名</th>
                              <th className="px-3 py-2 text-center text-[#9CA3AF] font-medium text-xs">操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(aliases).map(([alias, stdName]) => (
                              <tr key={alias} className="hover:bg-[#F7E1E2]/20 transition-colors duration-200 border-b border-gray-50">
                                <td className="px-3 py-1.5 text-xs">{alias}</td>
                                <td className="px-3 py-1.5 text-xs font-medium">{stdName}</td>
                                <td className="px-3 py-1.5 text-center">
                                  <button
                                    onClick={() => handleDeleteAlias(alias)}
                                    className="text-red-400 text-xs hover:text-red-600 transition-colors duration-200"
                                  >
                                    删除
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Holiday Management */}
                  {settingsTab === "holiday" && (
                    <div className="space-y-3">
                      <div className="bg-[#F7E1E2]/30 rounded-2xl p-3 text-xs text-[#1F2937] mb-3">
                        在这里录入节假日信息，AI 修正时会根据节日类型、节前节后影响等因素自动判断营业额系数。
                      </div>
                      <div className="grid grid-cols-5 gap-2 items-end">
                        <div>
                          <label className="text-xs text-[#9CA3AF]">日期</label>
                          <input
                            type="date"
                            value={newHolidayDate}
                            onChange={(e) => setNewHolidayDate(e.target.value)}
                            className="w-full border-0 bg-gray-50 rounded-xl px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-[#9CA3AF]">名称</label>
                          <input
                            value={newHolidayName}
                            onChange={(e) => setNewHolidayName(e.target.value)}
                            className="w-full border-0 bg-gray-50 rounded-xl px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200"
                            placeholder="如: Hari Raya Aidilfitri"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-[#9CA3AF]">类型</label>
                          <select
                            value={newHolidayType}
                            onChange={(e) => setNewHolidayType(e.target.value as Holiday["type"])}
                            className="w-full border-0 bg-gray-50 rounded-xl px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200"
                          >
                            <option value="public_holiday">法定公假</option>
                            <option value="festival">重要节日</option>
                            <option value="promotion">促销活动</option>
                            <option value="ramadan">斋月</option>
                            <option value="other">其他</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-[#9CA3AF]">备注</label>
                          <input
                            value={newHolidayNote}
                            onChange={(e) => setNewHolidayNote(e.target.value)}
                            className="w-full border-0 bg-gray-50 rounded-xl px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#F7E1E2] focus:outline-none transition-all duration-200"
                            placeholder="可选"
                          />
                        </div>
                        <button
                          onClick={handleAddHoliday}
                          disabled={rulesSaving || !newHolidayDate || !newHolidayName}
                          className="bg-[#F7E1E2] text-[#1F2937] px-4 py-1.5 rounded-xl text-sm hover:bg-[#EBCDCF] hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 font-medium transition-all duration-200"
                        >
                          添加
                        </button>
                      </div>
                      <div className="max-h-96 overflow-y-auto rounded-xl">
                        <table className="min-w-full text-sm">
                          <thead className="bg-gray-50/50 sticky top-0">
                            <tr>
                              <th className="px-3 py-2 text-left text-[#9CA3AF] font-medium text-xs">日期</th>
                              <th className="px-3 py-2 text-left text-[#9CA3AF] font-medium text-xs">名称</th>
                              <th className="px-3 py-2 text-center text-[#9CA3AF] font-medium text-xs">类型</th>
                              <th className="px-3 py-2 text-left text-[#9CA3AF] font-medium text-xs">备注</th>
                              <th className="px-3 py-2 text-center text-[#9CA3AF] font-medium text-xs">操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {holidaysList.length === 0 ? (
                              <tr>
                                <td colSpan={5} className="px-3 py-6 text-center text-[#9CA3AF] text-sm">
                                  暂无节假日数据，请添加
                                </td>
                              </tr>
                            ) : (
                              holidaysList.map((h) => {
                                const typeLabels: Record<string, string> = {
                                  public_holiday: "法定公假",
                                  festival: "重要节日",
                                  promotion: "促销活动",
                                  ramadan: "斋月",
                                  other: "其他",
                                };
                                const typeColors: Record<string, string> = {
                                  public_holiday: "bg-red-100 text-red-700",
                                  festival: "bg-orange-100 text-orange-700",
                                  promotion: "bg-[#F7E1E2] text-[#1F2937]",
                                  ramadan: "bg-green-100 text-green-700",
                                  other: "bg-gray-100 text-gray-700",
                                };
                                return (
                                  <tr key={h.id} className="hover:bg-[#F7E1E2]/20 transition-colors duration-200 border-b border-gray-50">
                                    <td className="px-3 py-1.5 text-xs font-mono">{h.date}</td>
                                    <td className="px-3 py-1.5 text-xs font-medium">{h.name}</td>
                                    <td className="px-3 py-1.5 text-center">
                                      <span className={`px-2 py-0.5 rounded-full text-xs ${typeColors[h.type] || ""}`}>
                                        {typeLabels[h.type] || h.type}
                                      </span>
                                    </td>
                                    <td className="px-3 py-1.5 text-xs text-[#9CA3AF]">{h.note}</td>
                                    <td className="px-3 py-1.5 text-center">
                                      <button
                                        onClick={() => h.id && handleDeleteHoliday(h.id)}
                                        className="text-red-400 text-xs hover:text-red-600 transition-colors duration-200"
                                      >
                                        删除
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                      {rulesSaving && <p className="text-sm text-[#d4727a] font-medium">保存中...</p>}
                    </div>
                  )}

          </div>
        )}

        {/* Toast Notification */}
        {toast && (
          <div className={`fixed bottom-6 right-6 px-4 py-3 rounded-2xl shadow-lg text-sm font-medium z-50 animate-fade-slide-up ${toast.type === "success" ? "bg-green-50 text-green-800" : toast.type === "error" ? "bg-red-50 text-red-800" : "bg-blue-50 text-blue-800"}`}>
            {toast.message}
          </div>
        )}
      </main>
    </div>
  );
}
// ========== Sub Components ==========
function ImportResultCard({ title, result }: { title: string; result: ImportResult }) {
  return (
    <div
      className={`p-4 rounded-2xl ${
        result.success
          ? "bg-green-50/70"
          : "bg-red-50/70"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium text-[#1F2937]">{title}</span>
        <span
          className={`text-sm ${
            result.success ? "text-green-700" : "text-red-700"
          }`}
        >
          {result.success ? `成功导入 ${result.importedRows} 条` : "导入失败"}
        </span>
      </div>
      {result.errors.length > 0 && (
        <div className="mt-2 text-sm text-red-600">
          {result.errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}
      {result.unmatchedProducts && result.unmatchedProducts.length > 0 && (
        <div className="mt-2">
          <p className="text-sm text-amber-700 font-medium">
            未匹配商品 ({result.unmatchedProducts.length}):
          </p>
          <div className="flex flex-wrap gap-1 mt-1">
            {result.unmatchedProducts.slice(0, 20).map((p) => (
              <span
                key={p}
                className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs"
              >
                {p}
              </span>
            ))}
            {result.unmatchedProducts.length > 20 && (
              <span className="text-xs text-amber-600">
                ... 还有 {result.unmatchedProducts.length - 20} 个
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#F7E1E2]/20 rounded-2xl p-4 hover:-translate-y-1 hover:shadow-lg transition-all duration-300">
      <p className="text-xs text-[#9CA3AF]">{label}</p>
      <p className="text-lg font-bold text-[#1F2937] mt-1">{value}</p>
    </div>
  );
}

function TimeSlotTable({
  suggestions,
  productSuggestions,
  fixedSchedule,
  timeslotSalesRecords,
}: {
  suggestions: TimeSlotSuggestion[];
  productSuggestions: ProductSuggestion[];
  fixedSchedule: Record<string, string[]>;
  timeslotSalesRecords: TimeslotSalesRecord[];
}) {
  const ALL_SLOTS = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"];

  // Build pivot: product x time slot
  const productNames = [...new Set(productSuggestions.map((p) => p.productName))];

  const slotMap = new Map<string, Map<string, TimeSlotSuggestion>>();
  for (const s of suggestions) {
    if (!slotMap.has(s.productName)) slotMap.set(s.productName, new Map());
    slotMap.get(s.productName)!.set(s.timeSlot, s);
  }

  return (
    <table className="min-w-full text-xs border-collapse">
      <thead>
        <tr className="bg-gray-50/50">
          <th className="px-2 py-2 text-left sticky left-0 bg-gray-50/50 min-w-[140px] text-[#9CA3AF] font-medium text-xs border-b border-gray-100">品名</th>
          <th className="px-2 py-2 text-right border-b border-gray-100 font-bold text-[#9CA3AF] text-xs">总数</th>
          <th className="px-2 py-2 text-right border-b border-gray-100 font-bold text-[#9CA3AF] text-xs">金额</th>
          {ALL_SLOTS.map((slot) => (
            <th key={slot} className="px-2 py-2 text-center border-b border-gray-100 min-w-[50px] text-[#9CA3AF] font-medium text-xs">
              {slot.replace(":00", "点")}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {productNames.map((name) => {
          const prodSugg = productSuggestions.find((p) => p.productName === name);
          const schedule = fixedSchedule[name] || [];
          // Use actual distributed total from time slot suggestions (not productSuggestions)
          // so the "总数" column always matches the sum of time slot columns
          const productSlots = suggestions.filter((s) => s.productName === name);
          const totalQty = productSlots.reduce((sum, s) => sum + s.quantity, 0);
          const totalAmount = productSlots.reduce((sum, s) => sum + s.amount, 0);
          return (
            <tr key={name} className="hover:bg-[#F7E1E2]/20 transition-colors duration-200 border-b border-gray-50">
              <td className="px-2 py-1.5 font-medium sticky left-0 bg-white text-[11px] whitespace-nowrap">
                {name}
              </td>
              <td className="px-2 py-1.5 text-right font-semibold">
                {totalQty}
              </td>
              <td className="px-2 py-1.5 text-right text-[#9CA3AF]">
                {totalAmount.toLocaleString()}
              </td>
              {ALL_SLOTS.map((slot) => {
                const isFixedSlot = schedule.includes(slot);
                const data = slotMap.get(name)?.get(slot);
                return (
                  <td
                    key={slot}
                    className={`px-2 py-1.5 text-center ${
                      isFixedSlot
                        ? "bg-[#F7E1E2]/40 text-[#1F2937] font-semibold"
                        : "text-gray-300"
                    }`}
                  >
                    {data && data.quantity > 0 ? data.quantity : isFixedSlot ? "-" : ""}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="bg-[#F7E1E2]/20 font-semibold border-t-2 border-gray-100">
          <td className="px-2 py-2 sticky left-0 bg-[#F7E1E2]/20">合计</td>
          <td className="px-2 py-2 text-right">
            {suggestions
              .reduce((s, item) => s + item.quantity, 0)
              .toLocaleString()}
          </td>
          <td className="px-2 py-2 text-right">
            {suggestions
              .reduce((s, item) => s + item.amount, 0)
              .toLocaleString()}
          </td>
          {ALL_SLOTS.map((slot) => {
            const total = suggestions
              .filter((s) => s.timeSlot === slot)
              .reduce((sum, s) => sum + s.amount, 0);
            return (
              <td key={slot} className="px-2 py-2 text-center">
                {total > 0 ? total.toLocaleString() : ""}
              </td>
            );
          })}
        </tr>
        {(() => {
          // Build price lookup from productSuggestions
          const priceMap = new Map<string, number>();
          for (const p of productSuggestions) {
            priceMap.set(p.productName, p.price);
          }
          // Calculate estimated sales amount per slot
          const estimatedSalesPerSlot = new Map<string, number>();
          let estimatedSalesTotal = 0;
          for (const slot of ALL_SLOTS) {
            if (slot < "12:00") {
              estimatedSalesPerSlot.set(slot, 0);
              continue;
            }
            const slotAmount = timeslotSalesRecords
              .filter((r) => r.timeSlot === slot)
              .reduce((sum, r) => {
                const price = priceMap.get(r.productName) ?? 0;
                return sum + r.avgQuantity * price;
              }, 0);
            estimatedSalesPerSlot.set(slot, Math.round(slotAmount));
            estimatedSalesTotal += Math.round(slotAmount);
          }
          // Calculate shipment totals per slot (same as 合计 row)
          const shipmentPerSlot = new Map<string, number>();
          for (const slot of ALL_SLOTS) {
            shipmentPerSlot.set(
              slot,
              suggestions.filter((s) => s.timeSlot === slot).reduce((sum, s) => sum + s.amount, 0)
            );
          }
          const shipmentTotal = suggestions.reduce((s, item) => s + item.amount, 0);

          return (
            <>
              <tr className="bg-blue-50/50 font-medium border-t border-gray-100">
                <td className="px-2 py-2 sticky left-0 bg-blue-50/50 text-blue-700">预计销售</td>
                <td className="px-2 py-2 text-right"></td>
                <td className="px-2 py-2 text-right text-blue-700">
                  {estimatedSalesTotal > 0 ? estimatedSalesTotal.toLocaleString() : ""}
                </td>
                {ALL_SLOTS.map((slot) => {
                  const val = estimatedSalesPerSlot.get(slot) || 0;
                  return (
                    <td key={slot} className="px-2 py-2 text-center text-blue-700">
                      {val > 0 ? val.toLocaleString() : ""}
                    </td>
                  );
                })}
              </tr>
              <tr className="bg-gray-50/30 font-medium border-t border-gray-100">
                <td className="px-2 py-2 sticky left-0 bg-gray-50/30">预计剩余</td>
                <td className="px-2 py-2 text-right"></td>
                <td className="px-2 py-2 text-right">
                  {(() => {
                    const diff = shipmentTotal - estimatedSalesTotal;
                    return (
                      <span className={diff < 0 ? "text-red-500" : "text-green-600"}>
                        {diff.toLocaleString()}
                      </span>
                    );
                  })()}
                </td>
                {(() => {
                  let cumulativeShipment = 0;
                  let cumulativeSales = 0;
                  return ALL_SLOTS.map((slot) => {
                    cumulativeShipment += shipmentPerSlot.get(slot) || 0;
                    cumulativeSales += estimatedSalesPerSlot.get(slot) || 0;
                    if (cumulativeShipment === 0 && cumulativeSales === 0) {
                      return <td key={slot} className="px-2 py-2 text-center"></td>;
                    }
                    const diff = cumulativeShipment - cumulativeSales;
                    return (
                      <td key={slot} className="px-2 py-2 text-center">
                        <span className={diff < 0 ? "text-red-500" : "text-green-600"}>
                          {diff.toLocaleString()}
                        </span>
                      </td>
                    );
                  });
                })()}
              </tr>
            </>
          );
        })()}
      </tfoot>
    </table>
  );
}
