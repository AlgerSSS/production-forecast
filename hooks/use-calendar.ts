"use client";

import { useState, useEffect, useCallback } from "react";
import { getContextEvents, addContextEvent, deleteContextEvent } from "@/lib/actions";
import type { ContextEvent } from "@/lib/types";
import dayjs from "dayjs";

export function useCalendar() {
  const [calendarMonth, setCalendarMonth] = useState(dayjs().month());
  const [calendarYear, setCalendarYear] = useState(dayjs().year());
  const [calendarEvents, setCalendarEvents] = useState<ContextEvent[]>([]);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState("");
  const [newEventTag, setNewEventTag] = useState("");
  const [newEventType, setNewEventType] = useState<ContextEvent["eventType"]>("other");
  const [newEventDesc, setNewEventDesc] = useState("");

  const loadEvents = useCallback(async () => {
    const start = `${calendarYear}-${String(calendarMonth + 1).padStart(2, "0")}-01`;
    const end = dayjs().year(calendarYear).month(calendarMonth).endOf("month").format("YYYY-MM-DD");
    const events = await getContextEvents(undefined, start, end);
    setCalendarEvents(events);
  }, [calendarYear, calendarMonth]);

  useEffect(() => { loadEvents().catch(() => {}); }, [loadEvents]);

  const navigateMonth = useCallback((delta: number) => {
    const d = dayjs().year(calendarYear).month(calendarMonth).add(delta, "month");
    setCalendarYear(d.year());
    setCalendarMonth(d.month());
  }, [calendarYear, calendarMonth]);

  const handleAddEvent = useCallback(async (showToast: (msg: string, type: "success" | "error" | "info") => void) => {
    if (!newEventTag || !selectedCalendarDate) return;
    await addContextEvent({ date: selectedCalendarDate, eventTag: newEventTag, eventType: newEventType, description: newEventDesc, impactProducts: "", createdBy: "user" });
    await loadEvents();
    setNewEventTag(""); setNewEventDesc("");
    showToast("事件已添加", "success");
  }, [newEventTag, newEventType, newEventDesc, selectedCalendarDate, loadEvents]);

  const handleDeleteEvent = useCallback(async (id: number, showToast: (msg: string, type: "success" | "error" | "info") => void) => {
    await deleteContextEvent(id);
    setCalendarEvents((prev) => prev.filter((x) => x.id !== id));
    showToast("已删除", "info");
  }, []);

  return {
    calendarMonth, calendarYear, calendarEvents, selectedCalendarDate,
    setSelectedCalendarDate, navigateMonth,
    newEventTag, setNewEventTag, newEventType, setNewEventType, newEventDesc, setNewEventDesc,
    handleAddEvent, handleDeleteEvent,
  };
}
