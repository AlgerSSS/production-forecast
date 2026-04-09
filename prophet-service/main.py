from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from models.trend_predictor import predict_trend

app = FastAPI(title="Prophet Trend Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/predict-trend")
async def predict(data: dict):
    """
    输入：过去60天的理想营业额序列
    输出：未来7天的趋势因子
    """
    return predict_trend(data)


@app.get("/health")
async def health():
    return {"status": "ok"}
