/* ============================================================
 * 统计学学科大模型 · 前端统计引擎 stats-engine.js
 * ------------------------------------------------------------
 * 纯 JavaScript 实现的统计计算与可视化引擎（零第三方依赖）：
 *   1. 数据解析与清洗（CSV/TSV、类型推断、缺失与异常检测）
 *   2. 描述统计（均值/中位数/SD/分位数/偏度/峰度/置信区间）
 *   3. 推断统计（单样本/独立/配对 t、单因素 ANOVA、卡方、
 *      Pearson/Spearman 相关、多元线性回归 OLS）
 *   4. 概率分布函数（正态/t/F/χ² 的 CDF 与分位数）
 *   5. Canvas 图表（直方图/箱线图/散点图/QQ 图/残差图/热力图）
 *   6. 一键自动分析 → 生成中文统计报告（Markdown）
 * ============================================================ */

(function (global) {
  'use strict';

  var STAT = {};

  /* ==========================================================
   * 一、数值与分布函数
   * ========================================================== */

  function gammaLn(x) {
    // Lanczos approximation
    var cof = [76.18009172947146, -86.50532032941677, 24.01409824083091,
      -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    var y = x, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    var ser = 1.000000000190015;
    for (var j = 0; j < 6; j++) ser += cof[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }

  function regularizedIncompleteBeta(a, b, x) {
    // I_x(a,b)，连分数法（Numerical Recipes betai）
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var lbeta = gammaLn(a + b) - gammaLn(a) - gammaLn(b);
    // bt = x^a (1-x)^b / B(a,b) = exp(a·lnx + b·ln(1-x) + lnΓ(a+b) − lnΓ(a) − lnΓ(b))
    var front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b + lbeta);
    if (x < (a + 1) / (a + b + 2)) return front * betacf(a, b, x) / a;
    return 1 - front * betacf(b, a, 1 - x) / b;
  }

  function betacf(a, b, x) {
    var MAXIT = 200, EPS = 3e-12, FPMIN = 1e-300;
    var qab = a + b, qap = a + 1, qam = a - 1;
    var c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    var h = d;
    for (var m = 1; m <= MAXIT; m++) {
      var m2 = 2 * m;
      var aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      var del = d * c;
      h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }

  function gammaP(a, x) {
    // 不完全 Gamma 下尾 P(a,x) = γ(a,x)/Γ(a)
    if (x <= 0) return 0;
    if (x < a + 1) {
      // 级数展开（NR gser）
      var ap = a, sum = 1 / a, del = sum;
      for (var n = 0; n < 300; n++) {
        ap += 1; del *= x / ap; sum += del;
        if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
      }
      return sum * Math.exp(-x + a * Math.log(x) - gammaLn(a));
    }
    // 连分数（NR gcf）：P = 1 − Q
    return 1 - gammaQ(a, x);
  }

  function gammaQ(a, x) {
    // 不完全 Gamma 上尾 Q(a,x) = Γ(a,x)/Γ(a)，连分数（NR gcf）
    var FPMIN = 1e-300, MAXIT = 200, EPS = 3e-14;
    var b = x + 1 - a;
    var c = 1 / FPMIN;
    var d = 1 / b;
    var h = d;
    var i, an, del;
    for (i = 1; i <= MAXIT; i++) {
      an = -i * (i - a);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      del = d * c;
      h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return Math.exp(-x + a * Math.log(x) - gammaLn(a)) * h;
  }

  /* ---- 正态分布 ---- */
  function erf(x) {
    // Abramowitz–Stegun 7.1.26
    var sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return sign * y;
  }
  function normCdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }
  function normInv(p) {
    // Acklam 初始近似 + Newton–Raphson 精化
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    var plow = 0.02425, phigh = 1 - plow, q, r, x;
    if (p < plow) {
      q = Math.sqrt(-2 * Math.log(p));
      x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p <= phigh) {
      q = p - 0.5; r = q * q;
      x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    // Newton–Raphson 精化：x ← x − (Φ(x)−p)/φ(x)
    for (var it = 0; it < 4; it++) {
      var phi = 0.5 * (1 + erf(x / Math.SQRT2));
      var e = phi - p;
      var pdf = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
      x = x - e / pdf;
    }
    return x;
  }

  /* ---- t 分布 ---- */
  function tCdf(t, df) {
    if (df <= 0) return NaN;
    var x = df / (df + t * t);
    var p = 0.5 * regularizedIncompleteBeta(df / 2, 0.5, x);
    return t > 0 ? 1 - p : p;
  }
  function tPval(t, df, twoTailed) {
    var p = tCdf(t, df);
    var tail = t > 0 ? 1 - p : p;
    return twoTailed ? 2 * tail : tail;
  }
  function tInv(df, p) {
    // 二分法求 t 分布分位数（稳健）
    if (df <= 0) return NaN;
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    var lo = -40, hi = 40;
    while (tCdf(hi, df) < p) hi *= 2;
    while (tCdf(lo, df) > p) lo *= 2;
    for (var i = 0; i < 80; i++) {
      var mid = (lo + hi) / 2;
      if (tCdf(mid, df) < p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /* ---- F 分布 ---- */
  function fCdf(F, d1, d2) {
    if (F <= 0) return 0;
    if (d1 <= 0 || d2 <= 0) return NaN;
    var x = d1 * F / (d1 * F + d2);
    return regularizedIncompleteBeta(d1 / 2, d2 / 2, x);
  }
  function fPval(F, d1, d2) { return 1 - fCdf(F, d1, d2); }
  function fInv(d1, d2, p) {
    if (p <= 0) return 0;
    if (p >= 1) return Infinity;
    var lo = 0, hi = 1000;
    while (fCdf(hi, d1, d2) < p) hi *= 2;
    for (var i = 0; i < 100; i++) {
      var mid = (lo + hi) / 2;
      if (fCdf(mid, d1, d2) < p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /* ---- χ² 分布 ---- */
  function chi2Cdf(x, k) { return x <= 0 ? 0 : gammaP(k / 2, x / 2); }
  function chi2Pval(x, k) { return x <= 0 ? 1 : gammaQ(k / 2, x / 2); }
  function chi2Inv(k, p) {
    if (p <= 0) return 0;
    if (p >= 1) return Infinity;
    var lo = 0, hi = 1;
    while (chi2Cdf(hi, k) < p) hi *= 2;
    for (var i = 0; i < 100; i++) {
      var mid = (lo + hi) / 2;
      if (chi2Cdf(mid, k) < p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /* ---- 通用二分求逆 ---- */
  function invert(cdfFn, p, lo, hi) {
    if (p <= 0) return lo;
    if (p >= 1) return hi;
    for (var i = 0; i < 100; i++) {
      var mid = (lo + hi) / 2;
      if (cdfFn(mid) < p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /* ==========================================================
   * 二、基础统计量
   * ========================================================== */

  function sum(arr) { var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i]; return s; }
  function mean(arr) { return arr.length ? sum(arr) / arr.length : NaN; }
  function variance(arr, ddof) {
    ddof = ddof == null ? 1 : ddof;
    if (arr.length <= ddof) return NaN;
    var m = mean(arr), s = 0;
    for (var i = 0; i < arr.length; i++) s += (arr[i] - m) * (arr[i] - m);
    return s / (arr.length - ddof);
  }
  function sd(arr, ddof) { return Math.sqrt(variance(arr, ddof)); }
  function se(arr) { return sd(arr) / Math.sqrt(arr.length); }
  function quantile(arr, q) {
    if (!arr.length) return NaN;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var pos = (a.length - 1) * q;
    var base = Math.floor(pos);
    var rest = pos - base;
    return (base + 1 < a.length) ? a[base] + rest * (a[base + 1] - a[base]) : a[base];
  }
  function median(arr) { return quantile(arr, 0.5); }
  function iqr(arr) { return quantile(arr, 0.75) - quantile(arr, 0.25); }
  function skewness(arr) {
    var n = arr.length, m = mean(arr), s = sd(arr, 0);
    if (!n || !s) return NaN;
    var t = 0;
    for (var i = 0; i < n; i++) t += Math.pow((arr[i] - m) / s, 3);
    return (n / ((n - 1) * (n - 2))) * t;
  }
  function kurtosis(arr) {
    var n = arr.length, m = mean(arr), s = sd(arr, 0);
    if (!n || !s) return NaN;
    var t = 0;
    for (var i = 0; i < n; i++) t += Math.pow((arr[i] - m) / s, 4);
    return n * (n + 1) / ((n - 1) * (n - 2) * (n - 3)) * t - 3 * (n - 1) * (n - 1) / ((n - 2) * (n - 3));
  }
  function zScoreOutliers(arr) {
    var m = mean(arr), s = sd(arr);
    if (!s) return [];
    var idx = [];
    for (var i = 0; i < arr.length; i++) if (Math.abs((arr[i] - m) / s) > 3) idx.push(i);
    return idx;
  }
  function iqrOutliers(arr) {
    var q1 = quantile(arr, 0.25), q3 = quantile(arr, 0.75);
    var iq = q3 - q1;
    var idx = [];
    for (var i = 0; i < arr.length; i++) if (arr[i] < q1 - 1.5 * iq || arr[i] > q3 + 1.5 * iq) idx.push(i);
    return idx;
  }
  function confIntervalMean(arr, alpha) {
    alpha = alpha == null ? 0.05 : alpha;
    var n = arr.length, m = mean(arr), s = sd(arr);
    var tCrit = tInv(n - 1, 1 - alpha / 2);
    var err = tCrit * s / Math.sqrt(n);
    return { lo: m - err, hi: m + err, mean: m, se: s / Math.sqrt(n), n: n, tCrit: tCrit };
  }
  function fmtP(p) {
    if (p == null || isNaN(p)) return '—';
    if (p < 0.001) return '<0.001';
    return p.toFixed(3);
  }
  function fmtNum(x, d) {
    if (x == null || isNaN(x)) return '—';
    d = d == null ? 3 : d;
    return Number(x.toFixed(d)).toLocaleString('zh-CN', { maximumFractionDigits: d });
  }
  function fmtInt(x) { return x == null ? '—' : Number(x).toLocaleString('zh-CN'); }

  function describe(arr) {
    var n = arr.length;
    var m = mean(arr);
    var s = sd(arr);
    var ci = confIntervalMean(arr);
    var out = {
      n: n, mean: m, sd: s, se: ci.se,
      median: median(arr), min: n ? Math.min.apply(null, arr) : NaN,
      max: n ? Math.max.apply(null, arr) : NaN,
      q1: quantile(arr, 0.25), q3: quantile(arr, 0.75), iqr: iqr(arr),
      skew: skewness(arr), kurt: kurtosis(arr),
      ci95_lo: ci.lo, ci95_hi: ci.hi,
      missing: NaN, outliers: iqrOutliers(arr).length
    };
    return out;
  }

  function freqTable(arr) {
    var map = {};
    arr.forEach(function (v) { var k = String(v); map[k] = (map[k] || 0) + 1; });
    var keys = Object.keys(map);
    keys.sort(function (a, b) { return map[b] - map[a]; });
    return keys.map(function (k) { return { value: k, count: map[k], pct: map[k] / arr.length }; });
  }

  /* ==========================================================
   * 三、假设检验
   * ========================================================== */

  /* 单样本 t 检验 */
  function tTestOneSample(sample, mu0) {
    var n = sample.length, m = mean(sample), s = sd(sample);
    if (!n || !s) return null;
    var t = (m - mu0) / (s / Math.sqrt(n));
    var p = tPval(t, n - 1, true);
    return {
      method: '单样本 t 检验', t: t, df: n - 1, p: p,
      mean: m, sd: s, se: s / Math.sqrt(n), mu0: mu0,
      ci: confIntervalMean(sample), significant: p < 0.05
    };
  }

  /* 独立样本 t 检验（默认 Welch） */
  function tTestIndependent(a, b, opts) {
    opts = opts || {};
    var welch = opts.welch !== false;
    var na = a.length, nb = b.length;
    var ma = mean(a), mb = mean(b);
    var va = variance(a), vb = variance(b);
    if (!na || !nb || (!va && !vb)) return null;
    var t, df, pooled;
    if (welch) {
      t = (ma - mb) / Math.sqrt(va / na + vb / nb);
      var num = Math.pow(va / na + vb / nb, 2);
      var den = Math.pow(va / na, 2) / (na - 1) + Math.pow(vb / nb, 2) / (nb - 1);
      df = num / den;
    } else {
      pooled = ((na - 1) * va + (nb - 1) * vb) / (na + nb - 2);
      var sp = Math.sqrt(pooled);
      t = (ma - mb) / (sp * Math.sqrt(1 / na + 1 / nb));
      df = na + nb - 2;
    }
    var p = tPval(t, df, true);
    var cohenD = Math.abs(ma - mb) / Math.sqrt(((na - 1) * va + (nb - 1) * vb) / (na + nb - 2));
    return {
      method: welch ? "Welch 独立样本 t 检验" : "Student 独立样本 t 检验",
      t: t, df: df, p: p,
      meanA: ma, meanB: mb, sdA: Math.sqrt(va), sdB: Math.sqrt(vb),
      diff: ma - mb, cohenD: cohenD, significant: p < 0.05
    };
  }

  /* 配对 t 检验 */
  function tTestPaired(a, b) {
    var n = Math.min(a.length, b.length);
    var d = [];
    for (var i = 0; i < n; i++) d.push(a[i] - b[i]);
    var md = mean(d), s = sd(d);
    if (!n || !s) return null;
    var t = md / (s / Math.sqrt(n));
    var p = tPval(t, n - 1, true);
    return {
      method: '配对样本 t 检验', t: t, df: n - 1, p: p,
      meanDiff: md, sdDiff: s, meanA: mean(a), meanB: mean(b),
      cohenD: Math.abs(md) / s, significant: p < 0.05
    };
  }

  /* 单因素 ANOVA + Bonferroni 多重比较 */
  function anovaOneWay(groups, groupNames) {
    var k = groups.length;
    var sizes = groups.map(function (g) { return g.length; });
    var means = groups.map(mean);
    var nTotal = sum(sizes);
    if (k < 2 || nTotal < k + 1) return null;

    var grand = 0;
    for (var i = 0; i < k; i++) grand += sum(groups[i]);
    grand /= nTotal;

    var ssBetween = 0, ssWithin = 0;
    groups.forEach(function (g, i) {
      ssBetween += sizes[i] * (means[i] - grand) * (means[i] - grand);
      g.forEach(function (v) { ssWithin += (v - means[i]) * (v - means[i]); });
    });
    var df1 = k - 1, df2 = nTotal - k;
    var msBetween = ssBetween / df1, msWithin = ssWithin / df2;
    var F = msBetween / msWithin;
    var p = fPval(F, df1, df2);
    var eta2 = ssBetween / (ssBetween + ssWithin);
    var omega2 = (ssBetween - df1 * msWithin) / (ssBetween + ssWithin + msWithin);

    /* Bonferroni 校正两两比较 */
    var pairs = [];
    for (var i2 = 0; i2 < k; i2++) {
      for (var j = i2 + 1; j < k; j++) {
        var d = means[i2] - means[j];
        var sPool = Math.sqrt(((sizes[i2] - 1) * variance(groups[i2]) + (sizes[j] - 1) * variance(groups[j])) / (sizes[i2] + sizes[j] - 2));
        var tStat = d / (sPool * Math.sqrt(1 / sizes[i2] + 1 / sizes[j]));
        var dfij = sizes[i2] + sizes[j] - 2;
        var rawP = tPval(tStat, dfij, true);
        pairs.push({
          groupA: groupNames ? groupNames[i2] : ('组' + (i2 + 1)),
          groupB: groupNames ? groupNames[j] : ('组' + (j + 1)),
          diff: d, t: tStat, df: dfij, rawP: rawP,
          adjP: Math.min(1, rawP * (k * (k - 1) / 2)),
          significant: rawP * (k * (k - 1) / 2) < 0.05
        });
      }
    }

    return {
      method: '单因素方差分析（ANOVA）',
      F: F, df1: df1, df2: df2, p: p,
      eta2: eta2, omega2: omega2,
      ssBetween: ssBetween, ssWithin: ssWithin,
      groupStats: groups.map(function (g, i) {
        return { name: groupNames ? groupNames[i] : ('组' + (i + 1)), n: sizes[i], mean: means[i], sd: sd(g) };
      }),
      pairs: pairs, significant: p < 0.05
    };
  }

  /* 卡方独立性检验 */
  function chi2Test(matrix) {
    var rows = matrix.length, cols = matrix[0].length;
    var rowSum = new Array(rows).fill(0), colSum = new Array(cols).fill(0), total = 0;
    for (var i = 0; i < rows; i++) for (var j = 0; j < cols; j++) {
      rowSum[i] += matrix[i][j]; colSum[j] += matrix[i][j]; total += matrix[i][j];
    }
    if (!total) return null;
    var chi2 = 0, minExp = Infinity;
    for (var i2 = 0; i2 < rows; i2++) for (var j2 = 0; j2 < cols; j2++) {
      var exp = rowSum[i2] * colSum[j2] / total;
      minExp = Math.min(minExp, exp);
      chi2 += (matrix[i2][j2] - exp) * (matrix[i2][j2] - exp) / exp;
    }
    var df = (rows - 1) * (cols - 1);
    var p = chi2Pval(chi2, df);
    var cramersV = Math.sqrt(chi2 / (total * (Math.min(rows, cols) - 1)));
    return {
      method: '卡方独立性检验（χ²）',
      chi2: chi2, df: df, p: p, cramersV: cramersV,
      total: total, minExpected: minExp,
      expectedOk: minExp >= 1 && (minExp >= 5 || true),
      significant: p < 0.05,
      warn: minExp < 1 ? '存在期望频数 < 1 的单元格，建议合并类别或改用 Fisher 精确检验' :
        (minExp < 5 ? '存在期望频数 < 5 的单元格，结果需谨慎解读，可考虑合并类别' : null)
    };
  }

  /* ---- 非参数检验 ---- */
  function rankArray(values) {
    // 平均秩（并列取平均）
    var idx = values.map(function (v, i) { return { v: v, i: i }; })
      .sort(function (a, b) { return a.v - b.v; });
    var ranks = new Array(values.length);
    var i = 0;
    while (i < idx.length) {
      var j = i;
      while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
      var avg = (i + j) / 2 + 1;
      for (var k = i; k <= j; k++) ranks[idx[k].i] = avg;
      i = j + 1;
    }
    return ranks;
  }

  /* Wilcoxon 秩和检验（Mann-Whitney U）— 两独立样本 */
  function wilcoxonRankSum(a, b) {
    var n1 = a.length, n2 = b.length;
    if (n1 < 3 || n2 < 3) return null;
    var all = a.map(function (v) { return { v: v, g: 0 }; }).concat(b.map(function (v) { return { v: v, g: 1 }; }));
    var ranks = rankArray(all.map(function (x) { return x.v; }));
    var r0 = 0;
    all.forEach(function (x, idx) { if (x.g === 0) r0 += ranks[idx]; });
    var U1 = r0 - n1 * (n1 + 1) / 2;
    var U2 = n1 * n2 - U1;
    var mu = n1 * n2 / 2;
    var sigma = Math.sqrt(n1 * n2 * (n1 + n2 + 1) / 12);
    if (!sigma) return null;
    var Umax = Math.max(U1, U2);
    var z = (Umax - mu - 0.5) / sigma; // 连续性校正
    var p = 2 * (1 - normCdf(Math.abs(z)));
    return {
      method: 'Wilcoxon 秩和检验（Mann-Whitney U）',
      U: U1, z: z, p: p, n1: n1, n2: n2,
      medianA: median(a), medianB: median(b),
      significant: p < 0.05
    };
  }

  /* Wilcoxon 符号秩检验 — 配对样本 */
  function wilcoxonSignedRank(a, b) {
    var diffs = [], i;
    for (i = 0; i < Math.min(a.length, b.length); i++) {
      var d = a[i] - b[i];
      if (d !== 0) diffs.push(d);
    }
    var n = diffs.length;
    if (n < 3) return null;
    var absSorted = diffs.map(function (d, idx) { return { abs: Math.abs(d), sign: d > 0 ? 1 : -1, idx: idx }; })
      .sort(function (x, y) { return x.abs - y.abs; });
    var ranks = rankArray(absSorted.map(function (x) { return x.abs; }));
    var rankByIdx = {};
    absSorted.forEach(function (x, k) { rankByIdx[x.idx] = ranks[k]; });
    var wPlus = 0;
    diffs.forEach(function (d, idx) { if (d > 0) wPlus += rankByIdx[idx]; });
    var mu = n * (n + 1) / 4;
    var sigma = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24);
    var z = (wPlus - mu) / sigma;
    var p = 2 * (1 - normCdf(Math.abs(z)));
    return {
      method: 'Wilcoxon 符号秩检验（配对）',
      W: wPlus, z: z, p: p, n: n,
      medianDiff: median(a) - median(b),
      significant: p < 0.05
    };
  }

  /* Kruskal-Wallis 检验 — 多组独立样本 */
  function kruskalWallis(groups) {
    var k = groups.length;
    if (k < 2) return null;
    var all = [];
    groups.forEach(function (g, gi) { g.forEach(function (v) { all.push({ v: v, g: gi }); }); });
    var ranks = rankArray(all.map(function (x) { return x.v; }));
    var N = all.length;
    var ri = new Array(k).fill(0), ni = groups.map(function (g) { return g.length; });
    all.forEach(function (x, idx) { ri[x.g] += ranks[idx]; });
    var H = (12 / (N * (N + 1))) * ri.reduce(function (s, r, gi) { return s + r * r / ni[gi]; }, 0) - 3 * (N + 1);
    // 并列校正
    var tieCounts = {};
    all.forEach(function (x) { var key = x.v; tieCounts[key] = (tieCounts[key] || 0) + 1; });
    var tieAdj = 0;
    Object.keys(tieCounts).forEach(function (key) {
      var t = tieCounts[key];
      if (t > 1) tieAdj += (t * t * t - t);
    });
    var denom = 1 - tieAdj / (N * N * N - N);
    if (denom > 0) H = H / denom;
    var df = k - 1;
    var p = 1 - chi2Cdf(H, df);
    return {
      method: 'Kruskal-Wallis 检验（非参数 ANOVA）',
      H: H, df: df, p: p,
      groupMedians: groups.map(median),
      significant: p < 0.05
    };
  }

  /* ---- 功效分析 ---- */
  /* 独立样本 t 检验的功效（非中心 t 近似） */
  function powerTTest(d, n, alpha, twoTailed) {
    alpha = alpha == null ? 0.05 : alpha;
    twoTailed = twoTailed !== false;
    var df = 2 * n - 2;
    var nc = d * Math.sqrt(n / 2);
    var tCrit = tInv(df, twoTailed ? 1 - alpha / 2 : 1 - alpha);
    var p1 = tCdf(tCrit - nc, df);
    var p2 = twoTailed ? tCdf(-tCrit - nc, df) : 0;
    var power = 1 - p1 + p2;
    return { power: Math.max(0, Math.min(1, power)), beta: 1 - power, df: df, nc: nc, tCrit: tCrit };
  }
  /* 达到目标功效所需的最小样本量（每组） */
  function requiredSampleSize(d, alpha, targetPower) {
    alpha = alpha == null ? 0.05 : alpha;
    targetPower = targetPower == null ? 0.8 : targetPower;
    var n = 3;
    while (n < 5000) {
      if (powerTTest(d, n, alpha).power >= targetPower) return n;
      n++;
    }
    return -1;
  }

  /* ---- 相关 ---- */
  function pearson(x, y) {
    var n = Math.min(x.length, y.length);
    if (n < 2) return null;
    var mx = mean(x), my = mean(y);
    var sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < n; i++) {
      sxy += (x[i] - mx) * (y[i] - my);
      sxx += (x[i] - mx) * (x[i] - mx);
      syy += (y[i] - my) * (y[i] - my);
    }
    if (!sxx || !syy) return null;
    var r = sxy / Math.sqrt(sxx * syy);
    var t = r * Math.sqrt((n - 2) / (1 - r * r));
    var p = tPval(t, n - 2, true);
    return { r: r, t: t, df: n - 2, p: p, n: n, significant: p < 0.05 };
  }

  function rank(arr) {
    var idx = arr.map(function (v, i) { return { v: v, i: i }; })
      .sort(function (a, b) { return a.v - b.v; });
    var ranks = new Array(arr.length);
    var i = 0;
    while (i < idx.length) {
      var j = i;
      while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
      var avg = (i + j) / 2 + 1;
      for (var k = i; k <= j; k++) ranks[idx[k].i] = avg;
      i = j + 1;
    }
    return ranks;
  }

  function spearman(x, y) {
    var rx = rank(x), ry = rank(y);
    var res = pearson(rx, ry);
    if (!res) return null;
    return { rho: res.r, t: res.t, df: res.df, p: res.p, n: res.n, significant: res.p < 0.05 };
  }

  function corrMatrix(cols, dataFn) {
    var k = cols.length;
    var mat = [];
    for (var i = 0; i < k; i++) {
      mat[i] = [];
      for (var j = 0; j < k; j++) {
        if (i === j) { mat[i][j] = 1; continue; }
        var pairs = [];
        for (var r = 0; r < dataFn.length; r++) {
          var xi = dataFn[r][cols[i]], xj = dataFn[r][cols[j]];
          if (xi != null && xj != null && !isNaN(xi) && !isNaN(xj)) pairs.push([xi, xj]);
        }
        var xy = pairs.length ? pearson(pairs.map(function (p) { return p[0]; }), pairs.map(function (p) { return p[1]; })) : null;
        mat[i][j] = xy ? xy.r : null;
      }
    }
    return mat;
  }

  /* ---- 线性回归（OLS） ---- */
  function ols(X, y, colNames) {
    // X: n×p 矩阵（不含截距列），colNames: p 个自变量名
    var n = X.length, p = X[0].length;
    if (n <= p + 1) return null;
    // 构造设计矩阵（含截距）
    var Z = [];
    for (var i = 0; i < n; i++) {
      var row = [1];
      for (var j = 0; j < p; j++) row.push(X[i][j]);
      Z.push(row);
    }
    // 正规方程 (Z'Z)β = Z'y，用高斯消元解
    var k = p + 1;
    var A = [], b = [];
    for (var a = 0; a < k; a++) {
      A[a] = [];
      for (var c = 0; c < k; c++) {
        var s = 0;
        for (var r = 0; r < n; r++) s += Z[r][a] * Z[r][c];
        A[a][c] = s;
      }
      var sb = 0;
      for (var r2 = 0; r2 < n; r2++) sb += Z[r2][a] * y[r2];
      b[a] = sb;
    }
    // 高斯消元（部分主元）
    var aug = A.map(function (row, i) { return row.concat([b[i]]); });
    for (var col = 0; col < k; col++) {
      var piv = col;
      for (var r3 = col + 1; r3 < k; r3++) if (Math.abs(aug[r3][col]) > Math.abs(aug[piv][col])) piv = r3;
      if (Math.abs(aug[piv][col]) < 1e-12) return null; // 奇异
      var tmp = aug[col]; aug[col] = aug[piv]; aug[piv] = tmp;
      for (var r4 = 0; r4 < k; r4++) {
        if (r4 === col) continue;
        var factor = aug[r4][col] / aug[col][col];
        for (var c2 = col; c2 <= k; c2++) aug[r4][c2] -= factor * aug[col][c2];
      }
    }
    var coefs = aug.map(function (row, i) { return row[k] / row[i]; });

    // 拟合与残差
    var fitted = [], resid = [];
    var ssRes = 0, ssTot = 0, my = mean(y);
    for (var i2 = 0; i2 < n; i2++) {
      var f = 0;
      for (var j2 = 0; j2 < k; j2++) f += coefs[j2] * Z[i2][j2];
      fitted.push(f);
      resid.push(y[i2] - f);
      ssRes += resid[i2] * resid[i2];
    }
    for (var i3 = 0; i3 < n; i3++) ssTot += (y[i3] - my) * (y[i3] - my);
    var r2 = 1 - ssRes / ssTot;
    var adjR2 = 1 - (1 - r2) * (n - 1) / (n - k);
    var mse = ssRes / (n - k);
    var seCoefs = [], tStats = [], pVals = [];
    for (var a2 = 0; a2 < k; a2++) {
      var seC = Math.sqrt(mse / (aug[a2][a2] || 1e-12));
      seCoefs.push(seC);
      tStats.push(coefs[a2] / seC);
      pVals.push(tPval(coefs[a2] / seC, n - k, true));
    }
    var fStat = r2 / (1 - r2) * (n - k) / (k - 1);
    var fP = fPval(fStat, k - 1, n - k);

    var names = ['(截距)'].concat(colNames);
    var coefTable = names.map(function (nm, i) {
      return { name: nm, coef: coefs[i], se: seCoefs[i], t: tStats[i], p: pVals[i], significant: pVals[i] < 0.05 };
    });
    return {
      method: '多元线性回归（OLS）',
      n: n, k: k, coefs: coefs, coefTable: coefTable,
      r2: r2, adjR2: adjR2, f: fStat, fP: fP,
      ssRes: ssRes, mse: mse, fitted: fitted, resid: resid,
      formula: 'y ~ ' + (colNames.length ? colNames.join(' + ') : '1'),
      significant: fP < 0.05
    };
  }

  /* ==========================================================
   * 四、数据解析与清洗
   * ========================================================== */

  function detectDelimiter(firstLine) {
    var candidates = [',', '\t', ';', '|'];
    var best = ',', bestCount = 0;
    candidates.forEach(function (d) {
      var c = (firstLine.match(new RegExp('\\' + d, 'g')) || []).length;
      if (c > bestCount) { bestCount = c; best = d; }
    });
    return { delim: best, count: bestCount };
  }

  function parseDelimited(text, opts) {
    opts = opts || {};
    var lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    // 去空行
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    if (!lines.length) return { headers: [], rows: [], errors: ['文件为空'] };
    var delim = opts.delim || detectDelimiter(lines[0]).delim;
    var hasHeader = opts.hasHeader !== false;
    var headers, startIdx = 0;
    var parseLine = function (line) {
      var cells = [], cur = '', inQ = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (inQ) {
          if (ch === '"') {
            if (line[i + 1] === '"') { cur += '"'; i++; }
            else inQ = false;
          } else cur += ch;
        } else if (ch === '"') inQ = true;
        else if (ch === delim) { cells.push(cur); cur = ''; }
        else cur += ch;
      }
      cells.push(cur);
      return cells;
    };

    if (hasHeader) {
      headers = parseLine(lines[0]).map(function (h) { return h.trim(); });
      // 处理重复表头
      var seen = {};
      headers = headers.map(function (h, i) {
        if (!h) h = '列' + (i + 1);
        if (seen[h]) { var n = 2; while (seen[h + '_' + n]) n++; h = h + '_' + n; }
        seen[h] = true;
        return h;
      });
      startIdx = 1;
    } else {
      var nCols = parseLine(lines[0]).length;
      headers = [];
      for (var i = 0; i < nCols; i++) headers.push('列' + (i + 1));
    }

    var rows = [], errors = [];
    for (var li = startIdx; li < lines.length; li++) {
      var line = lines[li].trim();
      if (!line) continue;
      var cells = parseLine(lines[li]);
      if (cells.length !== headers.length) {
        // 尝试补齐
        while (cells.length < headers.length) cells.push('');
        if (cells.length > headers.length) cells = cells.slice(0, headers.length);
      }
      var row = {};
      cells.forEach(function (c, i) { row[headers[i]] = c.trim(); });
      rows.push(row);
    }
    return { headers: headers, rows: rows, delim: delim, errors: errors };
  }

  function parseNumber(v) {
    if (v == null) return NaN;
    if (typeof v === 'number') return v;
    var s = String(v).replace(/,/g, '').replace(/[%\s]/g, '');
    if (s === '' || s === '-' || s === '—' || s === 'NA' || s === 'N/A' || s === 'null') return NaN;
    var n = Number(s);
    return isNaN(n) ? NaN : n;
  }

  function inferTypes(rows, headers) {
    var types = headers.map(function (h) {
      var numeric = 0, categorical = 0, missing = 0, sample = [];
      rows.forEach(function (r, ri) {
        var v = r[h];
        if (v == null || String(v).trim() === '') { missing++; return; }
        var n = parseNumber(v);
        if (!isNaN(n)) { numeric++; sample.push({ v: n, ri: ri }); }
        else categorical++;
      });
      var type = 'empty';
      if (numeric > 0 && numeric / (rows.length - missing) >= 0.9) type = 'numeric';
      else if (categorical > 0) type = 'categorical';
      var unique = new Set(rows.map(function (r) { return String(r[h] == null ? '' : r[h]); }));
      return {
        name: h, type: type, numericCount: numeric, catCount: categorical,
        missing: missing, missingRate: rows.length ? missing / rows.length : 0,
        unique: unique.size, sample: sample.slice(0, 5)
      };
    });
    return types;
  }

  function cleanRows(rows, headers, types) {
    var cleaned = rows.map(function (r) {
      var out = {};
      headers.forEach(function (h) {
        var info = types.find(function (t) { return t.name === h; });
        if (info && info.type === 'numeric') {
          var n = parseNumber(r[h]);
          out[h] = isNaN(n) ? null : n;
        } else {
          out[h] = (r[h] == null ? '' : String(r[h]).trim());
        }
      });
      return out;
    });
    // 删除全空行
    return cleaned.filter(function (r) {
      return headers.some(function (h) { return r[h] != null && r[h] !== ''; });
    });
  }

  function qualityReport(rows, headers, types) {
    var n = rows.length;
    var issues = [];
    types.forEach(function (t) {
      if (t.missingRate > 0.1) issues.push('「' + t.name + '」缺失率 ' + (t.missingRate * 100).toFixed(1) + '%');
      if (t.type === 'numeric') {
        var vals = rows.map(function (r) { return r[t.name]; }).filter(function (v) { return v != null && !isNaN(v); });
        if (vals.length > 3) {
          var out = iqrOutliers(vals);
          if (out.length) issues.push('「' + t.name + '」检出 ' + out.length + ' 个 IQR 法异常值（' + (out.length / vals.length * 100).toFixed(1) + '%）');
        }
      }
    });
    return { issues: issues, clean: issues.length === 0 };
  }

  /* ==========================================================
   * 五、Canvas 图表
   * ========================================================== */

  function setupCanvas(canvas, w, h) {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  var PALETTE = ['#1E3A5F', '#C9B037', '#3A6B9E', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899', '#84CC16'];

  function niceTicks(min, max, target) {
    target = target || 6;
    if (min === max) { min -= 0.5; max += 0.5; }
    var span = max - min;
    var step0 = span / target;
    var mag = Math.pow(10, Math.floor(Math.log10(step0)));
    var norm = step0 / mag;
    var step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    var lo = Math.floor(min / step) * step;
    var hi = Math.ceil(max / step) * step;
    var ticks = [];
    for (var v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
    return { ticks: ticks, lo: lo, hi: hi };
  }

  function drawAxis(ctx, opts) {
    var padL = opts.padL, padR = opts.padR, padT = opts.padT, padB = opts.padB;
    var w = opts.w, h = opts.h;
    ctx.strokeStyle = '#B0B7C3'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, h - padB); ctx.lineTo(w - padR, h - padB); ctx.stroke(); // x轴
    ctx.beginPath();
    ctx.moveTo(padL, h - padB); ctx.lineTo(padL, padT); ctx.stroke(); // y轴
    ctx.fillStyle = '#6B7280'; ctx.font = '11px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    (opts.xTicks || []).forEach(function (t) {
      var x = padL + (t - opts.xLo) / (opts.xHi - opts.xLo) * (w - padL - padR);
      ctx.fillText(fmtTick(t), x, h - padB + 16);
    });
    ctx.textAlign = 'right';
    (opts.yTicks || []).forEach(function (t) {
      var y = h - padB - (t - opts.yLo) / (opts.yHi - opts.yLo) * (h - padT - padB);
      ctx.fillText(fmtTick(t), padL - 6, y + 4);
    });
    ctx.textAlign = 'left';
    if (opts.xLabel) ctx.fillText(opts.xLabel, w - padR, h - padB + 30);
    if (opts.yLabel) {
      ctx.save();
      ctx.translate(12, padT + 8);
      ctx.fillText(opts.yLabel, 0, 0);
      ctx.restore();
    }
    if (opts.title) {
      ctx.fillStyle = '#1E3A5F'; ctx.font = 'bold 13px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(opts.title, (padL + w - padR) / 2, padT - 8);
    }
  }

  function fmtTick(v) {
    if (Math.abs(v) >= 10000 || (Math.abs(v) < 0.001 && v !== 0)) return v.toExponential(1);
    if (Number.isInteger(v)) return String(v);
    return Number(v.toFixed(2)).toString();
  }

  /* 直方图（带正态曲线） */
  function drawHistogram(canvas, data, opts) {
    opts = opts || {};
    var W = opts.width || 560, H = opts.height || 340;
    var s = setupCanvas(canvas, W, H);
    var ctx = s.ctx;
    var padL = opts.padL || 52, padR = 16, padT = opts.padT || 32, padB = opts.padB || 42;
    var m = mean(data), sdv = sd(data);
    var bins = opts.bins || Math.max(5, Math.min(30, Math.round(Math.sqrt(data.length))));
    var lo = Math.min.apply(null, data), hi = Math.max.apply(null, data);
    if (opts.fitNormal) { lo = Math.min(lo, m - 4 * sdv); hi = Math.max(hi, m + 4 * sdv); }
    var ticks = niceTicks(lo, hi, 8);
    var bw = (ticks.hi - ticks.lo) / bins;
    var counts = new Array(bins).fill(0);
    data.forEach(function (v) {
      var idx = Math.min(bins - 1, Math.max(0, Math.floor((v - ticks.lo) / bw)));
      counts[idx]++;
    });
    var maxC = Math.max.apply(null, counts);
    var yTicks = niceTicks(0, maxC * 1.15, 5);
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var scaleX = function (v) { return padL + (v - ticks.lo) / (ticks.hi - ticks.lo) * plotW; };
    var scaleY = function (c) { return H - padB - c / yTicks.hi * plotH; };

    // 网格
    ctx.strokeStyle = '#E8ECF1'; ctx.lineWidth = 1;
    yTicks.ticks.forEach(function (t) {
      var y = scaleY(t);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    });

    // 柱
    for (var i = 0; i < bins; i++) {
      var x = scaleX(ticks.lo + i * bw) + 1;
      var w = (plotW / bins) - 2;
      var hh = counts[i] / yTicks.hi * plotH;
      ctx.fillStyle = 'rgba(30,58,95,0.72)';
      ctx.fillRect(x, H - padB - hh, w, hh);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
      ctx.strokeRect(x, H - padB - hh, w, hh);
    }

    // 正态曲线（密度×面积换算）
    if (opts.fitNormal && sdv > 0) {
      ctx.strokeStyle = '#C9B037'; ctx.lineWidth = 2;
      ctx.beginPath();
      var area = data.length * bw;
      for (var px = 0; px <= plotW; px += 2) {
        var v = ticks.lo + px / plotW * (ticks.hi - ticks.lo);
        var pdf = Math.exp(-(v - m) * (v - m) / (2 * sdv * sdv)) / (sdv * Math.sqrt(2 * Math.PI));
        var yy = H - padB - pdf * area / yTicks.hi * plotH;
        if (px === 0) ctx.moveTo(scaleX(v), yy); else ctx.lineTo(scaleX(v), yy);
      }
      ctx.stroke();
      ctx.fillStyle = '#C9B037';
      ctx.font = '11px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText('正态曲线（拟合）', scaleX(ticks.lo + (ticks.hi - ticks.lo) * 0.72), padT + 12);
    }

    drawAxis(ctx, {
      w: W, h: H, padL: padL, padR: padR, padT: padT, padB: padB,
      xTicks: ticks.ticks, xLo: ticks.lo, xHi: ticks.hi,
      yTicks: yTicks.ticks, yLo: 0, yHi: yTicks.hi,
      xLabel: opts.xLabel || '取值', yLabel: '频数', title: opts.title
    });
  }

  /* 箱线图 */
  function drawBoxplot(canvas, groups, opts) {
    opts = opts || {};
    var W = opts.width || 560, H = opts.height || 340;
    var s = setupCanvas(canvas, W, H);
    var ctx = s.ctx;
    var padL = opts.padL || 52, padR = 16, padT = 30, padB = 46;
    var all = [];
    groups.forEach(function (g) { all = all.concat(g.values); });
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    var ticks = niceTicks(lo, hi, 8);
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var scaleY = function (v) { return H - padB - (v - ticks.lo) / (ticks.hi - ticks.lo) * plotH; };

    ctx.strokeStyle = '#E8ECF1';
    ticks.ticks.forEach(function (t) {
      var y = scaleY(t);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    });

    var n = groups.length;
    var slotW = plotW / n;
    groups.forEach(function (g, i) {
      var cx = padL + slotW * i + slotW / 2;
      var boxW = Math.min(slotW * 0.5, 64);
      var q1 = quantile(g.values, 0.25), q3 = quantile(g.values, 0.75), med = median(g.values);
      var iq = q3 - q1;
      var whiskerLo = Math.min.apply(null, g.values.filter(function (v) { return v >= q1 - 1.5 * iq; }));
      var whiskerHi = Math.max.apply(null, g.values.filter(function (v) { return v <= q3 + 1.5 * iq; }));
      var col = PALETTE[i % PALETTE.length];
      ctx.strokeStyle = col; ctx.lineWidth = 1.6;
      // 须
      ctx.beginPath(); ctx.moveTo(cx, scaleY(whiskerLo)); ctx.lineTo(cx, scaleY(q1)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, scaleY(q3)); ctx.lineTo(cx, scaleY(whiskerHi)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - boxW / 4, scaleY(whiskerLo)); ctx.lineTo(cx + boxW / 4, scaleY(whiskerLo)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - boxW / 4, scaleY(whiskerHi)); ctx.lineTo(cx + boxW / 4, scaleY(whiskerHi)); ctx.stroke();
      // 箱
      ctx.fillStyle = col + '44';
      ctx.fillRect(cx - boxW / 2, scaleY(q3), boxW, scaleY(q1) - scaleY(q3));
      ctx.strokeRect(cx - boxW / 2, scaleY(q3), boxW, scaleY(q1) - scaleY(q3));
      // 中位线
      ctx.strokeStyle = col; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(cx - boxW / 2, scaleY(med)); ctx.lineTo(cx + boxW / 2, scaleY(med)); ctx.stroke();
      // 异常点
      var outliers = g.values.filter(function (v) { return v < q1 - 1.5 * iq || v > q3 + 1.5 * iq; });
      ctx.fillStyle = '#EF4444';
      outliers.forEach(function (v) {
        ctx.beginPath(); ctx.arc(cx, scaleY(v), 3, 0, Math.PI * 2); ctx.fill();
      });
      ctx.fillStyle = '#1E3A5F'; ctx.textAlign = 'center';
      ctx.font = '12px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(g.name, cx, H - padB + 18);
      ctx.fillStyle = '#6B7280'; ctx.font = '10px -apple-system, sans-serif';
      ctx.fillText('n=' + g.values.length, cx, H - padB + 32);
    });
    drawAxis(ctx, {
      w: W, h: H, padL: padL, padR: padR, padT: padT, padB: padB,
      xTicks: [], xLo: ticks.lo, xHi: ticks.hi,
      yTicks: ticks.ticks, yLo: ticks.lo, yHi: ticks.hi,
      yLabel: opts.yLabel || '取值', title: opts.title
    });
  }

  /* 散点图（带回归线） */
  function drawScatter(canvas, x, y, opts) {
    opts = opts || {};
    var W = opts.width || 560, H = opts.height || 340;
    var s = setupCanvas(canvas, W, H);
    var ctx = s.ctx;
    var padL = 52, padR = 16, padT = 30, padB = 46;
    var n = Math.min(x.length, y.length);
    var pts = [];
    for (var i = 0; i < n; i++) if (x[i] != null && y[i] != null && !isNaN(x[i]) && !isNaN(y[i])) pts.push([x[i], y[i]]);
    if (!pts.length) return;
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    var xTicks = niceTicks(Math.min.apply(null, xs), Math.max.apply(null, xs), 8);
    var yTicks = niceTicks(Math.min.apply(null, ys), Math.max.apply(null, ys), 8);
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var sx = function (v) { return padL + (v - xTicks.lo) / (xTicks.hi - xTicks.lo) * plotW; };
    var sy = function (v) { return H - padB - (v - yTicks.lo) / (yTicks.hi - yTicks.lo) * plotH; };

    ctx.strokeStyle = '#E8ECF1';
    xTicks.ticks.forEach(function (t) {
      ctx.beginPath(); ctx.moveTo(sx(t), padT); ctx.lineTo(sx(t), H - padB); ctx.stroke();
    });
    yTicks.ticks.forEach(function (t) {
      ctx.beginPath(); ctx.moveTo(padL, sy(t)); ctx.lineTo(W - padR, sy(t)); ctx.stroke();
    });
    ctx.fillStyle = 'rgba(30,58,95,0.55)';
    pts.forEach(function (p) {
      ctx.beginPath(); ctx.arc(sx(p[0]), sy(p[1]), 3.2, 0, Math.PI * 2); ctx.fill();
    });
    if (opts.fitLine) {
      var reg = pearson(xs, ys);
      var b = reg ? reg.r * sd(ys) / sd(xs) : 0;
      var a = mean(ys) - b * mean(xs);
      ctx.strokeStyle = '#C9B037'; ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(sx(xTicks.lo), sy(a + b * xTicks.lo));
      ctx.lineTo(sx(xTicks.hi), sy(a + b * xTicks.hi));
      ctx.stroke();
      if (reg) {
        ctx.fillStyle = '#C9B037'; ctx.font = '11px -apple-system, "PingFang SC", sans-serif';
        ctx.fillText('r = ' + fmtNum(reg.r, 3) + (reg.p < 0.001 ? '（P<0.001）' : '（P=' + fmtNum(reg.p, 3) + '）'), padL + 8, padT + 14);
      }
    }
    drawAxis(ctx, {
      w: W, h: H, padL: padL, padR: padR, padT: padT, padB: padB,
      xTicks: xTicks.ticks, xLo: xTicks.lo, xHi: xTicks.hi,
      yTicks: yTicks.ticks, yLo: yTicks.lo, yHi: yTicks.hi,
      xLabel: opts.xLabel, yLabel: opts.yLabel, title: opts.title
    });
  }

  /* QQ 图 */
  function drawQQ(canvas, data, opts) {
    opts = opts || {};
    var W = opts.width || 420, H = opts.height || 340;
    var s = setupCanvas(canvas, W, H);
    var ctx = s.ctx;
    var padL = 52, padR = 16, padT = 30, padB = 46;
    var sorted = data.slice().sort(function (a, b) { return a - b; });
    var n = sorted.length;
    var theo = sorted.map(function (_, i) { return normInv((i + 0.5) / n); });
    var lo = Math.min.apply(null, theo), hi = Math.max.apply(null, theo);
    var yLo = Math.min.apply(null, sorted), yHi = Math.max.apply(null, sorted);
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var sx = function (v) { return padL + (v - lo) / (hi - lo) * plotW; };
    var sy = function (v) { return H - padB - (v - yLo) / (yHi - yLo) * plotH; };
    // 参考线
    ctx.strokeStyle = '#C9B037'; ctx.lineWidth = 1.6; ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(sx(lo), sy(lo));
    ctx.lineTo(sx(hi), sy(hi));
    ctx.stroke(); ctx.setLineDash([]);
    // 点
    ctx.fillStyle = 'rgba(30,58,95,0.7)';
    sorted.forEach(function (v, i) {
      ctx.beginPath(); ctx.arc(sx(theo[i]), sy(v), 3, 0, Math.PI * 2); ctx.fill();
    });
    drawAxis(ctx, {
      w: W, h: H, padL: padL, padR: padR, padT: padT, padB: padB,
      xTicks: niceTicks(lo, hi, 6).ticks, xLo: lo, xHi: hi,
      yTicks: niceTicks(yLo, yHi, 6).ticks, yLo: yLo, yHi: yHi,
      xLabel: '理论分位数', yLabel: '样本分位数', title: opts.title || 'Q-Q 正态图'
    });
  }

  /* 残差 vs 拟合值 */
  function drawResidual(canvas, fitted, resid, opts) {
    opts = opts || {};
    var W = opts.width || 420, H = opts.height || 300;
    var s = setupCanvas(canvas, W, H);
    var ctx = s.ctx;
    var padL = 52, padR = 16, padT = 30, padB = 46;
    var xTicks = niceTicks(Math.min.apply(null, fitted), Math.max.apply(null, fitted), 6);
    var rLo = Math.min.apply(null, resid), rHi = Math.max.apply(null, resid);
    var rAbs = Math.max(Math.abs(rLo), Math.abs(rHi)) * 1.15;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var sx = function (v) { return padL + (v - xTicks.lo) / (xTicks.hi - xTicks.lo) * plotW; };
    var sy = function (v) { return H - padB - (v + rAbs) / (2 * rAbs) * plotH; };
    // 零线
    ctx.strokeStyle = '#C9B037'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(padL, sy(0)); ctx.lineTo(W - padR, sy(0)); ctx.stroke();
    ctx.fillStyle = 'rgba(30,58,95,0.55)';
    for (var i = 0; i < fitted.length; i++) {
      ctx.beginPath(); ctx.arc(sx(fitted[i]), sy(resid[i]), 3, 0, Math.PI * 2); ctx.fill();
    }
    drawAxis(ctx, {
      w: W, h: H, padL: padL, padR: padR, padT: padT, padB: padB,
      xTicks: xTicks.ticks, xLo: xTicks.lo, xHi: xTicks.hi,
      yTicks: niceTicks(-rAbs, rAbs, 5).ticks, yLo: -rAbs, yHi: rAbs,
      xLabel: '拟合值 ŷ', yLabel: '残差', title: opts.title || '残差 vs 拟合值'
    });
  }

  /* 相关矩阵热力图 */
  function drawHeatmap(canvas, matrix, labels, opts) {
    opts = opts || {};
    var n = matrix.length;
    var cell = 52;
    var W = Math.max(320, n * cell + 80), H = n * cell + 70;
    var s = setupCanvas(canvas, W, H);
    var ctx = s.ctx;
    var ox = 72, oy = 10;
    ctx.font = '12px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'right'; ctx.fillStyle = '#1E3A5F';
    labels.forEach(function (l, i) { ctx.fillText(l.slice(0, 8), ox - 8, oy + i * cell + cell / 2 + 4); });
    ctx.textAlign = 'left';
    labels.forEach(function (l, i) { ctx.fillText(l.slice(0, 8), ox + i * cell + cell / 2 + 8, oy + n * cell + 18); });
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) {
        var r = matrix[i][j];
        var x = ox + j * cell, y = oy + i * cell;
        if (r == null) { ctx.fillStyle = '#EEE'; }
        else {
          var a = Math.min(1, Math.abs(r));
          var col = r >= 0 ? [30, 58, 95] : [201, 176, 55];
          ctx.fillStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + (0.08 + 0.75 * a) + ')';
        }
        ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
        ctx.fillStyle = (r != null && Math.abs(r) > 0.55) ? '#fff' : '#1E3A5F';
        ctx.textAlign = 'center';
        ctx.fillText(r == null ? '—' : fmtNum(r, 2), x + cell / 2, y + cell / 2 + 4);
      }
    }
  }

  /* ==========================================================
   * 六、一键自动分析
   * ========================================================== */

  /**
   * 自动分析：给定清洗后的数据框，智能编排统计检验并生成报告
   */
  function autoAnalyze(rows, headers, types, opts) {
    opts = opts || {};
    var report = [];
    var numericCols = types.filter(function (t) { return t.type === 'numeric'; }).map(function (t) { return t.name; });
    var catCols = types.filter(function (t) { return t.type === 'categorical'; }).map(function (t) { return t.name; });
    var n = rows.length;
    var notes = []; // 分析设置/调整说明

    // ---- 分析选项：排除异常值（IQR 法，按行剔除） ----
    if (opts.excludeOutliers && numericCols.length) {
      var keep = rows.filter(function (r) {
        for (var i = 0; i < numericCols.length; i++) {
          var v = r[numericCols[i]];
          if (v == null || isNaN(v)) continue;
          var colVals = rows.map(function (x) { return x[numericCols[i]]; }).filter(function (x) { return x != null && !isNaN(x); });
          var q1 = quantile(colVals, 0.25), q3 = quantile(colVals, 0.75);
          var iq = q3 - q1;
          if (v < q1 - 1.5 * iq || v > q3 + 1.5 * iq) return false;
        }
        return true;
      });
      var removed = rows.length - keep.length;
      rows = keep;
      n = rows.length;
      notes.push('已按 IQR 法则（1.5×四分位距）剔除 **' + removed + '** 个含异常值的样本后重新分析');
    }

    // ---- 分析选项：指定因变量（回归/主分析） ----
    if (opts.yVar && numericCols.indexOf(opts.yVar) >= 0 && opts.yVar !== numericCols[0]) {
      notes.push('按你的反馈，以「**' + opts.yVar + '**」为因变量重新构建回归模型');
    }

    report.push('# 数据分析报告');
    report.push('');
    report.push('> 由「统计学学科大模型 · 数据分析教学智能体」自动生成 | ' + new Date().toLocaleString('zh-CN'));
    report.push('');
    if (notes.length) {
      report.push('## 0. 本次分析调整说明（基于学生反馈）');
      report.push('');
      notes.forEach(function (t) { report.push('- ✅ ' + t); });
      report.push('');
    }
    report.push('## 1. 数据概览');
    report.push('');
    report.push('- 样本量：**' + n + '** 行，字段数：**' + headers.length + '**');
    report.push('- 数值型变量：' + (numericCols.length ? numericCols.join('、') : '无'));
    report.push('- 分类型变量：' + (catCols.length ? catCols.join('、') : '无'));
    report.push('');

    /* 变量结构表 */
    report.push('| 变量 | 类型 | 缺失率 | 唯一值 |');
    report.push('| --- | --- | --- | --- |');
    types.forEach(function (t) {
      report.push('| ' + t.name + ' | ' + (t.type === 'numeric' ? '数值' : t.type === 'categorical' ? '分类' : '空') + ' | ' + (t.missingRate * 100).toFixed(1) + '% | ' + t.unique + ' |');
    });
    report.push('');

    /* 描述统计 */
    report.push('## 2. 描述统计');
    report.push('');
    report.push('| 变量 | n | 均值 | 中位数 | 标准差 | Q1 | Q3 | 偏度 | 峰度 | 95%CI |');
    report.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    numericCols.forEach(function (c) {
      var vals = rows.map(function (r) { return r[c]; }).filter(function (v) { return v != null && !isNaN(v); });
      var d = describe(vals);
      report.push('| ' + c + ' | ' + d.n + ' | ' + fmtNum(d.mean) + ' | ' + fmtNum(d.median) + ' | ' + fmtNum(d.sd) + ' | ' + fmtNum(d.q1) + ' | ' + fmtNum(d.q3) + ' | ' + fmtNum(d.skew) + ' | ' + fmtNum(d.kurt) + ' | [' + fmtNum(d.ci95_lo) + ', ' + fmtNum(d.ci95_hi) + '] |');
    });
    report.push('');

    /* 分组比较（分类×数值） */
    var comparisons = [];
    numericCols.forEach(function (num) {
      catCols.forEach(function (cat) {
        var groups = [];
        var groupNames = [];
        var map = {};
        rows.forEach(function (r) {
          var v = r[num];
          if (v == null || isNaN(v)) return;
          var k = String(r[cat] == null ? '(缺失)' : r[cat]);
          if (!map[k]) { map[k] = []; groupNames.push(k); }
          map[k].push(v);
        });
        groupNames.forEach(function (k) { groups.push(map[k]); });
        // 只看有效组（≥2 组且每组 ≥2）
        var valid = groups.filter(function (g) { return g.length >= 2; });
        var vNames = groupNames.filter(function (_, i) { return groups[i].length >= 2; });
        if (valid.length >= 2 && valid.length <= 8) {
          comparisons.push({ num: num, cat: cat, groups: valid, names: vNames });
        }
      });
    });

    if (comparisons.length) {
      report.push('## 3. 分组比较（ANOVA / t 检验）');
      report.push('');
      comparisons.forEach(function (cmp) {
        var gNames = cmp.names, gs = cmp.groups;
        report.push('### 3.' + (comparisons.indexOf(cmp) + 1) + ' ' + cmp.num + ' × ' + cmp.cat);
        report.push('');
        report.push('| 组 | n | 均值 | 标准差 |');
        report.push('| --- | --- | --- | --- |');
        gs.forEach(function (g, i) {
          report.push('| ' + gNames[i] + ' | ' + g.length + ' | ' + fmtNum(mean(g)) + ' | ' + fmtNum(sd(g)) + ' |');
        });
        report.push('');
        if (gs.length === 2) {
          var t = tTestIndependent(gs[0], gs[1]);
          if (t) {
            report.push('**检验（参数）**：' + t.method + '，t = ' + fmtNum(t.t, 3) + '，自由度 = ' + fmtNum(t.df, 1) + '，P = ' + fmtP(t.p) + '，Cohen\'s d = ' + fmtNum(t.cohenD, 3));
            report.push('');
            report.push('- ' + (t.significant ? '**结论**：两组均值差异**显著**（P<0.05），效应量 d=' + fmtNum(t.cohenD, 2) + '（' + effectLabel(t.cohenD) + '）。' : '**结论**：两组均值差异**不显著**（P≥0.05），当前数据不足以支持组间差异存在。'));
            report.push('');
            // 非参数对照
            var w = wilcoxonRankSum(gs[0], gs[1]);
            if (w) {
              report.push('**非参数对照**（稳健性检验，不依赖正态假设）：' + w.method + '，z = ' + fmtNum(w.z, 3) + '，P = ' + fmtP(w.p) + '，组中位数 ' + gNames[0] + '=' + fmtNum(w.medianA) + '，' + gNames[1] + '=' + fmtNum(w.medianB));
              report.push('');
              report.push('- 参数与非参数结论' + (t.significant === w.significant ? '**一致**' : '**不一致**（数据可能偏离正态假设，以稳健的非参数结果为主要参考）') + '。');
              report.push('');
            }
          }
        } else {
          var anova = anovaOneWay(gs, gNames);
          if (anova) {
            report.push('**检验（参数）**：' + anova.method + '，F(' + anova.df1 + ', ' + anova.df2 + ') = ' + fmtNum(anova.F, 3) + '，P = ' + fmtP(anova.p) + '，η² = ' + fmtNum(anova.eta2, 3));
            report.push('');
            if (anova.significant) {
              report.push('- **结论**：组间差异**显著**（P<0.05），效应量 η²=' + fmtNum(anova.eta2, 2) + '。多重比较（Bonferroni 校正）：');
              report.push('');
              report.push('| 比较 | 均值差 | P（校正后） | 显著 |');
              report.push('| --- | --- | --- | --- |');
              anova.pairs.forEach(function (pr) {
                report.push('| ' + pr.groupA + ' vs ' + pr.groupB + ' | ' + fmtNum(pr.diff) + ' | ' + fmtP(pr.adjP) + ' | ' + (pr.significant ? '✓' : '—') + ' |');
              });
              report.push('');
            } else {
              report.push('- **结论**：组间差异**不显著**（P≥0.05），不拒绝各组均值相等的原假设。');
              report.push('');
            }
            // 非参数对照
            var kw = kruskalWallis(gs);
            if (kw) {
              report.push('**非参数对照**（Kruskal-Wallis，不依赖正态假设）：H(' + kw.df + ') = ' + fmtNum(kw.H, 3) + '，P = ' + fmtP(kw.p) + '，组中位数：' + gNames.map(function (n, i) { return n + '=' + fmtNum(kw.groupMedians[i]); }).join('，'));
              report.push('');
              report.push('- 参数与非参数结论' + (anova.significant === kw.significant ? '**一致**' : '**不一致**（数据可能偏离正态假设，以稳健的非参数结果为主要参考）') + '。');
              report.push('');
            }
          }
        }
      });
    }

    /* 相关分析 */
    if (numericCols.length >= 2) {
      report.push('## 4. 相关分析（Pearson）');
      report.push('');
      report.push('| 变量对 | r | P | 结论 |');
      report.push('| --- | --- | --- | --- |');
      for (var i = 0; i < numericCols.length; i++) {
        for (var j = i + 1; j < numericCols.length; j++) {
          var pairs = [];
          rows.forEach(function (r) {
            var a = r[numericCols[i]], b = r[numericCols[j]];
            if (a != null && b != null && !isNaN(a) && !isNaN(b)) pairs.push([a, b]);
          });
          if (pairs.length < 3) continue;
          var pr = pearson(pairs.map(function (p) { return p[0]; }), pairs.map(function (p) { return p[1]; }));
          if (!pr) continue;
          report.push('| ' + numericCols[i] + ' × ' + numericCols[j] + ' | ' + fmtNum(pr.r, 3) + ' | ' + fmtP(pr.p) + ' | ' + (pr.significant ? '显著相关' : '不显著') + ' |');
        }
      }
      report.push('');
      report.push('> 提示：相关不代表因果，显著相关可能受混淆变量影响。');
      report.push('');
    }

    /* 线性回归（以第一个数值变量为因变量） */
    if (numericCols.length >= 2 && n >= 8) {
      var yName = (opts.yVar && numericCols.indexOf(opts.yVar) >= 0) ? opts.yVar : numericCols[0];
      var xNames = numericCols.slice(1, Math.min(5, numericCols.length));
      var X = [], y = [];
      rows.forEach(function (r) {
        if (r[yName] == null || isNaN(r[yName])) return;
        var rowX = xNames.map(function (c) { return r[c] == null || isNaN(r[c]) ? mean(rows.map(function (rr) { return rr[c]; }).filter(function (v) { return v != null && !isNaN(v); })) : r[c]; });
        if (rowX.some(function (v) { return isNaN(v); })) return;
        X.push(rowX); y.push(r[yName]);
      });
      if (X.length >= xNames.length + 3) {
        var reg = ols(X, y, xNames);
        if (reg) {
          report.push('## 5. 线性回归分析');
          report.push('');
          report.push('因变量：**' + yName + '**；自变量：' + xNames.join('、'));
          report.push('');
          report.push('模型：' + reg.formula);
          report.push('');
          report.push('| 项 | 系数 | 标准误 | t | P | 显著 |');
          report.push('| --- | --- | --- | --- | --- | --- |');
          reg.coefTable.forEach(function (c) {
            report.push('| ' + c.name + ' | ' + fmtNum(c.coef) + ' | ' + fmtNum(c.se) + ' | ' + fmtNum(c.t, 3) + ' | ' + fmtP(c.p) + ' | ' + (c.significant ? '✓' : '—') + ' |');
          });
          report.push('');
          report.push('R² = ' + fmtNum(reg.r2, 3) + '，调整 R² = ' + fmtNum(reg.adjR2, 3) + '，F(' + (reg.k - 1) + ', ' + (reg.n - reg.k) + ') = ' + fmtNum(reg.f, 3) + '，P = ' + fmtP(reg.fP));
          report.push('');
          report.push('- ' + (reg.significant ? '**整体模型显著**：自变量对因变量具有统计显著的联合解释力。' : '**整体模型不显著**：当前自变量未能显著解释因变量变异。'));
          report.push('- 解读：' + (reg.coefTable[1] && reg.coefTable[1].significant ? '「' + reg.coefTable[1].name + '」的系数显著（P=' + fmtP(reg.coefTable[1].p) + '），控制其他变量后，该变量每增加 1 单位，' + yName + ' 平均变化 ' + fmtNum(reg.coefTable[1].coef) + ' 个单位。' : '未发现显著的自变量系数，建议检查变量选择与样本量。'));
          report.push('');
        }
      }
    }

    /* 分类×分类卡方 */
    if (catCols.length >= 2) {
      var c1 = catCols[0], c2 = catCols[1];
      var cats1 = Array.from(new Set(rows.map(function (r) { return String(r[c1]); }).filter(Boolean)));
      var cats2 = Array.from(new Set(rows.map(function (r) { return String(r[c2]); }).filter(Boolean)));
      if (cats1.length >= 2 && cats2.length >= 2 && cats1.length <= 6 && cats2.length <= 6) {
        var matrix = cats1.map(function (a) {
          return cats2.map(function (b) {
            return rows.filter(function (r) { return String(r[c1]) === a && String(r[c2]) === b; }).length;
          });
        });
        var chi = chi2Test(matrix);
        if (chi) {
          report.push('## 6. 分类变量关联分析（卡方检验）');
          report.push('');
          report.push('变量：' + c1 + ' × ' + c2);
          report.push('');
          report.push('| ' + c1 + ' \\ ' + c2 + ' | ' + cats2.join(' | ') + ' |');
          report.push('| --- | ' + cats2.map(function () { return ' --- '; }).join('|') + ' |');
          matrix.forEach(function (row, i) {
            report.push('| ' + cats1[i] + ' | ' + row.join(' | ') + ' |');
          });
          report.push('');
          report.push('χ² = ' + fmtNum(chi.chi2, 3) + '，自由度 = ' + chi.df + '，P = ' + fmtP(chi.p) + '，Cramér\'s V = ' + fmtNum(chi.cramersV, 3));
          if (chi.warn) report.push('');
          if (chi.warn) report.push('> ⚠️ ' + chi.warn);
          report.push('');
          report.push('- ' + (chi.significant ? '**结论**：两个分类变量**存在显著关联**。' : '**结论**：未发现两个分类变量之间的显著关联。'));
          report.push('');
        }
      }
    }

    /* 数据质量小结 */
    report.push('## 7. 数据质量小结');
    report.push('');
    var qr = qualityReport(rows, headers, types);
    if (qr.issues.length) {
      report.push('检查发现以下问题，建议处理后再建模：');
      qr.issues.forEach(function (iss) { report.push('- ⚠️ ' + iss); });
    } else {
      report.push('✓ 未发现明显缺失与异常值问题，数据质量良好。');
    }
    report.push('');
    report.push('---');
    report.push('');
    report.push('*本报告由统计学科大模型自动生成，用于教学辅助；正式研究请由专业统计人员复核。*');

    return {
      markdown: report.join('\n'),
      numericCols: numericCols,
      catCols: catCols,
      comparisons: comparisons
    };
  }

  function effectLabel(d) {
    d = Math.abs(d);
    if (d < 0.2) return '效应极小';
    if (d < 0.5) return '小效应';
    if (d < 0.8) return '中等效应';
    return '大效应';
  }

  /* ---- 示例数据集 ---- */
  var EXAMPLES = {
    'class_scores': {
      name: '班级成绩与学习投入',
      text: [
        '学生,性别,学习时长(小时),平时作业分,期末成绩',
        'A,女,2.5,88,92',
        'B,男,1.8,75,80',
        'C,女,3.2,93,95',
        'D,男,0.9,60,65',
        'E,女,2.2,85,88',
        'F,男,1.5,70,74',
        'G,女,2.8,90,91',
        'H,男,2.0,78,82',
        'I,女,1.2,66,70',
        'J,男,3.0,92,90',
        'K,女,2.6,87,89',
        'L,男,1.1,63,68',
        'M,女,2.9,91,93',
        'N,男,2.3,82,84',
        'O,女,1.6,72,75',
        'P,男,2.7,86,87'
      ].join('\n'),
      desc: '16 名学生：性别、学习时长、平时作业分与期末成绩，可做 t 检验（性别分组）、相关分析与线性回归。'
    },
    'teaching_methods': {
      name: '两种教学方法对比',
      text: [
        '方法,成绩',
        '传统教学,72', '传统教学,75', '传统教学,70', '传统教学,68', '传统教学,74',
        '传统教学,71', '传统教学,73', '传统教学,69', '传统教学,76', '传统教学,72',
        '翻转课堂,85', '翻转课堂,82', '翻转课堂,88', '翻转课堂,79', '翻转课堂,90',
        '翻转课堂,84', '翻转课堂,87', '翻转课堂,81', '翻转课堂,86', '翻转课堂,83'
      ].join('\n'),
      desc: '两种教学方法的期末成绩（每组 10 人，长格式），可做独立样本 t 检验并计算效应量。'
    },
    'pre_post': {
      name: '干预前后测（配对）',
      text: [
        '学生,前测,后测',
        '1,58,66',
        '2,62,70',
        '3,55,61',
        '4,70,78',
        '5,64,69',
        '6,60,68',
        '7,66,74',
        '8,59,63',
        '9,63,71',
        '10,57,65'
      ].join('\n'),
      desc: '10 名学生干预前后测成绩（配对数据），可做配对样本 t 检验。'
    },
    'survey': {
      name: '大学生睡眠与情绪问卷',
      text: [
        '学号,年级,睡眠时长(小时),焦虑得分,专业',
        'S01,大一,6.2,18,统计',
        'S02,大二,7.1,12,统计',
        'S03,大三,5.5,24,数据科学',
        'S04,大一,7.8,9,统计',
        'S05,大二,6.0,20,数据科学',
        'S06,大三,6.9,14,统计',
        'S07,大四,5.8,22,数据科学',
        'S08,大一,7.5,10,统计',
        'S09,大二,6.6,16,数据科学',
        'S10,大三,6.1,19,统计',
        'S11,大四,5.2,26,数据科学',
        'S12,大一,8.0,8,统计'
      ].join('\n'),
      desc: '12 名大学生的睡眠时长与焦虑得分（含年级、专业分组），可做 ANOVA、相关与回归分析。'
    }
  };

  STAT.parseDelimited = parseDelimited;
  STAT.inferTypes = inferTypes;
  STAT.cleanRows = cleanRows;
  STAT.qualityReport = qualityReport;
  STAT.describe = describe;
  STAT.freqTable = freqTable;
  STAT.tTestOneSample = tTestOneSample;
  STAT.tTestIndependent = tTestIndependent;
  STAT.tTestPaired = tTestPaired;
  STAT.wilcoxonRankSum = wilcoxonRankSum;
  STAT.wilcoxonSignedRank = wilcoxonSignedRank;
  STAT.kruskalWallis = kruskalWallis;
  STAT.powerTTest = powerTTest;
  STAT.requiredSampleSize = requiredSampleSize;
  STAT.anovaOneWay = anovaOneWay;
  STAT.chi2Test = chi2Test;
  STAT.pearson = pearson;
  STAT.spearman = spearman;
  STAT.corrMatrix = corrMatrix;
  STAT.ols = ols;
  STAT.autoAnalyze = autoAnalyze;
  STAT.examples = EXAMPLES;
  STAT.drawHistogram = drawHistogram;
  STAT.drawBoxplot = drawBoxplot;
  STAT.drawScatter = drawScatter;
  STAT.drawQQ = drawQQ;
  STAT.drawResidual = drawResidual;
  STAT.drawHeatmap = drawHeatmap;
  STAT.normCdf = normCdf;
  STAT.normInv = normInv;
  STAT.tCdf = tCdf;
  STAT.tInv = tInv;
  STAT.fCdf = fCdf;
  STAT.fInv = fInv;
  STAT.chi2Cdf = chi2Cdf;
  STAT.chi2Pval = chi2Pval;
  STAT.chi2Inv = chi2Inv;
  STAT.mean = mean;
  STAT.sd = sd;
  STAT.median = median;
  STAT.quantile = quantile;
  STAT.gammaLn = gammaLn;
  STAT.fmtP = fmtP;
  STAT.fmtNum = fmtNum;
  STAT.fmtInt = fmtInt;
  STAT.effectLabel = effectLabel;
  STAT.freqTable = freqTable;

  global.STAT = STAT;
})(window);
