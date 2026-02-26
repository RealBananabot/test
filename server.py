import os
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from app.scraper import download_problem
# from app.translator import translate_content
from app.translator import translate_content_stream

load_dotenv()
api_key = os.getenv("DEEPSEEK_API_KEY")

app = FastAPI()
# --- 关键：解决跨域问题 ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # 允许所有网站访问（开发环境可以这么干）
    allow_methods=["*"],
    allow_headers=["*"],
)

# @app.get("/get_translation")
# async def get_translation(contest_id: str, task_id: str):
# 	print(contest_id, task_id)
# 	print(f"received request: {task_id}")

# 	url = f"https://atcoder.jp/contests/{contest_id}/tasks/{task_id}"
# 	statement = download_problem(url)
# 	if not statement:
# 		return {"error": "scrape error"}

# 	translated_md = translate_content(statement, api_key)
# 	print(translated_md)
# 	return {
# 		"translation": translated_md
# 	}

@app.get("/get_translation")
async def get_translation(contest_id: str, task_id: str):
	print(contest_id, task_id)
	print(f"received request: {task_id}")

	url = f"https://atcoder.jp/contests/{contest_id}/tasks/{task_id}"
	statement = download_problem(url)
	if not statement:
		return {"error": "scrape error"}

	return StreamingResponse(
		translate_content_stream(statement, api_key), 
		media_type = "text/plain",
	)
