import dayjs from "dayjs";
import {
  BusinessRules,
  MonthlyTarget,
  DailyTarget,
  ProductSuggestion,
  ProductSalesBaseline,
  Product,
  ProductStrategy,
  DailySalesRecord,
  TimeSlotSuggestion,
  PlanningRules,
  TimeslotSalesRecord,
} from "@/lib/types";

// ========== Monthly Revenue Target ==========
export function calculateMonthlyTargets(
  rules: BusinessRules,
  year: number
): MonthlyTarget[] {
  const targets: MonthlyTarget[] = [];

  for (let month = 1; month <= 12; month++) {
    const coefficient = rules.monthlyCoefficients[String(month)] || 1;
    const baseRevenue = rules.firstMonthRevenue * coefficient;
    const enhancedRevenue =
      baseRevenue * (1 + rules.totalEnhancement);

    targets.push({
      month,
      year,
      coefficient,
      baseRevenue: Math.round(baseRevenue),
      enhancedRevenue: Math.round(enhancedRevenue),
    });
  }

  return targets;
}

// ========== Daily Target Split ==========
export function calculateDailyTargets(
  monthlyTarget: MonthlyTarget,
  rules: BusinessRules
): DailyTarget[] {
  const { year, month, enhancedRevenue } = monthlyTarget;
  const weights = rules.weekdayWeights;
  const shipmentRate = rules.shipmentFormula.shipmentRate;

  // Get all days in the month
  const daysInMonth = dayjs(`${year}-${String(month).padStart(2, "0")}-01`).daysInMonth();
  const days: { date: string; dayOfWeek: number; dayType: DailyTarget["dayType"]; weight: number }[] = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dayObj = dayjs(dateStr);
    const dow = dayObj.day(); // 0=Sun, 6=Sat

    let dayType: DailyTarget["dayType"];
    let weight: number;

    if (dow === 0 || dow === 6) {
      dayType = "weekend";
      weight = weights.weekend;
    } else if (dow === 5) {
      dayType = "friday";
      weight = weights.friday;
    } else {
      dayType = "mondayToThursday";
      weight = weights.mondayToThursday;
    }

    days.push({ date: dateStr, dayOfWeek: dow, dayType, weight });
  }

  // Calculate total weight
  const totalWeight = days.reduce((sum, d) => sum + d.weight, 0);

  // Distribute revenue by weight
  let distributed = 0;
  const dailyTargets: DailyTarget[] = days.map((d, index) => {
    let revenue: number;
    if (index === days.length - 1) {
      // Last day gets remainder to avoid rounding error
      revenue = enhancedRevenue - distributed;
    } else {
      revenue = Math.round((enhancedRevenue * d.weight) / totalWeight);
      distributed += revenue;
    }

    return {
      date: d.date,
      dayOfWeek: d.dayOfWeek,
      dayType: d.dayType,
      weight: d.weight,
      revenue,
      shipmentAmount: Math.round(revenue * shipmentRate),
    };
  });

  return dailyTargets;
}

