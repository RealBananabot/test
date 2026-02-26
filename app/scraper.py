import requests
from bs4 import BeautifulSoup
import html2text

def download_problem(url):
	soup = BeautifulSoup(requests.get(url).text, 'html.parser')

	# 初始化转换器
	h = html2text.HTML2Text()
	h.ignore_links = False  # 保留链接
	h.body_width = 0        # 不要自动换行（防止破坏公式）

	full_title = soup.title.text
	problem_title = full_title

	en_part = soup.find('span', class_='lang-en')

	# 2. 找到所有的 section
	sections = en_part.find_all('section')

	statement = ""
	for section in sections:
		h3 = section.find("h3")
		if not h3:
			continue

		title = h3.text

		if "Problem Statement" in title:
			for var_tag in section.find_all("var"):
				var_tag.replace_with(f"${var_tag.get_text()}$")

			# --- 核心改进：获取 HTML 源码而非纯文本 ---
			# .decode_contents() 会获取标签内部的 HTML 字符串
			section_html = section.decode_contents()
			
			# 使用 html2text 将 HTML 转为 Markdown
			# 它会自动处理 <ul><li> 为 -，处理 <p> 为双换行
			md_content = h.handle(section_html)
			print(md_content)
			statement = md_content

	result = ""
	result += f"## {problem_title}\n\n"
	result += f"{statement}\n\n"
	return result
