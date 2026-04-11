"use client";

import { useForecastContext } from "@/components/providers/forecast-provider";
import { useToastContext } from "@/components/providers/toast-provider";
import { adoptDailyReview } from "@/lib/actions";
import type { PageId } from "@/constants";
import dayjs from "dayjs";

export function OverviewPage({ navigate }: { navigate: (page: PageId) => void }) {
  const { state, dispatch } = useForecastContext();
  const { showToast } = useToastContext();
  const { yesterdaySales, dailyTargets, dashboardReview, dashboardEvents } = state;

  return (
    <div className="space-y-6 animate-fade-slide-up">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-6">
          <p className="text-xs text-[#86868b] mb-1">昨日营业额</p>
          <p className="text-xl font-bold text-[#1d1d1f]">
            {yesterdaySales !== null ? (yesterdaySales > 0 ? `RM ${yesterdaySales.toLocaleString()}` : "暂无数据") : "—"}
          </p>
        </div>
        <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-6">
          <p className="text-xs text-[#86868b] mb-1">昨日达成率</p>
          <p className="text-xl font-bold text-[#1d1d1f]">{(() => {
            if (yesterdaySales === null) return "—";
            const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD");
            const yTarget = dailyTargets.find((d) => d.date === yesterday);
            if (!yTarget || !yTarget.revenue) return "暂无目标";
            const rate = ((yesterdaySales / yTarget.revenue) * 100).toFixed(1);
            return `${rate}%`;
          })()}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-6">
          <p className="text-xs text-[#86868b] mb-1">今日目标</p>
          <p className="text-xl font-bold text-[#1d1d1f]">
            {(() => { const today = dayjs().format("YYYY-MM-DD"); const todayTarget = dailyTargets.find((d) => d.date === today); return todayTarget ? `RM ${todayTarget.revenue.toLocaleString()}` : "—"; })()}
          </p>
        </div>
        <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-6">
          <p className="text-xs text-[#86868b] mb-1">今日出货</p>
          <p className="text-xl font-bold text-[#1d1d1f]">
            {(() => { const today = dayjs().format("YYYY-MM-DD"); const todayTarget = dailyTargets.find((d) => d.date === today); return todayTarget ? `RM ${todayTarget.shipmentAmount.toLocaleString()}` : "—"; })()}
          </p>
        </div>
      </div>

      {/* AI Review Summary */}
      {dashboardReview && (
        <div className="bg-[#0071e3]/10 rounded-2xl p-6">
          <h3 className="text-sm font-semibold text-[#1d1d1f] mb-3">AI 昨日复盘摘要</h3>
          <p className="text-sm text-[#1d1d1f]/80 mb-3">{dashboardReview.review?.summary || "暂无复盘数据"}</p>
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
            <button onClick={() => navigate("review")} className="text-xs text-[#86868b] hover:text-[#1d1d1f] transition-colors">查看完整复盘 →</button>
            {!dashboardReview.adopted && (
              <button onClick={async () => {
                const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD");
                await adoptDailyReview(yesterday);
                dispatch({ type: "SET_DASHBOARD_REVIEW", payload: { ...dashboardReview, adopted: true } });
                showToast("已采纳AI今日策略", "success");
              }} className="text-xs bg-[#0071e3] text-white px-3 py-1 rounded-lg font-medium hover:bg-[#0071e3]/90 transition-colors">
                采纳AI今日策略 ✓
              </button>
            )}
          </div>
        </div>
      )}

      {/* Today Events */}
      <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-6">
        <h3 className="text-sm font-semibold text-[#1d1d1f] mb-3">今日事件提醒</h3>
        {dashboardEvents.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {dashboardEvents.map((e, i) => (
              <span key={i} className="text-xs bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg">
                {e.eventTag} {e.description && `— ${e.description}`}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#86868b]">今日暂无事件</p>
        )}
        <button onClick={() => { navigate("calendar"); }} className="mt-3 text-xs text-[#86868b] hover:text-[#1d1d1f] transition-colors">+ 添加今日事件</button>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-6">
        <h3 className="text-sm font-semibold text-[#1d1d1f] mb-3">快捷操作</h3>
        <div className="flex gap-3">
          <button onClick={() => navigate("production")} className="px-4 py-2 bg-[#0071e3] text-white rounded-xl text-sm font-medium hover:bg-[#0071e3]/90 transition-colors">生成今日排产单</button>
          <button onClick={() => navigate("review")} className="px-4 py-2 bg-gray-100 text-[#1d1d1f] rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors">录入昨日数据</button>
        </div>
      </div>
    </div>
  );
}