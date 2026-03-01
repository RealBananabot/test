// ==UserScript==
// @name         QOJ 题目翻译 (防幻觉)
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  自动解析 QOJ PDF 题目，调用 DeepSeek API 翻译。支持纯文本提取与 Tesseract.js OCR 识别。新增防幻觉 Prompt，避免纯图片 PDF 翻译出虚假题目。
// @author       banana, gemini, assistant
// @match        https://contest.ucup.ac/contest/*/problem/*
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
// @require      https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js
// @resource     katexCSS https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css
// @resource     texmathCSS https://cdn.jsdelivr.net/npm/markdown-it-texmath@1.0.0/css/texmath.min.css
// ==/UserScript==

(async function() {
    'use strict';

    // ==========================================
    // 1. 配置管理 (API Key, Prompt & Theme)
    // ==========================================

    // v1.5 新增：防御性 Prompt，防止 AI 在遇到乱码/空文本时产生幻觉编造题目
    const DEFAULT_PROMPT = `以下内容是我从算法竞赛题目的 PDF 文件中提取出的纯文本（可能是通过 OCR 识别的）。由于提取限制，**一些数学公式、上下标、空格和换行可能会严重错乱**。

如果文本正常，你需要做的事：
1. 忽略文字中其他部分（如输入输出及其格式，以及样例），只提取题目的题目描述部分。如果题目原文有样例解释，你应该同时翻译解释部分，否则不应该主动解释样例。
2. **极力修复错乱的数学变量和公式**，结合上下文语境，重新使用标准的 LaTeX 语法（用 $ 符号包裹）表示。
3. 将题目准确地翻译成中文，不要改写题目内容，不要解决或者分析问题，只给出题目的翻译，不要输出其他任何内容。

【重要判定规则】
如果下方提供的待翻译文本几乎为空，或者全是无意义的乱码、无法构成连贯的英文/中文句子，**请绝对不要自行编造或猜测题目内容**！你必须直接输出以下警告信息，并且不要输出任何其他内容：
"> ⚠️ **文本提取失败或内容无法识别。** 这可能是一个纯图片或扫描版的 PDF。请点击上方的【📷 OCR 强制翻译】按钮进行重试。"`;

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
            --btn-ocr-bg: #4a3f2b;
            --btn-ocr-hover: #5c4e36;
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
            --btn-ocr-bg: #fff8e7;
            --btn-ocr-hover: #fdf0d5;
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
        .ai-translation-box blockquote {
            border-left: 4px solid #d4a72c;
            padding-left: 10px;
            color: #d4a72c;
            margin-left: 0;
            background: rgba(212, 167, 44, 0.1);
            padding: 10px;
            border-radius: 0 4px 4px 0;
        }

        .ai-toolbar {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 10px;
            flex-wrap: wrap;
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
        .ai-ocr-btn {
            background: var(--btn-ocr-bg);
            border-color: #d4a72c;
        }
        .ai-ocr-btn:hover { background: var(--btn-ocr-hover); }

        .ai-error { color: #ff6b6b; }
    `);

    const md = markdownit({ html: true }).use(texmath, { engine: katex, delimiters: 'dollars' });

    const iframe = document.querySelector('iframe#statements-pdf');
    if (!iframe) return;

    // 结构化容器：toolbar + content
    const container = document.createElement('div');
    container.className = `ai-translation-box theme-${currentTheme}`;
    container.innerHTML = `
        <div class="ai-toolbar">
            <button type="button" class="ai-btn ai-retranslate">🔄 重新翻译</button>
            <button type="button" class="ai-btn ai-ocr-btn" title="当 PDF 是纯图片或扫描件时使用此功能">📷 OCR 强制翻译</button>
            <div class="ai-status-msg">正在准备 PDF 解析引擎...</div>
        </div>
        <div class="ai-content"></div>
    `;
    iframe.parentNode.insertBefore(container, iframe);

    const statusEl = container.querySelector('.ai-status-msg');
    const contentEl = container.querySelector('.ai-content');
    const retranslateBtn = container.querySelector('.ai-retranslate');
    const ocrBtn = container.querySelector('.ai-ocr-btn');

    // ==========================================
    // 2.5 缓存工具
    // ==========================================
    const CACHE_PREFIX = 'deepseek_translation_cache_v2';

    function djb2Hash(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) + h) + str.charCodeAt(i);
            h >>>= 0;
        }
        return h.toString(16);
    }

    function normalizeUrlForCache(u) {
        try {
            const url = new URL(u, location.href);
            return `${url.origin}${url.pathname}`;
        } catch {
            return String(u || '');
        }
    }

    function buildCacheKey(useOCR) {
        const pageId = `${location.origin}${location.pathname}`;
        const pdfId = normalizeUrlForCache(iframe.src);
        const raw = `${pageId}|${pdfId}|${customPrompt}|ocr:${useOCR}`;
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
    // 3. PDF 解析核心 (纯文本提取 + OCR 提取)
    // ==========================================
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    // 模式 1：常规纯文本提取
    async function extractTextFromPDF(url, fetchSignal) {
        statusEl.textContent = '正在抓取 PDF 原始数据...';
        const response = await fetch(url, { signal: fetchSignal });
        const arrayBuffer = await response.arrayBuffer();
        const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;

        let fullText = '';
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            if (fetchSignal.aborted) throw new DOMException('Aborted', 'AbortError');
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

    // 模式 2：OCR 提取 (PDF -> Canvas -> Tesseract.js)
    async function extractTextWithOCR(url, fetchSignal) {
        statusEl.textContent = '正在初始化 OCR 引擎 (首次需下载语言模型，请耐心等待)...';

        // 初始化 Tesseract worker，支持中英文
        const worker = await Tesseract.createWorker('eng+chi_sim');

        try {
            statusEl.textContent = '正在抓取 PDF 原始数据...';
            const response = await fetch(url, { signal: fetchSignal });
            const arrayBuffer = await response.arrayBuffer();
            const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;

            let fullText = '';
            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                if (fetchSignal.aborted) throw new DOMException('Aborted', 'AbortError');

                statusEl.textContent = `正在渲染并进行 OCR 识别 (第 ${pageNum}/${pdf.numPages} 页，可能较慢)...`;
                const page = await pdf.getPage(pageNum);

                // 放大 2 倍渲染以提高 OCR 识别率
                const viewport = page.getViewport({ scale: 2.0 });
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                await page.render({ canvasContext: ctx, viewport: viewport }).promise;

                if (fetchSignal.aborted) throw new DOMException('Aborted', 'AbortError');

                // 将 Canvas 交给 Tesseract 识别
                const ret = await worker.recognize(canvas);
                fullText += ret.data.text + '\n\n';
            }
            return fullText;
        } finally {
            await worker.terminate(); // 释放内存
        }
    }

    // ==========================================
    // 4. 发送翻译请求 + 缓存逻辑
    // ==========================================
    let translating = false;
    let currentAbortController = null;

    async function startTranslation({ force = false, useOCR = false } = {}) {
        const cacheKey = buildCacheKey(useOCR);

        // 1) 非强制模式：优先读缓存
        if (!force) {
            const cached = loadCache(cacheKey);
            if (cached) {
                const dt = new Date(cached.savedAt);
                statusEl.textContent = `✅ 已从缓存加载（${dt.toLocaleString()}）${useOCR ? '[OCR模式]' : ''}`;
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
        ocrBtn.disabled = true;
        contentEl.innerHTML = '';

        if (useOCR) {
            statusEl.textContent = '📷 正在启动 OCR 强制翻译流程...';
        } else {
            statusEl.textContent = force ? '🔄 正在强制重新翻译（将覆盖缓存）...' : '正在准备翻译...';
        }

        const abortController = new AbortController();
        currentAbortController = abortController;

        try {
            // 根据是否启用 OCR 选择提取方式
            const pdfText = useOCR
                ? await extractTextWithOCR(iframe.src, abortController.signal)
                : await extractTextFromPDF(iframe.src, abortController.signal);

            // 基础拦截：如果连一个字符都没有，直接报错
            if (!pdfText.trim()) {
                if (!useOCR) {
                    throw new Error("常规文本提取失败或为空。如果这是扫描版 PDF，请点击【📷 OCR 强制翻译】按钮。");
                } else {
                    throw new Error("OCR 识别未提取到任何文本。");
                }
            }

            const finalPrompt = `${customPrompt}\n\n--- 待翻译文本如下 ---\n${pdfText}`;

            const response = await fetch('https://api.deepseek.com/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages:[{ role: 'user', content: finalPrompt }],
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
            statusEl.textContent = `✅ 翻译完成（已缓存，可点击“重新翻译”覆盖）${useOCR ? '[OCR模式]' : ''}`;

        } catch (err) {
            if (err?.name === 'AbortError') {
                statusEl.textContent = '已中断当前翻译任务。';
            } else {
                statusEl.innerHTML = `<span class="ai-error">错误: ${err.message}</span>`;
            }
        } finally {
            translating = false;
            retranslateBtn.disabled = false;
            ocrBtn.disabled = false;
            currentAbortController = null;
        }
    }

    // 按钮事件绑定
    retranslateBtn.addEventListener('click', () => startTranslation({ force: true, useOCR: false }));
    ocrBtn.addEventListener('click', () => startTranslation({ force: true, useOCR: true }));

    // 自动启动：优先缓存，否则常规翻译
    startTranslation({ force: false, useOCR: false });

})();