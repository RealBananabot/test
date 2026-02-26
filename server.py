import os
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel # 🌟 新增：用于解析前端传来的 JSON 数据
from dotenv import load_dotenv

# 已经不需要 import app.scraper 了
from app.translator import translate_content_stream

load_dotenv()
api_key = os.getenv("DEEPSEEK_API_KEY")

app = FastAPI()

# --- 关键：解决跨域问题 ---
# 注意：当你使用 POST + application/json 时，浏览器会先发送一个 OPTIONS "预检"请求。
# 下面的配置会自动拦截并处理预检请求，确保你的 fetch 不会被跨域拦截。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_methods=["*"],
    allow_headers=["*"],
)

# 🌟 新增：定义前端发来的请求体结构
class TranslationRequest(BaseModel):
    contest_id: str
    task_id: str
    content: str   # 这是前端抓取并传给我们的 HTML 代码

# 🌟 改为 @app.post 接收数据
@app.post("/get_translation")
async def get_translation(req: TranslationRequest):
    print(f"received POST request: {req.contest_id} - {req.task_id}")

    # 容错：如果前端没提取到内容
    if not req.content:
        return {"error": "no content provided from frontend"}

    # 直接把前端传来的网页源码丢给大模型处理（AI 会自动忽略 HTML 标签读取文字和公式）
    return StreamingResponse(
        translate_content_stream(req.content, api_key), 
        media_type = "text/plain",
    )