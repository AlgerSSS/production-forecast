from prophet import Prophet
import pandas as pd


def predict_trend(data: dict) -> dict:
    """
    输入: {"history": [{"ds": "2026-03-01", "y": 68000, "is_payday_period": 0, "is_ramadan": 0}, ...]}
    输出: {"trend_factors": [{"date": "...", "trend_factor": 1.03, ...}, ...]}
    """
    history = data.get("history", [])
    if len(history) < 14:
        return {"trend_factors": [], "error": "需要至少14天数据"}

    df = pd.DataFrame(history)
    df["ds"] = pd.to_datetime(df["ds"])

    model = Prophet(
        yearly_seasonality=True,
        weekly_seasonality=True,
        daily_seasonality=False,
        changepoint_prior_scale=0.05,
    )

    # 添加自定义回归变量
    has_payday = "is_payday_period" in df.columns
    has_ramadan = "is_ramadan" in df.columns

    if has_payday:
        model.add_regressor("is_payday_period")
    if has_ramadan:
        model.add_regressor("is_ramadan")

    model.fit(df)

    future = model.make_future_dataframe(periods=7)

    # 填充回归变量（未来7天默认为0，调用方可传入）
    future_regressors = data.get("future_regressors", {})
    if has_payday:
        future["is_payday_period"] = future["ds"].apply(
            lambda d: future_regressors.get(d.strftime("%Y-%m-%d"), {}).get("is_payday_period", 0)
        )
    if has_ramadan:
        future["is_ramadan"] = future["ds"].apply(
            lambda d: future_regressors.get(d.strftime("%Y-%m-%d"), {}).get("is_ramadan", 0)
        )

    forecast = model.predict(future)

    baseline_mean = df["y"].mean()
    trend_factors = []
    for _, row in forecast.tail(7).iterrows():
        factor = round(row["yhat"] / baseline_mean, 3) if baseline_mean > 0 else 1.0
        trend_factors.append({
            "date": row["ds"].strftime("%Y-%m-%d"),
            "trend_factor": factor,
            "yhat": round(row["yhat"], 0),
            "yhat_lower": round(row["yhat_lower"], 0),
            "yhat_upper": round(row["yhat_upper"], 0),
            "weekly_component": round(row.get("weekly", 0), 3),
        })

    return {"trend_factors": trend_factors}
