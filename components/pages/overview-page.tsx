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
        <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#1d1d1f]">AI 昨日复盘摘要</h3>
            {dashboardReview.adopted && <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full font-medium">已采纳</span>}
          </div>
          <p className="text-sm text-[#1d1d1f]/80">{dashboardReview.review?.summary || "暂无复盘数据"}</p>

          {/* Highlights & Pain Points */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {dashboardReview.review?.highlights && dashboardReview.review.highlights.length > 0 && (
              <div className="bg-green-50/60 rounded-xl p-3">
                <p className="text-xs font-medium text-green-800 mb-2">亮点</p>
                <div className="flex flex-wrap gap-1.5">
                  {dashboardReview.review.highlights.map((h: string, i: number) => (
                    <span key={i} className="text-xs text-green-700 bg-green-100/80 px-2 py-0.5 rounded-lg">{h}</span>
                  ))}
                </div>
              </div>
            )}
            {dashboardReview.review?.painPoints && dashboardReview.review.painPoints.length > 0 && (
              <div className="bg-red-50/60 rounded-xl p-3">
                <p className="text-xs font-medium text-red-800 mb-2">待改进</p>
                <div className="flex flex-wrap gap-1.5">
                  {dashboardReview.review.painPoints.map((p: string, i: number) => (
                    <span key={i} className="text-xs text-red-700 bg-red-100/80 px-2 py-0.5 rounded-lg">{p}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Stockout Analysis */}
          {dashboardReview.review?.stockoutAnalysis && dashboardReview.review.stockoutAnalysis.length > 0 && (
            <div className="bg-amber-50/60 rounded-xl p-3">
              <p className="text-xs font-medium text-amber-800 mb-2">断货分析</p>
              <div className="space-y-1.5">
                {dashboardReview.review.stockoutAnalysis.map((s: { product: string; lossQty: number; lossAmount: number; suggestion: string }, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-amber-900 font-medium">{s.product}</span>
                    <span className="text-amber-700">损失 {s.lossQty} 个 / RM {s.lossAmount}</span>
                    <span className="text-amber-600 max-w-[40%] truncate">{s.suggestion}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timeslot Insights */}
          {dashboardReview.review?.timeslotInsights && dashboardReview.review.timeslotInsights.length > 0 && (
            <div className="bg-purple-50/60 rounded-xl p-3">
              <p className="text-xs font-medium text-purple-800 mb-2">时段洞察</p>
              <div className="space-y-1">
                {dashboardReview.review.timeslotInsights.map((t: string, i: number) => (
                  <p key={i} className="text-xs text-purple-700">{t}</p>
                ))}
              </div>
            </div>
          )}

          {/* Tomorrow Suggestions */}
          {dashboardReview.tomorrowSuggestions && (
            <div className="bg-[#0071e3]/8 rounded-xl p-3">
              <p className="text-xs font-medium text-[#0071e3] mb-2">明日排产建议</p>
              <p className="text-xs text-[#1d1d1f]/70 mb-2">{dashboardReview.tomorrowSuggestions.reason}</p>
              {dashboardReview.tomorrowSuggestions.productAdjustments && dashboardReview.tomorrowSuggestions.productAdjustments.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {dashboardReview.tomorrowSuggestions.productAdjustments.map((a: { productName: string; adjustRatio: number; reason: string }, i: number) => (
                    <span key={i} className={`text-xs px-2 py-0.5 rounded-lg ${a.adjustRatio > 1 ? "bg-green-100 text-green-700" : a.adjustRatio < 1 ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-700"}`}>
                      {a.productName} {a.adjustRatio > 1 ? "↑" : a.adjustRatio < 1 ? "↓" : "→"}{Math.round(Math.abs(a.adjustRatio - 1) * 100)}%
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button onClick={() => navigate("review")} className="text-xs text-[#86868b] hover:text-[#1d1d1f] transition-colors">查看完整复盘 →</button>
            {!dashboardReview.adopted && (
              <button onClick={async () => {
                const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD");
                await adoptDailyReview(yesterday);
                dispatch({ type: "SET_DASHBOARD_REVIEW", payload: { ...dashboardReview, adopted: true } });
                showToast("已采纳AI今日策略", "success");
              }} className="text-xs bg-[#0071e3] text-white px-3 py-1 rounded-lg font-medium hover:bg-[#0071e3]/90 transition-colors">
                采纳AI今日策略
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