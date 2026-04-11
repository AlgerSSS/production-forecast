"use client";

import { useState, useCallback } from "react";
import { useForecastContext } from "@/components/providers/forecast-provider";
import {
  saveOutOfStockRecords, deleteOutOfStockByDate, adoptDailyReview, upsertDailyRevenue,
} from "@/lib/actions";
import { parseStockoutLine, calculateLossSlots, calculateStockoutLoss } from "@/lib/engine/forecast-engine";
import type { OutOfStockRecord, DailyReviewResult } from "@/lib/types";
import dayjs from "dayjs";

export function useReview() {
  const { state } = useForecastContext();
  const [reviewDate, setReviewDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [reviewActualRevenue, setReviewActualRevenue] = useState("");
  const [stockoutText, setStockoutText] = useState("");
  const [parsedStockouts, setParsedStockouts] = useState<OutOfStockRecord[]>([]);
  const [reviewResult, setReviewResult] = useState<DailyReviewResult | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  const handleStockoutTextChange = useCallback((text: string) => {
    setStockoutText(text);
    const lines = text.split("\n").filter(Boolean);
    const dow = new Date(reviewDate).getDay();
    const realDayType: OutOfStockRecord["dayType"] = (dow === 0 || dow === 6) ? "weekend" : dow === 5 ? "friday" : "mondayToThursday";
    const parsed = lines.map((line) => {
      const result = parseStockoutLine(line);
      if (!result) return null;
      const lossSlots = calculateLossSlots(result.soldoutTime);
      const soldoutSlot = `${result.soldoutTime.split(":")[0]}:00`;
      return { productName: result.inputName, inputName: result.inputName, soldoutTime: result.soldoutTime, soldoutSlot, date: reviewDate, lossSlots, dayType: realDayType, estimatedLossQty: 0, estimatedLossAmount: 0 } satisfies OutOfStockRecord;
    }).filter((x): x is OutOfStockRecord => x !== null);
    setParsedStockouts(parsed);
  }, [reviewDate]);

  const submitReview = useCallback(async (showToast: (msg: string, type: "success" | "error" | "info") => void) => {
    setReviewLoading(true);
    try {
      if (parsedStockouts.length > 0) {
        const enriched = parsedStockouts.map((s) => {
          const product = state.products.find((p) => p.name === s.productName);
          const price = product?.price || 0;
          const history = state.timeslotSalesRecords || [];
          const { lossQty, lossAmount } = calculateStockoutLoss(s, history, price);
          return { ...s, date: reviewDate, estimatedLossQty: lossQty, estimatedLossAmount: lossAmount };
        });
        await deleteOutOfStockByDate(reviewDate);
        await saveOutOfStockRecords(enriched);
      }
      const actualRevenue = Number(reviewActualRevenue) || 0;
      if (actualRevenue > 0) {
        await upsertDailyRevenue(reviewDate, actualRevenue);
      }
      const res = await fetch("/api/daily-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedData: { date: reviewDate, actualRevenue, stockoutRecords: parsedStockouts } }),
      });
      const data = await res.json();
      if (res.ok) { setReviewResult(data); showToast("AI 复盘完成", "success"); }
      else showToast(data.error || "复盘失败", "error");
    } catch (err) { showToast(String(err), "error"); }
    finally { setReviewLoading(false); }
  }, [parsedStockouts, state.products, state.timeslotSalesRecords, reviewDate, reviewActualRevenue]);

  const adoptReview = useCallback(async (showToast: (msg: string, type: "success" | "error" | "info") => void) => {
    if (!reviewResult) return;
    await adoptDailyReview(reviewDate);
    setReviewResult({ ...reviewResult, adopted: true });
    showToast("已采纳复盘建议", "success");
  }, [reviewResult, reviewDate]);

  return {
    reviewDate, setReviewDate, reviewActualRevenue, setReviewActualRevenue,
    stockoutText, handleStockoutTextChange, parsedStockouts,
    reviewResult, reviewLoading, submitReview, adoptReview,
  };
}
