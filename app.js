/* ============================================================
 * 统计学学科大模型 · 前端应用逻辑 app.js
 * ------------------------------------------------------------
 * 模块：导航 / 知识问答（LLM + 本地知识库兜底）/ 数据分析
 *       Agent（上传→清洗→分析→图表→报告）/ 多模态可视化
 *       （6 个交互实验）/ 关于页渲染
 * ============================================================ */
(function () {
  'use strict';

  var S = window.STAT;
  var KB = window.STAT_KB;

  /* ================= 通用 ================= */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function mdInline(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\*([^*]+)\*/g, '<i>$1</i>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }
  function mdToHtml(md) {
    var lines = md.split('\n');
    var html = '', inTable = false;
    lines.forEach(function (line) {
      var t = line.trim();
      if (t.startsWith('# ')) { if (inTable) { html += '</table>'; inTable = false; } html += '<h1>' + mdInline(t.slice(2)) + '</h1>'; }
      else if (t.startsWith('## ')) { if (inTable) { html += '</table>'; inTable = false; } html += '<h2>' + mdInline(t.slice(3)) + '</h2>'; }
      else if (t.startsWith('### ')) { if (inTable) { html += '</table>'; inTable = false; } html += '<h3>' + mdInline(t.slice(4)) + '</h3>'; }
      else if (t.startsWith('|') && t.endsWith('|')) {
        var cells = t.slice(1, -1).split('|').map(function (c) { return c.trim(); });
        if (cells.every(function (c) { return /^:?-+:?$/.test(c); })) return; // 分隔行
        if (!inTable) { html += '<table><tr>' + cells.map(function (c) { return '<th>' + mdInline(c) + '</th>'; }).join('') + '</tr>'; inTable = true; }
        else { html += '<tr>' + cells.map(function (c) { return '<td>' + mdInline(c) + '</td>'; }).join('') + '</tr>'; }
      }
      else if (t.startsWith('> ')) { if (inTable) { html += '</table>'; inTable = false; } html += '<div class="hint">' + mdInline(t.slice(2)) + '</div>'; }
      else if (t.startsWith('- ')) { if (inTable) { html += '</table>'; inTable = false; } html += '<div>• ' + mdInline(t.slice(2)) + '</div>'; }
      else if (t === '---') { if (inTable) { html += '</table>'; inTable = false; } html += '<hr>'; }
      else if (t === '') { if (inTable) { html += '</table>'; inTable = false; } html += '<br>'; }
      else { if (inTable) { html += '</table>'; inTable = false; } html += '<div>' + mdInline(line) + '</div>'; }
    });
    if (inTable) html += '</table>';
    return html;
  }

  /* ================= 导航 ================= */
  window.go = function (page) {
    document.querySelectorAll('.page').forEach(function (s) { s.classList.remove('active'); });
    $('page-' + page).classList.add('active');
    document.querySelectorAll('.nav-tabs button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.p === page);
    });
    window.scrollTo(0, 0);
    if (page === 'library') renderLibrary();
    if (page === 'litsearch') setTimeout(function () { var el = $('lit-q'); if (el) el.focus(); }, 100);
  };

  /* ==========================================================
   * 一、知识问答模块
   * ========================================================== */
  var chatHistory = [];
  var CHAT_CFG_KEY = 'statllm_cfg_v1';

  function defaultCfg() {
    return {
      provider: 'deepseek',
      apiKey: '',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com',
      workerUrl: 'https://statllm.mentalhealthresearch.top'
    };
  }
  function getChatConfig() {
    var d = defaultCfg();
    try {
      var saved = JSON.parse(localStorage.getItem(CHAT_CFG_KEY) || '{}');
      Object.keys(d).forEach(function (k) { if (saved[k] !== undefined) d[k] = saved[k]; });
    } catch (e) { /* ignore */ }
    return d;
  }
  window.saveChatConfig = function () {
    var cfg = {
      provider: $('cfg-provider').value,
      apiKey: $('cfg-key').value.trim(),
      model: $('cfg-model').value.trim(),
      baseUrl: $('cfg-base').value.trim(),
      workerUrl: $('cfg-worker').value.trim()
    };
    localStorage.setItem(CHAT_CFG_KEY, JSON.stringify(cfg));
    flashStatus('配置已保存');
    updateChatStatus();
  };
  window.testConn = async function () {
    var cfg = readCfgFromForm();
    var btn = event.target; btn.disabled = true; btn.textContent = '测试中…';
    try {
      var worker = cfg.workerUrl || defaultCfg().workerUrl;
      var resp = await fetch(worker.replace(/\/+$/, '') + '/api/health', { method: 'GET' });
      var j = await resp.json();
      if (j.ok) flashStatus('✓ 网关连通：' + (j.provider || '未知') + ' · ' + (j.model || ''));
      else flashStatus('✗ 网关异常：' + (j.error || resp.status));
    } catch (e) {
      if (cfg.provider === 'local') { flashStatus('✓ 本地知识库模式（无需网关）'); }
      else flashStatus('✗ 网关不可达：' + e.message);
    }
    btn.disabled = false; btn.textContent = '测试连接';
  };
  function readCfgFromForm() {
    return {
      provider: $('cfg-provider').value,
      apiKey: $('cfg-key').value.trim(),
      model: $('cfg-model').value.trim(),
      baseUrl: $('cfg-base').value.trim(),
      workerUrl: $('cfg-worker').value.trim()
    };
  }
  function updateChatStatus() {
    var cfg = getChatConfig();
    var dot = document.querySelector('#chat-status .dot');
    var txt = $('chat-status-txt');
    if (cfg.provider === 'local') { dot.className = 'dot off'; txt.textContent = '本地知识库模式'; }
    else if (!cfg.apiKey) { dot.className = 'dot off'; txt.textContent = '未配置 Key · 将用本地知识库兜底'; }
    else { dot.className = 'dot ok'; txt.textContent = '已连接 ' + (cfg.provider === 'deepseek' ? 'DeepSeek' : cfg.provider === 'siliconflow' ? 'SiliconFlow' : 'OpenAI 兼容'); }
  }
  function flashStatus(msg) {
    $('chat-status-txt').textContent = msg;
    setTimeout(updateChatStatus, 1800);
  }

  /* ---- 建议问题 ---- */
  function renderSuggestions() {
    var row = $('sugg-row');
    row.innerHTML = '';
    (KB.suggestions || []).forEach(function (q) {
      var chip = document.createElement('button');
      chip.className = 'sugg-chip';
      chip.textContent = q;
      chip.onclick = function () { $('chat-input').value = q; sendChat(); };
      row.appendChild(chip);
    });
  }

  /* ---- 消息渲染 ---- */
  function addMsg(role, html) {
    var box = $('chat-msgs');
    var div = document.createElement('div');
    div.className = 'msg ' + role;
    div.innerHTML = '<div class="avatar">' + (role === 'user' ? '👤' : 'Σ') + '</div><div class="bubble">' + html + '</div>';
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
  }
  function addTyping() {
    var box = $('chat-msgs');
    var div = document.createElement('div');
    div.className = 'msg ai';
    div.id = 'typing-msg';
    div.innerHTML = '<div class="avatar">Σ</div><div class="bubble"><span class="typing-ind"><i></i><i></i><i></i></span></div>';
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }
  function removeTyping() {
    // 移除所有打字指示（避免多轮对话残留）
    document.querySelectorAll('#typing-msg').forEach(function (el) { el.remove(); });
  }

  /* ---- 本地知识库兜底回答 ---- */
  window.quickAsk = function (q) {
    $('chat-input').value = q;
    sendChat();
  };
  function localAnswer(question) {
    var hits = KB.search(question, 3);
    if (!hits.length) {
      return '<b>抱歉，知识库暂未检索到与「' + esc(question) + '」直接匹配的内容。</b><br><br>' +
        '建议：① 换个更聚焦的关键词（如"t 检验""置信区间""卡方检验"）；② 尝试下方推荐问题；③ 配置大模型 Key 后获得更开放的生成式答疑。';
    }
    var html = '<b>根据统计学科知识库检索，要点如下：</b><br><br>';
    // 第一个命中：完整讲解（含生动例子）；其余命中：标题引导追问
    hits.forEach(function (h, i) {
      if (i === 0) {
        html += '<b>『' + mdInline(h.title) + '』</b><br>' + mdInline(h.content) + '<br><br>';
        html += '<span class="src-chip">来源</span> <b>' + esc(h.source) + '</b><br><br>';
      } else {
        html += '<span class="src-chip" style="cursor:pointer" onclick="quickAsk(\'' + esc(h.title).replace(/'/g, "\\'") + '\')">➡ ' + esc(h.title) + '</span>';
      }
    });
    if (hits.length > 1) html += '<br><span class="hint">点击上方延伸概念可继续追问</span><br><br>';
    // 相关追问建议
    var related = KB.search(question, 8).slice(hits.length, hits.length + 3);
    if (related.length) {
      html += '<div class="src-ref">💡 <b>延伸思考：</b>' + related.map(function (r) {
        return '<span class="src-chip">' + esc(r.title) + '</span>';
      }).join('') + '<br><span class="hint">点击上方问题可继续追问，或直接输入新问题。</span></div><br>';
    }
    html += '<div class="src-ref">📎 以上内容来自华东师大统计学院课程讲义、高等教育出版社权威教材及开放教材（OpenIntro / NIST），回答可溯源。<br>💡 配置大模型 API Key 后可获得更深入的推导讲解与个性化答疑。</div>';
    return html;
  }

  /* ---- 调用后端（流式） ---- */
  async function callLLM(question, context, onDelta, onDone, onFail) {
    var cfg = getChatConfig();
    var worker = (cfg.workerUrl || 'http://localhost:8787').replace(/\/+$/, '');
    var payload = {
      question: question,
      context: context,
      provider: cfg.provider,
      apiKey: cfg.apiKey,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      history: chatHistory.slice(-6),
      stream: true
    };
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 60000);
    try {
      var resp = await fetch(worker + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!resp.ok) {
        var errJson = await resp.json().catch(function () { return {}; });
        throw new Error(errJson.error || ('HTTP ' + resp.status));
      }
      var ct = resp.headers.get('content-type') || '';
      if (ct.indexOf('text/event-stream') >= 0) {
        // SSE 流式
        var reader = resp.body.getReader();
        var decoder = new TextDecoder();
        var buf = '';
        var sources = [];
        var full = '';
        for (;;) {
          var chunk = await reader.read();
          if (chunk.done) break;
          buf += decoder.decode(chunk.value, { stream: true });
          var parts = buf.split('\n\n');
          buf = parts.pop();
          parts.forEach(function (p) {
            var line = p.trim();
            if (!line || !line.startsWith('data:')) return;
            var data = line.slice(5).trim();
            if (data === '[DONE]') return;
            try {
              var j = JSON.parse(data);
              if (j.delta) { full += j.delta; onDelta(j.delta); }
              if (j.sources) sources = j.sources;
              if (j.done) { onDone(full, sources); }
            } catch (e) { /* 忽略不完整帧 */ }
          });
        }
        onDone(full, sources);
      } else {
        var j2 = await resp.json();
        onDone(j2.answer || '', j2.sources || []);
      }
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') onFail('请求超时（60s），网关可能未部署。请确认 Worker 地址或改用本地知识库模式。');
      else onFail('网关调用失败：' + e.message + '。已切换本地知识库兜底回答。');
    }
  }

  /* ---- 本地文献检索（RAG：600 篇文献摘要参与问答） ---- */
  function litSearchLocal(q, topN) {
    if (!RES || !RES.literature) return [];
    var zhSegs = (q.match(/[\u4e00-\u9fa5]{2,}/g) || []);
    var enWords = (q.toLowerCase().match(/[a-z0-9]{2,}/g) || []);
    var hits = [];
    Object.keys(RES.literature).forEach(function (dir) {
      var lit = RES.literature[dir];
      if (!lit || !lit.items) return;
      lit.items.forEach(function (it) {
        var text = ((it.title || '') + ' ' + (it.abstract || '') + ' ' + (it.source || '')).toLowerCase();
        var score = 0;
        enWords.forEach(function (w) { if (text.indexOf(w) >= 0) score += 2; });
        zhSegs.forEach(function (w) { if (text.indexOf(w) >= 0) score += 2; });
        var cn = lit.cn || '';
        zhSegs.forEach(function (w) { if (cn.indexOf(w) >= 0) score += 1; });
        if (score > 0) hits.push({ score: score, it: it, dir: dir });
      });
    });
    hits.sort(function (a, b) { return b.score - a.score; });
    return hits.slice(0, topN).map(function (h) { return { it: h.it, dir: h.dir }; });
  }

  /* 文献引用 HTML（链接指向 OA 原文/DOI） */
  function litRefHtml(litHits) {
    if (!litHits || !litHits.length) return '';
    var html = '<div class="src-ref">🔗 <b>相关学术文献：</b><br>';
    litHits.forEach(function (h) {
      var it = h.it;
      var link = it.pdf_url || (it.doi ? 'https://doi.org/' + it.doi.replace('https://doi.org/', '') : '');
      var title = esc((it.title || '').slice(0, 46)) + ((it.title || '').length > 46 ? '…' : '');
      html += '• ' + (link ? '<a href="' + link + '" target="_blank" rel="noopener">' + title + '</a>' : title) +
        ' <span class="hint">(' + esc(it.source || '') + ', ' + (it.year || '—') + ')</span><br>';
    });
    html += '</div>';
    return html;
  }

  /* ---- 发送 ---- */
  window.sendChat = function () {
    var input = $('chat-input');
    var q = input.value.trim();
    if (!q) return;
    input.value = '';
    input.style.height = 'auto';
    addMsg('user', esc(q));
    chatHistory.push({ role: 'user', content: q });
    addTyping();

    var cfg = getChatConfig();
    var hits = KB.search(q, 4);
    var litHits = litSearchLocal(q, 3);
    var context = hits.map(function (h) {
      return '[知识点] ' + h.title + '\n' + h.content + '\n[来源] ' + h.source;
    }).join('\n\n');
    if (litHits.length) {
      context += '\n\n【学术文献参考（开放获取）】\n' + litHits.map(function (h) {
        var it = h.it;
        return '[文献] ' + it.title + '（' + (it.source || '') + ', ' + (it.year || '') + '）摘要：' + (it.abstract || '').slice(0, 300) + '【来源】' + (it.source || '开放获取文献');
      }).join('\n\n');
    }
    var litRefsHtml = litRefHtml(litHits);

    var finalize = function (finalHtml, sources) {
      removeTyping();
      var bubble = addMsg('ai', finalHtml + litRefsHtml);
      chatHistory.push({ role: 'assistant', content: '（回答见上）' });
      if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
      // 滚动到底
      var box = $('chat-msgs'); box.scrollTop = box.scrollHeight;
    };

    if (cfg.provider === 'local' || !cfg.apiKey) {
      // 本地兜底
      setTimeout(function () {
        removeTyping();
        finalize(localAnswer(q));
      }, 450);
      return;
    }

    // 走后端
    var acc = '';
    var aiMsg = null;
    var started = false;
    var bubbleEl = null; // 当前消息的气泡元素（避免多轮对话 id 冲突）
    callLLM(q, context,
      function (delta) {
        if (!started) {
          removeTyping();
          var div = document.createElement('div');
          div.className = 'msg ai';
          div.innerHTML = '<div class="avatar">Σ</div><div class="bubble"></div>';
          $('chat-msgs').appendChild(div);
          aiMsg = div;
          bubbleEl = div.querySelector('.bubble');
          started = true;
        }
        acc += delta;
        if (bubbleEl) bubbleEl.innerHTML = mdInline(acc) + '<span class="typing-ind" style="margin-left:6px"><i></i><i></i><i></i></span>';
        var box = $('chat-msgs'); box.scrollTop = box.scrollHeight;
      },
      function (full, sources) {
        if (bubbleEl) {
          var srcHtml = '';
          if (sources && sources.length) {
            srcHtml = '<div class="src-ref">📎 <b>引用来源：</b>' + sources.map(function (s) {
              return '<span class="src-chip">' + esc(s) + '</span>';
            }).join('') + '</div>';
          } else if (hits.length) {
            srcHtml = '<div class="src-ref">📎 <b>引用来源：</b>' + hits.slice(0, 3).map(function (h) {
              return '<span class="src-chip">' + esc(h.source) + '</span>';
            }).join('') + '</div>';
          }
          bubbleEl.innerHTML = mdInline(full || acc) + srcHtml;
        }
        var box = $('chat-msgs'); box.scrollTop = box.scrollHeight;
      },
      function (errMsg) {
        removeTyping();
        finalize(localAnswer(q) + '<br><br><span class="hint">⚠️ ' + esc(errMsg) + '</span>');
      }
    );
  };

  /* Enter 发送 */
  $('chat-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    setTimeout(function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 130) + 'px';
    }.bind(this), 0);
  });

  /* 初始化配置表单 */
  function initChatConfig() {
    var cfg = getChatConfig();
    $('cfg-provider').value = cfg.provider;
    $('cfg-key').value = cfg.apiKey;
    $('cfg-model').value = cfg.model;
    $('cfg-base').value = cfg.baseUrl;
    $('cfg-worker').value = cfg.workerUrl;
    $('cfg-provider').addEventListener('change', function () {
      var p = this.value;
      if (p === 'deepseek') { $('cfg-model').value = 'deepseek-chat'; $('cfg-base').value = 'https://api.deepseek.com'; }
      else if (p === 'siliconflow') { $('cfg-model').value = 'Qwen/Qwen2.5-32B-Instruct'; $('cfg-base').value = 'https://api.siliconflow.cn/v1'; }
      else if (p === 'openai') { $('cfg-model').value = ''; $('cfg-base').value = ''; }
    });
    updateChatStatus();
  }

  /* ==========================================================
   * 二、数据分析 Agent 模块
   * ========================================================== */
  var currentData = null; // {headers, rows, types, cleaned, meta}

  /* 上传 */
  var zone = $('upload-zone');
  zone.addEventListener('click', function () { $('file-input').click(); });
  zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', function () { zone.classList.remove('drag'); });
  zone.addEventListener('drop', function (e) {
    e.preventDefault(); zone.classList.remove('drag');
    var f = e.dataTransfer.files[0];
    if (f) readFile(f);
  });
  $('file-input').addEventListener('change', function () {
    var f = this.files[0];
    if (f) readFile(f);
  });

  function readFile(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var text = e.target.result;
      loadDataText(text, file.name);
    };
    // 尝试 UTF-8；失败则 GBK
    reader.readAsText(file, 'utf-8');
  }

  function loadExample(name) {
    var ex = S.examples[name];
    if (!ex) return;
    loadDataText(ex.text, ex.name);
  }
  window.loadExample = loadExample;

  function loadDataText(text, name) {
    var parsed = S.parseDelimited(text);
    if (parsed.errors && parsed.errors.length) { alert('解析失败：' + parsed.errors.join('；')); return; }
    var types = S.inferTypes(parsed.rows, parsed.headers);
    var cleaned = S.cleanRows(parsed.rows, parsed.headers, types);
    currentData = { headers: parsed.headers, rows: cleaned, types: types, meta: { name: name || '上传数据' } };
    $('data-result').style.display = 'block';
    switchDataTab('overview');
    renderOverview();
    renderQuality();
    // 自动触发一次分析
    runAutoAnalyze();
  }

  window.switchDataTab = function (tab) {
    document.querySelectorAll('.data-tabs button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-pane').forEach(function (p) { p.style.display = 'none'; });
    $('tab-' + tab).style.display = 'block';
    if (tab === 'charts' && currentData) renderCharts();
    if (tab === 'inference' && currentData) renderInference();
    if (tab === 'describe' && currentData) renderDescribeTable();
    if (tab === 'report' && currentData) renderReport();
  };

  function renderOverview() {
    var d = currentData;
    var n = d.rows.length;
    var numC = d.types.filter(function (t) { return t.type === 'numeric'; }).length;
    var catC = d.types.filter(function (t) { return t.type === 'categorical'; }).length;
    var missTotal = 0;
    d.types.forEach(function (t) { missTotal += t.missing; });
    $('stat-cards').innerHTML = [
      statCard(n, '样本量（行）'),
      statCard(d.headers.length, '变量数'),
      statCard(numC + ' / ' + catC, '数值 / 分类变量'),
      statCard(((missTotal / (n * d.headers.length)) * 100).toFixed(1) + '%', '整体缺失率')
    ].join('');
    // 变量 chips
    $('var-chips').innerHTML = d.types.map(function (t) {
      var cls = t.type === 'numeric' ? 'num' : t.type === 'categorical' ? 'cat' : '';
      var icon = t.type === 'numeric' ? '🔢' : t.type === 'categorical' ? '🏷️' : '⬜';
      return '<span class="var-chip ' + cls + '">' + icon + ' ' + esc(t.name) + ' <span class="hint">(' + t.unique + '值' + (t.type === 'numeric' ? '·缺失' + (t.missingRate * 100).toFixed(0) + '%' : '') + ')</span></span>';
    }).join('');
    // 预览表
    var html = '<table class="grid"><thead><tr><th>#</th>';
    d.headers.forEach(function (h) { html += '<th>' + esc(h) + '</th>'; });
    html += '</tr></thead><tbody>';
    d.rows.slice(0, 50).forEach(function (r, i) {
      html += '<tr><td>' + (i + 1) + '</td>';
      d.headers.forEach(function (h) {
        var v = r[h];
        var t = d.types.find(function (x) { return x.name === h; });
        var cls = t && t.type === 'categorical' ? ' class="cat"' : '';
        var show = (v == null || v === '') ? '<span class="hint">(缺失)</span>' : esc(String(v));
        html += '<td' + cls + '>' + show + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    $('data-preview').innerHTML = html;
  }
  function statCard(v, label) {
    return '<div class="stat-card"><b>' + v + '</b><span>' + label + '</span></div>';
  }

  function renderQuality() {
    var d = currentData;
    var qr = S.qualityReport(d.rows, d.headers, d.types);
    var html = '';
    if (qr.issues.length) {
      html += '<div class="warn-box">⚠️ 检出 ' + qr.issues.length + ' 项数据质量提示：<br>' +
        qr.issues.map(function (i) { return '&nbsp;&nbsp;• ' + esc(i); }).join('<br>') + '</div>';
    } else {
      html += '<div style="color:var(--ok);font-weight:600">✓ 未发现明显缺失与异常值问题，数据质量良好。</div>';
    }
    html += '<table class="grid" style="margin-top:12px"><thead><tr><th>变量</th><th>类型</th><th>样本量</th><th>缺失数</th><th>缺失率</th><th>唯一值</th></tr></thead><tbody>';
    d.types.forEach(function (t) {
      html += '<tr><td>' + esc(t.name) + '</td><td>' + (t.type === 'numeric' ? '数值' : t.type === 'categorical' ? '分类' : '空') + '</td>' +
        '<td>' + (d.rows.length - t.missing) + '</td><td>' + t.missing + '</td><td>' + (t.missingRate * 100).toFixed(1) + '%</td><td>' + t.unique + '</td></tr>';
    });
    html += '</tbody></table>';
    $('quality-report').innerHTML = html;
  }

  function renderDescribeTable() {
    var d = currentData;
    var nums = d.types.filter(function (t) { return t.type === 'numeric'; });
    if (!nums.length) { $('describe-table').innerHTML = '<p class="hint">未检测到数值型变量。</p>'; return; }
    var html = '<table class="grid"><thead><tr><th>变量</th><th>n</th><th>均值</th><th>中位数</th><th>标准差</th><th>标准误</th><th>Q1</th><th>Q3</th><th>IQR</th><th>偏度</th><th>峰度</th><th>95%CI</th></tr></thead><tbody>';
    nums.forEach(function (t) {
      var vals = d.rows.map(function (r) { return r[t.name]; }).filter(function (v) { return v != null && !isNaN(v); });
      var ds = S.describe(vals);
      html += '<tr><td>' + esc(t.name) + '</td><td>' + ds.n + '</td><td>' + S.fmtNum(ds.mean) + '</td><td>' + S.fmtNum(ds.median) + '</td>' +
        '<td>' + S.fmtNum(ds.sd) + '</td><td>' + S.fmtNum(ds.se) + '</td><td>' + S.fmtNum(ds.q1) + '</td><td>' + S.fmtNum(ds.q3) + '</td>' +
        '<td>' + S.fmtNum(ds.iqr) + '</td><td>' + S.fmtNum(ds.skew) + '</td><td>' + S.fmtNum(ds.kurt) + '</td>' +
        '<td>[' + S.fmtNum(ds.ci95_lo) + ', ' + S.fmtNum(ds.ci95_hi) + ']</td></tr>';
    });
    html += '</tbody></table>';
    html += '<p class="hint" style="margin-top:8px">偏度 |skew|&gt;1 提示明显偏态；峰度 &gt;0 为尖峰、&lt;0 为平峰。严重偏态可考虑对数变换或非参数方法。</p>';
    $('describe-table').innerHTML = html;
  }

  function renderInference() {
    var d = currentData;
    var analysis = S.autoAnalyze(d.rows, d.headers, d.types);
    var html = '';
    // 分组比较
    var nums = d.types.filter(function (t) { return t.type === 'numeric'; }).map(function (t) { return t.name; });
    var cats = d.types.filter(function (t) { return t.type === 'categorical'; }).map(function (t) { return t.name; });

    html += '<div class="card"><h3>🔬 假设检验结果</h3>';
    var tested = false;
    nums.forEach(function (num) {
      cats.forEach(function (cat) {
        var map = {}, names = [];
        d.rows.forEach(function (r) {
          var v = r[num];
          if (v == null || isNaN(v)) return;
          var k = String(r[cat] == null ? '(缺失)' : r[cat]);
          if (!map[k]) { map[k] = []; names.push(k); }
          map[k].push(v);
        });
        var gs = names.map(function (k) { return map[k]; }).filter(function (g) { return g.length >= 2; });
        var gNames = names.filter(function (_, i) { return map[names[i]].length >= 2; });
        if (gs.length < 2 || gs.length > 8) return;
        tested = true;
        html += '<div style="border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:12px">';
        html += '<b style="color:var(--primary)">' + esc(num) + ' × ' + esc(cat) + '</b> —— ' + (gs.length === 2 ? '两组比较' : gs.length + ' 组比较') + '<br>';
        if (gs.length === 2) {
          var t = S.tTestIndependent(gs[0], gs[1]);
          if (t) {
            var sig = t.significant ? '<span style="color:var(--ok);font-weight:700">显著</span>' : '<span style="color:var(--muted)">不显著</span>';
            html += '<span class="hint">' + esc(t.method) + '：t = ' + S.fmtNum(t.t, 3) + '，df = ' + S.fmtNum(t.df, 1) + '，P = ' + S.fmtP(t.p) + '，Cohen\'s d = ' + S.fmtNum(t.cohenD, 3) + '</span><br>';
            html += '结论：两组均值差异<b> ' + sig + ' </b>（' + esc(gNames[0]) + '：' + S.fmtNum(t.meanA) + ' ± ' + S.fmtNum(t.sdA) + '；' + esc(gNames[1]) + '：' + S.fmtNum(t.meanB) + ' ± ' + S.fmtNum(t.sdB) + '）';
            var w = S.wilcoxonRankSum(gs[0], gs[1]);
            if (w) {
              html += '<br><span class="hint">🔒 非参数对照（' + esc(w.method) + '）：z = ' + S.fmtNum(w.z, 3) + '，P = ' + S.fmtP(w.p) + '，结论' + (t.significant === w.significant ? '<b style="color:var(--ok)">一致</b>' : '<b style="color:var(--warn)">不一致</b>（数据可能偏离正态）') + '</span>';
            }
          }
        } else {
          var av = S.anovaOneWay(gs, gNames);
          if (av) {
            var sig2 = av.significant ? '<span style="color:var(--ok);font-weight:700">显著</span>' : '<span style="color:var(--muted)">不显著</span>';
            html += '<span class="hint">' + esc(av.method) + '：F(' + av.df1 + ', ' + av.df2 + ') = ' + S.fmtNum(av.F, 3) + '，P = ' + S.fmtP(av.p) + '，η² = ' + S.fmtNum(av.eta2, 3) + '</span><br>';
            html += '结论：组间差异<b> ' + sig2 + ' </b><br>';
            html += '<span class="hint">组均值：' + av.groupStats.map(function (g) { return esc(g.name) + '=' + S.fmtNum(g.mean); }).join('，') + '</span>';
            var kw = S.kruskalWallis(gs);
            if (kw) {
              html += '<br><span class="hint">🔒 非参数对照（Kruskal-Wallis）：H(' + kw.df + ') = ' + S.fmtNum(kw.H, 3) + '，P = ' + S.fmtP(kw.p) + '，结论' + (av.significant === kw.significant ? '<b style="color:var(--ok)">一致</b>' : '<b style="color:var(--warn)">不一致</b>（数据可能偏离正态）') + '</span>';
            }
            if (av.significant) {
              html += '<br><span class="hint">两两比较（Bonferroni 校正）：</span><br>';
              av.pairs.forEach(function (pr) {
                html += '<span class="hint">&nbsp;&nbsp;• ' + esc(pr.groupA) + ' vs ' + esc(pr.groupB) + '：差 ' + S.fmtNum(pr.diff) + '，P<sub>adj</sub> = ' + S.fmtP(pr.adjP) + (pr.significant ? ' <b style="color:var(--ok)">✓</b>' : '') + '</span><br>';
              });
            }
          }
        }
        html += '</div>';
      });
    });
    if (!tested) html += '<p class="hint">未检测到合适的分组变量（分类变量每组需 ≥2 个观测），跳过分组检验。</p>';
    html += '</div>';

    // 相关
    if (nums.length >= 2) {
      html += '<div class="card"><h3>🔗 相关分析（Pearson）</h3><table class="grid"><thead><tr><th>变量对</th><th>r</th><th>P</th><th>结论</th></tr></thead><tbody>';
      for (var i = 0; i < nums.length; i++) {
        for (var j = i + 1; j < nums.length; j++) {
          var pairs = [];
          d.rows.forEach(function (r) {
            var a = r[nums[i]], b = r[nums[j]];
            if (a != null && b != null && !isNaN(a) && !isNaN(b)) pairs.push([a, b]);
          });
          if (pairs.length < 3) continue;
          var pr = S.pearson(pairs.map(function (p) { return p[0]; }), pairs.map(function (p) { return p[1]; }));
          if (!pr) continue;
          html += '<tr><td>' + esc(nums[i]) + ' × ' + esc(nums[j]) + '</td><td>' + S.fmtNum(pr.r, 3) + '</td><td>' + S.fmtP(pr.p) + '</td><td>' + (pr.significant ? '<b style="color:var(--ok)">显著相关</b>' : '不显著') + '</td></tr>';
        }
      }
      html += '</tbody></table><p class="hint" style="margin-top:8px">相关不代表因果；显著相关也可能源于混淆变量。</p></div>';
    }

    // 回归
    if (nums.length >= 2 && d.rows.length >= 8) {
      var yName = nums[0], xNames = nums.slice(1, Math.min(5, nums.length));
      var X = [], y = [];
      d.rows.forEach(function (r) {
        if (r[yName] == null || isNaN(r[yName])) return;
        var rowX = xNames.map(function (c) {
          if (r[c] != null && !isNaN(r[c])) return r[c];
          var colVals = d.rows.map(function (rr) { return rr[c]; }).filter(function (v) { return v != null && !isNaN(v); });
          return S.mean(colVals);
        });
        if (rowX.some(function (v) { return isNaN(v); })) return;
        X.push(rowX); y.push(r[yName]);
      });
      if (X.length >= xNames.length + 3) {
        var reg = S.ols(X, y, xNames);
        if (reg) {
          html += '<div class="card"><h3>📈 线性回归（因变量：' + esc(yName) + '）</h3>';
          html += '<span class="hint">模型：' + esc(reg.formula) + '</span><br><br>';
          html += '<table class="grid"><thead><tr><th>项</th><th>系数</th><th>标准误</th><th>t</th><th>P</th><th>显著</th></tr></thead><tbody>';
          reg.coefTable.forEach(function (c) {
            html += '<tr><td>' + esc(c.name) + '</td><td>' + S.fmtNum(c.coef) + '</td><td>' + S.fmtNum(c.se) + '</td><td>' + S.fmtNum(c.t, 3) + '</td><td>' + S.fmtP(c.p) + '</td><td>' + (c.significant ? '✓' : '—') + '</td></tr>';
          });
          html += '</tbody></table>';
          html += '<p class="hint" style="margin-top:8px">R² = ' + S.fmtNum(reg.r2, 3) + '，调整 R² = ' + S.fmtNum(reg.adjR2, 3) + '，F(' + (reg.k - 1) + ', ' + (reg.n - reg.k) + ') = ' + S.fmtNum(reg.f, 3) + '，P = ' + S.fmtP(reg.fP) + '</p>';
          html += '</div>';
        }
      }
    }

    // 卡方
    if (cats.length >= 2) {
      var c1 = cats[0], c2 = cats[1];
      var cs1 = Array.from(new Set(d.rows.map(function (r) { return String(r[c1]); }).filter(Boolean)));
      var cs2 = Array.from(new Set(d.rows.map(function (r) { return String(r[c2]); }).filter(Boolean)));
      if (cs1.length >= 2 && cs2.length >= 2 && cs1.length <= 6 && cs2.length <= 6) {
        var matrix = cs1.map(function (a) { return cs2.map(function (b) { return d.rows.filter(function (r) { return String(r[c1]) === a && String(r[c2]) === b; }).length; }); });
        var chi = S.chi2Test(matrix);
        if (chi) {
          html += '<div class="card"><h3>🏷️ 卡方检验：' + esc(c1) + ' × ' + esc(c2) + '</h3>';
          html += '<span class="hint">χ² = ' + S.fmtNum(chi.chi2, 3) + '，df = ' + chi.df + '，P = ' + S.fmtP(chi.p) + '，Cramér\'s V = ' + S.fmtNum(chi.cramersV, 3) + '</span><br>';
          html += '结论：' + (chi.significant ? '<b style="color:var(--ok)">两个分类变量存在显著关联</b>' : '未发现显著关联');
          if (chi.warn) html += '<br><span class="hint">⚠️ ' + esc(chi.warn) + '</span>';
          html += '</div>';
        }
      }
    }

    $('inference-result').innerHTML = html;
  }

  function renderCharts() {
    var d = currentData;
    var nums = d.types.filter(function (t) { return t.type === 'numeric'; }).map(function (t) { return t.name; });
    var cats = d.types.filter(function (t) { return t.type === 'categorical'; }).map(function (t) { return t.name; });
    var html = '';

    function chartCard(id, title) {
      return '<div class="chart-card"><canvas id="' + id + '"></canvas><div class="chart-cap">' + title + '</div></div>';
    }
    function numVals(name) {
      return d.rows.map(function (r) { return r[name]; }).filter(function (v) { return v != null && !isNaN(v); });
    }

    if (nums.length) {
      var v0 = numVals(nums[0]);
      if (v0.length > 3) {
        html += chartCard('chart-hist', '直方图与正态拟合 · ' + esc(nums[0]));
      }
      if (v0.length >= 5) {
        html += chartCard('chart-qq', 'Q-Q 正态图 · ' + esc(nums[0]));
      }
    }
    // 箱线图（第一个分组比较）
    if (nums.length && cats.length) {
      var map = {}, names = [];
      d.rows.forEach(function (r) {
        var v = r[nums[0]];
        if (v == null || isNaN(v)) return;
        var k = String(r[cats[0]] == null ? '(缺失)' : r[cats[0]]);
        if (!map[k]) { map[k] = []; names.push(k); }
        map[k].push(v);
      });
      var gs = names.map(function (k) { return map[k]; }).filter(function (g) { return g.length >= 3; });
      var gNames = names.filter(function (_, i) { return map[names[i]].length >= 3; });
      if (gs.length >= 2 && gs.length <= 8) {
        html += chartCard('chart-box', '分组箱线图 · ' + esc(nums[0]) + ' by ' + esc(cats[0]));
      }
    }
    // 散点图（回归）
    if (nums.length >= 2) {
      var pts = [];
      d.rows.forEach(function (r) {
        var a = r[nums[0]], b = r[nums[1]];
        if (a != null && b != null && !isNaN(a) && !isNaN(b)) pts.push([a, b]);
      });
      if (pts.length >= 5) {
        html += chartCard('chart-scatter', '散点图与相关 · ' + esc(nums[0]) + ' vs ' + esc(nums[1]));
      }
    }
    // 热力图
    if (nums.length >= 2) {
      var mat = S.corrMatrix(nums, d.rows);
      html += '<div class="chart-card" style="grid-column:1/-1"><canvas id="chart-heat" style="margin:0 auto"></canvas><div class="chart-cap">相关矩阵热力图</div></div>';
    }

    $('charts-area').innerHTML = html || '<p class="hint">无可视化数据（需要数值型变量）。</p>';

    // 绘制
    setTimeout(function () {
      if (nums.length && numVals(nums[0]).length > 3) {
        S.drawHistogram($('chart-hist'), numVals(nums[0]), { fitNormal: true, xLabel: nums[0], title: '分布形态' });
      }
      if (nums.length && numVals(nums[0]).length >= 5) {
        S.drawQQ($('chart-qq'), numVals(nums[0]));
      }
      if (nums.length && cats.length) {
        var gs2 = names.map(function (k) { return map[k]; }).filter(function (g) { return g.length >= 3; });
        var gNames2 = names.filter(function (_, i) { return map[names[i]].length >= 3; });
        if (gs2.length >= 2 && gs2.length <= 8) {
          S.drawBoxplot($('chart-box'), gs2.map(function (g, i) { return { name: gNames2[i], values: g }; }), { yLabel: nums[0] });
        }
      }
      if (nums.length >= 2) {
        var pts2 = [];
        d.rows.forEach(function (r) {
          var a = r[nums[0]], b = r[nums[1]];
          if (a != null && b != null && !isNaN(a) && !isNaN(b)) pts2.push([a, b]);
        });
        if (pts2.length >= 5) {
          S.drawScatter($('chart-scatter'),
            pts2.map(function (p) { return p[0]; }), pts2.map(function (p) { return p[1]; }),
            { fitLine: true, xLabel: nums[0], yLabel: nums[1] });
        }
      }
      if (nums.length >= 2) {
        var mat = S.corrMatrix(nums, d.rows);
        S.drawHeatmap($('chart-heat'), mat, nums);
      }
    }, 60);
  }

  var lastReport = '';
  function renderReport() {
    var d = currentData;
    var analysis = S.autoAnalyze(d.rows, d.headers, d.types);
    lastReport = analysis.markdown;
    $('report-box').innerHTML = mdToHtml(analysis.markdown);
  }
  window.copyReport = function () {
    if (!lastReport) return;
    navigator.clipboard.writeText(lastReport).then(function () { alert('报告已复制到剪贴板'); });
  };
  window.downloadReport = function () {
    if (!lastReport) return;
    var blob = new Blob(['# 统计学学科大模型 · 数据分析报告\n\n' + lastReport], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '统计分析报告_' + Date.now() + '.md';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  window.runAutoAnalyze = function () {
    if (!currentData) { alert('请先上传数据或加载示例数据'); return; }
    var btn = event && event.target;
    if (btn) { btn.textContent = '⏳ 分析中…'; btn.disabled = true; }
    setTimeout(function () {
      renderDescribeTable();
      renderInference();
      renderCharts();
      renderReport();
      if (btn) { btn.textContent = '▶ 一键全量分析'; btn.disabled = false; }
      switchDataTab('report');
    }, 80);
  };

  /* ---- 功效分析计算器 ---- */
  window.calcPower = function () {
    var d = parseFloat($('pw-d').value), n = parseInt($('pw-n').value, 10), a = parseFloat($('pw-a').value);
    var r = S.powerTTest(d, n, a);
    var box = $('pw-result');
    if (!r) { box.innerHTML = '<span class="warn-box">参数无效</span>'; return; }
    var label = r.power >= 0.8 ? '<span style="color:var(--ok);font-weight:700">✓ 功效充足</span>' : (r.power >= 0.5 ? '<span style="color:var(--warn);font-weight:700">⚠ 功效偏低</span>' : '<span style="color:var(--danger);font-weight:700">✗ 功效不足</span>');
    box.innerHTML = '独立样本 t 检验功效：<b>' + (r.power * 100).toFixed(1) + '%</b>　' + label +
      '<br><span class="hint">α=' + a + '，效应量 d=' + d + '，每组 n=' + n + '，df=' + r.df + '，t*=' + S.fmtNum(r.tCrit, 2) + '；第二类错误 β=' + (r.beta * 100).toFixed(1) + '%</span>' +
      '<br><span class="hint">💡 推荐：为达到 80% 功效，每组至少需要 <b style="color:var(--primary)">' + S.requiredSampleSize(d, a, 0.8) + '</b> 个样本（当前 ' + n + '）。</span>';
  };
  window.calcSampleSize = function () {
    var d = parseFloat($('pw-d').value), a = parseFloat($('pw-a').value);
    var n = S.requiredSampleSize(d, a, 0.8);
    var box = $('pw-result');
    box.innerHTML = '要达到 <b>80% 功效</b>，在 α=' + a + '、效应量 d=' + d + ' 下，每组所需样本量：<b style="font-size:17px;color:var(--primary)">' + n + '</b>' +
      (n < 0 ? '（当前设定下难以达到，请增大效应量）' : ' 人<br><span class="hint">双组总样本量 ≈ ' + (n * 2) + '。公式：n ≈ (z₁₋α/₂ + z₁₋β)² × 2 / d²</span>');
  };

  /* ==========================================================
   * 三、多模态可视化实验室
   * ========================================================== */
  var VIZ = {
    clt: { title: '中心极限定理', desc: '从任意分布（可选）反复抽样，观察样本均值的分布随样本量 n 增大趋于正态。' },
    lln: { title: '大数定律', desc: '样本均值随 n 增大依概率收敛于总体均值 μ。' },
    ci: { title: '置信区间模拟', desc: '重复抽样并构造 95% 置信区间，观察覆盖率是否接近 95%。' },
    power: { title: '假设检验功效', desc: '调节效应量 d、样本量 n 与显著性水平 α，观察检验功效（1−β）与两类错误的变化。' },
    normal: { title: '正态分布曲线', desc: '调节均值 μ 与标准差 σ，观察概率密度曲线形态与区间概率。' },
    reg: { title: '回归拟合演示', desc: '拖动数据点，观察最小二乘回归线的变化与残差。' },
    tdist: { title: 't 分布 vs 正态分布', desc: '自由度 df 越小，t 分布尾部越厚、中心越低——这是小样本用 t 分布而不用正态分布的原因。' },
    chi2: { title: '卡方分布', desc: '自由度 k 决定 χ² 分布形态（偏态→近似正态），着色 α 尾部即拒绝域，用于卡方检验。' },
    errors: { title: '两类错误模拟', desc: 'α 是第一类错误（误拒），β 是第二类错误（漏拒）。调节 α 与功效，观察决策矩阵四象限的变化。' },
    pvalue: { title: 'P 值动画', desc: 'P 值 = H₀ 为真时出现"当前或更极端"观测的概率。移动观测值，观察绿色 P 值区域与红色拒绝域的关系。' }
  };
  var vizState = { current: 'clt', anim: null };

  window.initViz = function () { renderViz('clt'); };

  function renderVizMenu() {
    var menu = $('viz-menu');
    menu.innerHTML = '';
    Object.keys(VIZ).forEach(function (k) {
      var b = document.createElement('button');
      b.dataset.viz = k;
      b.className = k === vizState.current ? 'active' : '';
      b.innerHTML = '<span class="vi">' + ({ clt: '🎲', lln: '📉', ci: '🎯', power: '⚡', normal: '🔔', reg: '📈', tdist: '🧪', chi2: '📊', errors: '⚖️', pvalue: '🔍' }[k]) + '</span>' + VIZ[k].title;
      b.onclick = function () { renderViz(k); };
      menu.appendChild(b);
    });
  }

  function renderViz(key) {
    vizState.current = key;
    // 停止旧实验的定时器/监听器
    if (vizState.stopFn) { try { vizState.stopFn(); } catch (e) { /* ignore */ } vizState.stopFn = null; }
    renderVizMenu();
    $('viz-title').textContent = VIZ[key].title;
    var controls = $('viz-controls');
    var notes = $('viz-notes');
    controls.innerHTML = '';
    notes.innerHTML = '<b>📖 教学要点：</b>' + VIZ[key].desc + '<br><br><b>💡 操作：</b>调节下方参数观察变化' + (key === 'reg' ? '，点击画布可添加数据点，拖动点可改变数据' : '');
    var canvas = $('viz-canvas');

    var fns = {
      clt: function () {
        controls.innerHTML =
          '<div class="param-row"><label>总体分布</label><select id="vp-dist">' +
          '<option value="uniform">均匀分布</option><option value="exp">指数分布（偏态）</option>' +
          '<option value="binom">二项分布</option><option value="custom">自定义离散</option></select></div>' +
          '<div class="param-row"><label>样本量 n</label><input type="range" id="vp-n" min="2" max="50" value="5"><output id="vp-nv">5</output></div>' +
          '<div class="param-row"><label>抽样次数 m</label><input type="range" id="vp-m" min="100" max="2000" value="600"><output id="vp-mv">600</output></div>';
        bindRange('vp-n', 'vp-nv'); bindRange('vp-m', 'vp-mv');
        var n = 5, m = 600, dist = 'uniform';
        function sample() {
          var v;
          if (dist === 'uniform') v = Math.random() * 6;
          else if (dist === 'exp') v = -Math.log(1 - Math.random()) * 2;
          else if (dist === 'binom') v = (Math.random() < 0.3 ? 0 : 1);
          else v = Math.floor(Math.random() * 6) + 1;
          return v;
        }
        function draw() {
          var ctx = canvas.getContext('2d');
          var w = canvas.width, h = canvas.height;
          ctx.clearRect(0, 0, w, h);
          // 左侧：总体分布直方图
          ctx.fillStyle = '#F5F7FA'; ctx.fillRect(20, 20, w / 2 - 40, h - 60);
          // 右侧：样本均值分布
          var means = [];
          for (var i = 0; i < m; i++) {
            var s = 0;
            for (var j = 0; j < n; j++) s += sample();
            means.push(s / n);
          }
          var mu = dist === 'exp' ? 2 : dist === 'binom' ? 0.3 : 3.5;
          var sigma = dist === 'exp' ? 2 : dist === 'binom' ? Math.sqrt(0.21) : Math.sqrt(3);
          var se = sigma / Math.sqrt(n);
          // 右图
          var rx = w / 2 + 20, rw = w / 2 - 40, ry = 20, rh = h - 100;
          var lo = mu - 4 * se, hi = mu + 4 * se;
          if (n <= 2) { lo = Math.min.apply(null, means); hi = Math.max.apply(null, means); }
          var bins = 24, bw = (hi - lo) / bins;
          var counts = new Array(bins).fill(0);
          means.forEach(function (v) {
            var idx = Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / bw)));
            counts[idx]++;
          });
          var maxC = Math.max.apply(null, counts);
          ctx.strokeStyle = '#D8DEE6'; ctx.strokeRect(rx, ry, rw, rh);
          for (var b2 = 0; b2 < bins; b2++) {
            var bh = counts[b2] / maxC * (rh - 24);
            ctx.fillStyle = 'rgba(30,58,95,0.72)';
            ctx.fillRect(rx + b2 * (rw / bins) + 1, ry + rh - 24 - bh, rw / bins - 2, bh);
          }
          // 理论正态曲线
          ctx.strokeStyle = '#C9B037'; ctx.lineWidth = 2; ctx.beginPath();
          for (var px = 0; px <= rw; px += 2) {
            var vx = lo + px / rw * (hi - lo);
            var pdf = Math.exp(-(vx - mu) * (vx - mu) / (2 * se * se)) / (se * Math.sqrt(2 * Math.PI));
            var yy = ry + rh - 24 - pdf * (m * bw) / maxC * (rh - 24);
            if (px === 0) ctx.moveTo(rx + px, yy); else ctx.lineTo(rx + px, yy);
          }
          ctx.stroke();
          ctx.fillStyle = '#1E3A5F'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('样本均值分布（n=' + n + '，m=' + m + ' 次抽样）', rx + rw / 2, ry + 14);
          ctx.fillStyle = '#C9B037'; ctx.font = '11px sans-serif';
          ctx.fillText('理论正态 N(μ, σ²/n)', rx + rw * 0.75, ry + 28);
          // 左图：总体分布采样
          var lx = 20, lw = w / 2 - 40;
          ctx.strokeStyle = '#D8DEE6'; ctx.strokeRect(lx, ry, lw, rh);
          var raw = [];
          for (var k = 0; k < 2000; k++) raw.push(sample());
          var rLo = Math.min.apply(null, raw), rHi = Math.max.apply(null, raw);
          var rBins = 20, rBw = (rHi - rLo) / rBins || 1;
          var rCounts = new Array(rBins).fill(0);
          raw.forEach(function (v) { rCounts[Math.min(rBins - 1, Math.max(0, Math.floor((v - rLo) / rBw)))]++; });
          var rMax = Math.max.apply(null, rCounts);
          for (var rb = 0; rb < rBins; rb++) {
            ctx.fillStyle = 'rgba(58,107,158,0.6)';
            ctx.fillRect(lx + rb * (lw / rBins) + 1, ry + rh - 24 - rCounts[rb] / rMax * (rh - 24), lw / rBins - 2, rCounts[rb] / rMax * (rh - 24));
          }
          ctx.fillStyle = '#1E3A5F'; ctx.font = '13px sans-serif';
          ctx.fillText('总体分布（2000 次采样）', lx + lw / 2, ry + 14);
          // 结论文字
          ctx.fillStyle = '#44566C'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
          ctx.fillText('观察：n 越大，样本均值分布越窄、越接近正态（红色曲线）', 20, h - 18);
        }
        var timer = setInterval(function () {
          n = +$('vp-n').value; m = +$('vp-m').value; dist = $('vp-dist').value;
          draw();
        }, 50);
        return function () { clearInterval(timer); };
      },
      lln: function () {
        controls.innerHTML =
          '<div class="param-row"><label>总体分布</label><select id="vp-dist2">' +
          '<option value="uniform">均匀分布 μ=3.5</option><option value="exp">指数分布 μ=2</option>' +
          '<option value="binom">二项(0/1) μ=0.3</option></select></div>' +
          '<div class="param-row"><label>抽样次数</label><input type="range" id="vp-m2" min="50" max="3000" value="800"><output id="vp-m2v">800</output></div>';
        bindRange('vp-m2', 'vp-m2v');
        function draw() {
          var ctx = canvas.getContext('2d');
          var w = canvas.width, h = canvas.height;
          ctx.clearRect(0, 0, w, h);
          var dist = $('vp-dist2').value;
          var m = +$('vp-m2').value;
          var mu = dist === 'exp' ? 2 : dist === 'binom' ? 0.3 : 3.5;
          function sample() {
            if (dist === 'exp') return -Math.log(1 - Math.random()) * 2;
            if (dist === 'binom') return Math.random() < 0.3 ? 1 : 0;
            return Math.random() * 6;
          }
          var sums = 0, pts = [];
          for (var i = 1; i <= m; i++) {
            sums += sample();
            if (i <= 100 || i % Math.ceil(m / 120) === 0) pts.push([i, sums / i]);
          }
          // 坐标
          var padL = 60, padB = 44, padT = 24;
          var plotW = w - padL - 24, plotH = h - padB - padT;
          var yLo = dist === 'binom' ? 0 : 0, yHi = dist === 'exp' ? 4 : dist === 'binom' ? 0.6 : 7;
          ctx.strokeStyle = '#E8ECF1'; ctx.lineWidth = 1;
          for (var g = 0; g <= 5; g++) {
            var gy = padT + (yHi - (yLo + (yHi - yLo) * g / 5)) / (yHi - yLo) * plotH;
            ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(w - 24, gy); ctx.stroke();
          }
          ctx.strokeStyle = '#B0B7C3';
          ctx.beginPath(); ctx.moveTo(padL, h - padB); ctx.lineTo(w - 24, h - padB); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, h - padB); ctx.stroke();
          // 目标线 μ
          ctx.strokeStyle = '#C9B037'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
          var muY = padT + (yHi - mu) / (yHi - yLo) * plotH;
          ctx.beginPath(); ctx.moveTo(padL, muY); ctx.lineTo(w - 24, muY); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#C9B037'; ctx.font = '12px sans-serif';
          ctx.fillText('总体均值 μ = ' + mu, w - 150, muY - 8);
          // 均值轨迹
          ctx.strokeStyle = 'rgba(30,58,95,0.85)'; ctx.lineWidth = 1.8; ctx.beginPath();
          pts.forEach(function (p, i2) {
            var x = padL + p[0] / m * plotW;
            var y = padT + (yHi - p[1]) / (yHi - yLo) * plotH;
            if (i2 === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
          ctx.stroke();
          // 坐标标签
          ctx.fillStyle = '#6B7280'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('样本量 n', w / 2, h - 14);
          ctx.save(); ctx.translate(12, padT + 8); ctx.fillText('样本均值 X̄ₙ', 0, 0); ctx.restore();
          ctx.textAlign = 'left'; ctx.fillStyle = '#1E3A5F'; ctx.font = '13px sans-serif';
          ctx.fillText('大数定律：X̄ₙ 依概率收敛于 μ（n=' + m + '，X̄=' + (sums / m).toFixed(3) + '）', padL, 16);
        }
        var timer = setInterval(draw, 50);
        return function () { clearInterval(timer); };
      },
      ci: function () {
        controls.innerHTML =
          '<div class="param-row"><label>置信水平</label><input type="range" id="vp-alpha" min="80" max="99" value="95"><output id="vp-alphav">95%</output></div>' +
          '<div class="param-row"><label>重复抽样次数</label><input type="range" id="vp-ci-m" min="20" max="100" value="40"><output id="vp-ci-mv">40</output></div>' +
          '<div class="param-row"><label>样本量</label><input type="range" id="vp-ci-n" min="5" max="100" value="30"><output id="vp-ci-nv">30</output></div>';
        bindRange('vp-alpha', 'vp-alphav', function (v) { return v + '%'; });
        bindRange('vp-ci-m', 'vp-ci-mv'); bindRange('vp-ci-n', 'vp-ci-nv');
        function draw() {
          var ctx = canvas.getContext('2d');
          var w = canvas.width, h = canvas.height;
          ctx.clearRect(0, 0, w, h);
          var conf = +$('vp-alpha').value / 100;
          var m = +$('vp-ci-m').value;
          var n = +$('vp-ci-n').value;
          var mu = 10, sigma = 2;
          var alpha = 1 - conf;
          var tCrit = S.tInv(n - 1, 1 - alpha / 2);
          var covered = 0, intervals = [];
          for (var i = 0; i < m; i++) {
            var vals = [];
            for (var j = 0; j < n; j++) vals.push(mu + sigma * randn());
            var meanV = S.mean(vals), seV = S.sd(vals) / Math.sqrt(n);
            var lo = meanV - tCrit * seV, hi = meanV + tCrit * seV;
            intervals.push([lo, hi, lo <= mu && hi >= mu]);
            if (lo <= mu && hi >= mu) covered++;
          }
          var yStep = (h - 80) / m;
          ctx.strokeStyle = '#E8ECF1';
          ctx.beginPath(); ctx.moveTo(80, 20); ctx.lineTo(80, h - 60); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(80, h - 60); ctx.lineTo(w - 20, h - 60); ctx.stroke();
          // μ 参考线
          var xMu = 80 + (mu - 6) / 12 * (w - 100);
          ctx.strokeStyle = '#C9B037'; ctx.lineWidth = 2.2; ctx.setLineDash([6, 3]);
          ctx.beginPath(); ctx.moveTo(xMu, 20); ctx.lineTo(xMu, h - 60); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#C9B037'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('真实 μ=' + mu, xMu, 14);
          intervals.forEach(function (iv, i2) {
            var y = 24 + i2 * yStep;
            var x1 = 80 + (iv[0] - 6) / 12 * (w - 100);
            var x2 = 80 + (iv[1] - 6) / 12 * (w - 100);
            ctx.strokeStyle = iv[2] ? 'rgba(16,185,129,0.9)' : 'rgba(239,68,68,0.95)';
            ctx.lineWidth = 3.4;
            ctx.beginPath(); ctx.moveTo(Math.max(x1, 80), y); ctx.lineTo(Math.min(x2, w - 20), y); ctx.stroke();
            ctx.lineWidth = 1; ctx.strokeStyle = iv[2] ? '#10B981' : '#EF4444';
            ctx.beginPath(); ctx.moveTo(Math.max(x1, 80), y - 3); ctx.lineTo(Math.max(x1, 80), y + 3); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(Math.min(x2, w - 20), y - 3); ctx.lineTo(Math.min(x2, w - 20), y + 3); ctx.stroke();
          });
          ctx.fillStyle = '#1E3A5F'; ctx.font = '13px sans-serif'; ctx.textAlign = 'left';
          ctx.fillText('95% 置信区间重复抽样模拟：' + covered + '/' + m + ' 个区间覆盖真实均值（' + (covered / m * 100).toFixed(0) + '%）', 84, h - 28);
          ctx.fillStyle = '#C9B037';
          ctx.fillText('── 绿：覆盖 μ　红：未覆盖', w - 210, h - 28);
        }
        var timer = setInterval(draw, 60);
        return function () { clearInterval(timer); };
      },
      power: function () {
        controls.innerHTML =
          '<div class="param-row"><label>效应量 Cohen\'s d</label><input type="range" id="vp-d" min="0.1" max="1.5" step="0.05" value="0.5"><output id="vp-dv">0.5</output></div>' +
          '<div class="param-row"><label>每组样本量 n</label><input type="range" id="vp-pn" min="5" max="200" value="30"><output id="vp-pnv">30</output></div>' +
          '<div class="param-row"><label>显著性水平 α</label><input type="range" id="vp-pa" min="1" max="10" value="5"><output id="vp-pav">0.05</output></div>' +
          '<div class="param-row"><label>模拟次数</label><input type="range" id="vp-pm" min="100" max="3000" value="800"><output id="vp-pmv">800</output></div>';
        bindRange('vp-d', 'vp-dv'); bindRange('vp-pn', 'vp-pnv');
        bindRange('vp-pa', 'vp-pav', function (v) { return (v / 100).toFixed(2); });
        bindRange('vp-pm', 'vp-pmv');
        function draw() {
          var ctx = canvas.getContext('2d');
          var w = canvas.width, h = canvas.height;
          ctx.clearRect(0, 0, w, h);
          var d = +$('vp-d').value;
          var n = +$('vp-pn').value;
          var alpha = +$('vp-pa').value / 100;
          var m = +$('vp-pm').value;
          // 理论功效：非中心 t 近似
          var nc = d * Math.sqrt(n / 2);
          var tCrit = S.tInv(2 * n - 2, 1 - alpha / 2);
          // 模拟
          var rej = 0;
          for (var i = 0; i < m; i++) {
            var a = [], b = [];
            for (var j = 0; j < n; j++) { a.push(randn()); b.push(randn() + d); }
            var t = S.tTestIndependent(a, b);
            if (t && t.p < alpha) rej++;
          }
          var power = rej / m;
          // 功效曲线（随 n 的理论近似：用功效函数简式）
          var curve = [];
          for (var nn = 5; nn <= 200; nn += 3) {
            var ncn = d * Math.sqrt(nn / 2);
            var tcn = S.tInv(2 * nn - 2, 1 - alpha / 2);
            curve.push([nn, 1 - S.tCdf(tcn - ncn, 2 * nn - 2) + S.tCdf(-tcn - ncn, 2 * nn - 2)]);
          }
          // 画布布局：左侧功效曲线（全范围），右侧当前点
          var padL = 64, padB = 48, padT = 30;
          var plotW = w * 0.68 - padL, plotH = h - padB - padT;
          var ox = padL, oy = padT;
          ctx.strokeStyle = '#E8ECF1'; ctx.lineWidth = 1;
          for (var g = 0; g <= 4; g++) {
            var gy = oy + (1 - g / 4) * plotH;
            ctx.beginPath(); ctx.moveTo(ox, gy); ctx.lineTo(ox + plotW, gy); ctx.stroke();
            ctx.fillStyle = '#6B7280'; ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
            ctx.fillText((g / 4 * 100).toFixed(0) + '%', ox - 6, gy + 4);
          }
          for (var gx = 0; gx <= 4; gx++) {
            var xx = ox + gx / 4 * plotW;
            ctx.beginPath(); ctx.moveTo(xx, oy); ctx.lineTo(xx, oy + plotH); ctx.stroke();
            ctx.fillStyle = '#6B7280'; ctx.textAlign = 'center';
            ctx.fillText(Math.round(5 + gx / 4 * 195), xx, oy + plotH + 16);
          }
          // 0.8 参考线
          ctx.strokeStyle = '#C9B037'; ctx.setLineDash([5, 4]);
          var y08 = oy + (1 - 0.8) * plotH;
          ctx.beginPath(); ctx.moveTo(ox, y08); ctx.lineTo(ox + plotW, y08); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#C9B037'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
          ctx.fillText('功效 0.8 参考线', ox + plotW - 80, y08 - 6);
          // 曲线
          ctx.strokeStyle = 'rgba(30,58,95,0.9)'; ctx.lineWidth = 2.2; ctx.beginPath();
          curve.forEach(function (pt, i2) {
            var x = ox + (pt[0] - 5) / 195 * plotW;
            var y = oy + (1 - pt[1]) * plotH;
            if (i2 === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
          ctx.stroke();
          // 当前点
          var curX = ox + (n - 5) / 195 * plotW;
          var curY = oy + (1 - power) * plotH;
          ctx.fillStyle = '#EF4444';
          ctx.beginPath(); ctx.arc(curX, curY, 6, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(curX, curY, 6, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = '#1E3A5F'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
          ctx.fillText('样本量 n', ox + plotW / 2 - 20, oy + plotH + 34);
          ctx.fillText('检验功效（Power）', ox + plotW / 2 - 20, 16);
          // 右侧结论卡
          var rx = w * 0.72, rw2 = w - rx - 16;
          ctx.fillStyle = '#fff'; ctx.strokeStyle = '#D8DEE6';
          ctx.fillRect(rx, oy, rw2, plotH);
          ctx.fillStyle = '#1E3A5F'; ctx.font = 'bold 14px sans-serif';
          ctx.fillText('当前设定', rx + 14, oy + 24);
          ctx.font = '12px sans-serif'; ctx.fillStyle = '#44566C'; ctx.textAlign = 'left';
          var rows = [
            ['效应量 d', d.toFixed(2)],
            ['样本量 n', n],
            ['α', alpha.toFixed(2)],
            ['模拟次数', m],
            ['模拟功效 1−β', (power * 100).toFixed(1) + '%'],
            ['β（第二类错误）', ((1 - power) * 100).toFixed(1) + '%']
          ];
          rows.forEach(function (r, i2) {
            ctx.fillText(r[0], rx + 14, oy + 50 + i2 * 26);
            ctx.fillStyle = '#1E3A5F'; ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(r[1], rx + rw2 - 14, oy + 50 + i2 * 26);
            ctx.fillStyle = '#44566C'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
          });
          var verdict = power >= 0.8 ? '✓ 功效充足（≥0.8）' : (power >= 0.5 ? '⚠ 功效偏低，建议增大样本量' : '✗ 功效不足，请显著增大样本量或效应量');
          ctx.fillStyle = power >= 0.8 ? '#10B981' : power >= 0.5 ? '#F59E0B' : '#EF4444';
          ctx.font = 'bold 13px sans-serif';
          ctx.fillText(verdict, rx + 14, oy + plotH - 16);
          ctx.fillStyle = '#7A8AA0'; ctx.font = '11px sans-serif';
          ctx.fillText('功效 = P(正确拒绝 H₀)', rx + 14, oy + plotH - 32);
        }
        var timer = setInterval(draw, 60);
        return function () { clearInterval(timer); };
      },
      normal: function () {
        controls.innerHTML =
          '<div class="param-row"><label>均值 μ</label><input type="range" id="vp-mu" min="-5" max="5" step="0.1" value="0"><output id="vp-muv">0</output></div>' +
          '<div class="param-row"><label>标准差 σ</label><input type="range" id="vp-sig" min="0.2" max="3" step="0.1" value="1"><output id="vp-sigv">1</output></div>' +
          '<div class="param-row"><label>显示区间</label><input type="range" id="vp-z" min="1" max="4" step="0.1" value="2"><output id="vp-zv">±2σ</output></div>';
        bindRange('vp-mu', 'vp-muv'); bindRange('vp-sig', 'vp-sigv');
        bindRange('vp-z', 'vp-zv', function (v) { return '±' + v + 'σ'; });
        function draw() {
          var ctx = canvas.getContext('2d');
          var w = canvas.width, h = canvas.height;
          ctx.clearRect(0, 0, w, h);
          var mu = +$('vp-mu').value, sig = +$('vp-sig').value, z = +$('vp-z').value;
          var padL = 70, padB = 50, padT = 30;
          var plotW = w - padL - 30, plotH = h - padB - padT;
          var lo = mu - 4.2 * sig, hi = mu + 4.2 * sig;
          var sx = function (v) { return padL + (v - lo) / (hi - lo) * plotW; };
          var yMax = 1 / (sig * Math.sqrt(2 * Math.PI));
          var sy = function (y) { return padT + plotH - y / (yMax * 1.15) * plotH; };
          // 网格
          ctx.strokeStyle = '#E8ECF1';
          for (var g = 0; g <= 4; g++) {
            var gy = padT + g / 4 * plotH;
            ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(padL + plotW, gy); ctx.stroke();
          }
          // 曲线下区间着色
          var za = mu - z * sig, zb = mu + z * sig;
          ctx.beginPath();
          ctx.moveTo(sx(za), sy(0));
          for (var px = 0; px <= plotW; px += 2) {
            var v = lo + px / plotW * (hi - lo);
            if (v < za || v > zb) continue;
            var y = Math.exp(-(v - mu) * (v - mu) / (2 * sig * sig)) / (sig * Math.sqrt(2 * Math.PI));
            ctx.lineTo(sx(v), sy(y));
          }
          ctx.lineTo(sx(zb), sy(0));
          ctx.closePath();
          ctx.fillStyle = 'rgba(201,176,55,0.28)';
          ctx.fill();
          // 曲线
          ctx.strokeStyle = '#1E3A5F'; ctx.lineWidth = 2.6; ctx.beginPath();
          for (var px2 = 0; px2 <= plotW; px2 += 2) {
            var v2 = lo + px2 / plotW * (hi - lo);
            var y2 = Math.exp(-(v2 - mu) * (v2 - mu) / (2 * sig * sig)) / (sig * Math.sqrt(2 * Math.PI));
            if (px2 === 0) ctx.moveTo(sx(v2), sy(y2)); else ctx.lineTo(sx(v2), sy(y2));
          }
          ctx.stroke();
          // 均值和 ±σ 线
          ctx.strokeStyle = '#C9B037'; ctx.lineWidth = 1.6; ctx.setLineDash([5, 4]);
          ctx.beginPath(); ctx.moveTo(sx(mu), padT); ctx.lineTo(sx(mu), padT + plotH); ctx.stroke();
          ctx.setLineDash([]);
          // 面积概率计算（理论）
          var pWithin = S.normCdf(z) - S.normCdf(-z);
          ctx.fillStyle = '#1E3A5F'; ctx.font = '13px sans-serif'; ctx.textAlign = 'left';
          ctx.fillText('正态分布 N(μ=' + mu + ', σ=' + sig + ')', padL + 8, 18);
          ctx.fillStyle = '#8a6d00'; ctx.font = '12px sans-serif';
          ctx.fillText('P(μ−' + z + 'σ ≤ X ≤ μ+' + z + 'σ) = ' + (pWithin * 100).toFixed(2) + '%', padL + 8, 34);
          // 坐标
          ctx.strokeStyle = '#B0B7C3'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(padL, padT + plotH); ctx.lineTo(padL + plotW, padT + plotH); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + plotH); ctx.stroke();
          ctx.fillStyle = '#6B7280'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
          var ticks = [-3, -2, -1, 0, 1, 2, 3];
          ticks.forEach(function (t) {
            var v = mu + t * sig;
            if (v < lo || v > hi) return;
            ctx.fillText((mu + t * sig).toFixed(1), sx(v), padT + plotH + 16);
            ctx.beginPath(); ctx.moveTo(sx(v), padT + plotH - 4); ctx.lineTo(sx(v), padT + plotH); ctx.stroke();
          });
          ctx.fillText('x（μ=' + mu + ' 处为 0）', padL + plotW / 2, padT + plotH + 34);
          ctx.save(); ctx.translate(10, padT + 6); ctx.fillText('密度', 0, 0); ctx.restore();
        }
        var timer = setInterval(draw, 50);
        return function () { clearInterval(timer); };
      },
      reg: function () {
        controls.innerHTML =
          '<div class="param-row"><label>添加随机点</label><button class="btn btn-soft btn-sm" id="vp-add">+ 加 5 个点</button>' +
          '<button class="btn btn-ghost btn-sm" id="vp-clear">清空</button>' +
          '<button class="btn btn-ghost btn-sm" id="vp-reset">重置示例</button></div>' +
          '<p class="hint">点击画布添加点，拖动已有点改变数据，观察回归线与残差变化</p>';
        var pts = [];
        function seed() {
          pts = [];
          for (var i = 0; i < 18; i++) pts.push([2 + Math.random() * 8, 3 + 1.2 * i / 18 * 8 + (Math.random() - 0.5) * 4]);
        }
        seed();
        var dragIdx = -1;
        function draw() {
          var ctx = canvas.getContext('2d');
          var w = canvas.width, h = canvas.height;
          ctx.clearRect(0, 0, w, h);
          var padL = 70, padB = 50, padT = 34;
          var plotW = w - padL - 30, plotH = h - padB - padT;
          var xLo = 0, xHi = 12, yLo = 0, yHi = 16;
          var sx = function (v) { return padL + (v - xLo) / (xHi - xLo) * plotW; };
          var sy = function (v) { return padT + plotH - (v - yLo) / (yHi - yLo) * plotH; };
          // 网格
          ctx.strokeStyle = '#E8ECF1';
          for (var gx = 0; gx <= 4; gx++) {
            var x = sx(xLo + gx / 4 * (xHi - xLo));
            ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
          }
          for (var gy = 0; gy <= 4; gy++) {
            var y = sy(yLo + gy / 4 * (yHi - yLo));
            ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
          }
          ctx.strokeStyle = '#B0B7C3';
          ctx.beginPath(); ctx.moveTo(padL, padT + plotH); ctx.lineTo(padL + plotW, padT + plotH); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + plotH); ctx.stroke();
          ctx.fillStyle = '#6B7280'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('x', padL + plotW / 2, h - 14);
          ctx.save(); ctx.translate(10, padT + 6); ctx.fillText('y', 0, 0); ctx.restore();
          if (pts.length >= 3) {
            var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
            var reg = S.pearson(xs, ys);
            var b = reg ? reg.r * S.sd(ys) / S.sd(xs) : 0;
            var a = S.mean(ys) - b * S.mean(xs);
            // 残差线
            pts.forEach(function (p) {
              var fit = a + b * p[0];
              ctx.strokeStyle = 'rgba(239,68,68,0.4)'; ctx.lineWidth = 1;
              ctx.beginPath(); ctx.moveTo(sx(p[0]), sy(p[1])); ctx.lineTo(sx(p[0]), sy(fit)); ctx.stroke();
            });
            // 回归线
            ctx.strokeStyle = '#C9B037'; ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(sx(xLo), sy(a + b * xLo));
            ctx.lineTo(sx(xHi), sy(a + b * xHi));
            ctx.stroke();
            ctx.fillStyle = '#C9B037'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'left';
            ctx.fillText('ŷ = ' + a.toFixed(2) + ' + ' + b.toFixed(2) + 'x', padL + 10, 18);
            if (reg) {
              ctx.fillStyle = '#1E3A5F'; ctx.font = '12px sans-serif';
              ctx.fillText('r = ' + S.fmtNum(reg.r, 3) + '，P = ' + S.fmtP(reg.p) + '，n = ' + pts.length, padL + 10, 32);
            }
          } else {
            ctx.fillStyle = '#7A8AA0'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('至少需要 3 个点才能拟合回归线', padL + plotW / 2, padT + plotH / 2);
          }
          // 点
          pts.forEach(function (p, i) {
            ctx.fillStyle = 'rgba(30,58,95,0.85)';
            ctx.beginPath(); ctx.arc(sx(p[0]), sy(p[1]), 5, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6;
            ctx.stroke();
          });
        }
        function toData(e) {
          var rect = canvas.getBoundingClientRect();
          var sx = canvas.width / rect.width, sy2 = canvas.height / rect.height;
          var mx = (e.clientX - rect.left) * sx, my = (e.clientY - rect.top) * sy2;
          var padL = 70, padB = 50, padT = 34;
          var plotW = canvas.width - padL - 30, plotH = canvas.height - padB - padT;
          var x = (mx - padL) / plotW * 12;
          var y = 16 - (my - padT) / plotH * 16;
          return [x, y];
        }
        canvas.onmousedown = function (e) {
          var d = toData(e);
          if (d[0] < 0 || d[0] > 12 || d[1] < 0 || d[1] > 16) return;
          var best = -1, bestD = 20;
          pts.forEach(function (p, i) {
            var dist = Math.hypot(p[0] - d[0], p[1] - d[1]);
            if (dist < bestD) { bestD = dist; best = i; }
          });
          if (best >= 0 && bestD < 0.9) dragIdx = best;
          else { pts.push(d); }
          draw();
        };
        canvas.onmousemove = function (e) {
          if (dragIdx < 0) return;
          var d = toData(e);
          pts[dragIdx] = [Math.max(0, Math.min(12, d[0])), Math.max(0, Math.min(16, d[1]))];
          draw();
        };
        canvas.onmouseup = function () { dragIdx = -1; };
        canvas.ontouchstart = function (e) { e.preventDefault(); canvas.onmousedown(e.touches[0]); };
        canvas.ontouchmove = function (e) { e.preventDefault(); canvas.onmousemove(e.touches[0]); };
        canvas.ontouchend = function () { dragIdx = -1; };
        setTimeout(function () {
          var addB = $('vp-add'), clrB = $('vp-clear'), rstB = $('vp-reset');
          if (addB) addB.onclick = function () {
            for (var i = 0; i < 5; i++) pts.push([2 + Math.random() * 8, 3 + Math.random() * 10]);
            draw();
          };
          if (clrB) clrB.onclick = function () { pts = []; draw(); };
          if (rstB) rstB.onclick = function () { seed(); draw(); };
        }, 0);
        draw();
        return function () {
          canvas.onmousedown = canvas.onmousemove = canvas.onmouseup = null;
          canvas.ontouchstart = canvas.ontouchmove = canvas.ontouchend = null;
        };
      },
      /* ---- 新增：t 分布 vs 正态 ---- */
      tdist: function () {
        controls.innerHTML =
          '<div class="param-row"><label>自由度 df</label><input type="range" id="vp-tdf" min="1" max="60" value="5"><output id="vp-tdfv">5</output></div>' +
          '<div class="param-row"><label>显示尾部概率 α/2</label><input type="range" id="vp-tal" min="1" max="20" value="5"><output id="vp-talv">0.05</output></div>';
        bindRange('vp-tdf', 'vp-tdfv');
        bindRange('vp-tal', 'vp-talv', function (v) { return (v / 100).toFixed(2); });
        function draw() {
          var ctx = canvas.getContext('2d');
          var w = canvas.width, h = canvas.height;
          ctx.clearRect(0, 0, w, h);
          var df = +$('vp-tdf').value;
          var alpha = +$('vp-tal').value / 100;
          var padL = 70, padB = 48, padT = 34;
          var plotW = w - padL - 30, plotH = h - padB - padT;
          var xLo = -5, xHi = 5;
          var sx = function (v) { return padL + (v - xLo) / (xHi - xLo) * plotW; };
          function normPdf(v) { return Math.exp(-v * v / 2) / Math.sqrt(2 * Math.PI); }
          function tPdf(v, d) {
            var g = Math.exp(S.gammaLn((d + 1) / 2) - S.gammaLn(d / 2));
            return g / (Math.sqrt(d * Math.PI)) * Math.pow(1 + v * v / d, -(d + 1) / 2);
          }
          // 网格
          ctx.strokeStyle = '#E8ECF1'; ctx.lineWidth = 1;
          for (var g = 0; g <= 4; g++) {
            var gy = padT + g / 4 * plotH;
            ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(padL + plotW, gy); ctx.stroke();
          }
          // t 分布尾部着色（右尾）
          var tCritR = S.tInv(df, 1 - alpha / 2);
          var tCritL = -tCritR;
          var yMax = normPdf(0);
          var sy = function (y) { return padT + plotH - y / (yMax * 1.12) * plotH; };
          // 右尾区域
          ctx.beginPath(); ctx.moveTo(sx(tCritR), sy(0));
          for (var px = 0; px <= plotW; px += 2) {
            var v = xLo + px / plotW * (xHi - xLo);
            if (v < tCritR) continue;
            ctx.lineTo(sx(v), sy(tPdf(v, df)));
          }
          ctx.lineTo(sx(xHi), sy(0)); ctx.closePath();
          ctx.fillStyle = 'rgba(239,68,68,0.22)'; ctx.fill();
          // 左尾区域
          ctx.beginPath(); ctx.moveTo(sx(tCritL), sy(0));
          for (var px2 = 0; px2 <= plotW; px2 += 2) {
            var v2 = xLo + px2 / plotW * (xHi - xLo);
            if (v2 > tCritL) continue;
            ctx.lineTo(sx(v2), sy(tPdf(v2, df)));
          }
          ctx.lineTo(sx(xLo), sy(0)); ctx.closePath();
          ctx.fillStyle = 'rgba(239,68,68,0.22)'; ctx.fill();
          // 曲线：t（红粗）与正态（蓝灰细）
          ctx.strokeStyle = '#1E3A5F'; ctx.lineWidth = 2.4; ctx.beginPath();
          for (var px3 = 0; px3 <= plotW; px3 += 2) {
            var v3 = xLo + px3 / plotW * (xHi - xLo);
            if (px3 === 0) ctx.moveTo(sx(v3), sy(tPdf(v3, df))); else ctx.lineTo(sx(v3), sy(tPdf(v3, df)));
          }
          ctx.stroke();
          ctx.strokeStyle = '#94A3B8'; ctx.lineWidth = 1.6; ctx.setLineDash([5, 4]); ctx.beginPath();
          for (var px4 = 0; px4 <= plotW; px4 += 2) {
            var v4 = xLo + px4 / plotW * (xHi - xLo);
            if (px4 === 0) ctx.moveTo(sx(v4), sy(normPdf(v4))); else ctx.lineTo(sx(v4), sy(normPdf(v4)));
          }
          ctx.stroke(); ctx.setLineDash([]);
          // 临界值标注
          ctx.fillStyle = '#EF4444'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('−t*', sx(tCritL), sy(0) + 16);
          ctx.fillText('t*', sx(tCritR), sy(0) + 16);
          ctx.strokeStyle = 'rgba(239,68,68,0.5)'; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(sx(tCritR), padT); ctx.lineTo(sx(tCritR), padT + plotH); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(sx(tCritL), padT); ctx.lineTo(sx(tCritL), padT + plotH); ctx.stroke();
          ctx.setLineDash([]);
          // 图例与标题
          ctx.textAlign = 'left';
          ctx.font = '13px sans-serif'; ctx.fillStyle = '#1E3A5F';
          ctx.fillText('t 分布（df=' + df + '）', padL + 10, 18);
          ctx.fillStyle = '#94A3B8';
          ctx.fillText('标准正态 N(0,1)', padL + 170, 18);
          ctx.fillStyle = '#EF4444';
          ctx.fillText('拒绝域 α=' + alpha.toFixed(2) + '（每尾 α/2）', padL + 340, 18);
          // 结论
          var tailDiff = (S.tCdf(tCritR, df) - 0.5) - (S.normCdf(tCritR) - 0.5);
          ctx.font = '12px sans-serif'; ctx.fillStyle = '#44566C';
          ctx.fillText('df 越小 → 尾部越厚、临界值 |t*| 越大：df=' + df + ' 时 t*=' + tCritR.toFixed(2) + '，正态 z*=' + S.normInv(1 - alpha / 2).toFixed(2), padL + 10, padT + plotH + 28);
          // 坐标轴
          ctx.strokeStyle = '#B0B7C3'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(padL, padT + plotH); ctx.lineTo(padL + plotW, padT + plotH); ctx.stroke();
          ctx.fillStyle = '#6B7280'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
          [-4, -2, 0, 2, 4].forEach(function (t) {
            ctx.fillText(t, sx(t), padT + plotH + 16);
          });
        }
        var timer = setInterval(draw, 60);
        return function () { clearInterval(timer); };
      },
      /* ---- 新增：卡方分布 ---- */
      chi2: function () {
        controls.innerHTML =
          '<div class="param-row"><label>自由度 k</label><input type="range" id="vp-cdf" min="1" max="20" value="4"><output id="vp-cdfv">4</output></div>' +
          '<div class="param-row"><label>显著性水平 α</label><input type="range" id="vp-ca" min="1" max="20" value="5"><output id="vp-cav">0.05</output></div>';
        bindRange('vp-cdf', 'vp-cdfv');
        bindRange('vp-ca', 'vp-cav', function (v) { return (v / 100).toFixed(2); });
        function chi2Pdf(x, k) {
          if (x <= 0) return 0;
          return Math.pow(x, k / 2 - 1) * Math.exp(-x / 2) / (Math.pow(2, k / 2) * Math.exp(S.gammaLn(k / 2)));
        }
        function draw() {
          var ctx = canvas.getContext('2d');
          var w = canvas.width, h = canvas.height;
          ctx.clearRect(0, 0, w, h);
          var k = +$('vp-cdf').value;
          var alpha = +$('vp-ca').value / 100;
          var padL = 70, padB = 48, padT = 34;
          var plotW = w - padL - 30, plotH = h - padB - padT;
          var xHi = Math.max(k + 5 * Math.sqrt(2 * k), 12);
          var xLo = 0;
          var sx = function (v) { return padL + (v - xLo) / (xHi - xLo) * plotW; };
          // 峰值 y
          var peak = chi2Pdf(Math.max(k - 2, 0.5), k);
          var yMax = peak * 1.15;
          var sy = function (y) { return padT + plotH - y / yMax * plotH; };
          var crit = S.chi2Inv(k, 1 - alpha);
          // 网格
          ctx.strokeStyle = '#E8ECF1'; ctx.lineWidth = 1;
          for (var g = 0; g <= 4; g++) {
            var gy = padT + g / 4 * plotH;
            ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(padL + plotW, gy); ctx.stroke();
          }
          // 拒绝域着色
          ctx.beginPath(); ctx.moveTo(sx(crit), sy(0));
          for (var px = 0; px <= plotW; px += 2) {
            var v = xLo + px / plotW * (xHi - xLo);
            if (v < crit) continue;
            ctx.lineTo(sx(v), sy(chi2Pdf(v, k)));
          }
          ctx.lineTo(sx(xHi), sy(0)); ctx.closePath();
          ctx.fillStyle = 'rgba(239,68,68,0.24)'; ctx.fill();
          // 曲线
          ctx.strokeStyle = '#1E3A5F'; ctx.lineWidth = 2.6; ctx.beginPath();
          for (var px2 = 0; px2 <= plotW; px2 += 2) {
            var v2 = xLo + px2 / plotW * (xHi - xLo);
            if (px2 === 0) ctx.moveTo(sx(v2), sy(chi2Pdf(v2, k))); else ctx.lineTo(sx(v2), sy(chi2Pdf(v2, k)));
          }
          ctx.stroke();
          // 均值与临界值标注
          ctx.fillStyle = '#1E3A5F'; ctx.font = '12px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('均值 k=' + k, sx(k), sy(0) + 20);
          ctx.strokeStyle = 'rgba(30,58,95,0.4)'; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(sx(k), padT); ctx.lineTo(sx(k), padT + plotH); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#EF4444';
          ctx.fillText('χ²临界值=' + crit.toFixed(2), sx(Math.min(crit + (xHi - xLo) * 0.06, xHi - (xHi - xLo) * 0.08)), padT + 16);
          ctx.strokeStyle = 'rgba(239,68,68,0.55)';
          ctx.beginPath(); ctx.moveTo(sx(crit), padT); ctx.lineTo(sx(crit), padT + plotH); ctx.stroke();
          // 标题与结论
          ctx.textAlign = 'left'; ctx.fillStyle = '#1E3A5F'; ctx.font = '13px sans-serif';
          ctx.fillText('χ² 分布（df=' + k + '），拒绝域面积 = α = ' + alpha.toFixed(2), padL + 10, 18);
          ctx.fillStyle = '#44566C'; ctx.font = '12px sans-serif';
          ctx.fillText('k 越大分布越对称、越接近正态；期望 E=df=' + k + '，方差 Var=2df=' + (2 * k), padL + 10, padT + plotH + 28);
          // 坐标轴
          ctx.strokeStyle = '#B0B7C3'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(padL, padT + plotH); ctx.lineTo(padL + plotW, padT + plotH); ctx.stroke();
          ctx.fillStyle = '#6B7280'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
          [0, 5, 10, 15, 20].forEach(function (t) { if (t <= xHi) ctx.fillText(t, sx(t), padT + plotH + 16); });
        }
        var timer = setInterval(draw, 60);
        return function () { clearInterval(timer); };
      },
      /* ---- 新增：两类错误模拟 ---- */
      errors: function () {
        controls.innerHTML =
          '<div class="param-row"><label>显著性水平 α</label><input type="range" id="vp-ea" min="1" max="20" value="5"><output id="vp-eav">0.05</output></div>' +
          '<div class="param-row"><label>H₀ 为真比例（先验）</label><input type="range" id="vp-eh" min="10" max="90" value="60"><output id="vp-ehv">60%</output></div>' +
          '<div class="param-row"><label>功效 1−β</label><input type="range" id="vp-ep" min="20" max="99" value="80"><output id="vp-epv">0.80</output></div>' +
          '<div class="param-row"><label>模拟次数</label><input type="range" id="vp-em" min="100" max="3000" value="1000"><output id="vp-emv">1000</output></div>';
        bindRange('vp-ea', 'vp-eav', function (v) { return (v / 100).toFixed(2); });
        bindRange('vp-eh', 'vp-ehv', function (v) { return v + '%'; });
        bindRange('vp-ep', 'vp-epv', function (v) { return (v / 100).toFixed(2); });
        bindRange('vp-em', 'vp-emv');
        function draw() {
          var ctx = canvas.getContext('2d');
          var w = canvas.width, h = canvas.height;
          ctx.clearRect(0, 0, w, h);
          var alpha = +$('vp-ea').value / 100;
          var pTrue = +$('vp-eh').value / 100;
          var power = +$('vp-ep').value / 100;
          var m = +$('vp-em').value;
          var beta = 1 - power;
          // 模拟
          var tp = 0, fp = 0, tn = 0, fn = 0;
          for (var i = 0; i < m; i++) {
            var h0true = Math.random() < pTrue;
            var rej = Math.random() < (h0true ? alpha : power);
            if (h0true && rej) fp++;
            else if (h0true && !rej) tn++;
            else if (!h0true && rej) tp++;
            else fn++;
          }
          var ox = 60, oy = 46;
          var cw = (w - ox - 40) / 2, chh = (h - oy - 90) / 2;
          function cell(x, y, label, count, pct, color) {
            ctx.fillStyle = color;
            ctx.fillRect(x, y, cw, chh);
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
            ctx.strokeRect(x, y, cw, chh);
            ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
            ctx.font = 'bold 15px sans-serif';
            ctx.fillText(label, x + cw / 2, y + chh / 2 - 12);
            ctx.font = 'bold 21px sans-serif';
            ctx.fillText(count.toLocaleString(), x + cw / 2, y + chh / 2 + 16);
            ctx.font = '12px sans-serif';
            ctx.fillText('(' + (pct * 100).toFixed(1) + '%)', x + cw / 2, y + chh / 2 + 36);
          }
          // 四象限
          cell(ox, oy, '✅ 正确拒绝（功效）', tp, tp / m, 'rgba(16,185,129,0.75)');
          cell(ox + cw, oy, '❌ 第一类错误（α）', fp, fp / m, 'rgba(239,68,68,0.78)');
          cell(ox, oy + chh, '✅ 正确接受（1−α）', tn, tn / m, 'rgba(58,107,158,0.72)');
          cell(ox + cw, oy + chh, '❌ 第二类错误（β）', fn, fn / m, 'rgba(245,158,11,0.82)');
          // 行列标签
          ctx.fillStyle = '#1E3A5F'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('拒绝 H₀', ox + cw / 2, oy - 14);
          ctx.fillText('不拒绝 H₀', ox + cw + cw / 2, oy - 14);
          ctx.save(); ctx.translate(14, oy + chh / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('H₀ 为真', 0, 0); ctx.restore();
          ctx.save(); ctx.translate(14, oy + chh + chh / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('H₀ 为假', 0, 0); ctx.restore();
          // 底部结论
          ctx.textAlign = 'left'; ctx.font = '12.5px sans-serif'; ctx.fillStyle = '#44566C';
          ctx.fillText('模拟 ' + m + ' 次：第一类错误率 ' + (fp / m * 100).toFixed(1) + '%（理论 α=' + alpha.toFixed(2) + '），第二类错误率 ' + (fn / m * 100).toFixed(1) + '%（理论 β=' + beta.toFixed(2) + '），经验功效 ' + (tp / (m * (1 - pTrue)) * 100).toFixed(1) + '%（理论 ' + (power * 100).toFixed(0) + '%）', 20, h - 26);
          ctx.fillStyle = '#C9B037'; ctx.font = '13px sans-serif';
          ctx.fillText('α 由显著性水平控制，β 由样本量/效应量决定；增大样本量可同时降低两类错误', 20, h - 46);
        }
        var timer = setInterval(draw, 120);
        return function () { clearInterval(timer); };
      },
      /* ---- 新增：P 值动画 ---- */
      pvalue: function () {
        controls.innerHTML =
          '<div class="param-row"><label>观测 z 值</label><input type="range" id="vp-pz" min="-4" max="4" step="0.05" value="1.8"><output id="vp-pzv">1.80</output></div>' +
          '<div class="param-row"><label>显著性水平 α</label><input type="range" id="vp-pa2" min="1" max="15" value="5"><output id="vp-pa2v">0.05</output></div>' +
          '<div class="param-row"><label>检验方向</label><select id="vp-ptail"><option value="two">双侧检验</option><option value="right">右侧检验</option><option value="left">左侧检验</option></select></div>';
        bindRange('vp-pz', 'vp-pzv', function (v) { return (+v).toFixed(2); });
        bindRange('vp-pa2', 'vp-pa2v', function (v) { return (v / 100).toFixed(2); });
        function draw() {
          var ctx = canvas.getContext('2d');
          var w = canvas.width, h = canvas.height;
          ctx.clearRect(0, 0, w, h);
          var z = +$('vp-pz').value;
          var alpha = +$('vp-pa2').value / 100;
          var tail = $('vp-ptail').value;
          var padL = 70, padB = 52, padT = 34;
          var plotW = w - padL - 30, plotH = h - padB - padT;
          var xLo = -4.4, xHi = 4.4;
          var sx = function (v) { return padL + (v - xLo) / (xHi - xLo) * plotW; };
          var yMax = 0.45;
          var sy = function (y) { return padT + plotH - y / yMax * plotH; };
          function pdf(v) { return Math.exp(-v * v / 2) / Math.sqrt(2 * Math.PI); }
          // P 值区域（绿色）
          ctx.beginPath();
          if (tail === 'two') {
            ctx.moveTo(sx(z), sy(0));
            for (var px = 0; px <= plotW; px += 2) {
              var v = xLo + px / plotW * (xHi - xLo);
              if (v < z && v > -z) continue;
              ctx.lineTo(sx(v), sy(pdf(v)));
            }
            ctx.lineTo(sx(xHi), sy(0)); ctx.closePath();
            ctx.moveTo(sx(-z), sy(0));
            for (var px2 = 0; px2 <= plotW; px2 += 2) {
              var v2 = xLo + px2 / plotW * (xHi - xLo);
              if (v2 > -z) continue;
              ctx.lineTo(sx(v2), sy(pdf(v2)));
            }
            ctx.lineTo(sx(xLo), sy(0)); ctx.closePath();
          } else if (tail === 'right') {
            ctx.moveTo(sx(z), sy(0));
            for (var px3 = 0; px3 <= plotW; px3 += 2) {
              var v3 = xLo + px3 / plotW * (xHi - xLo);
              if (v3 < z) continue;
              ctx.lineTo(sx(v3), sy(pdf(v3)));
            }
            ctx.lineTo(sx(xHi), sy(0)); ctx.closePath();
          } else {
            ctx.moveTo(sx(z), sy(0));
            for (var px4 = 0; px4 <= plotW; px4 += 2) {
              var v4 = xLo + px4 / plotW * (xHi - xLo);
              if (v4 > z) continue;
              ctx.lineTo(sx(v4), sy(pdf(v4)));
            }
            ctx.lineTo(sx(xLo), sy(0)); ctx.closePath();
          }
          ctx.fillStyle = 'rgba(16,185,129,0.35)'; ctx.fill();
          // 拒绝域（红色边界）
          var zCrit;
          if (tail === 'two') {
            zCrit = S.normInv(1 - alpha / 2);
            ctx.strokeStyle = 'rgba(239,68,68,0.75)'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.moveTo(sx(zCrit), padT); ctx.lineTo(sx(zCrit), padT + plotH); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(sx(-zCrit), padT); ctx.lineTo(sx(-zCrit), padT + plotH); ctx.stroke();
            ctx.setLineDash([]);
          } else if (tail === 'right') {
            zCrit = S.normInv(1 - alpha);
            ctx.strokeStyle = 'rgba(239,68,68,0.75)'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.moveTo(sx(zCrit), padT); ctx.lineTo(sx(zCrit), padT + plotH); ctx.stroke();
            ctx.setLineDash([]);
          } else {
            zCrit = S.normInv(alpha);
            ctx.strokeStyle = 'rgba(239,68,68,0.75)'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.moveTo(sx(zCrit), padT); ctx.lineTo(sx(zCrit), padT + plotH); ctx.stroke();
            ctx.setLineDash([]);
          }
          // 正态曲线
          ctx.strokeStyle = '#1E3A5F'; ctx.lineWidth = 2.4; ctx.beginPath();
          for (var px5 = 0; px5 <= plotW; px5 += 2) {
            var v5 = xLo + px5 / plotW * (xHi - xLo);
            if (px5 === 0) ctx.moveTo(sx(v5), sy(pdf(v5))); else ctx.lineTo(sx(v5), sy(pdf(v5)));
          }
          ctx.stroke();
          // 观测值标记
          var obsY = sy(pdf(z));
          ctx.fillStyle = '#EF4444';
          ctx.beginPath(); ctx.arc(sx(z), obsY, 6, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
          ctx.strokeStyle = 'rgba(239,68,68,0.6)'; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(sx(z), padT); ctx.lineTo(sx(z), padT + plotH); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#EF4444'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('z=' + z.toFixed(2), sx(z), padT + 14);
          // P 值计算
          var p;
          if (tail === 'two') p = 2 * (1 - S.normCdf(Math.abs(z)));
          else if (tail === 'right') p = 1 - S.normCdf(z);
          else p = S.normCdf(z);
          var reject = p <= alpha;
          // 标题与结论
          ctx.textAlign = 'left'; ctx.fillStyle = '#1E3A5F'; ctx.font = 'bold 13px sans-serif';
          ctx.fillText('标准正态分布下的假设检验（H₀: μ=μ₀）', padL + 10, 18);
          ctx.font = '12.5px sans-serif';
          ctx.fillStyle = '#10B981';
          ctx.fillText('绿色面积 = P 值 = ' + p.toFixed(4), padL + 10, 33);
          ctx.fillStyle = '#44566C';
          ctx.fillText('红色虚线 = 拒绝域边界（α=' + alpha.toFixed(2) + '）', padL + 230, 33);
          ctx.fillStyle = reject ? '#EF4444' : '#10B981';
          ctx.font = 'bold 14px sans-serif';
          ctx.fillText(reject ? '✗ P ≤ α → 拒绝 H₀（差异显著）' : '✓ P > α → 不拒绝 H₀（证据不足）', padL + 10, padT + plotH + 30);
          // 坐标轴
          ctx.strokeStyle = '#B0B7C3'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(padL, padT + plotH); ctx.lineTo(padL + plotW, padT + plotH); ctx.stroke();
          ctx.fillStyle = '#6B7280'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
          [-4, -2, 0, 2, 4].forEach(function (t) { ctx.fillText(t, sx(t), padT + plotH + 16); });
        }
        var timer = setInterval(draw, 60);
        return function () { clearInterval(timer); };
      }
    };

    var stop = fns[key]();
    vizState.stopFn = stop;
  }

  function bindRange(id, outId, fmt) {
    var el = $(id), out = $(outId);
    if (!el || !out) return;
    el.addEventListener('input', function () {
      out.textContent = fmt ? fmt(el.value) : el.value;
    });
  }
  function randn() {
    // Box-Muller
    var u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* ==========================================================
   * 四、关于页渲染
   * ========================================================== */
  function renderAbout() {
    // 知识库来源
    $('about-sources').innerHTML = KB.meta.sources.map(function (s) {
      return '<span class="tag">' + esc(s) + '</span>';
    }).join('');
    // 前沿观点
    $('frontier-list').innerHTML = KB.frontier.map(function (f) {
      return '<div class="frontier-item"><b>' + esc(f.title) + '</b><p>' + mdInline(f.content) + '</p><div class="src">📎 ' + esc(f.source) + '</div></div>';
    }).join('');
    // 知识版图（聊天侧栏）
    var el = $('kb-courses');
    if (el) {
      el.innerHTML = KB.meta.courses.map(function (c) {
        return '<span class="tag">' + esc(c) + '</span>';
      }).join('') + '<p class="hint" style="margin-top:8px">知识条目 ' + KB.entries.length + ' 条 · 易混淆概念 ' + KB.confusions.length + ' 组 · 高频问答 ' + KB.qa.length + ' 条 · 前沿观点 ' + KB.frontier.length + ' 篇</p>';
    }
  }

  /* ==========================================================
   * 四、资源库（教材 + 文献分类展示）
   * ========================================================== */
  var RES = window.STAT_RESOURCES || { textbooks: {}, literature: {} };
  var DIR_ORDER = [
    ['probability_and_statistics', '概率论与数理统计'],
    ['regression_analysis', '回归分析'],
    ['design_of_experiments', '试验设计'],
    ['multivariate_statistics', '多元统计分析'],
    ['time_series', '时间序列分析'],
    ['survey_sampling', '抽样调查']
  ];
  var GIT_BASE = 'https://raw.githubusercontent.com/Haiyan-Codes/statistics-llm/main/resources/';

  window.renderLibrary = function () {
    var tbCount = 0, litCount = 0, oaCount = 0;
    DIR_ORDER.forEach(function (pair) {
      var key = pair[0];
      if (RES.textbooks[key]) tbCount += RES.textbooks[key].length;
      if (RES.literature[key]) {
        litCount += RES.literature[key].items.length;
        RES.literature[key].items.forEach(function (it) { if (it.local_pdf) oaCount++; });
      }
    });
    $('lib-tb-count').textContent = tbCount;
    $('lib-lit-count').textContent = litCount;
    $('lib-oa-count').textContent = oaCount;
    // tabs
    var tabs = $('lib-tabs');
    tabs.innerHTML = '<button class="active" onclick="libTab(null,this)">全部</button>' + DIR_ORDER.map(function (p) {
      return '<button onclick="libTab(\'' + p[0] + '\',this)">' + p[1] + '</button>';
    }).join('');
    renderLibContent(null);
  };

  window.libTab = function (key, btn) {
    document.querySelectorAll('#lib-tabs button').forEach(function (b) { b.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    renderLibContent(key);
  };

  var LIB_FAV_KEY = 'statllm_lib_favs';
  var libFavOnly = false;
  function getFavs() {
    try { return JSON.parse(localStorage.getItem(LIB_FAV_KEY) || '{}'); } catch (e) { return {}; }
  }
  function isFav(dir, title) { return !!getFavs()[dir + '||' + title]; }
  window.toggleFav = function (dir, title, ev) {
    if (ev) ev.stopPropagation();
    var favs = getFavs();
    var key = dir + '||' + title;
    if (favs[key]) delete favs[key]; else favs[key] = 1;
    localStorage.setItem(LIB_FAV_KEY, JSON.stringify(favs));
    renderLibContent(null, true);
  };
  window.toggleFavFilter = function () {
    libFavOnly = !libFavOnly;
    $('lib-fav-btn').classList.toggle('btn-gold', libFavOnly);
    $('lib-fav-btn').classList.toggle('btn-ghost', !libFavOnly);
    renderLibContent(null, true);
  };

  function renderLibContent(key, keepTab) {
    var html = '';
    var dirs = key ? DIR_ORDER.filter(function (p) { return p[0] === key; }) : DIR_ORDER;
    var q = ($('lib-search') && $('lib-search').value || '').trim().toLowerCase();
    var sortBy = $('lib-sort') ? $('lib-sort').value : 'default';
    var shown = 0;
    dirs.forEach(function (pair) {
      var dkey = pair[0], cn = pair[1];
      var tbs = RES.textbooks[dkey] || [];
      var lits = RES.literature[dkey] ? RES.literature[dkey].items.slice() : [];
      // 搜索过滤 + 收藏过滤 + 排序
      if (q || libFavOnly) {
        lits = lits.filter(function (it) {
          var txt = ((it.title || '') + ' ' + (it.abstract || '') + ' ' + (it.source || '') + ' ' + (it.authors || []).join(' ')).toLowerCase();
          var okText = !q || txt.indexOf(q) >= 0;
          var okFav = !libFavOnly || isFav(dkey, it.title);
          return okText && okFav;
        });
      }
      if (sortBy === 'year') lits.sort(function (a, b) { return (b.year || 0) - (a.year || 0); });
      else if (sortBy === 'cited') lits.sort(function (a, b) { return (b.cited || 0) - (a.cited || 0); });
      var filteredTb = tbs.filter(function (b) { return !q || (b.title + '').toLowerCase().indexOf(q) >= 0; });
      if (!filteredTb.length && !lits.length) return;
      shown += lits.length;
      html += '<div class="card"><h3>📖 ' + cn + '（教材 ' + filteredTb.length + ' 本 · 文献 ' + lits.length + ' 篇）</h3>';
      if (filteredTb.length) {
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;margin-bottom:14px">';
        filteredTb.forEach(function (b) {
          var url = b.url || (GIT_BASE + 'textbooks/' + dkey + '/' + encodeURIComponent(b.file));
          html += '<div style="border:1px solid var(--line);border-radius:10px;padding:12px;background:var(--bg-soft)">' +
            '<b style="color:var(--primary);font-size:13px">' + esc(b.title) + '</b>' +
            '<div class="hint" style="margin:6px 0">' + esc(b.source || '') + (b.size ? ' · ' + b.size : '') + '</div>' +
            '<a class="btn btn-soft btn-sm" href="' + url + '" target="_blank" rel="noopener">⬇ 下载</a></div>';
        });
        html += '</div>';
      }
      if (lits.length) {
        html += '<div class="table-scroll" style="max-height:340px"><table class="grid"><thead><tr><th>文献</th><th>作者</th><th>来源/年份</th><th>被引</th><th></th><th></th></tr></thead><tbody>';
        lits.slice(0, 40).forEach(function (it) {
          // 链接优先用原始 OA 全文/DOI（文献 PDF 未上传 GitHub，本地存档仅作徽章）
          var link = it.pdf_url || (it.doi ? 'https://doi.org/' + it.doi.replace('https://doi.org/', '') : '');
          var localBadge = it.local_pdf ? ' <span class="tag" title="课程组资料硬盘已存全文">📦 本地已存</span>' : '';
          var fav = isFav(dkey, it.title);
          html += '<tr><td style="text-align:left"><b>' + esc(it.title || '') + '</b>' +
            (it.oa ? ' <span class="tag-gold" style="padding:0 6px;font-size:10px">OA</span>' : '') + localBadge + '<br>' +
            '<span class="hint">' + esc((it.abstract || '').slice(0, 90)) + '…</span></td>' +
            '<td class="hint" style="font-size:11px">' + esc((it.authors || []).slice(0, 3).join(', ')) + '</td>' +
            '<td class="hint" style="font-size:11px">' + esc(it.source || '') + '<br>' + (it.year || '—') + '</td>' +
            '<td>' + (it.cited || 0) + '</td>' +
            '<td>' + (link ? '<a href="' + link + '" target="_blank" rel="noopener" title="打开原文">↗</a>' : '—') + '</td>' +
            '<td><span style="cursor:pointer;font-size:15px" onclick="toggleFav(\'' + dkey + '\',\'' + esc(it.title).replace(/'/g, "\\'") + '\',event)">' + (fav ? '⭐' : '☆') + '</span></td></tr>';
        });
        html += '</tbody></table></div>';
      }
      html += '</div>';
    });
    if (!html) html = '<div class="card"><p class="hint">没有匹配的资源，换个关键词试试～</p></div>';
    var info = $('lib-filter-info');
    if (info) info.textContent = (q ? '搜索「' + q + '」' : '') + (libFavOnly ? ' · 仅收藏' : '') + (shown ? ' · 共 ' + shown + ' 篇匹配' : '');
    $('lib-content').innerHTML = html;
  }

  /* ==========================================================
   * 五、文献检索
   * ========================================================== */
  window.searchLit = async function () {
    var q = $('lit-q').value.trim();
    if (!q) return;
    var box = $('lit-result');
    box.innerHTML = '<p class="hint">🔍 正在检索 OpenAlex / Crossref / arXiv …</p>';
    var cfg = getChatConfig();
    var worker = (cfg.workerUrl || 'https://statllm.mentalhealthresearch.top').replace(/\/+$/, '');
    try {
      var resp = await fetch(worker + '/api/search-literature', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q })
      });
      var j = await resp.json();
      if (!j.ok) throw new Error(j.error || '检索失败');
      var items = j.results || [];
      if (!items.length) { box.innerHTML = '<p class="hint">未找到相关文献，换个关键词试试～</p>'; return; }
      var html = '<div class="card"><h3>检索结果：' + esc(q) + '（' + items.length + ' 篇）</h3></div>';
      items.slice(0, 25).forEach(function (it, i) {
        var link = it.pdfUrl || (it.doi ? 'https://doi.org/' + it.doi.replace('https://doi.org/', '') : '');
        html += '<div class="card" style="padding:14px 16px">' +
          '<div style="display:flex;gap:8px;align-items:flex-start"><b style="color:var(--primary);flex:1">' + (i + 1) + '. ' + esc(it.title) + '</b>' +
          (it.oa ? '<span class="tag tag-gold">OA 全文</span>' : '') + '<span class="tag">' + esc(it.api || '') + '</span></div>' +
          '<div class="hint" style="margin:6px 0">' + esc((it.authors || []).slice(0, 5).join(', ')) + '　·　' + esc(it.source || '') + '　·　' + (it.year || '—') + '　·　被引 ' + (it.cited || 0) + '</div>' +
          '<div style="font-size:12.5px;color:var(--ink2);line-height:1.7">' + esc((it.abstract || '').slice(0, 280)) + (it.abstract && it.abstract.length > 280 ? '…' : '') + '</div>' +
          '<div style="margin-top:8px">' + (link ? '<a class="btn btn-soft btn-sm" href="' + link + '" target="_blank" rel="noopener">↗ 查看全文/DOI</a>' : '') +
          (it.doi ? ' <span class="hint" style="margin-left:8px">DOI: ' + esc(it.doi.replace('https://doi.org/', '')) + '</span>' : '') + '</div></div>';
      });
      box.innerHTML = html;
    } catch (e) {
      box.innerHTML = '<div class="warn-box">⚠️ 检索失败：' + esc(e.message) + '<br><span class="hint">若网关未部署文献检索接口，请确认 Worker 已更新。</span></div>';
    }
  };

  /* ==========================================================
   * 六、知识蒸馏
   * ========================================================== */
  var distillZone = $('distill-zone');
  if (distillZone) {
    distillZone.addEventListener('click', function () { $('distill-file').click(); });
    distillZone.addEventListener('dragover', function (e) { e.preventDefault(); distillZone.classList.add('drag'); });
    distillZone.addEventListener('dragleave', function () { distillZone.classList.remove('drag'); });
    distillZone.addEventListener('drop', function (e) {
      e.preventDefault(); distillZone.classList.remove('drag');
      var f = e.dataTransfer.files[0];
      if (f) handleDistillFile(f);
    });
    $('distill-file').addEventListener('change', function () {
      if (this.files[0]) handleDistillFile(this.files[0]);
    });
  }

  function handleDistillFile(file) {
    var ext = file.name.split('.').pop().toLowerCase();
    $('distill-status').textContent = '正在读取 ' + file.name + ' …';
    if (ext === 'pdf') {
      if (!window.pdfjsLib) { $('distill-status').textContent = '⚠️ PDF 解析组件未加载'; return; }
      var fr = new FileReader();
      fr.onload = async function () {
        try {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/pdf.worker.min.js';
          var pdf = await window.pdfjsLib.getDocument({ data: fr.result }).promise;
          var text = '';
          for (var p = 1; p <= Math.min(pdf.numPages, 30); p++) {
            var page = await pdf.getPage(p);
            var tc = await page.getTextContent();
            text += tc.items.map(function (it) { return it.str; }).join(' ') + '\n';
          }
          $('distill-text').value = text.slice(0, 50000);
          $('distill-status').textContent = '✓ PDF 文本已提取（' + Math.min(pdf.numPages, 30) + ' 页）';
        } catch (e) {
          $('distill-status').textContent = '✗ PDF 解析失败：' + e.message;
        }
      };
      fr.readAsArrayBuffer(file);
    } else {
      var r2 = new FileReader();
      r2.onload = function () { $('distill-text').value = String(r2.result).slice(0, 50000); $('distill-status').textContent = '✓ 已载入 ' + file.name; };
      r2.readAsText(file, 'utf-8');
    }
  }

  window.runDistill = async function () {
    var text = $('distill-text').value.trim();
    if (text.length < 100) { alert('请先上传或粘贴至少 100 字的材料文本'); return; }
    var btn = event && event.target;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 蒸馏中…'; }
    $('distill-status').textContent = '🧪 正在蒸馏：摘要 / 知识点 / 公式 / 教学建议 …';
    var cfg = getChatConfig();
    var worker = (cfg.workerUrl || 'https://statllm.mentalhealthresearch.top').replace(/\/+$/, '');
    var box = $('distill-result');
    try {
      var resp = await fetch(worker + '/api/distill', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text, provider: cfg.provider, apiKey: cfg.apiKey, model: cfg.model, baseUrl: cfg.baseUrl })
      });
      var j = await resp.json();
      if (!j.ok) throw new Error(j.error || '蒸馏失败');
      var r = j.result || {};
      var html = '<div class="card"><h3>📋 ' + esc(r.title || '蒸馏结果') + '</h3>' +
        '<div style="background:var(--bg-soft);border-radius:10px;padding:14px;font-size:13.5px;color:var(--ink2);line-height:1.9">' + mdInline(r.summary || '') + '</div></div>';
      if ((r.keywords || []).length) html += '<div class="card"><h3>🏷️ 关键词</h3>' + r.keywords.map(function (k) { return '<span class="tag tag-gold">' + esc(k) + '</span>'; }).join('') + '</div>';
      if ((r.knowledge_points || []).length) {
        html += '<div class="card"><h3>🧠 知识点蒸馏</h3>';
        r.knowledge_points.forEach(function (kp, i) {
          html += '<div style="border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:10px">' +
            '<b style="color:var(--primary)">' + (i + 1) + '. ' + esc(kp.name || '') + '</b>' +
            (kp.course ? ' <span class="tag">' + esc(kp.course) + '</span>' : '') +
            '<div style="font-size:13px;color:var(--ink2);margin-top:6px"><b>定义：</b>' + mdInline(kp.definition || '') + '</div>' +
            '<div style="font-size:13px;color:var(--ink2);margin-top:4px;background:var(--accent-soft);border-radius:8px;padding:8px 10px"><b>通俗理解：</b>' + mdInline(kp.explanation || '') + '</div></div>';
        });
        html += '</div>';
      }
      if ((r.key_formulas || []).length) html += '<div class="card"><h3>📐 重要公式</h3>' + r.key_formulas.map(function (f) { return '<div style="font-family:var(--mono);background:var(--bg-soft);border-radius:8px;padding:6px 10px;margin:4px 0;font-size:13px">' + esc(f) + '</div>'; }).join('') + '</div>';
      if ((r.confusions || []).length) html += '<div class="card"><h3>⚠️ 易混淆点</h3>' + r.confusions.map(function (c) { return '<div style="font-size:13px;color:var(--ink2);margin:4px 0">• ' + mdInline(c) + '</div>'; }).join('') + '</div>';
      if (r.teaching_suggestions) html += '<div class="card"><h3>👩‍🏫 教学建议</h3><div style="font-size:13px;color:var(--ink2);line-height:1.8">' + mdInline(r.teaching_suggestions) + '</div></div>';
      if ((r.related_topics || []).length) html += '<div class="card"><h3>🔗 延伸主题</h3>' + r.related_topics.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') + '</div>';
      html += '<div class="card"><button class="btn btn-soft btn-sm" onclick="copyDistill()">📋 复制蒸馏结果</button></div>';
      box.innerHTML = html;
      window._lastDistill = r;
    } catch (e) {
      box.innerHTML = '<div class="warn-box">⚠️ 蒸馏失败：' + esc(e.message) + '<br><span class="hint">请确认已在「知识问答」页配置 DeepSeek API Key。</span></div>';
    }
    if (btn) { btn.disabled = false; btn.textContent = '🧪 开始蒸馏'; }
    $('distill-status').textContent = '';
  };
  window.copyDistill = function () {
    var r = window._lastDistill;
    if (!r) return;
    var txt = '## ' + (r.title || '蒸馏结果') + '\n\n' + (r.summary || '') +
      '\n\n### 知识点\n' + (r.knowledge_points || []).map(function (k) { return '**' + k.name + '**：' + k.definition + '（通俗理解：' + k.explanation + '）'; }).join('\n') +
      '\n\n### 公式\n' + (r.key_formulas || []).join('\n') + '\n\n### 易混淆点\n' + (r.confusions || []).map(function (c) { return '- ' + c; }).join('\n') +
      '\n\n### 教学建议\n' + (r.teaching_suggestions || '');
    navigator.clipboard.writeText(txt).then(function () { alert('蒸馏结果已复制'); });
  };

  /* ==========================================================
   * 七、教案工坊（检索 → 教案 → pptx）
   * ========================================================== */
  var lessonCtx = '';
  window.runLesson = async function () {
    var topic = $('lesson-topic').value.trim();
    if (!topic) { alert('请输入课程主题'); return; }
    var btn = event && event.target;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 生成中（检索教材文献 + 大模型设计）…'; }
    var box = $('lesson-result');
    box.innerHTML = '<p class="hint">🔍 正在检索教材库与学术文献，并设计教案…</p>';
    var cfg = getChatConfig();
    var worker = (cfg.workerUrl || 'https://statllm.mentalhealthresearch.top').replace(/\/+$/, '');
    try {
      // 1. 本地知识库检索 + 学术文献检索，拼 context
      var kbHits = KB.search(topic, 3);
      var ctx = kbHits.map(function (h) { return '[教材知识点] ' + h.title + '：' + h.content.slice(0, 300) + '（来源：' + h.source + '）'; }).join('\n');
      lessonCtx = ctx;
      try {
        var lr = await fetch(worker + '/api/search-literature', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: topic })
        });
        var lj = await lr.json();
        if (lj.ok && lj.results) {
          var litCtx = lj.results.slice(0, 6).map(function (it) {
            return '[文献] ' + it.title + '（' + it.source + ', ' + it.year + '）：' + (it.abstract || '').slice(0, 200);
          }).join('\n');
          lessonCtx = ctx + '\n' + litCtx;
        }
      } catch (e) { /* 文献检索失败不阻塞教案生成 */ }
      // 2. 调用教案生成
      var lessonType = $('lesson-type') ? $('lesson-type').value : 'theory';
      var resp = await fetch(worker + '/api/lesson', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topic, context: lessonCtx, type: lessonType, provider: cfg.provider, apiKey: cfg.apiKey, model: cfg.model, baseUrl: cfg.baseUrl })
      });
      var j = await resp.json();
      if (!j.ok) throw new Error(j.error || '教案生成失败');
      renderLesson(j.lesson, j.outline || []);
    } catch (e) {
      box.innerHTML = '<div class="warn-box">⚠️ 教案生成失败：' + esc(e.message) + '<br><span class="hint">请确认已在「知识问答」页配置 DeepSeek API Key。</span></div>';
    }
    if (btn) { btn.disabled = false; btn.textContent = '📝 生成教案'; }
  };

  function renderLesson(lesson, outline) {
    var box = $('lesson-result');
    var html = '<div class="card"><h3>📋 ' + esc(lesson.title || '教案') + '</h3>' +
      '<p class="hint">' + esc(lesson.target_audience || '') + '　·　' + esc(lesson.duration || '') + '</p>';
    if ((lesson.teaching_objectives || []).length) {
      html += '<h4>🎯 教学目标</h4><ul style="font-size:13px;color:var(--ink2);line-height:1.9;padding-left:20px">' +
        lesson.teaching_objectives.map(function (o) { return '<li>' + mdInline(o) + '</li>'; }).join('') + '</ul>';
    }
    if ((lesson.knowledge_framework || []).length) {
      html += '<h4>🗂️ 知识框架</h4><table class="grid"><thead><tr><th>环节</th><th>要点</th><th>时长</th></tr></thead><tbody>';
      lesson.knowledge_framework.forEach(function (k) {
        html += '<tr><td>' + esc(k.section || '') + '</td><td style="text-align:left">' + esc((k.key_points || []).join('、')) + '</td><td>' + (k.duration_min || '—') + 'min</td></tr>';
      });
      html += '</tbody></table>';
    }
    if ((lesson.teaching_process || []).length) {
      html += '<h4>👩‍🏫 教学过程</h4>';
      lesson.teaching_process.forEach(function (p) {
        html += '<div style="border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin-bottom:8px">' +
          '<b style="color:var(--primary)">步骤' + (p.step || '') + '：' + esc(p.name || '') + '</b> <span class="hint">' + (p.minutes || '') + 'min</span>' +
          '<div style="font-size:13px;color:var(--ink2);margin-top:4px">' + mdInline(p.content || '') + '</div>' +
          ((p.examples || []).length ? '<div style="font-size:12.5px;color:var(--ink2);margin-top:4px;background:var(--accent-soft);border-radius:8px;padding:6px 10px"><b>📐 举例：</b>' + p.examples.map(function (e) { return mdInline(e); }).join('<br>') + '</div>' : '') +
          (p.interaction ? '<div class="hint" style="margin-top:4px">💬 互动：' + esc(p.interaction) + '</div>' : '') + '</div>';
      });
    }
    if ((lesson.difficult_points || []).length) {
      html += '<h4>🧗 难点与突破</h4>';
      lesson.difficult_points.forEach(function (d) {
        html += '<div style="font-size:13px;color:var(--ink2);margin:4px 0">• <b>' + esc(d.point || '') + '</b> → ' + mdInline(d.strategy || '') + '</div>';
      });
    }
    if ((lesson.case_studies || []).length) html += '<h4>📚 课堂案例</h4>' + lesson.case_studies.map(function (c) { return '<div style="font-size:13px;color:var(--ink2);margin:4px 0">• ' + mdInline(c) + '</div>'; }).join('');
    if ((lesson.assignments || []).length) html += '<h4>📝 作业设计</h4>' + lesson.assignments.map(function (a) { return '<div style="font-size:13px;color:var(--ink2);margin:4px 0">• ' + mdInline(a) + '</div>'; }).join('');
    html += '<h4>📊 考核评价</h4><div style="font-size:13px;color:var(--ink2)">' + mdInline(lesson.assessment || '') + '</div>';
    if ((lesson.references || []).length) {
      html += '<h4>📎 参考文献（观点出处）</h4>';
      lesson.references.forEach(function (r) {
        html += '<div style="font-size:12.5px;color:var(--ink2);margin:3px 0"><span class="src-chip">出处</span> ' + esc(r.item || '') + ' <span class="hint">（' + esc(r.source || '') + '）</span></div>';
      });
    }
    html += '<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">' +
      '<button class="btn btn-gold" onclick="downloadLessonPptx()">📥 导出 PPT（.pptx）</button>' +
      '<button class="btn btn-soft" onclick="downloadLessonMd()">📄 导出讲义（.md）</button>' +
      '<button class="btn btn-soft" onclick="copyLesson()">📋 复制教案</button></div></div>';
    box.innerHTML = html;
    window._lastLesson = lesson;
    window._lastOutline = outline;
  }
  window.copyLesson = function () {
    var l = window._lastLesson;
    if (!l) return;
    var txt = '## ' + l.title + '\n\n### 教学目标\n' + (l.teaching_objectives || []).map(function (o) { return '- ' + o; }).join('\n') +
      '\n\n### 教学过程\n' + (l.teaching_process || []).map(function (p) { return '**' + (p.name || '') + '**：' + p.content + ((p.examples || []).length ? '\n  例：' + p.examples.join('；') : ''); }).join('\n') +
      '\n\n### 参考文献\n' + (l.references || []).map(function (r) { return '- ' + r.item + '（' + r.source + '）'; }).join('\n');
    navigator.clipboard.writeText(txt).then(function () { alert('教案已复制'); });
  };
  window.downloadLessonMd = function () {
    var l = window._lastLesson;
    if (!l) { alert('暂无教案，请先生成教案'); return; }
    var md = '# ' + (l.title || '统计教案') + '\n\n' +
      '> 适用对象：' + (l.target_audience || '—') + '　课时：' + (l.duration || '—') + '\n\n' +
      '## 教学目标\n' + (l.teaching_objectives || []).map(function (o) { return '- ' + o; }).join('\n') + '\n\n' +
      '## 知识框架\n' + (l.knowledge_framework || []).map(function (k) { return '- [' + (k.duration_min || '?') + 'min] ' + k.section + '：' + (k.key_points || []).join('、'); }).join('\n') + '\n\n' +
      '## 教学过程\n' + (l.teaching_process || []).map(function (p) {
        var s = '### ' + (p.step || '') + '. ' + (p.name || '') + '（' + (p.minutes || '?') + 'min）\n' + (p.content || '');
        if ((p.examples || []).length) s += '\n\n**举例：**' + p.examples.map(function (e) { return '\n- ' + e; }).join('');
        if (p.visual) s += '\n\n**可视化示意：**' + p.visual;
        if (p.interaction) s += '\n\n**互动：**' + p.interaction;
        return s;
      }).join('\n\n') + '\n\n' +
      '## 教学难点与突破\n' + (l.difficult_points || []).map(function (d) { return '- ' + d.point + ' → ' + d.strategy; }).join('\n') + '\n\n' +
      '## 案例\n' + (l.case_studies || []).map(function (c) { return '- ' + c; }).join('\n') + '\n\n' +
      '## 作业与考核\n' + (l.assignments || []).map(function (a) { return '- ' + a; }).join('\n') + '\n- 评价：' + (l.assessment || '—') + '\n\n' +
      '## 参考文献（出处）\n' + (l.references || []).map(function (r) { return '- ' + r.item + '（' + r.source + '）'; }).join('\n');
    var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '教案_' + (l.title || '统计课') + '.md';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  window.downloadLessonPptx = function () {
    var lesson = window._lastLesson, outline = window._lastOutline;
    var Pptx = window.PptxGenJS || window.pptxgen;
    if (!lesson) { alert('暂无教案，请先点击「生成教案」'); return; }
    if (!Pptx) { alert('PPT 组件未就绪，请刷新页面后重试'); return; }
    try {
      var pptx = new Pptx();
      pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
      pptx.layout = 'WIDE';
      var NAVY = '1E3A5F', GOLD = 'C9B037', GRAY = '6B7280', BODY = '44566C';
      var fontFace = 'Microsoft YaHei';
      (outline && outline.length ? outline : []).forEach(function (s, i) {
        if (s.type === 'cover') {
          var slide = pptx.addSlide();
          slide.background = { color: NAVY };
          slide.addText(s.title, { x: 0.8, y: 2.2, w: 11.7, h: 1.4, fontSize: 36, bold: true, color: 'FFFFFF', fontFace: fontFace, align: 'center' });
          slide.addShape('line', { x: 4.5, y: 3.7, w: 4.3, h: 0, line: { color: GOLD, width: 2 } });
          slide.addText(s.subtitle || '', { x: 0.8, y: 4.0, w: 11.7, h: 0.6, fontSize: 16, color: GOLD, fontFace: fontFace, align: 'center' });
          slide.addText(s.meta || '', { x: 0.8, y: 4.7, w: 11.7, h: 0.5, fontSize: 12, color: 'B8C4D4', fontFace: fontFace, align: 'center' });
        } else if (s.type === 'chart') {
          var c = s.chart || {};
          var chartSlide = pptx.addSlide();
          chartSlide.background = { color: 'FFFFFF' };
          chartSlide.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.9, fill: { color: NAVY } });
          chartSlide.addText(s.title, { x: 0.5, y: 0.16, w: 11.5, h: 0.6, fontSize: 22, bold: true, color: 'FFFFFF', fontFace: fontFace });
          try {
            var chartType = { bar: 'bar', line: 'line', scatter: 'scatter', pie: 'doughnut' }[c.type] || 'bar';
            var series = (c.series || []).map(function (sr) {
              return { name: sr.name || '数值', labels: c.labels || [], values: (sr.data || []).map(Number) };
            });
            chartSlide.addChart(chartType, series, {
              x: 1.0, y: 1.3, w: 8.6, h: 4.8,
              xValAxisLabel: c.xLabel || '', yValAxisLabel: c.yLabel || '',
              showLegend: series.length > 1, legendPos: 'b',
              catAxisLabelFontFace: fontFace, valAxisLabelFontFace: fontFace,
              chartColors: [GOLD, NAVY, '3A6B9E', '8B5CF6', '10B981'], showTitle: false
            });
          } catch (e) { /* 图表失败不影响整体 */ }
          if (c.note) chartSlide.addText('💡 ' + c.note, { x: 1.0, y: 6.4, w: 11.0, h: 0.6, fontSize: 12, color: BODY, fontFace: fontFace });
          chartSlide.addText('「数智统计」教案 · 第 ' + (i + 1) + ' 页', { x: 0.5, y: 7.1, w: 5, h: 0.3, fontSize: 9, color: GRAY, fontFace: fontFace });
        } else {
          var s2 = pptx.addSlide();
          s2.background = { color: 'FFFFFF' };
          s2.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.9, fill: { color: NAVY } });
          s2.addText(s.title, { x: 0.5, y: 0.16, w: 11.5, h: 0.6, fontSize: 22, bold: true, color: 'FFFFFF', fontFace: fontFace });
          if (s.type === 'ref') {
            (s.items || []).forEach(function (it, k) {
              s2.addText((k + 1) + '. ' + it, { x: 0.6, y: 1.2 + k * 0.55, w: 12.1, h: 0.5, fontSize: 13, color: BODY, fontFace: fontFace, valign: 'top' });
            });
          } else {
            var items = s.items || [];
            var lines = items.map(function (it) { return '• ' + it; });
            s2.addText(lines.join('\n'), {
              x: 0.6, y: 1.1, w: 12.1, h: 5.9, fontSize: 15, color: BODY, fontFace: fontFace, valign: 'top', paraSpaceAfterPt: 10, lineSpacingMultiple: 1.15
            });
          }
          s2.addText('「数智统计」教案 · 第 ' + (i + 1) + ' 页', { x: 0.5, y: 7.1, w: 5, h: 0.3, fontSize: 9, color: GRAY, fontFace: fontFace });
        }
      });
      var fname = '教案_' + (lesson.title || '统计课') + '.pptx';
      pptx.writeFile({ fileName: fname });
    } catch (e) {
      alert('PPT 生成失败：' + e.message);
    }
  };

  /* ================= 初始化 ================= */
  document.addEventListener('DOMContentLoaded', function () {
    renderSuggestions();
    initChatConfig();
    renderAbout();
    updateChatStatus();
    // 默认欢迎消息
    setTimeout(function () {
      addMsg('ai', '<b>你好！我是「数智统计」答疑助手。</b><br><br>' +
        '我可以帮你：<br>' +
        '📖 讲解统计概念、辨析易混淆术语、引导证明题思路（回答附带来源引用）<br>' +
        '📊 引导数据分析：切换到「数据分析 Agent」上传数据即可自动完成清洗、检验、建模与报告<br>' +
        '📚 浏览教学资源、检索文献、蒸馏知识、生成教案（顶部导航直达）<br><br>' +
        '先试试下面的推荐问题，或在输入框直接提问～');
    }, 200);
  });

})();
