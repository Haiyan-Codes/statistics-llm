/* ============================================================
 * 统计学学科大模型 · 扩展知识库 knowledge-extra.js
 * ------------------------------------------------------------
 * 从开放授权教材提炼的补充知识点（在 knowledge.js 基础上扩充）：
 *   · OpenIntro Statistics, 4th Edition (CC BY-SA, openintro.org)
 *   · NIST/SEMATECH e-Handbook of Statistical Methods (公共领域)
 * 所有条目均标注出处，支撑"可溯源"答疑。
 * 加载顺序：knowledge.js → knowledge-extra.js → app.js
 * ============================================================ */
(function (global) {
  'use strict';
  var KB = global.STAT_KB;
  if (!KB) return;

  /* ---------------- 补充知识点 ---------------- */
  var EXTRA_ENTRIES = [
    /* ===== 概率论与数理统计 ===== */
    {
      id: 'binom', course: '概率论与数理统计',
      keywords: ['二项分布', '伯努利', '成功次数', 'n次试验', 'binomial'],
      title: '二项分布',
      content: 'n 次独立重复试验中，每次成功概率为 p，则成功次数 X~Bin(n,p)，概率质量函数 P(X=k)=C(n,k)·p^k·(1−p)^(n−k)。**特征**：期望 E(X)=np，方差 Var(X)=np(1−p)。**适用条件**：①每次试验只有成功/失败两种结果（伯努利试验）；②各次试验独立；③概率 p 恒定。正态近似：当 np≥10 且 n(1−p)≥10 时可用 N(np, np(1−p)) 近似（连续性校正更精确）。二项分布是最基础也最重要的离散分布，是比例推断（如置信区间、卡方检验期望频数）的出发点。',
      source: 'OpenIntro Statistics 4th Edition（CC BY-SA, openintro.org）',
      tags: ['离散分布', '伯努利试验']
    },
    {
      id: 'poisson', course: '概率论与数理统计',
      keywords: ['泊松分布', '稀有事件', '计数', 'poisson', 'λ'],
      title: '泊松分布',
      content: '描述单位时间/空间内稀有事件发生次数的分布：P(X=k)=λ^k·e^(−λ)/k!，其中 λ 为单位区间内的平均发生次数。**性质**：期望与方差相等（E(X)=Var(X)=λ）——这是判断数据是否符合泊松模型的重要线索（过度离散时考虑负二项）。**与二项分布的关系**：当 n 很大、p 很小、np=λ 时，二项分布趋于泊松分布；泊松可视为"稀有事件"的极限模型。典型应用：客服来电数、商店顾客数、放射性衰变、文本词频。',
      source: 'OpenIntro Statistics 4th Edition（CC BY-SA, openintro.org）',
      tags: ['离散分布', '计数数据']
    },
    {
      id: 'geo_geom', course: '概率论与数理统计',
      keywords: ['几何分布', '首次成功', '等待时间', 'geometric'],
      title: '几何分布',
      content: '重复独立伯努利试验中，首次成功所需试验次数 X~Geom(p)，P(X=k)=(1−p)^(k−1)·p。期望 E(X)=1/p，方差 Var(X)=(1−p)/p²。**直觉**：p 越小，等待首次成功需要的平均次数越多。几何分布具有**无记忆性**：P(X>m+n|X>m)=P(X>n)——已经等了 m 次没成功，不改变继续等待的分布，这与独立试验假设一致。教学提示：与负二项分布（第 r 次成功所需次数）对照理解。',
      source: 'OpenIntro Statistics 4th Edition（CC BY-SA, openintro.org）',
      tags: ['离散分布', '等待时间']
    },
    {
      id: 'exp_mem', course: '概率论与数理统计',
      keywords: ['指数分布', '无记忆性', '寿命', '风险率', 'exponential'],
      title: '指数分布与无记忆性',
      content: '连续型指数分布 X~Exp(λ) 的密度 f(x)=λe^(−λx)（x≥0），期望 E(X)=1/λ，方差 1/λ²。**核心性质：无记忆性**——P(X>s+t|X>s)=P(X>t)，即"元件已经工作了 s 小时，不改变剩余寿命的分布"，这刻画了恒定风险率（失效率不随时间变化）。**用途**：泊松过程的事件间隔时间、设备寿命建模（当失效率恒定）、排队论服务时间。局限：现实元件常有老化（浴盆曲线），此时 Weibull 分布更合适。',
      source: 'OpenIntro Statistics 4th Edition（CC BY-SA, openintro.org）',
      tags: ['连续分布', '寿命建模']
    },
    {
      id: 'empirical_rule', course: '概率论与数理统计',
      keywords: ['经验法则', '68 95 99.7', '正态分布', '标准差', 'empirical rule'],
      title: '68-95-99.7 经验法则',
      content: '对近似正态分布的数据：约 68% 的观测落在 μ±1σ 内，约 95% 落在 μ±2σ 内，约 99.7% 落在 μ±3σ 内。**教学用途**：快速判断数据是否大致正态（检查落在各区间的比例），也是 z 分数解释的基础（z=2 表示离均值 2 个标准差，对应约 97.5% 分位）。**警示**：经验法则只对近似正态分布成立；对重尾或偏态分布会严重低估极端值出现概率，此时用切比雪夫不等式（至少 1−1/k² 的比例在 k 倍标准差内，适用于任意分布）更稳健。',
      source: 'OpenIntro Statistics 4th Edition（CC BY-SA, openintro.org）',
      tags: ['正态分布', '经验法则']
    },
    {
      id: 'zscore', course: '概率论与数理统计',
      keywords: ['z分数', '标准化', '标准正态', '标准化得分'],
      title: 'Z 分数与数据标准化',
      content: 'Z 分数 z=(x−μ)/σ 度量观测值相对均值偏离多少个标准差，将不同量纲/尺度的数据转换为可比较的"标准正态尺度"（均值为 0、标准差为 1）。**用途**：①跨变量比较（如语文 85 分 vs 数学 90 分谁更突出，看各自 z 分数）；②检测异常值（|z|>3 常视为异常）；③标准化后用于聚类、PCA 等对尺度敏感的多元方法。**注意**：z 分数保留分布形态（偏态数据 z 分数仍偏态），转换不改变相对排序。',
      source: 'OpenIntro Statistics 4th Edition（CC BY-SA, openintro.org）',
      tags: ['标准化', '数据变换']
    },

    /* ===== 回归分析 ===== */
    {
      id: 'interaction', course: '回归分析',
      keywords: ['交互作用', '交互项', '调节效应', '斜率随组变化', 'interaction'],
      title: '回归中的交互作用项',
      content: '交互作用表示一个自变量的效应随另一个自变量变化而变化：模型 y=β₀+β₁x₁+β₂x₂+β₃(x₁×x₂)+ε 中，x₂ 每增加 1 单位，x₁ 对 y 的斜率变为 β₁+β₃x₂。**识别**：分组斜率明显不同、画散点按分组着色看到非平行线。**解释要点**：存在显著交互时，"主效应"不再有简单含义（如 x₁ 的效应取决于 x₂），应报告简单斜率或进行简单效应分析。分类×连续交互（如性别×学习时长）是最常见的教学案例。',
      source: 'OpenIntro Statistics 4th Edition（CC BY-SA, openintro.org）',
      tags: ['交互作用', '模型解释']
    },
    {
      id: 'aic_bic', course: '回归分析',
      keywords: ['AIC', 'BIC', '模型选择', '信息准则', '过拟合', '变量选择'],
      title: 'AIC 与 BIC：模型选择的信息准则',
      content: 'AIC = −2·ln(L) + 2k，BIC = −2·ln(L) + k·ln(n)，其中 L 为似然、k 为参数个数、n 为样本量。两者都在"拟合优度"与"模型复杂度"之间权衡，数值越小越好，但仅可用于**同一数据、嵌套或可比较模型**的相对比较（不能跨数据集比 AIC 绝对值）。**区别**：BIC 对复杂模型惩罚更重（k·ln(n) > 2k 当 n>7），倾向更简约模型；大样本下 BIC 趋于选择真实模型，AIC 在预测场景常更优。教学要点：模型选择是"简约与拟合"的平衡，防止过拟合。',
      source: 'OpenIntro Statistics 4th Edition（CC BY-SA, openintro.org）',
      tags: ['模型选择', '信息准则']
    },
    {
      id: 'outlier_leverage', course: '回归分析',
      keywords: ['异常值', '杠杆点', 'Cook距离', '强影响点', 'outlier'],
      title: '回归中的异常值与强影响点',
      content: '三类特殊点：①**纵向异常点**——残差大（y 方向偏离），对回归线影响有限；②**杠杆点**——x 方向极端（如 x=20 而其余 x∈[0,5]），能"拉动"回归线；③**强影响点**——既高杠杆又大残差，显著改变估计。**诊断**：Cook 距离（综合衡量该点对全部拟合的影响，D>4/n 提示强影响）、杠杆值 h（>2(p+1)/n 为高杠杆）、DFFITS/DFBETA。**处理**：先核查数据录入错误；合理数据考虑稳健回归或报告剔除后的敏感性分析；切勿为了"好看"随意删点。',
      source: 'OpenIntro Statistics 4th Edition（CC BY-SA, openintro.org）',
      tags: ['模型诊断', '稳健性']
    },

    /* ===== 试验设计（NIST 视角） ===== */
    {
      id: 'spc', course: '试验设计',
      keywords: ['控制图', '统计过程控制', 'SPC', '均值图', '极差图', '过程能力'],
      title: '控制图与统计过程控制（SPC）',
      content: '控制图（如 X̄-R 图、p 图）按时间顺序绘制过程统计量，中心线为均值，上下控制限（通常为 ±3σ）区分**普通变异**（受控）与**特殊变异**（失控）。**判异准则**：点超出控制限、连续 7 点同侧、连续 7 点上升/下降等。**要点**：控制限是基于过程自身波动的统计界限，不是规格限；控制图用于"过程是否稳定"，过程能力分析（Cp、Cpk）用于"稳定过程能否满足规格"。使用前需确认子组取样策略合理、过程受控。来源：NIST/SEMATECH e-Handbook（公共领域）。',
      source: 'NIST/SEMATECH e-Handbook of Statistical Methods（公共领域）',
      tags: ['过程控制', '质量工程']
    },
    {
      id: 'msa', course: '试验设计',
      keywords: ['测量系统分析', 'Gauge R&R', '重复性', '再现性', 'MSA'],
      title: '测量系统分析（Gauge R&R）',
      content: '测量误差会掩盖真实的过程变异，测量系统分析量化测量系统的**重复性**（同一操作者同一件多次测量的一致性）与**再现性**（不同操作者之间的差异）。**关键指标**：%GRR（测量系统变异占总体变异的百分比），行业经验阈值：<10% 良好、10%~30% 可接受（视应用）、>30% 不合格需改进测量系统。**意义**：把"测量误差"从"过程变异"中分离，避免把仪器噪音误判为过程问题。来源：NIST/SEMATECH e-Handbook（公共领域）。',
      source: 'NIST/SEMATECH e-Handbook of Statistical Methods（公共领域）',
      tags: ['测量系统', '质量工程']
    },

    /* ===== 多元统计分析 ===== */
    {
      id: 'mahalanobis', course: '多元统计分析',
      keywords: ['马氏距离', 'mahalanobis', '距离度量', '协方差', '异常检测'],
      title: '马氏距离：考虑协方差的距离',
      content: '马氏距离 D²=(x−μ)′Σ⁻¹(x−μ) 在计算距离时**考虑变量的协方差结构**，对变量的量纲与相关性进行校正。与欧氏距离相比：欧氏距离假设各变量独立同尺度，会高估斜向散布方向的距离；马氏距离将数据"白化"后再度量，能正确识别沿相关方向分布的点。**用途**：多元异常检测（D² 服从卡方分布，可设阈值）、判别分析、聚类前的距离度量。教学提示：当变量高度相关或量纲差异大时，务必用马氏距离或先标准化。',
      source: 'OpenIntro Statistics 4th Edition（CC BY-SA, openintro.org）',
      tags: ['距离度量', '异常检测']
    },
    {
      id: 'pca_vs_factor', course: '多元统计分析',
      keywords: ['因子分析', '主成分', '共同因子', '旋转', '潜变量'],
      title: '因子分析 vs 主成分分析',
      content: '**主成分分析（PCA）**：将 p 个变量线性组合为互不相关的主成分，目标是**最大化方差/信息**，属于数据压缩与降维，主成分是观测变量的精确函数。**因子分析（FA）**：假设变量由少数**潜因子**加上独有误差生成（X=ΛF+ε），目标是**解释变量间的相关结构**，估计因子载荷 Λ；因子不是变量的精确函数，通常需要旋转（如 varimax）增强解释性。选择：只需降维可视化→PCA；需要识别潜在构念/量表结构效度→FA。',
      source: 'OpenIntro Statistics 4th Edition（CC BY-SA, openintro.org）',
      tags: ['因子分析', '潜变量']
    },

    /* ===== 时间序列 ===== */
    {
      id: 'ets', course: '时间序列分析',
      keywords: ['指数平滑', 'ETS', 'Holt', 'Holt-Winters', '平滑参数'],
      title: '指数平滑与 ETS 模型',
      content: '指数平滑对历史观测赋予**指数衰减权重**：ŷ_{t+1}=αy_t+(1−α)ŷ_t，平滑参数 α∈(0,1) 越大越看重近期数据。**扩展**：Holt 线性趋势法（水平+趋势两项）、Holt-Winters 法（水平+趋势+季节三项），并区分加法/乘法季节效应。ETS 模型（Error-Trend-Season）将误差、趋势、季节的组合统一建模，可用 AIC 自动选择最优形式，预测区间由状态空间模型给出。**适用**：单变量、规律性较强的序列；相比 ARIMA 更简单稳健，对短期预测效果好。',
      source: 'OpenIntro Statistics 4th Edition（CC BY-SA, openintro.org）',
      tags: ['指数平滑', '预测方法']
    },

    /* ===== 数据思维 ===== */
    {
      id: 'obs_vs_exp', course: '概率论与数理统计',
      keywords: ['观察研究', '随机实验', '因果', '混淆', 'randomized experiment'],
      title: '观察研究 vs 随机实验',
      content: '**随机实验**：随机分配处理，从设计上平衡已知与未知混淆因素，可支持因果结论（如药物随机对照试验）。**观察研究**：研究者不干预分配，只观察（如问卷、病例对照），只能支持**相关**结论——处理组与对照组可能在年龄、健康水平等混淆变量上系统不同。**判断要点**：①是否有随机分配？（实验的核心）②组间基线是否可比？③结论是"相关"还是"因果"？教学案例：支架植入 vs 药物治疗的中风研究（OpenIntro 经典案例）——随机实验显示支架组反而更多复发，说明直觉假设可能被数据推翻，也说明随机化的重要性。',
      source: 'OpenIntro Statistics 4th Edition（CC BY-SA, openintro.org）',
      tags: ['研究设计', '因果推断']
    },
    {
      id: 'viz_principles', course: '概率论与数理统计',
      keywords: ['数据可视化', '直方图', '箱线图', '图表选择', '可视化原则'],
      title: '数据可视化的选择原则',
      content: '**按数据类型与目的选图**：单个数值变量→直方图（看分布形态）、箱线图（看异常值与分位数）、密度曲线；两个数值变量→散点图（看关系）；分类×数值→分组箱线图/小提琴图；分类×分类→堆叠柱状图/马赛克图；时间序列→折线图。**原则**：①图表应忠实呈现数据（坐标从零开始要谨慎，避免误导性截断）；②突出数据而非装饰（避免 3D、伪彩色过度）；③标注单位与来源；④对比时用相同尺度。教学要点：先问"我想看什么"，再选图——分布、关系、比较、趋势各有适图。',
      source: 'OpenIntro Statistics 4th Edition（CC BY-SA, openintro.org）',
      tags: ['数据可视化', 'EDA']
    }
  ];

  /* ---------------- 补充高频问答 ---------------- */
  var EXTRA_QA = [
    {
      q: '泊松分布和二项分布有什么关系？',
      a: '二项分布 Bin(n,p) 描述 n 次独立试验的成功次数；泊松分布 Poi(λ) 描述稀有事件在单位区间的发生次数。当 n 很大、p 很小且 np=λ 保持有限时，二项分布收敛于泊松分布（泊松是二项分布的极限形式）。直觉：当"成功"非常稀有、试验次数非常多时，计数"成功次数"近似只由均值 λ 决定，具体 n 和 p 的组合不再重要。实际判断：np≥10 时二项分布本身已接近正态；事件稀有（p 小）且计数间隔开放（没有固定试验次数）时直接选泊松。',
      source: 'OpenIntro Statistics 4th Edition（CC BY-SA, openintro.org）'
    },
    {
      q: '为什么回归模型要加交互项？',
      a: '当一个自变量的效应随另一个自变量变化而变化时（例如学习时长对成绩的作用在男生和女生中不同），不加交互项会"平均掉"这种异质性，得到误导性的单一斜率。判断依据：①领域理论预期存在调节关系；②分组散点图斜率明显不同；③交互项系数显著（p<0.05）且加入后模型信息准则改善。注意：加入交互项后，主效应系数的解释变为"另一变量为 0 时的效应"，务必结合简单斜率分析解读。',
      source: 'OpenIntro Statistics 4th Edition（CC BY-SA, openintro.org）'
    },
    {
      q: 'AIC 和 BIC 有什么区别，怎么选模型？',
      a: '两者都是"拟合优度（−2lnL）+ 复杂度惩罚"的权衡指标，越小越好：AIC=2k 惩罚，BIC=k·ln(n) 惩罚。BIC 对复杂模型惩罚更重（n>7 时 k·ln(n)>2k），倾向于更简约的模型；AIC 更看重预测性能，在样本量大时可能保留更多变量。实用建议：①只能比较同一数据集上的候选模型；②小样本或追求解释简约用 BIC，预测导向用 AIC（或交叉验证）；③AIC/BIC 只给出相对排序，不回答"模型是否正确"。',
      source: 'OpenIntro Statistics 4th Edition（CC BY-SA, openintro.org）'
    },
    {
      q: '控制图上的点越界代表什么？',
      a: '控制图（如 X̄ 图）的点超出 ±3σ 控制限，说明过程出现了"特殊变异"（assignable cause）——某种系统因素（设备故障、操作变化、原材料批次等）介入，过程不再受控（out of control）。注意：控制限不是规格限（规格限由客户/设计要求决定）；点越界≠产品不合格，而是过程行为发生统计意义上的显著变化，需要调查原因。其他判异信号还包括连续 7 点同侧、连续上升/下降趋势等（Western Electric 规则）。',
      source: 'NIST/SEMATECH e-Handbook of Statistical Methods（公共领域）'
    },
    {
      q: '什么是马氏距离？为什么比欧氏距离好？',
      a: '欧氏距离按"各方向等权重"计算，当变量量纲不同或高度相关时会产生偏差（例如身高和体重单位不同，直接算距离主要被量纲大的变量主导）。马氏距离通过协方差矩阵的逆对数据做"白化"：先消除变量相关性、再按各自方差归一化，得到尺度无关、方向正确的距离。应用：多元异常检测（马氏距离平方服从卡方分布）、线性判别分析、聚类预处理。判断：变量相关性强或量纲差异大时，优先用马氏距离（或先标准化再用欧氏距离，近似等价）。',
      source: 'OpenIntro Statistics 4th Edition（CC BY-SA, openintro.org）'
    }
  ];

  /* ---------------- 补充易混淆概念 ---------------- */
  var EXTRA_CONFUSIONS = [
    {
      pair: '重复性 vs 再现性（测量系统）',
      a: '重复性（Repeatability）',
      b: '再现性（Reproducibility）',
      diff: '重复性：同一操作者、同一台仪器、对同一被测对象多次测量的变异——反映仪器本身的稳定性/随机误差。再现性：不同操作者（或不同仪器/不同时间）对同一对象测量的变异——反映操作者技能、操作流程等人为差异。测量系统分析（Gauge R&R）把总测量变异分解为重复性+再现性两部分：%GRR=两者合计占总变异的比例，<10% 优秀、>30% 需改进。教学口诀："重复性是机器稳不稳，再现性是人和方法齐不齐"。',
      source: 'NIST/SEMATECH e-Handbook of Statistical Methods（公共领域）'
    },
    {
      pair: '控制限 vs 规格限',
      a: '控制限（Control Limits）',
      b: '规格限（Specification Limits）',
      diff: '控制限由过程自身数据计算（通常 ±3σ），反映过程"自然波动"的范围，用于判断过程是否受控——数据点在控制限内表示过程稳定，无特殊原因。规格限由设计/客户要求决定（如公差 ±0.05mm），用于判断产品是否合格。两者无必然联系：过程可以受控但规格限很严（产生不合格品，需改善过程能力 Cp/Cpk）；也可以失控但产品仍合格。控制图回答"过程稳不稳"，过程能力分析回答"稳的过程能不能满足要求"。',
      source: 'NIST/SEMATECH e-Handbook of Statistical Methods（公共领域）'
    }
  ];

  /* ---------------- 合并进知识库 ---------------- */
  function dedupByTitle(arr, title) {
    return arr.some(function (e) { return e.title === title; });
  }
  EXTRA_ENTRIES.forEach(function (e) {
    if (!dedupByTitle(KB.entries, e.title)) KB.entries.push(e);
  });
  EXTRA_QA.forEach(function (q) {
    if (!dedupByTitle(KB.qa, q.q)) KB.qa.push(q);
  });
  EXTRA_CONFUSIONS.forEach(function (c) {
    if (!dedupByTitle(KB.confusions, c.pair)) KB.confusions.push(c);
  });
  ['OpenIntro Statistics 4th Edition（CC BY-SA, openintro.org）',
    'NIST/SEMATECH e-Handbook of Statistical Methods（公共领域）'].forEach(function (s) {
    if (KB.meta.sources.indexOf(s) < 0) KB.meta.sources.push(s);
  });

  global.STAT_KB_EXTRA = {
    entriesAdded: EXTRA_ENTRIES.length,
    qaAdded: EXTRA_QA.length,
    confusionsAdded: EXTRA_CONFUSIONS.length
  };
})(window);