// ========== Sales Baseline Calculation ==========
export function calculateSalesBaselines(
  salesRecords: DailySalesRecord[],
  products: Product[],
  baselineOverrides?: Record<string, { mondayToThursday: number; friday: number; weekend: number }>
): ProductSalesBaseline[] {
  const productNameSet = new Set(products.map((p) => p.name));

  // Group by standardName and dayType
  const groupedSales: Record<
    string,
    { mondayToThursday: number[]; friday: number[]; weekend: number[] }
  > = {};

  // First, aggregate by (standardName, date)
  const dailyAgg: Record<string, Record<string, number>> = {};

  for (const record of salesRecords) {
    const name = record.standardName;
    if (!productNameSet.has(name)) continue;

    if (!dailyAgg[name]) dailyAgg[name] = {};
    if (!dailyAgg[name][record.date]) dailyAgg[name][record.date] = 0;
    dailyAgg[name][record.date] += record.quantity;
  }

  // Then classify by day type
  for (const [name, dateSales] of Object.entries(dailyAgg)) {
    if (!groupedSales[name]) {
      groupedSales[name] = { mondayToThursday: [], friday: [], weekend: [] };
    }

    for (const [dateStr, qty] of Object.entries(dateSales)) {
      const dow = new Date(dateStr).getDay();
      if (dow === 0 || dow === 6) {
        groupedSales[name].weekend.push(qty);
      } else if (dow === 5) {
        groupedSales[name].friday.push(qty);
      } else {
        groupedSales[name].mondayToThursday.push(qty);
      }
    }
  }

  const baselines: ProductSalesBaseline[] = [];

  for (const product of products) {
    // Check if there's a baseline override for this product (e.g. new products)
    const override = baselineOverrides?.[product.name];
    if (override) {
      baselines.push({
        productName: product.name,
        avgMondayToThursday: override.mondayToThursday,
        avgFriday: override.friday,
        avgWeekend: override.weekend,
        totalSales: 0,
        dayCount: 0,
      });
      continue;
    }

    const data = groupedSales[product.name];
    if (!data) {
      baselines.push({
        productName: product.name,
        avgMondayToThursday: 0,
        avgFriday: 0,
        avgWeekend: 0,
        totalSales: 0,
        dayCount: 0,
      });
      continue;
    }

    const avg = (arr: number[]) =>
      arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

    baselines.push({
      productName: product.name,
      avgMondayToThursday: avg(data.mondayToThursday),
      avgFriday: avg(data.friday),
      avgWeekend: avg(data.weekend),
      totalSales:
        data.mondayToThursday.reduce((a, b) => a + b, 0) +
        data.friday.reduce((a, b) => a + b, 0) +
        data.weekend.reduce((a, b) => a + b, 0),
      dayCount:
        data.mondayToThursday.length + data.friday.length + data.weekend.length,
    });
  }

  return baselines;
}

// ========== Round to Pack Multiple ==========
function roundToMultiple(quantity: number, multiple: number, unitType: "batch" | "individual"): number {
  if (unitType === "individual") return Math.max(1, Math.round(quantity));
  if (multiple <= 0) return Math.max(1, Math.round(quantity));
  return Math.max(multiple, Math.ceil(quantity / multiple) * multiple);
}

