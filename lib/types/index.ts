// ========== Product Types ==========
export interface Product {
  id: string;
  category: string;
  name: string;
  nameEn: string;
  price: number;
  packMultiple: number;
  unitType: "batch" | "individual"; // batch = 按整批取整, individual = 按个出货
  displayFullQuantity: number; // 满柜数量
}

export interface ProductAlias {
  alias: string;
  standardName: string;
}

export interface ProductStrategy {
  productName: string;
  positioning: "TOP" | "潜在TOP" | "其他";
  category: string;
  coldHot: "冷" | "热";
  salesRatio: number;
  targetTC: number | null;
  audience: string;
  breakStockTime: string;
  sortOrder: number;
}

// ========== Sales Data Types ==========
export interface DailySalesRecord {
  productName: string;
  standardName: string;
  quantity: number;
  date: string; // YYYY-MM-DD
  dayOfWeek: number; // 0=Sunday, 1=Monday, ..., 6=Saturday
}

export interface ProductSalesBaseline {
  productName: string;
  avgMondayToThursday: number;
  avgFriday: number;
  avgWeekend: number;
  totalSales: number;
  dayCount: number;
}

// ========== Business Rules Types ==========
export interface BusinessRules {
  firstMonthRevenue: number;
  operationEnhancement: number;
  marketEnhancement: number;
  totalEnhancement: number;
  monthlyCoefficients: Record<string, number>;
  weekdayWeights: {
    mondayToThursday: number;
    friday: number;
    weekend: number;
  };
  shipmentFormula: {
    tastingWasteRate: number;
    waterBarRate: number;
    shipmentRate: number;
  };
  baselineOverrides?: Record<string, {
    mondayToThursday: number;
    friday: number;
    weekend: number;
  }>;
  productBoosts?: Record<string, number>; // 产品级别加成倍率，如 { "趁热心动蛋挞": 1.25 }
}

export interface PlanningRules {
  timeSlots: string[];
  restockLeadTime: { hot: string; cold: string };
  reductionLeadTime: { hot: string; cold: string };
  topPriorityRestock: boolean;
  breakStockThresholds: Record<string, string>;
  fixedShipmentSchedule: Record<string, string[]>;
}

// ========== Forecast Types ==========
export interface MonthlyTarget {
  month: number;
  year: number;
  coefficient: number;
  baseRevenue: number;
  enhancedRevenue: number;
}

export interface DailyTarget {
  date: string; // YYYY-MM-DD
  dayOfWeek: number;
  dayType: "mondayToThursday" | "friday" | "weekend";
  weight: number;
  revenue: number;
  shipmentAmount: number;
}

export interface ProductSuggestion {
  productName: string;
  price: number;
  packMultiple: number;
  unitType: "batch" | "individual";
  baselineQuantity: number;
  suggestedQuantity: number;
  roundedQuantity: number;
  totalAmount: number;
  positioning: string;
  coldHot: string;
  displayFullQuantity: number;
  adjustedQuantity?: number;
  adjustReason?: string;
}

export interface TimeSlotSuggestion {
  productName: string;
  timeSlot: string;
  quantity: number;
  amount: number;
}

// ========== Timeslot Sales Data Types ==========
export interface TimeslotSalesRecord {
  productName: string;
  dayType: "mondayToThursday" | "friday" | "weekend";
  timeSlot: string;
  avgQuantity: number;
  sampleCount: number;
}

export interface AITimeSlotSuggestion {
  productName: string;
  timeSlot: string;
  quantity: number;
  amount: number;
  reason: string;
}

export interface AITimeSlotResult {
  suggestions: AITimeSlotSuggestion[];
  analysis: string;
  adopted: boolean;
}

export interface ForecastRun {
  id: string;
  month: number;
  year: number;
  createdAt: string;
  monthlyTargets: MonthlyTarget[];
  dailyTargets: DailyTarget[];
  productSuggestions: Record<string, ProductSuggestion[]>; // keyed by date
  timeSlotSuggestions: Record<string, TimeSlotSuggestion[]>; // keyed by date
}

// ========== Manual Adjustment Types ==========
export interface ManualAdjustment {
  id: string;
  targetType: "daily" | "product" | "timeSlot";
  targetDate: string;
  productName?: string;
  timeSlot?: string;
  fieldName: string;
  originalValue: number;
  adjustedValue: number;
  reason: string;
  adjustedBy: string;
  adjustedAt: string;
}

// ========== Import Result Types ==========
export interface ImportResult {
  success: boolean;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  errors: string[];
  unmatchedProducts?: string[];
}

// ========== Planning Case Types ==========
export interface PlanningCaseItem {
  productName: string;
  price: number;
  packMultiple: number;
  totalQuantity: number;
  coldHot: string;
  timeSlotQuantities: Record<string, number>;
  restockNote: string;
  reductionTime: string;
}

export interface PlanningCase {
  date: string;
  dayType: string;
  estimatedRevenue: number;
  customerCount: number;
  averageSpend: number;
  items: PlanningCaseItem[];
}

// ========== App State ==========
export interface AppData {
  products: Product[];
  strategies: ProductStrategy[];
  salesData: DailySalesRecord[];
  salesBaselines: ProductSalesBaseline[];
  planningCases: PlanningCase[];
  forecastRun: ForecastRun | null;
  adjustments: ManualAdjustment[];
}

// ========== Holiday Types ==========
export interface Holiday {
  id?: number;
  date: string;            // YYYY-MM-DD
  name: string;            // 节日名称
  type: "public_holiday" | "festival" | "promotion" | "ramadan" | "other";
  coefficient?: number | null;    // 建议系数（可选，由AI动态判断）
  note: string;            // 备注
}

// ========== AI Correction Types ==========
export interface DailyAICorrection {
  date: string;
  aiCoefficient: number;     // AI建议系数
  aiRevenue: number;         // AI修正后营业额
  aiShipmentAmount: number;  // AI修正后出货金额
  reason: string;            // 修正原因
  adopted: boolean;          // 是否采用
}

export interface AIProductCorrection {
  productName: string;
  suggestedQuantity: number;
  reason: string;
}
