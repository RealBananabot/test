// ==UserScript==
// @name         AtCoder 题目翻译
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  支持 Markdown 和数学公式渲染
// @author       banana
// @match        https://atcoder.jp/contests/*/tasks/*
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @require      https://cdn.jsdelivr.net/npm/markdown-it@13.0.1/dist/markdown-it.min.js
// @require      https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js
// @require      https://cdn.jsdelivr.net/npm/markdown-it-texmath@1.0.0/texmath.min.js
// @resource     katexCSS https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css
// @resource     texmathCSS https://cdn.jsdelivr.net/npm/markdown-it-texmath@1.0.0/css/texmath.min.css
// ==/UserScript==

(function() {
    'use strict';

    // 1. 获取 CSS 文本
    let katexCss = GM_getResourceText("katexCSS");
    let texmathCss = GM_getResourceText("texmathCSS");

    // 2. 【绕过网站路径限制】将 KaTeX 的字体相对路径替换为 CDN 绝对路径
    // 原本是 url(fonts/KaTeX...) -> 替换后 url(https://cdn.../fonts/KaTeX...)
    katexCss = katexCss.replace(/url\((['"]?)fonts\//g, "url($1https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/");

    // 3. 注入样式（使用 GM_addStyle 会生成 <style> 标签，从而完美规避该网站的 CSP <link> 拦截）
    GM_addStyle(katexCss);
    GM_addStyle(texmathCss);
    // 🌟 专门定制公式的颜色
    GM_addStyle(`
        #my-custom-latex-panel .katex {
            color: #98c379 !important; /* 公式颜色（例如柔和的绿色） */
        }
    `);

	const md = markdownit({ html: true }).use(texmath, {
        engine: katex,
        delimiters: 'dollars' // 识别 $ 和 $$
    });

    const pathParts = window.location.pathname.split('/');
    const contestId = pathParts[2];
    const taskId = pathParts[4];

    // 创建容器并添加一些 CSS 样式，让它看起来更像 AtCoder 原生风格
    const container = document.createElement('div');
    container.style.cssText = `
        background: #fdfdfd;
        padding: 20px;
        border: 1px solid #ddd;
        border-radius: 4px;
        margin-bottom: 30px;
        line-height: 1.6;
    `;
    container.innerHTML = '正在获取 AI 翻译...';

	// --- 修改后的插入逻辑 ---
	function insertContainer() {
		// 1. 查找所有 h3 标签（AtCoder 的小标题通常是 h3）
		const headers = document.querySelectorAll('#task-statement h3');
		let targetElement = null;

		for (const h3 of headers) {
			// 2. 匹配包含 "Constraints" 或 "制约" 的标题
			if (h3.textContent.includes('Constraints')) {
				// 3. 找到该标题所属的最近的一个容器（通常是 section 或 div.part）
				// 这样插入能保证在整块 Constraints 之前，而不是仅仅在文字上方
				targetElement = h3.closest('.part') || h3.closest('section') || h3;
				break;
			}
		}

		if (targetElement) {
			// 在 Constraints 模块之前插入
			targetElement.parentNode.insertBefore(container, targetElement);
		} else {
			// 如果没找到 Constraints（有些题目可能没写），则回退到插入在最顶部
			const mainNode = document.querySelector('#task-statement span.lang-en') || document.querySelector('#task-statement');
			if (mainNode) {
				mainNode.prepend(container);
			}
		}
	}

	insertContainer();

    const apiUrl = `http://127.0.0.1:8000/get_translation?contest_id=${contestId}&task_id=${taskId}`;

    // 【核心修改】使用流式读取 fetch
    async function fetchTranslationStream() {
        try {
            const response = await fetch(apiUrl);
            
            if (!response.ok) {
                container.innerHTML = `请求失败: ${response.status}`;
                return;
            }

            // 获取数据流的读取器
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let mdContent = '';

            container.innerHTML = 'AI 思考中...';

            // 循环读取流数据
            while (true) {
                const { done, value } = await reader.read();
                
                // 数据读取完毕
                if (done) break; 

                // 将二进制 chunk 解码为文本
                const chunkText = decoder.decode(value, { stream: true });
                
                // 如果你的后端返回的是 OpenAI 那种 Server-Sent Events (SSE) 格式的数据（例如 data: {"text": "..."}），
                // 你需要在这里做字符串正则解析。
                // 如果后端直接返回纯文本流，这里就可以直接拼接：
                mdContent += chunkText;

                // 实时渲染：每次收到新文字都重新渲染一次完整的当前 Markdown
                container.innerHTML = md.render(mdContent);
            }
            
            console.log("流式输出完成");
            
        } catch (err) {
            console.error(err);
            container.innerHTML = '无法连接到本地服务器或请求中断。';
        }
    }

    // 执行请求
    fetchTranslationStream();
})();