// ==UserScript==
// @name         AtCoder 题目翻译
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  支持 Markdown 和数学公式渲染，支持前端直接提取页面内容
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
    // ... Markdown 渲染器初始化、容器创建等代码保持不变 ...

    // 🌟🌟🌟 新增：仿造 Python 后端的精确提取逻辑 🌟🌟🌟
    function extractProblemStatement() {
        // 1. 获取网页标题
        const problemTitle = document.title;

        // 2. 找到英文部分
        const enPart = document.querySelector('.lang-en');
        if (!enPart) return "";

        // 3. 找到所有的 section
        const sections = enPart.querySelectorAll('section');
        let targetSection = null;

        for (const section of sections) {
            const h3 = section.querySelector('h3');
            if (h3 && h3.textContent.includes('Problem Statement')) {
                // 【核心技巧】：克隆这个 section，这样我们对它的修改就不会影响页面的显示
                targetSection = section.cloneNode(true);
                break;
            }
        }

        if (!targetSection) {
            // 如果没找到 Problem Statement（有的古老题目格式不同），退化为提取整个 task-statement
            targetSection = document.querySelector('#task-statement').cloneNode(true);
        }

        // 4. 将克隆体里所有的 <var> 替换为 $...$
        const varTags = targetSection.querySelectorAll('var');
        varTags.forEach(varTag => {
            const text = varTag.textContent;
            // 用纯文本节点替换原本的 <var> 标签
            varTag.replaceWith('$' + text + '$');
        });

        // 5. 获取处理后的精简 HTML 源码
        // 注意：大模型（如 DeepSeek）原生具备极强的 HTML 阅读能力，
        // 你直接把这段精简后的 HTML 发给它，并在 Prompt 中要求“输出 Markdown”，
        // 它的效果等同于甚至好于你用 Python 的 html2text。
        const statementHtml = targetSection.innerHTML;

        // 拼接最终要传给后端的内容
        const finalContent = `## ${problemTitle}\n\n${statementHtml}\n\n`;
        return finalContent;
    }
    // 调用提取函数，获取精简后的内容
    const extractedContent = extractProblemStatement();

    // 1. 获取 CSS 文本
    let katexCss = GM_getResourceText("katexCSS");
    let texmathCss = GM_getResourceText("texmathCSS");

    // 2. 绕过路径限制
    katexCss = katexCss.replace(/url\((['"]?)fonts\//g, "url($1https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/");

    // 3. 注入样式
    GM_addStyle(katexCss);
    GM_addStyle(texmathCss);
    GM_addStyle(`
        #my-custom-latex-panel .katex {
            color: #98c379 !important;
        }
    `);

    const md = markdownit({ html: true }).use(texmath, {
        engine: katex,
        delimiters: 'dollars' 
    });

    const pathParts = window.location.pathname.split('/');
    const contestId = pathParts[2];
    const taskId = pathParts[4];

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

    // 插入逻辑
    function insertContainer() {
        const headers = document.querySelectorAll('#task-statement h3');
        let targetElement = null;

        for (const h3 of headers) {
            if (h3.textContent.includes('Constraints')) {
                targetElement = h3.closest('.part') || h3.closest('section') || h3;
                break;
            }
        }

        if (targetElement) {
            targetElement.parentNode.insertBefore(container, targetElement);
        } else {
            const mainNode = document.querySelector('#task-statement span.lang-en') || document.querySelector('#task-statement');
            if (mainNode) {
                mainNode.prepend(container);
            }
        }
    }

    insertContainer();

    const apiUrl = `http://127.0.0.1:8000/get_translation`;

    async function fetchTranslationStream() {
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contest_id: contestId,
                    task_id: taskId,
                    content: extractedContent // 🌟 将精简提取的内容发给后端
                })
            });
            
            if (!response.ok) {
                container.innerHTML = `请求失败: ${response.status}`;
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let mdContent = '';

            container.innerHTML = 'AI 思考中...';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break; 

                const chunkText = decoder.decode(value, { stream: true });
                mdContent += chunkText;
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