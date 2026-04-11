"use client";

import { useState, useCallback } from "react";
import { useForecastContext } from "@/components/providers/forecast-provider";
import {
  getFixedShipmentSchedules, getProductAliases, getHolidays, getBusinessRulesFromDB,
  updateBusinessRule, updateFixedShipmentSchedule, deleteFixedShipmentSchedule,
  updateProductAlias, deleteProductAlias, addHoliday, deleteHoliday,
  autoImportFromDataDir, getProducts, getStrategies, getSalesBaselines,
} from "@/lib/actions";
import type { Holiday } from "@/lib/types";

export function useSettings() {
  const { state, dispatch } = useForecastContext();
  const [settingsTab, setSettingsTab] = useState<"data" | "business" | "schedule" | "alias" | "holiday">("data");
  const [rulesSaving, setRulesSaving] = useState(false);
  const [holidaysList, setHolidaysList] = useState<Holiday[]>([]);
  const [newAliasKey, setNewAliasKey] = useState("");
  const [newAliasValue, setNewAliasValue] = useState("");
  const [editingScheduleProduct, setEditingScheduleProduct] = useState("");
  const [editingScheduleSlots, setEditingScheduleSlots] = useState("");
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [newHolidayName, setNewHolidayName] = useState("");
  const [newHolidayType, setNewHolidayType] = useState<Holiday["type"]>("public_holiday");
  const [newHolidayNote, setNewHolidayNote] = useState("");

  const loadRulesData = useCallback(async () => {
    const [sched, al, hols] = await Promise.all([getFixedShipmentSchedules(), getProductAliases(), getHolidays()]);
    dispatch({ type: "SET_FIXED_SCHEDULE", payload: sched });
    dispatch({ type: "SET_ALIASES", payload: al });
    setHolidaysList(hols);
  }, [dispatch]);

  const handleSaveBusinessRule = useCallback(async (key: string, value: unknown) => {
    setRulesSaving(true);
    try {
      await updateBusinessRule(key, value);
      const rules = await getBusinessRulesFromDB();
      dispatch({ type: "SET_BUSINESS_RULES", payload: rules });
      if (rules.monthlyCoefficients && Object.keys(rules.monthlyCoefficients).length > 0) {
        dispatch({ type: "SET_MONTHLY_COEFFICIENTS", payload: rules.monthlyCoefficients });
      }
    } finally { setRulesSaving(false); }
  }, [dispatch]);

  const handleSaveAlias = useCallback(async () => {
    if (!newAliasKey || !newAliasValue) return;
    setRulesSaving(true);
    try {
      await updateProductAlias(newAliasKey, newAliasValue);
      dispatch({ type: "SET_ALIASES", payload: { ...state.aliases, [newAliasKey]: newAliasValue } });
      setNewAliasKey(""); setNewAliasValue("");
    } finally { setRulesSaving(false); }
  }, [newAliasKey, newAliasValue, state.aliases, dispatch]);

  const handleDeleteAlias = useCallback(async (alias: string) => {
    setRulesSaving(true);
    try {
      await deleteProductAlias(alias);
      const next = { ...state.aliases }; delete next[alias];
      dispatch({ type: "SET_ALIASES", payload: next });
    } finally { setRulesSaving(false); }
  }, [state.aliases, dispatch]);

  const handleSaveSchedule = useCallback(async () => {
    if (!editingScheduleProduct) return;
    setRulesSaving(true);
    try {
      const slots = editingScheduleSlots.split(",").map((s) => s.trim()).filter(Boolean);
      if (slots.length === 0) {
        await deleteFixedShipmentSchedule(editingScheduleProduct);
        const next = { ...state.fixedSchedule }; delete next[editingScheduleProduct];
        dispatch({ type: "SET_FIXED_SCHEDULE", payload: next });
      } else {
        await updateFixedShipmentSchedule(editingScheduleProduct, slots);
        dispatch({ type: "SET_FIXED_SCHEDULE", payload: { ...state.fixedSchedule, [editingScheduleProduct]: slots } });
      }
      setEditingScheduleProduct(""); setEditingScheduleSlots("");
    } finally { setRulesSaving(false); }
  }, [editingScheduleProduct, editingScheduleSlots, state.fixedSchedule, dispatch]);

  const handleAddHoliday = useCallback(async () => {
    if (!newHolidayDate || !newHolidayName) return;
    setRulesSaving(true);
    try {
      await addHoliday({ date: newHolidayDate, name: newHolidayName, type: newHolidayType, note: newHolidayNote });
      const updated = await getHolidays();
      setHolidaysList(updated);
      setNewHolidayDate(""); setNewHolidayName(""); setNewHolidayType("public_holiday"); setNewHolidayNote("");
    } finally { setRulesSaving(false); }
  }, [newHolidayDate, newHolidayName, newHolidayType, newHolidayNote]);

  const handleDeleteHoliday = useCallback(async (id: number) => {
    setRulesSaving(true);
    try { await deleteHoliday(id); setHolidaysList((prev) => prev.filter((h) => h.id !== id)); }
    finally { setRulesSaving(false); }
  }, []);

  const handleAutoImport = useCallback(async () => {
    dispatch({ type: "SET_LOADING", payload: true });
    try {
      const result = await autoImportFromDataDir();
      dispatch({ type: "SET_IMPORT_STATUS", payload: result });
      const [prods, strats, bls, sched, rules, al] = await Promise.all([
        getProducts(), getStrategies(), getSalesBaselines(),
        getFixedShipmentSchedules(), getBusinessRulesFromDB(), getProductAliases(),
      ]);
      dispatch({ type: "SET_CORE_DATA", payload: { products: prods, strategies: strats, baselines: bls, fixedSchedule: sched, businessRulesState: rules, aliases: al } });
      if (rules.monthlyCoefficients && Object.keys(rules.monthlyCoefficients).length > 0) {
        dispatch({ type: "SET_MONTHLY_COEFFICIENTS", payload: rules.monthlyCoefficients });
      }
    } catch (err) { console.error(err); }
    dispatch({ type: "SET_LOADING", payload: false });
  }, [dispatch]);

  return {
    settingsTab, setSettingsTab, rulesSaving, loadRulesData,
    businessRulesState: state.businessRulesState, fixedSchedule: state.fixedSchedule, aliases: state.aliases,
    handleSaveBusinessRule, handleSaveAlias, handleDeleteAlias, handleSaveSchedule,
    handleAddHoliday, handleDeleteHoliday, handleAutoImport,
    holidaysList, newAliasKey, setNewAliasKey, newAliasValue, setNewAliasValue,
    editingScheduleProduct, setEditingScheduleProduct, editingScheduleSlots, setEditingScheduleSlots,
    newHolidayDate, setNewHolidayDate, newHolidayName, setNewHolidayName,
    newHolidayType, setNewHolidayType, newHolidayNote, setNewHolidayNote,
    importStatus: state.importStatus, products: state.products, strategies: state.strategies,
    baselines: state.baselines, dataLoaded: state.dataLoaded, loading: state.loading,
  };
}
