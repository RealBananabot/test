from openai import OpenAI

def translate_content(text, api_key):
	prompt = f"""
	请将下面的算法题目翻译成中文，数学公式和包裹公式的符号按原样保留。

	题目内容：
	{text}
	"""

	client = OpenAI(
		api_key = api_key, 
		base_url = "https://api.deepseek.com")

	try:
		response = client.chat.completions.create(
			model="deepseek-chat",
			messages=[
				{"role": "user", "content": prompt},
			],
			stream=False,
		)
	except Exception as e:
		print(f"translate error: {e}")
		return None
	return response.choices[0].message.content

def translate_content_stream(text, api_key):
	prompt = f"请将下面的算法题目翻译成中文,数学公式和包裹公式的符号按原样保留。\n\n题目内容：\n{text}"

	client = OpenAI(
		api_key = api_key, 
		base_url = "https://api.deepseek.com"
	)

	try:
		# 1. 开启 stream=True
		response = client.chat.completions.create(
			model="deepseek-chat",
			messages=[{"role": "user", "content": prompt}],
			stream=True, 
		)

		# 2. 迭代流式响应
		for chunk in response:
			if chunk.choices[0].delta.content:
				content = chunk.choices[0].delta.content
				yield content  # 逐块返回文本
				
	except Exception as e:
		yield f"\nTranslate Error：{str(e)}"

def get_ai_stream(text, api_key):
    client = OpenAI(
        api_key=api_key, 
        base_url="https://api.deepseek.com"
    )

    prompt = f"请将下面的算法题目翻译成中文,数学公式和包裹公式的符号按原样保留。\n\n题目内容：\n{text}"

    try:
        # 1. 开启 stream=True
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[{"role": "user", "content": prompt}],
            stream=True, 
        )

        # 2. 迭代流式响应
        for chunk in response:
            if chunk.choices[0].delta.content:
                content = chunk.choices[0].delta.content
                yield content  # 逐块返回文本
                
    except Exception as e:
        yield f"\n【翻译出错】：{str(e)}"