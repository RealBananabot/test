// ==UserScript==
// @name         AtCoder 题目翻译 (直连 DeepSeek 版)
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  支持 Markdown 和数学公式渲染，直接调用 DeepSeek API 进行流式翻译
// @author       banana, gemini
// @match        https://atcoder.jp/contests/*/tasks/*
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      api.deepseek.com
// @require      https://cdn.jsdelivr.net/npm/markdown-it@13.0.1/dist/markdown-it.min.js
// @require      https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js
// @require      https://cdn.jsdelivr.net/npm/markdown-it-texmath@1.0.0/texmath.min.js
// @resource     katexCSS https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css
// @resource     texmathCSS https://cdn.jsdelivr.net/npm/markdown-it-texmath@1.0.0/css/texmath.min.css
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // 1. API Key 管理逻辑
    // ==========================================
    let apiKey = GM_getValue('deepseek_api_key', '');

    // 如果没有配置过 API Key，提示输入
    if (!apiKey) {
        apiKey = prompt('首次使用翻译功能，请输入您的 DeepSeek API Key:\n(获取地址: platform.deepseek.com)');
        if (apiKey) {
            GM_setValue('deepseek_api_key', apiKey.trim());
        } else {
            alert('未配置 API Key，AI 翻译功能将无法运行。');
            return;
        }
    }

    // 在油猴菜单中注册重置 API Key 的选项
    GM_registerMenuCommand('⚙️ 设置/更换 DeepSeek API Key', () => {
        const newKey = prompt('请输入新的 DeepSeek API Key:', apiKey);
        if (newKey !== null && newKey.trim() !== '') {
            GM_setValue('deepseek_api_key', newKey.trim());
            apiKey = newKey.trim();
            alert('API Key 更新成功，刷新页面生效！');
        }
    });

    // ==========================================
    // 2. 提取题目内容
    // ==========================================
    function extractProblemStatement() {
        const problemTitle = document.title;
        const enPart = document.querySelector('.lang-en');
        if (!enPart) return "";

        const sections = enPart.querySelectorAll('section');
        let targetSection = null;

        for (const section of sections) {
            const h3 = section.querySelector('h3');
            if (h3 && h3.textContent.includes('Problem Statement')) {
                targetSection = section.cloneNode(true);
                break;
            }
        }

        if (!targetSection) {
            const statementHtml = document.querySelector('#task-statement');
            if(statementHtml) targetSection = statementHtml.cloneNode(true);
            else return "";
        }

        const varTags = targetSection.querySelectorAll('var');
        varTags.forEach(varTag => {
            const text = varTag.textContent;
            varTag.replaceWith('$' + text + '$');
        });

        const statementHtml = targetSection.innerHTML;
        return `## ${problemTitle}\n\n${statementHtml}\n\n`;
    }

    const extractedContent = extractProblemStatement();
    if(!extractedContent) return;

    // ==========================================
    // 3. 初始化 Markdown 渲染和 UI
    // ==========================================
    let katexCss = GM_getResourceText("katexCSS");
    let texmathCss = GM_getResourceText("texmathCSS");
    katexCss = katexCss.replace(/url\((['"]?)fonts\//g, "url($1https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/");

    GM_addStyle(katexCss);
    GM_addStyle(texmathCss);
    GM_addStyle(`
        #my-custom-latex-panel .katex { color: #98c379 !important; }
        .ai-translation-box { background: #fdfdfd; padding: 20px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 30px; line-height: 1.6; }
    `);

    const md = markdownit({ html: true }).use(texmath, { engine: katex, delimiters: 'dollars' });

    const container = document.createElement('div');
    container.className = 'ai-translation-box';
    container.innerHTML = '正在连接 DeepSeek API...';

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
            if (mainNode) mainNode.prepend(container);
        }
    }

    insertContainer();

    // ==========================================
    // 4. 直连 DeepSeek 发起流式请求
    // ==========================================
    async function fetchTranslationStream() {
        const promptText = `请将下面的算法题目翻译成中文，把 HTML 格式正确转换为 markdown 格式，数学公式和包裹公式的符号按原样保留。\n\n题目内容：\n${extractedContent}`;

        try {
            const response = await fetch('https://api.deepseek.com/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: [{ role: 'user', content: promptText }],
                    stream: true // 开启流式输出
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                container.innerHTML = `<span style="color:red">API 请求失败: ${response.status}</span><br><pre>${errText}</pre><br>可能是 API Key 错误或欠费，请检查，可在 TamperMonkey 菜单修改你的 Key。`;
                return;
            }

            // 解析 SSE (Server-Sent Events) 数据流
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let mdContent = '';
            let buffer = '';

            container.innerHTML = 'AI 思考中...';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                // 解码当前的数据块并加入缓冲区
                buffer += decoder.decode(value, { stream: true });

                // SSE 格式按 \n 分割，处理完整的一行
                const lines = buffer.split('\n');
                buffer = lines.pop(); // 最后一行可能是不完整的，保留在 buffer 中

                for (const line of lines) {
                    if (line.trim() === '') continue;
                    if (line.startsWith('data: ')) {
                        const dataStr = line.slice(6);

                        // 判断流是否结束
                        if (dataStr === '[DONE]') break;

                        try {
                            const data = JSON.parse(dataStr);
                            const deltaContent = data.choices[0]?.delta?.content;
                            if (deltaContent) {
                                mdContent += deltaContent;
                                // 实时渲染 Markdown
                                container.innerHTML = md.render(mdContent);
                            }
                        } catch (e) {
                            console.error('JSON 解析错误:', e, line);
                        }
                    }
                }
            }

            console.log("翻译完成");

        } catch (err) {
            console.error(err);
            container.innerHTML = `<span style="color:red">请求异常: ${err.message}</span>`;
        }
    }

    fetchTranslationStream();
})();