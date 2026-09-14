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
    if (page === 'viz') initViz();
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
      workerUrl: 'http://localhost:8787'
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
    var t = $('typing-msg');
    if (t) t.remove();
  }

  /* ---- 本地知识库兜底回答 ---- */
  function localAnswer(question) {
    var hits = KB.search(question, 3);
    if (!hits.length) {
      return '<b>抱歉，知识库暂未检索到与「' + esc(question) + '」直接匹配的内容。</b><br><br>' +
        '建议：① 换个更聚焦的关键词（如"t 检验""置信区间""卡方检验"）；② 尝试下方推荐问题；③ 配置大模型 Key 后获得更开放的生成式答疑。';
    }
    var html = '<b>根据统计学科知识库检索，要点如下：</b><br><br>';
    hits.forEach(function (h, i) {
      html += '<b>『' + mdInline(h.title) + '』</b><br>' + mdInline(h.content) + '<br><br>';
      html += '<span class="src-chip">来源</span> <b>' + esc(h.source) + '</b><br><br>';
    });
    html += '<div class="src-ref">📎 以上内容来自华东师大统计学院课程讲义与高等教育出版社权威教材，回答可溯源。<br>💡 配置大模型 API Key 后可获得更深入的推导讲解与个性化答疑。</div>';
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
    var context = hits.map(function (h) {
      return '[知识点] ' + h.title + '\n' + h.content + '\n[来源] ' + h.source;
    }).join('\n\n');

    var finalize = function (finalHtml, sources) {
      removeTyping();
      var bubble = addMsg('ai', finalHtml);
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
    callLLM(q, context,
      function (delta) {
        if (!started) {
          removeTyping();
          var div = document.createElement('div');
          div.className = 'msg ai';
          div.innerHTML = '<div class="avatar">Σ</div><div class="bubble" id="stream-bubble"></div>';
          $('chat-msgs').appendChild(div);
          aiMsg = div;
          started = true;
        }
        acc += delta;
        var b = $('stream-bubble');
        if (b) b.innerHTML = mdInline(acc) + '<span class="typing-ind" style="margin-left:6px"><i></i><i></i><i></i></span>';
        var box = $('chat-msgs'); box.scrollTop = box.scrollHeight;
      },
      function (full, sources) {
        var b = $('stream-bubble');
        if (b) {
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
          b.innerHTML = mdInline(full || acc) + srcHtml;
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
          }
        } else {
          var av = S.anovaOneWay(gs, gNames);
          if (av) {
            var sig2 = av.significant ? '<span style="color:var(--ok);font-weight:700">显著</span>' : '<span style="color:var(--muted)">不显著</span>';
            html += '<span class="hint">' + esc(av.method) + '：F(' + av.df1 + ', ' + av.df2 + ') = ' + S.fmtNum(av.F, 3) + '，P = ' + S.fmtP(av.p) + '，η² = ' + S.fmtNum(av.eta2, 3) + '</span><br>';
            html += '结论：组间差异<b> ' + sig2 + ' </b><br>';
            html += '<span class="hint">组均值：' + av.groupStats.map(function (g) { return esc(g.name) + '=' + S.fmtNum(g.mean); }).join('，') + '</span>';
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

  /* ==========================================================
   * 三、多模态可视化实验室
   * ========================================================== */
  var VIZ = {
    clt: { title: '中心极限定理', desc: '从任意分布（可选）反复抽样，观察样本均值的分布随样本量 n 增大趋于正态。' },
    lln: { title: '大数定律', desc: '样本均值随 n 增大依概率收敛于总体均值 μ。' },
    ci: { title: '置信区间模拟', desc: '重复抽样并构造 95% 置信区间，观察覆盖率是否接近 95%。' },
    power: { title: '假设检验功效', desc: '调节效应量 d、样本量 n 与显著性水平 α，观察检验功效（1−β）与两类错误的变化。' },
    normal: { title: '正态分布曲线', desc: '调节均值 μ 与标准差 σ，观察概率密度曲线形态。' },
    reg: { title: '回归拟合演示', desc: '拖动数据点，观察最小二乘回归线的变化与残差。' }
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
      b.innerHTML = '<span class="vi">' + ({ clt: '🎲', lln: '📉', ci: '🎯', power: '⚡', normal: '🔔', reg: '📈' }[k]) + '</span>' + VIZ[k].title;
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
        '📊 引导数据分析：切换到「数据分析 Agent」上传数据即可自动完成清洗、检验、建模与报告<br><br>' +
        '先试试下面的推荐问题，或在输入框直接提问～');
    }, 200);
  });

})();
