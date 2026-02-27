// ==UserScript==
// @name         QOJ 题目翻译 (可定制 Prompt + DeepSeek 版 + 双主题 + 缓存 + 重新翻译)
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  自动解析 QOJ PDF 题目，调用 DeepSeek API 翻译。支持用户自定义 Prompt，支持 Light/Dark 模式切换。新增翻译缓存与手动重新翻译按钮。
// @author       banana, gemini
// @match        https://qoj.ac/contest/*/problem/*
// @match        https://qoj.ac/problem/*
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      api.deepseek.com
// @require      https://cdn.jsdelivr.net/npm/markdown-it@13.0.1/dist/markdown-it.min.js
// @require      https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js
// @require      https://cdn.jsdelivr.net/npm/markdown-it-texmath@1.0.0/texmath.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
// @resource     katexCSS https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css
// @resource     texmathCSS https://cdn.jsdelivr.net/npm/markdown-it-texmath@1.0.0/css/texmath.min.css
// ==/UserScript==

(async function() {
    'use strict';

    // ==========================================
    // 1. 配置管理 (API Key, Prompt & Theme)
    // ==========================================

    const DEFAULT_PROMPT = `以下内容是我从算法竞赛题目的 PDF 文件中提取出的纯文本。由于提取限制，**一些数学公式、上下标、空格和换行可能会错乱**。
你需要做的事：
1. 忽略文字中其他部分（如输入输出及其格式，以及样例），只提取题目的题目描述部分。如果题目原文有样例解释，你应该同时翻译解释部分，否则不应该主动解释样例。
2. **修复错乱的数学变量和公式**，重新使用标准的 LaTeX 语法（用 $ 符号包裹）表示。
3. 将题目准确地翻译成中文，不要改写题目内容，不要解决或者分析问题，只给出题目的翻译，不要输出其他任何内容。`;

    let apiKey = GM_getValue('deepseek_api_key', '');
    let customPrompt = GM_getValue('deepseek_custom_prompt', DEFAULT_PROMPT);
    let currentTheme = GM_getValue('deepseek_theme', 'dark'); // 默认暗色模式

    // 检查 API Key
    if (!apiKey) {
        apiKey = prompt('首次使用，请输入您的 DeepSeek API Key:');
        if (apiKey) GM_setValue('deepseek_api_key', apiKey.trim());
    }

    // 注册油猴菜单
    GM_registerMenuCommand('⚙️ 设置/更换 DeepSeek API Key', () => {
        const newKey = prompt('请输入新的 DeepSeek API Key:', apiKey);
        if (newKey) {
            GM_setValue('deepseek_api_key', newKey.trim());
            location.reload();
        }
    });

    GM_registerMenuCommand('📝 设置/自定义 Translation Prompt', () => {
        const newPrompt = prompt('请输入您的自定义翻译 Prompt (原文本会自动拼接在此 Prompt 之后):', customPrompt);
        if (newPrompt !== null) {
            GM_setValue('deepseek_custom_prompt', newPrompt.trim() || DEFAULT_PROMPT);
            alert('Prompt 已更新，下次翻译将生效！\n（提示：Prompt 改了之后缓存 key 也会变化，不会误用旧缓存）');
            location.reload();
        }
    });

    GM_registerMenuCommand('🌗 切换主题 (Light / Dark)', () => {
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        GM_setValue('deepseek_theme', newTheme);
        alert(`已切换为 ${newTheme === 'dark' ? '黑暗 (Dark)' : '明亮 (Light)'} 模式！`);
        location.reload();
    });

    // ==========================================
    // 2. UI 渲染准备 (双主题 CSS)
    // ==========================================
    let katexCss = GM_getResourceText("katexCSS");
    let texmathCss = GM_getResourceText("texmathCSS");
    katexCss = katexCss.replace(/url\((['"]?)fonts\//g, "url($1https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/");
    GM_addStyle(katexCss);
    GM_addStyle(texmathCss);

    // 注入支持双主题的 CSS 变量 + 工具栏/按钮样式
    GM_addStyle(`
        /* 黑暗模式变量 */
        .ai-translation-box.theme-dark {
            --bg-color: #2b2b2b;
            --text-color: #d3d3d3;
            --border-color: #444;
            --heading-color: #fff;
            --katex-color: #98c379;
            --pre-bg: #1e1e1e;
            --pre-border: #333;
            --status-color: #aaa;

            --btn-bg: #3a3a3a;
            --btn-bg-hover: #4a4a4a;
            --btn-border: #555;
            --btn-text: #e5e5e5;
            --btn-disabled: #2f2f2f;
        }
        /* 明亮模式变量 */
        .ai-translation-box.theme-light {
            --bg-color: #ffffff;
            --text-color: #333333;
            --border-color: #e1e4e8;
            --heading-color: #000000;
            --katex-color: #005cc5;
            --pre-bg: #f6f8fa;
            --pre-border: #d1d5da;
            --status-color: #666666;

            --btn-bg: #f6f8fa;
            --btn-bg-hover: #eceff3;
            --btn-border: #d1d5da;
            --btn-text: #24292e;
            --btn-disabled: #f0f2f4;
        }

        /* 翻译框基础样式 */
        .ai-translation-box {
            background: var(--bg-color);
            color: var(--text-color);
            padding: 20px;
            border: 1px solid var(--border-color);
            border-radius: 6px;
            margin-bottom: 20px;
            line-height: 1.6;
            font-size: 15px;
            transition: background 0.3s, color 0.3s;
        }
        .ai-translation-box h1, .ai-translation-box h2, .ai-translation-box h3 {
            color: var(--heading-color);
            margin-top: 15px;
            margin-bottom: 10px;
        }
        .ai-translation-box .katex {
            color: var(--katex-color) !important;
            font-size: 1.1em;
        }
        .ai-translation-box pre {
            background: var(--pre-bg);
            padding: 12px;
            border-radius: 4px;
            border: 1px solid var(--pre-border);
            overflow-x: auto;
        }

        .ai-toolbar {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 10px;
        }
        .ai-status-msg {
            font-style: italic;
            color: var(--status-color);
            flex: 1;
            min-width: 0;
        }

        .ai-btn {
            cursor: pointer;
            user-select: none;
            background: var(--btn-bg);
            color: var(--btn-text);
            border: 1px solid var(--btn-border);
            border-radius: 6px;
            padding: 6px 10px;
            font-size: 13px;
            transition: background 0.2s;
            white-space: nowrap;
        }
        .ai-btn:hover { background: var(--btn-bg-hover); }
        .ai-btn:disabled {
            cursor: not-allowed;
            opacity: 0.75;
            background: var(--btn-disabled);
        }

        .ai-error { color: #ff6b6b; }
    `);

    const md = markdownit({ html: true }).use(texmath, { engine: katex, delimiters: 'dollars' });

    const iframe = document.querySelector('iframe#statements-pdf');
    if (!iframe) return;

    // 结构化容器：toolbar + content，避免渲染时把按钮刷掉
    const container = document.createElement('div');
    container.className = `ai-translation-box theme-${currentTheme}`;
    container.innerHTML = `
        <div class="ai-toolbar">
            <button type="button" class="ai-btn ai-retranslate">🔄 重新翻译</button>
            <div class="ai-status-msg">正在准备 PDF 解析引擎...</div>
        </div>
        <div class="ai-content"></div>
    `;
    iframe.parentNode.insertBefore(container, iframe);

    const statusEl = container.querySelector('.ai-status-msg');
    const contentEl = container.querySelector('.ai-content');
    const retranslateBtn = container.querySelector('.ai-retranslate');

    // ==========================================
    // 2.5 缓存工具 (新增)
    // ==========================================
    const CACHE_PREFIX = 'deepseek_translation_cache_v1';

    function djb2Hash(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) + h) + str.charCodeAt(i); // h*33 + c
            h >>>= 0;
        }
        return h.toString(16);
    }

    function normalizeUrlForCache(u) {
        try {
            const url = new URL(u, location.href);
            return `${url.origin}${url.pathname}`; // 去掉 query/hash，提升命中稳定性
        } catch {
            return String(u || '');
        }
    }

    function buildCacheKey() {
        const pageId = `${location.origin}${location.pathname}`;
        const pdfId = normalizeUrlForCache(iframe.src);
        const raw = `${pageId}|${pdfId}|${customPrompt}`;
        return `${CACHE_PREFIX}:${djb2Hash(raw)}`;
    }

    function loadCache(cacheKey) {
        const cached = GM_getValue(cacheKey, null);
        if (!cached || typeof cached !== 'object') return null;
        if (!cached.mdContent || typeof cached.mdContent !== 'string') return null;
        return cached;
    }

    function saveCache(cacheKey, mdContent) {
        GM_setValue(cacheKey, {
            mdContent,
            savedAt: Date.now(),
            page: `${location.origin}${location.pathname}`,
            pdf: normalizeUrlForCache(iframe.src),
            promptHash: djb2Hash(customPrompt)
        });
    }

    // ==========================================
    // 3. PDF 解析核心
    // ==========================================
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    async function extractTextFromPDF(url, fetchSignal) {
        statusEl.textContent = '正在抓取 PDF 原始数据...';
        const response = await fetch(url, { signal: fetchSignal });
        const arrayBuffer = await response.arrayBuffer();
        const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;

        let fullText = '';
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            statusEl.textContent = `正在解析 PDF 文本 (第 ${pageNum}/${pdf.numPages} 页)...`;
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            let lastY = -1;
            for (const item of textContent.items) {
                if (lastY !== -1 && Math.abs(item.transform[5] - lastY) > 5) fullText += '\n';
                fullText += item.str;
                lastY = item.transform[5];
            }
            fullText += '\n\n';
        }
        return fullText;
    }

    // ==========================================
    // 4. 发送翻译请求 + 缓存逻辑 (新增)
    // ==========================================
    let translating = false;
    let currentAbortController = null;

    async function startTranslation({ force = false } = {}) {
        const cacheKey = buildCacheKey();

        // 1) 非强制模式：优先读缓存
        if (!force) {
            const cached = loadCache(cacheKey);
            if (cached) {
                const dt = new Date(cached.savedAt);
                statusEl.textContent = `✅ 已从缓存加载（${dt.toLocaleString()}）`;
                contentEl.innerHTML = md.render(cached.mdContent);
                return;
            }
        }

        // 2) 强制或无缓存：开始翻译（若正在翻译，先中断）
        if (translating && currentAbortController) {
            try { currentAbortController.abort(); } catch {}
        }

        translating = true;
        retranslateBtn.disabled = true;
        contentEl.innerHTML = '';
        statusEl.textContent = force ? '🔄 正在强制重新翻译（将覆盖缓存）...' : '正在准备翻译...';

        const abortController = new AbortController();
        currentAbortController = abortController;

        try {
            const pdfText = await extractTextFromPDF(iframe.src, abortController.signal);
            if (!pdfText.trim()) throw new Error("PDF 文本提取失败");

            const finalPrompt = `${customPrompt}\n\n--- 待翻译文本如下 ---\n${pdfText}`;

            const response = await fetch('https://api.deepseek.com/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: [{ role: 'user', content: finalPrompt }],
                    stream: true
                }),
                signal: abortController.signal
            });

            if (!response.ok) throw new Error(`API 返回错误: ${response.status}`);

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let mdContent = '';
            let buffer = '';

            statusEl.textContent = 'DeepSeek 正在思考并重组公式...';

            let doneByDone = false;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (line.trim() === '' || !line.startsWith('data: ')) continue;
                    const dataStr = line.slice(6);
                    if (dataStr === '[DONE]') {
                        doneByDone = true;
                        break;
                    }

                    try {
                        const data = JSON.parse(dataStr);
                        const delta = data.choices[0]?.delta?.content;
                        if (delta) {
                            mdContent += delta;
                            contentEl.innerHTML = md.render(mdContent);
                        }
                    } catch (e) {
                        // ignore bad chunks
                    }
                }

                if (doneByDone) break;
            }

            // 3) 完成后写缓存
            saveCache(cacheKey, mdContent);
            statusEl.textContent = '✅ 翻译完成（已缓存，可点击“重新翻译”覆盖）';

        } catch (err) {
            if (err?.name === 'AbortError') {
                statusEl.textContent = '已中断当前翻译任务。';
            } else {
                statusEl.innerHTML = `<span class="ai-error">错误: ${err.message}</span>（请检查 API Key 或网络连通性）`;
            }
        } finally {
            translating = false;
            retranslateBtn.disabled = false;
            currentAbortController = null;
        }
    }

    // 按钮：强制重新翻译（绕过缓存并覆盖）
    retranslateBtn.addEventListener('click', () => startTranslation({ force: true }));

    // 自动启动：优先缓存，否则翻译
    startTranslation({ force: false });

})();