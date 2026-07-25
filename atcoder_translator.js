// ==UserScript==
// @name         AtCoder 题目与题解翻译
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  支持 Markdown 和数学公式渲染，支持 DeepSeek 直连及 OpenAI 兼容接口(如 OpenRouter)，支持题解翻译与思维链展示。
// @author       banana (modified)
// @match        https://atcoder.jp/contests/*/tasks/*
// @match        https://atcoder.jp/contests/*/editorial/*
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      *
// @require      https://cdn.jsdelivr.net/npm/markdown-it@13.0.1/dist/markdown-it.min.js
// @require      https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js
// @require      https://cdn.jsdelivr.net/npm/markdown-it-texmath@1.0.0/texmath.min.js
// @resource     katexCSS https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css
// @resource     texmathCSS https://cdn.jsdelivr.net/npm/markdown-it-texmath@1.0.0/css/texmath.min.css
// ==/UserScript==

(function() {
    'use strict';

    const isEditorial = window.location.href.includes('/editorial');

    // ==========================================
    // 1. 配置与设置面板管理
    // ==========================================
    const defaultConfig = {
        provider: 'deepseek', // 'deepseek' 或 'openai'
        apiKey: '',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        enableReasoning: false // 是否开启 OpenRouter 的 extra_body reasoning
    };

    let config = {
        provider: GM_getValue('api_provider', defaultConfig.provider),
        apiKey: GM_getValue('api_key', defaultConfig.apiKey),
        baseUrl: GM_getValue('base_url', defaultConfig.baseUrl),
        model: GM_getValue('model', defaultConfig.model),
        enableReasoning: GM_getValue('enable_reasoning', defaultConfig.enableReasoning)
    };

    // 注入设置面板 CSS
    GM_addStyle(`
        #ai-translator-settings { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); z-index: 9999; width: 400px; font-family: sans-serif; }
        #ai-translator-settings h3 { margin-top: 0; border-bottom: 1px solid #eee; padding-bottom: 10px; }
        #ai-translator-settings label { display: block; margin-top: 10px; font-weight: bold; font-size: 14px; }
        #ai-translator-settings input[type="text"], #ai-translator-settings input[type="password"], #ai-translator-settings select { width: 100%; padding: 8px; margin-top: 5px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
        #ai-translator-settings .checkbox-label { display: flex; align-items: center; font-weight: normal; margin-top: 10px; }
        #ai-translator-settings .checkbox-label input { margin-right: 8px; width: auto; }
        #ai-translator-settings .btn-group { margin-top: 20px; text-align: right; }
        #ai-translator-settings button { padding: 8px 15px; margin-left: 10px; border: none; border-radius: 4px; cursor: pointer; }
        #ai-translator-settings .btn-save { background: #007bff; color: white; }
        #ai-translator-settings .btn-cancel { background: #ccc; }
        #ai-settings-overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 9998; }

        /* 翻译框样式 */
        .ai-translation-box { background: #fdfdfd; padding: 20px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 30px; line-height: 1.6; }
        .ai-reasoning-box { background: #f5f5f5; border-left: 4px solid #ccc; padding: 10px; margin-bottom: 15px; font-size: 0.9em; color: #555; }
        .ai-reasoning-box summary { cursor: pointer; font-weight: bold; color: #333; }

        /* 翻译按钮 */
        .ai-translate-btn-row { text-align: center; padding: 30px 0; }
        .ai-translate-btn { display: inline-block; padding: 10px 28px; font-size: 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
        .ai-translate-btn:hover { background: #0056b3; }
        .ai-translate-btn:disabled { background: #999; cursor: not-allowed; }
        .ai-retranslate-bar { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-bottom: 12px; }
        .ai-retranslate-btn { padding: 4px 14px; font-size: 13px; background: #f0f0f0; color: #555; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; }
        .ai-retranslate-btn:hover { background: #e0e0e0; }
        .ai-copy-btn { padding: 4px 14px; font-size: 13px; background: #f0f0f0; color: #555; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; }
        .ai-copy-btn:hover { background: #e0e0e0; }
        .ai-copy-btn.copied { background: #d4edda; color: #155724; border-color: #28a745; }

        /* KaTeX 公式渲染修复 */
        .ai-translation-box .katex-display { margin: 0.5em 0 !important; }
        .ai-translation-box .katex { font-size: 1.05em !important; color: #000 !important; }
        .ai-translation-box p { margin-bottom: 10px; word-break: break-word; }

        /* 列表样式 */
        .ai-translation-box ul, .ai-translation-box ol { padding-left: 2em; margin: 0.5em 0; }
        .ai-translation-box li { margin-bottom: 0.25em; }
        .ai-translation-box ul { list-style-type: disc; }
        .ai-translation-box ul ul { list-style-type: circle; }
        .ai-translation-box ul ul ul { list-style-type: square; }
        .ai-translation-box ol { list-style-type: decimal; }
    `);

    // 创建设置面板 DOM
    const overlay = document.createElement('div');
    overlay.id = 'ai-settings-overlay';
    const settingsDiv = document.createElement('div');
    settingsDiv.id = 'ai-translator-settings';
    settingsDiv.innerHTML = `
        <h3>⚙️ AI 翻译设置</h3>
        <label>接口类型</label>
        <select id="ai-provider">
            <option value="deepseek">DeepSeek 官方</option>
            <option value="openai">OpenAI 兼容 (如 OpenRouter)</option>
        </select>

        <label>API Key</label>
        <input type="password" id="ai-apikey" placeholder="sk-...">

        <label>Base URL</label>
        <input type="text" id="ai-baseurl" placeholder="https://api.deepseek.com">

        <label>模型名称 (Model)</label>
        <input type="text" id="ai-model" placeholder="deepseek-v4-flash">

        <label class="checkbox-label" title="适用于 OpenRouter 上的 Gemini 等支持 extra_body reasoning 的模型">
            <input type="checkbox" id="ai-reasoning"> 开启 OpenRouter Reasoning (extra_body)
        </label>

        <div class="btn-group">
            <button class="btn-cancel" id="ai-btn-cancel">取消</button>
            <button class="btn-save" id="ai-btn-save">保存并刷新</button>
        </div>
    `;
    document.body.appendChild(overlay);
    document.body.appendChild(settingsDiv);

    function openSettings() {
        document.getElementById('ai-provider').value = config.provider;
        document.getElementById('ai-apikey').value = config.apiKey;
        document.getElementById('ai-baseurl').value = config.baseUrl;
        document.getElementById('ai-model').value = config.model;
        document.getElementById('ai-reasoning').checked = config.enableReasoning;
        overlay.style.display = 'block';
        settingsDiv.style.display = 'block';
    }

    function closeSettings() {
        overlay.style.display = 'none';
        settingsDiv.style.display = 'none';
    }

    document.getElementById('ai-btn-cancel').onclick = closeSettings;
    document.getElementById('ai-btn-save').onclick = () => {
        GM_setValue('api_provider', document.getElementById('ai-provider').value);
        GM_setValue('api_key', document.getElementById('ai-apikey').value.trim());
        GM_setValue('base_url', document.getElementById('ai-baseurl').value.trim());
        GM_setValue('model', document.getElementById('ai-model').value.trim());
        GM_setValue('enable_reasoning', document.getElementById('ai-reasoning').checked);
        alert('设置已保存，页面即将刷新！');
        location.reload();
    };

    // 预设切换逻辑
    document.getElementById('ai-provider').addEventListener('change', function() {
        if (this.value === 'deepseek') {
            document.getElementById('ai-baseurl').value = 'https://api.deepseek.com';
            document.getElementById('ai-model').value = 'deepseek-v4-flash';
        } else {
            document.getElementById('ai-baseurl').value = 'https://openrouter.ai/api/v1';
            document.getElementById('ai-model').value = 'google/gemini-3.1-flash-lite-preview';
        }
    });

    GM_registerMenuCommand('⚙️ 设置 AI 翻译接口', openSettings);

    if (!config.apiKey) {
        openSettings();
        return;
    }

    // ==========================================
    // 2. 提取页面内容 (区分题面与题解)
    // ==========================================
    function extractContent() {
        if (isEditorial) {
            // 题解页面提取逻辑 — 通过 h2 标题精确定位到包含题解正文的 .col-sm-12
            const h2 = document.querySelector('#main-container .col-sm-12 h2');
            if (!h2) return "";

            const container = h2.closest('.col-sm-12');
            if (!container) return "";

            const titleText = h2.textContent.trim();

            // 题解正文位于 <hr class="mt-1"> 之后、<div class="clearfix"> 之前
            const hr = container.querySelector('hr.mt-1');
            if (!hr) return "";

            const bodyParts = [];
            let current = hr.nextElementSibling;
            while (current && !current.classList.contains('clearfix')) {
                // 排除已注入的翻译框
                if (!current.classList.contains('ai-translation-box')) {
                    const clone = current.cloneNode(true);
                    clone.querySelectorAll('script').forEach(s => s.remove());

                    // 将 KaTeX 渲染的数学公式还原为 $...$ LaTeX 格式
                    clone.querySelectorAll('.katex').forEach(katex => {
                        const annotation = katex.querySelector('.katex-mathml annotation[encoding="application/x-tex"]');
                        if (annotation) {
                            katex.replaceWith('$' + annotation.textContent + '$');
                        }
                    });

                    // 处理 <var> 标签
                    clone.querySelectorAll('var').forEach(varTag => {
                        varTag.replaceWith('$' + varTag.textContent + '$');
                    });

                    bodyParts.push(clone.innerHTML);
                }
                current = current.nextElementSibling;
            }

            if (bodyParts.length === 0) return "";

            return `## ${titleText}\n\n${bodyParts.join('\n\n')}\n\n`;
        } else {
            // 题目页面提取逻辑 (原版逻辑)
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
                varTag.replaceWith('$' + varTag.textContent + '$');
            });

            return `## ${problemTitle}\n\n${targetSection.innerHTML}\n\n`;
        }
    }

    const extractedContent = extractContent();
    if(!extractedContent) return;

    // ==========================================
    // 3. 缓存 Key 计算
    // ==========================================
    function computeCacheKey() {
        // 基于 URL 路径计算缓存 key（忽略 query string 和 hash）
        const clean = window.location.href.replace(/[?#].*$/, '');
        const hash = btoa(unescape(encodeURIComponent(clean))).replace(/[/+=]/g, '_');
        return 'ai_trans_' + hash;
    }

    const CACHE_KEY = computeCacheKey();

    function getCached() {
        try {
            const raw = GM_getValue(CACHE_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    function saveCache(html, reasoning, rawMd) {
        GM_setValue(CACHE_KEY, JSON.stringify({
            html: html,
            reasoning: reasoning || '',
            rawMd: rawMd || '',
            time: Date.now()
        }));
    }

    function clearCache() {
        GM_setValue(CACHE_KEY, '');
        location.reload();
    }

    GM_registerMenuCommand('🗑️ 清除当前页面翻译缓存', clearCache);

    // ==========================================
    // 4. 初始化 Markdown 渲染和 UI 容器
    // ==========================================
    let katexCss = GM_getResourceText("katexCSS");
    let texmathCss = GM_getResourceText("texmathCSS");
    katexCss = katexCss.replace(/url\((['"]?)fonts\//g, "url($1https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/");

    GM_addStyle(katexCss);
    GM_addStyle(texmathCss);

    const md = markdownit({
        html: true,
        typographer: false  // 禁用 typographer，避免将引号/破折号自动替换导致公式破坏
    }).use(texmath, {
        engine: katex,
        delimiters: 'dollars',
        outerSpace: false   // 允许公式紧贴中文字符，如 "选择$x$"
    });

    // 禁用可能与 LaTeX 语法冲突的 Markdown 规则
    md.inline.ruler.before('escape', 'math_escape', (state, silent) => false);
    // 将 _ 从斜体标记中排除，减少与下标 a_i 的冲突
    md.disable('emphasis');

    function preprocessMarkdown(text) {
        if (!text) return "";
        // 1. 修复公式内美元符号与内容的空格（AI 有时会多写空格）
        //    精确匹配 $...$ 对内 trim，避免破坏列表标记 "- $" 中的空格
        text = text.replace(/\$([^$\n]+?)\$/g, (match, inner) => {
            return '$' + inner.trim() + '$';
        });

        // 2. 特殊处理：防止 Markdown 转义公式内的反斜杠
        // 这是一个比较稳健的做法：如果发现有 \begin{...}，确保它前后有换行
        text = text.replace(/(\\begin\{[a-z\*]+\})/g, '\n$1');
        text = text.replace(/(\\end\{[a-z\*]+\})/g, '$1\n');

        return text;
    }

    const container = document.createElement('div');
    container.className = 'ai-translation-box';

    function insertContainer() {
        if (isEditorial) {
            const h2 = document.querySelector('#main-container .col-sm-12 h2');
            if (h2) {
                h2.parentNode.insertBefore(container, h2.nextSibling);
            } else {
                const mainNode = document.querySelector('#main-container .col-sm-12:last-child');
                if (mainNode) mainNode.prepend(container);
            }
        } else {
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
    }

    insertContainer();

    // 存储原始 markdown 供复制功能使用
    let currentRawMd = '';

    function renderTranslateButton() {
        container.innerHTML = `
            <div class="ai-translate-btn-row">
                <button class="ai-translate-btn" id="ai-trigger-translate">翻译</button>
            </div>`;
        document.getElementById('ai-trigger-translate').onclick = doTranslate;
    }

    function renderRetranslateButton() {
        return `<div class="ai-retranslate-bar">
            <button class="ai-copy-btn" id="ai-copy-md" title="复制翻译内容的 Markdown 源码">📋 复制源码</button>
            <button class="ai-retranslate-btn" id="ai-trigger-retranslate">重新翻译</button>
        </div>`;
    }

    function bindRetranslateButton() {
        const btn = document.getElementById('ai-trigger-retranslate');
        if (btn) btn.onclick = doTranslate;
    }

    function bindCopyButton() {
        const btn = document.getElementById('ai-copy-md');
        if (!btn) return;
        btn.onclick = async () => {
            try {
                await navigator.clipboard.writeText(currentRawMd);
                btn.textContent = '✅ 已复制';
                btn.classList.add('copied');
                setTimeout(() => {
                    btn.textContent = '📋 复制源码';
                    btn.classList.remove('copied');
                }, 2000);
            } catch (e) {
                // fallback for older browsers
                const ta = document.createElement('textarea');
                ta.value = currentRawMd;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                btn.textContent = '✅ 已复制';
                btn.classList.add('copied');
                setTimeout(() => {
                    btn.textContent = '📋 复制源码';
                    btn.classList.remove('copied');
                }, 2000);
            }
        };
    }

    // ==========================================
    // 6. 构建 Prompt
    // ==========================================
    function buildPrompt() {
        const taskPrompt = `# Role
你是一位精通多国语言的算法竞赛（Competitive Programming）专家，擅长处理复杂的题目文本，并能精准修复受损的数学公式。

# Task
你的任务是将一段从算法题目中提取的英文文本，翻译成专业、易懂的中文题目描述。

# Rules & Process
1. **内容筛选**：
   - 仅提取"题目描述（Problem Description）"部分。
   - 如果原文包含"样例解释（Note/Explanation）"，请一并翻译。
   - **严格跳过**：输入输出格式、数据范围（Constraints）、样例数据、作者信息等。

2. **数学公式修复与重构（核心）**：
   - 识别并修复因文本提取导致的公式错误（如 \`a i\` 修复为 $a_i$，\`n 2\` 修复为 $n^2$，\`10 9\` 修复为 $10^9$）。
   - **格式规范**：所有变量、常量、公式必须使用 LaTeX 语法，并用单美元符号 \`$\` 包裹。
   - **严禁使用**：双美元符号 \`$$\`、\`\\( \\)\`、\`\\[ \\]\` 或普通括号表示公式。
   - **公式内严禁空格**：必须写 \`$a_i$\` 而不是 \`$ a_i $\`。符号与美元符之间不要有空格。
   - **示例**：分数必须为 \`$\\frac{a}{b}$\`，下标为 \`$a_i$\`，幂次为 \`$2^n$\`。

3. **翻译原则**：
   - 保持准确性，严禁改写题目逻辑，严禁自行分析或给出解题思路。
   - 术语翻译需符合中文算法竞赛习惯（如：Tree 翻译为"树"，Query 翻译为"查询/询问"，Modulo 翻译为"取模"）。

4. **输出格式**：
   - 直接输出翻译后的 Markdown 内容，不输出任何前缀（如"以下是翻译："）或后缀。
   - 公式与中文之间不需要额外空格：如 \`选择 $x$\` 而不是 \`选择 $x $\`。
   - 原文中的并列条件、枚举项应使用 Markdown 无序列表（\`- \`）或有序列表（\`1. \`）呈现。列表项之间用空行分隔。

# Input Text
${extractedContent}`;

        const editorialPrompt = `# Role
你是一位精通算法竞赛（Competitive Programming）的资深教练，擅长将晦涩难懂的英文官方题解（Editorial）翻译并解释为清晰易懂的中文。

# Task
将以下 AtCoder 官方英文题解翻译为中文。

# Rules & Process
1. **准确与通俗**：准确翻译算法思想（如 DP 状态转移、图论建模、贪心策略），语言要符合中国算法竞赛选手的阅读习惯。

2. **数学公式规范**：
   - 所有变量、常量、公式必须使用 LaTeX 语法，并用单美元符号 \`$\` 包裹。
   - **严禁使用**：双美元符号 \`$$\`、\`\\( \\)\`、\`\\[ \\]\`。
   - **公式内严禁空格**：必须写 \`$a_i$\` 而不是 \`$ a_i $\`。符号与美元符之间不要有空格。
   - **下标**：使用 \`_\` 表示下标，如 \`$dp_{i,j}$\`、\`$A_i$\`。
   - 行首的公式（如 \`$-1 \\le x$\`）不要用 \`$$\` 包裹，直接用 \`$\`。若公式以 \`-\` 开头且恰好位于行首，请在 \`$\` 前加一个空格或换行，避免被误解析为列表标记。

3. **代码处理**：如果原文包含代码片段，请保留原样，并可适当在代码旁添加中文注释。

4. **输出格式**：
   - 直接输出翻译后的 Markdown 内容，不要包含任何多余的问候语或前缀。
   - 原文中的并列条件、枚举项应使用 Markdown 无序列表（\`- \`）或有序列表（\`1. \`）呈现。列表项之间用空行分隔。

# Input Text
${extractedContent}`;

        return isEditorial ? editorialPrompt : taskPrompt;
    }

    // ==========================================
    // 7. 发起流式翻译
    // ==========================================
    async function doTranslate() {
        const btn = document.getElementById('ai-trigger-translate') || document.getElementById('ai-trigger-retranslate');
        if (btn) btn.disabled = true;

        container.innerHTML = 'AI 思考中...';

        const prompt = buildPrompt();
        let endpoint = config.baseUrl.replace(/\/+$/, '') + '/chat/completions';

        let requestBody = {
            model: config.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            stream: true
        };

        if (config.provider === 'openai' && config.enableReasoning) {
            requestBody.extra_body = { reasoning: { enabled: true } };
        }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errText = await response.text();
                container.innerHTML = `<span style="color:red">API 请求失败: ${response.status}</span><br><pre>${errText}</pre>`;
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let mdContent = '';
            let reasoningContent = '';
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (line.trim() === '') continue;
                    if (line.startsWith('data: ')) {
                        const dataStr = line.slice(6);
                        if (dataStr === '[DONE]') break;

                        try {
                            const data = JSON.parse(dataStr);
                            const delta = data.choices[0]?.delta;

                            if (delta) {
                                if (delta.reasoning_content) {
                                    reasoningContent += delta.reasoning_content;
                                }
                                if (delta.content) {
                                    mdContent += delta.content;
                                }

                                let renderHtml = '';
                                if (reasoningContent) {
                                    renderHtml += `<details class="ai-reasoning-box"><summary>AI 思考过程</summary><div>${md.render(preprocessMarkdown(reasoningContent))}</div></details>`;
                                }
                                if (mdContent) {
                                    renderHtml += md.render(preprocessMarkdown(mdContent));
                                }
                                container.innerHTML = renderHtml || 'AI 正在生成内容...';
                            }
                        } catch (e) {
                            // 忽略解析错误
                        }
                    }
                }
            }

            // 翻译完成后写入缓存并添加按钮
            const finalHtml = container.innerHTML;
            currentRawMd = mdContent;
            saveCache(finalHtml, reasoningContent, mdContent);
            container.innerHTML = renderRetranslateButton() + finalHtml;
            bindRetranslateButton();
            bindCopyButton();

        } catch (err) {
            console.error(err);
            container.innerHTML = `<span style="color:red">请求异常: ${err.message}</span>`;
        }
    }

    // ==========================================
    // 8. 初始化：检查缓存决定展示内容
    // ==========================================
    const cached = getCached();
    if (cached && cached.html) {
        container.innerHTML = renderRetranslateButton() + cached.html;
        bindRetranslateButton();
        bindCopyButton();
        if (cached.rawMd) {
            currentRawMd = cached.rawMd;
        }
    } else {
        renderTranslateButton();
    }
})();