// ========== Product Shipment Suggestions ==========
// Primary strategy: use timeslot sales data aggregated by dayType as baseline
// Fallback: use product_sales_baseline when no timeslot data exists
export function calculateProductSuggestions(
  dailyTarget: DailyTarget,
  products: Product[],
  baselines: ProductSalesBaseline[],
  strategies: ProductStrategy[],
  timeslotRecords?: TimeslotSalesRecord[],
  productBoosts?: Record<string, number>
): ProductSuggestion[] {
  const { shipmentAmount, dayType } = dailyTarget;

  // Strategy map
  const strategyMap = new Map<string, ProductStrategy>();
  for (const s of strategies) {
    strategyMap.set(s.productName, s);
  }

  // Baseline map (fallback)
  const baselineMap = new Map<string, ProductSalesBaseline>();
  for (const b of baselines) {
    baselineMap.set(b.productName, b);
  }

  // Primary: use timeslot records to get daily total per product for the matching dayType
  // avgQuantity is independent per slot, sum across all slots = daily total
  const timeslotBaselineMap = new Map<string, number>();
  if (timeslotRecords && timeslotRecords.length > 0) {
    for (const r of timeslotRecords) {
      if (r.dayType !== dayType) continue;
      timeslotBaselineMap.set(
        r.productName,
        (timeslotBaselineMap.get(r.productName) || 0) + r.avgQuantity
      );
    }
  }

  // Step 1: Get baseline quantity for each product based on dayType
  const suggestions: ProductSuggestion[] = [];

  // Day-type-specific boost multipliers for more precise forecasting
  const boostMultipliers: Record<string, { top: number; potentialTop: number }> = {
    mondayToThursday: { top: 1.10, potentialTop: 1.05 },
    friday: { top: 1.12, potentialTop: 1.06 },
    weekend: { top: 1.15, potentialTop: 1.08 },
  };

  // Day-type-specific minimum quantities for products with no baseline
  const minQuantityMultipliers: Record<string, { top: number; potentialTop: number; other: number }> = {
    mondayToThursday: { top: 2, potentialTop: 1, other: 1 },
    friday: { top: 2.5, potentialTop: 1.5, other: 1 },
    weekend: { top: 3, potentialTop: 2, other: 1.5 },
  };

  const boost = boostMultipliers[dayType] || boostMultipliers.mondayToThursday;
  const minQtyMult = minQuantityMultipliers[dayType] || minQuantityMultipliers.mondayToThursday;

  for (const product of products) {
    const baseline = baselineMap.get(product.name);
    const strategy = strategyMap.get(product.name);

    // Primary: use timeslot-aggregated baseline; fallback: product_sales_baseline
    let baselineQty = 0;
    const timeslotQty = timeslotBaselineMap.get(product.name);
    if (timeslotQty !== undefined && timeslotQty > 0) {
      baselineQty = Math.round(timeslotQty);
    } else if (baseline) {
      switch (dayType) {
        case "mondayToThursday":
          baselineQty = baseline.avgMondayToThursday;
          break;
        case "friday":
          baselineQty = baseline.avgFriday;
          break;
        case "weekend":
          baselineQty = baseline.avgWeekend;
          break;
      }
    }

    // Apply strategy adjustments with day-type-specific boost
    let adjustedQty = baselineQty;
    const positioning = strategy?.positioning || "其他";

    if (positioning === "TOP" && adjustedQty > 0) {
      adjustedQty = Math.round(adjustedQty * boost.top);
    } else if (positioning === "潜在TOP" && adjustedQty > 0) {
      adjustedQty = Math.round(adjustedQty * boost.potentialTop);
    }

    // Apply product-specific boost (e.g. tasting waste, sales trend)
    const productBoost = productBoosts?.[product.name];
    if (productBoost && productBoost > 0 && adjustedQty > 0) {
      adjustedQty = Math.round(adjustedQty * productBoost);
    }

    // If no baseline, estimate with day-type-specific minimums
    if (adjustedQty === 0) {
      if (positioning === "TOP") {
        adjustedQty = Math.round(product.packMultiple * minQtyMult.top);
      } else if (positioning === "潜在TOP") {
        adjustedQty = Math.round(product.packMultiple * minQtyMult.potentialTop);
      } else {
        adjustedQty = product.unitType === "individual"
          ? Math.round(5 * minQtyMult.other)
          : Math.round(product.packMultiple * minQtyMult.other);
      }
    }

    // Round to pack multiple
    const roundedQty = roundToMultiple(adjustedQty, product.packMultiple, product.unitType);

    suggestions.push({
      productName: product.name,
      price: product.price,
      packMultiple: product.packMultiple,
      unitType: product.unitType,
      baselineQuantity: baselineQty,
      suggestedQuantity: adjustedQty,
      roundedQuantity: roundedQty,
      totalAmount: Math.round(roundedQty * product.price),
      positioning,
      coldHot: strategy?.coldHot || "热",
      displayFullQuantity: product.displayFullQuantity || 0,
    });
  }

  // Step 2: Balance total amount to match target
  const totalSuggested = suggestions.reduce((sum, s) => sum + s.totalAmount, 0);
  const ratio = totalSuggested > 0 ? shipmentAmount / totalSuggested : 1;

  if (Math.abs(ratio - 1) > 0.05) {
    // Scale quantities proportionally
    for (const s of suggestions) {
      const scaledQty = Math.round(s.suggestedQuantity * ratio);
      s.suggestedQuantity = scaledQty;
      s.roundedQuantity = roundToMultiple(scaledQty, s.packMultiple, s.unitType);
      s.totalAmount = Math.round(s.roundedQuantity * s.price);
    }
  }

  // Step 3: Sort by positioning priority (TOP > 潜在TOP > 其他), then by strategy sort_order
  const positioningPriority: Record<string, number> = { "TOP": 0, "潜在TOP": 1, "其他": 2 };
  const strategyOrderMap = new Map<string, number>();
  for (const s of strategies) {
    strategyOrderMap.set(s.productName, s.sortOrder);
  }

  suggestions.sort((a, b) => {
    const pa = positioningPriority[a.positioning] ?? 2;
    const pb = positioningPriority[b.positioning] ?? 2;
    if (pa !== pb) return pa - pb;
    const oa = strategyOrderMap.get(a.productName) ?? 999;
    const ob = strategyOrderMap.get(b.productName) ?? 999;
    return oa - ob;
  });

  return suggestions;
}

// ========== Time Slot Distribution (Historical Sales Proportion) ==========
export function calculateTimeSlotSuggestions(
  productSuggestions: ProductSuggestion[],
  dailyTarget: DailyTarget,
  planningRules: PlanningRules,
  timeslotHistory?: TimeslotSalesRecord[]
): TimeSlotSuggestion[] {
  const fixedSchedule = planningRules.fixedShipmentSchedule || {};
  const { dayType } = dailyTarget;

  // Build history lookup: product -> timeSlot -> avgQuantity (filtered by dayType)
  // avgQuantity is the independent average sales for each time slot
  const historyMap = new Map<string, Map<string, number>>();
  if (timeslotHistory && timeslotHistory.length > 0) {
    for (const r of timeslotHistory) {
      if (r.dayType !== dayType) continue;
      if (!historyMap.has(r.productName)) historyMap.set(r.productName, new Map());
      historyMap.get(r.productName)!.set(r.timeSlot, r.avgQuantity);
    }
  }

  const slotSuggestions: TimeSlotSuggestion[] = [];

  for (const product of productSuggestions) {
    const productHistory = historyMap.get(product.productName);
    const multiple = product.unitType === "batch" ? product.packMultiple : 1;

    const rawQty = product.adjustedQuantity ?? product.roundedQuantity;
    // Enforce pack multiple constraint on totalQty entering timeslot distribution
    const totalQty = (multiple > 1)
      ? Math.ceil(rawQty / multiple) * multiple
      : rawQty;
    if (totalQty <= 0) continue;
    const schedule = fixedSchedule[product.productName];
    const fullQty = product.displayFullQuantity || 0;

    // Fixed schedule is the hard constraint — only these slots can receive shipments
    const targetSlots = (schedule && schedule.length > 0) ? schedule : ["11:00"];

    if (targetSlots.length === 1) {
      slotSuggestions.push({
        productName: product.productName,
        timeSlot: targetSlots[0],
        quantity: totalQty,
        amount: Math.round(totalQty * product.price),
      });
      continue;
    }

    // Step a: Distribute totalQty across ALL targetSlots by historical proportion
    const slotAvgs = new Map<string, number>();
    let hasHistory = false;
    for (const slot of targetSlots) {
      const avg = productHistory?.get(slot) || 0;
      slotAvgs.set(slot, avg);
      if (avg > 0) hasHistory = true;
    }

    let allocation: Map<string, number>;
    if (hasHistory) {
      const histTotal = Array.from(slotAvgs.values()).reduce((s, v) => s + v, 0);
      allocation = distributeByProportion(totalQty, slotAvgs, histTotal, multiple, product.unitType);
    } else {
      // No history: equal distribution
      const equalAvgs = new Map<string, number>();
      for (const slot of targetSlots) equalAvgs.set(slot, 1);
      allocation = distributeByProportion(totalQty, equalAvgs, targetSlots.length, multiple, product.unitType);
    }

    // Step b: Full-cabinet constraint — earlySum (slots <= "12:00") must >= displayFullQuantity
    const unit = (product.unitType === "batch" && multiple > 1) ? multiple : 1;
    const earlySlots = targetSlots.filter((s) => s <= "12:00");
    const lateSlots = targetSlots.filter((s) => s > "12:00");

    if (fullQty > 0 && earlySlots.length > 0 && lateSlots.length > 0) {
      const alignedFullQty = Math.ceil(fullQty / unit) * unit;
      let earlySum = earlySlots.reduce((s, slot) => s + (allocation.get(slot) || 0), 0);

      if (earlySum < alignedFullQty) {
        let deficit = alignedFullQty - earlySum;
        // Take from latest afternoon slots first
        const reversedLate = [...lateSlots].reverse();
        for (const lateSlot of reversedLate) {
          if (deficit <= 0) break;
          const lateQty = allocation.get(lateSlot) || 0;
          const take = Math.min(deficit, Math.floor(lateQty / unit) * unit);
          if (take > 0) {
            allocation.set(lateSlot, lateQty - take);
            deficit -= take;
          }
        }
        // Add deficit-covered amount to the latest early slot
        const lastEarly = earlySlots[earlySlots.length - 1];
        const covered = alignedFullQty - earlySum - deficit;
        if (covered > 0) {
          allocation.set(lastEarly, (allocation.get(lastEarly) || 0) + covered);
        }
        earlySum += covered;
      }
    }

    // Step c: Fallback — if early slots exist but all have 0, move 1 unit from afternoon
    if (earlySlots.length > 0 && lateSlots.length > 0) {
      const earlySum = earlySlots.reduce((s, slot) => s + (allocation.get(slot) || 0), 0);
      if (earlySum === 0) {
        // Find last late slot with enough to give
        for (let i = lateSlots.length - 1; i >= 0; i--) {
          const lateQty = allocation.get(lateSlots[i]) || 0;
          if (lateQty >= unit) {
            allocation.set(lateSlots[i], lateQty - unit);
            allocation.set(earlySlots[earlySlots.length - 1], unit);
            break;
          }
        }
      }
    }

    // Step d: Output all slots with qty > 0
    for (const slot of targetSlots) {
      const qty = allocation.get(slot) || 0;
      if (qty > 0) {
        slotSuggestions.push({
          productName: product.productName,
          timeSlot: slot,
          quantity: qty,
          amount: Math.round(qty * product.price),
        });
      }
    }
  }

  return slotSuggestions;
}

// Distribute totalQty across time slots by historical sales proportion
// Each slot gets quantity proportional to its avgQuantity — no front-heavy bias
// Guarantees: sum of all slot quantities === totalQty
function distributeByProportion(
  totalQty: number,
  slotAvgs: Map<string, number>,
  histTotal: number,
  multiple: number,
  unitType: "batch" | "individual"
): Map<string, number> {
  const slots = Array.from(slotAvgs.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const n = slots.length;
  const unit = (unitType === "batch" && multiple > 1) ? multiple : 1;

  const allocated = new Array(n).fill(0);

  if (histTotal > 0) {
    // Step 1: guarantee minimum unit for every slot that has historical sales
    // This ensures early slots (10:00/11:00) get at least 1 batch even if proportion is tiny
    let guaranteed = 0;
    for (let i = 0; i < n; i++) {
      if (slots[i][1] > 0 && totalQty >= guaranteed + unit) {
        allocated[i] = unit;
        guaranteed += unit;
      }
    }

    // Step 2: distribute remaining quantity by historical proportion
    const remaining = totalQty - guaranteed;
    if (remaining > 0) {
      for (let i = 0; i < n; i++) {
        const raw = (remaining * slots[i][1]) / histTotal;
        const extra = Math.floor(raw / unit) * unit;
        allocated[i] += extra;
      }

      // Step 3: distribute leftover to slots with largest rounding loss
      let leftover = totalQty - allocated.reduce((s, v) => s + v, 0);
      if (leftover > 0) {
        const losses = slots.map((s, i) => ({
          idx: i,
          loss: (remaining * s[1]) / histTotal - (allocated[i] - (slots[i][1] > 0 ? unit : 0)),
        }));
        losses.sort((a, b) => b.loss - a.loss);

        for (const { idx } of losses) {
          if (leftover <= 0) break;
          if (leftover >= unit) {
            allocated[idx] += unit;
            leftover -= unit;
          }
        }
        // Drop sub-unit remainder — never break pack multiple constraint
      }
    }
  } else {
    // No history: equal distribution
    for (let i = 0; i < n; i++) {
      allocated[i] = Math.floor(totalQty / n / unit) * unit;
    }
    let leftover = totalQty - allocated.reduce((s, v) => s + v, 0);
    for (let i = 0; i < n && leftover >= unit; i++) {
      allocated[i] += unit;
      leftover -= unit;
    }
    // Drop sub-unit remainder
  }

  const result = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    result.set(slots[i][0], Math.max(0, allocated[i]));
  }
  return result;
}
