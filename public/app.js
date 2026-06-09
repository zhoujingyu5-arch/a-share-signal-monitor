const DEFAULT_WATCHLIST = [
  "sh000001",
  "sz399006",
  "sh000300",
  "sh000852",
  "bj899050",
  "hkHSI",
  "usINX",
  "usIXIC",
  "usDJI",
  "yfN225",
  "yfKS11",
  "yfGDAXI",
  "ukUKX",
  "yfBTCF",
  "yfDXY",
  "yfBCOM",
  "yfGCF",
  "yfCLF",
  "yfHGF"
];
const SHANGHAI_INDEX_CODES = new Set([
  "000001",
  "000016",
  "000300",
  "000688",
  "000852",
  "000905"
]);
const STORAGE_KEY = "global-signal-watchlist-v1";
const stepLabels = ["破线", "拐头", "交叉", "排列", "乖离"];

let watchlist = loadWatchlist();
let timer = null;
let searchTimer = null;
let searchItems = [];
let activeSearchIndex = -1;

const els = {
  refreshBtn: document.querySelector("#refreshBtn"),
  autoRefresh: document.querySelector("#autoRefresh"),
  symbolInput: document.querySelector("#symbolInput"),
  addSymbol: document.querySelector("#addSymbol"),
  searchResults: document.querySelector("#searchResults"),
  watchChips: document.querySelector("#watchChips"),
  signalGrid: document.querySelector("#signalGrid"),
  lastUpdate: document.querySelector("#lastUpdate"),
  upDown: document.querySelector("#upDown"),
  breadthLabel: document.querySelector("#breadthLabel"),
  upRatio: document.querySelector("#upRatio"),
  marketAmount: document.querySelector("#marketAmount"),
  amountLabel: document.querySelector("#amountLabel"),
  mainFlow: document.querySelector("#mainFlow"),
  leadersList: document.querySelector("#leadersList")
};

function loadWatchlist() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return Array.isArray(saved) && saved.length ? saved : DEFAULT_WATCHLIST;
  } catch {
    return DEFAULT_WATCHLIST;
  }
}

function saveWatchlist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlist));
}

function addToWatchlist(secid) {
  const normalized = normalizeSecid(secid);
  if (!normalized || watchlist.includes(normalized)) return;
  watchlist.push(normalized);
  els.symbolInput.value = "";
  hideSearchResults();
  saveWatchlist();
  renderChips();
  refresh();
}

function hideSearchResults() {
  searchItems = [];
  activeSearchIndex = -1;
  els.searchResults.hidden = true;
  els.searchResults.innerHTML = "";
}

function renderSearchResults(items) {
  searchItems = items;
  activeSearchIndex = items.length ? 0 : -1;
  els.searchResults.innerHTML = "";
  items.forEach((item, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = `searchOption${index === activeSearchIndex ? " active" : ""}`;
    const name = document.createElement("b");
    name.textContent = item.name;
    const meta = document.createElement("span");
    meta.textContent = `${item.market} ${item.code}`;
    option.append(name, meta);
    option.addEventListener("mousedown", (event) => {
      event.preventDefault();
      addToWatchlist(item.symbol || item.secid);
    });
    els.searchResults.append(option);
  });
  els.searchResults.hidden = items.length === 0;
}

function updateActiveSearch() {
  const options = els.searchResults.querySelectorAll(".searchOption");
  options.forEach((option, index) => option.classList.toggle("active", index === activeSearchIndex));
}

async function searchByName(query) {
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const json = await response.json();
    if (json.ok && els.symbolInput.value.trim() === query) renderSearchResults(json.data);
  } catch {
    hideSearchResults();
  }
}

function normalizeSecid(input) {
  const raw = String(input || "").trim();
  if (/^(sh|sz|bj)\d{6}$/i.test(raw)) return `${raw.slice(0, 2).toLowerCase()}${raw.slice(2)}`;
  if (/^(hk|us|uk|yf)[a-z0-9.]+$/i.test(raw)) return `${raw.slice(0, 2).toLowerCase()}${raw.slice(2).toUpperCase()}`;
  if (/^[01]\.\d{6}$/.test(raw)) {
    const [market, code] = raw.split(".");
    return `${market === "1" ? "sh" : "sz"}${code}`;
  }
  const code = raw.replace(/[^\d]/g, "").slice(-6);
  if (!/^\d{6}$/.test(code)) return "";
  if (code === "899050") return "bj899050";
  const market = code.startsWith("6") || code.startsWith("9") || SHANGHAI_INDEX_CODES.has(code) ? "sh" : "sz";
  return `${market}${code}`;
}

function fmtNumber(value, digits = 2) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return "--";
  return Number(value).toFixed(digits);
}

function fmtMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)}万亿`;
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return n.toFixed(0);
}

function fmtQuoteTime(value) {
  if (!value) return "时间未知";
  const text = String(value);
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]} ${compact[4]}:${compact[5]}`;
  return text.replace("T", " ").replace(".000Z", " UTC");
}

function isQuoteStale(value) {
  if (!value) return true;
  const text = String(value);
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/);
  const normalized = compact
    ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:00`
    : text.replaceAll("/", "-").replace(" ", "T");
  const timestamp = Date.parse(normalized);
  return !Number.isFinite(timestamp) || Date.now() - timestamp > 30 * 60 * 60 * 1000;
}

function ema(values, period) {
  const k = 2 / (period + 1);
  const out = [];
  let prev = values[0];
  values.forEach((value, index) => {
    prev = index === 0 ? value : value * k + prev * (1 - k);
    out.push(prev);
  });
  return out;
}

function last(arr, n = 1) {
  return arr[arr.length - n];
}

function crossedUp(a, b) {
  return last(a, 2) <= last(b, 2) && last(a) > last(b);
}

function crossedDown(a, b) {
  return last(a, 2) >= last(b, 2) && last(a) < last(b);
}

function sequentialSteps(conditions) {
  let previousComplete = true;
  return conditions.map((condition) => {
    const complete = previousComplete && condition;
    previousComplete = complete;
    return complete;
  });
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function detect2B(rows, close) {
  if (rows.length < 40) return { label: "无", tone: "neutral" };
  const prior = rows.slice(-40, -5);
  const recent = rows.slice(-5);
  const priorLow = Math.min(...prior.map((row) => row.low));
  const priorHigh = Math.max(...prior.map((row) => row.high));
  const recentLow = Math.min(...recent.map((row) => row.low));
  const recentHigh = Math.max(...recent.map((row) => row.high));
  if (recentLow < priorLow * 0.995 && close > priorLow) {
    return { label: "底部2B回收", tone: "up" };
  }
  if (recentHigh > priorHigh * 1.005 && close < priorHigh) {
    return { label: "顶部2B回落", tone: "down" };
  }
  return { label: "无", tone: "neutral" };
}

function progressAt(index, direction, closes, highs, lows, e20, e60, e120) {
  if (index < 120) return 0;
  const close = closes[index];
  const high60 = Math.max(...highs.slice(Math.max(0, index - 59), index + 1));
  const low60 = Math.min(...lows.slice(Math.max(0, index - 59), index + 1));
  const bias120 = ((close - e120[index]) / e120[index]) * 100;
  const conditions = direction === "bull" ? [
    close > e20[index],
    e20[index] > e20[index - 1],
    e20[index] > e60[index],
    e20[index] > e60[index] && e60[index] > e120[index] && e60[index] > e60[index - 1],
    bias120 > 12 || close >= high60 * 0.995
  ] : [
    close < e20[index],
    e20[index] < e20[index - 1],
    e20[index] < e60[index],
    e20[index] < e60[index] && e60[index] < e120[index] && e60[index] < e60[index - 1],
    bias120 < -12 || close <= low60 * 1.005
  ];
  return sequentialSteps(conditions).filter(Boolean).length;
}

function analyzeKlines(payload, quote) {
  const rows = payload.klines || [];
  if (rows.length < 120) {
    return {
      phase: "历史数据不足",
      tone: "warn",
      next: `当前仅取得 ${rows.length} 根日线，暂不进行五阶段判断。`,
      bottomLine: "实时价格仍可监控，待数据源补齐历史日线后自动恢复。",
      bullSteps: [false, false, false, false, false],
      bearSteps: [false, false, false, false, false],
      bullScore: 0,
      bearScore: 0,
      ema20: null,
      ema60: null,
      ema120: null,
      bias20: null,
      bias120: null,
      maWidth: null,
      macdPct: null,
      systemStage: "等待数据",
      stageDays: 0,
      slope20: null,
      slopeChange: null,
      volumeRatio: null,
      density: null,
      dense: false,
      deduction20: null,
      structure2B: { label: "无", tone: "neutral" },
      rangePosition: null,
      humanState: "无法判断",
      riskReward: null,
      riskRewardText: "数据不足",
      close: Number(quote?.price) || null,
      prevClose: null
    };
  }
  const closes = rows.map((r) => r.close);
  const highs = rows.map((r) => r.high);
  const lows = rows.map((r) => r.low);
  const e20 = ema(closes, 20);
  const e60 = ema(closes, 60);
  const e120 = ema(closes, 120);
  const close = Number(quote?.price) || last(closes);
  const prevClose = last(closes, 2);
  const currentE20 = last(e20);
  const currentE60 = last(e60);
  const currentE120 = last(e120);
  const bias120 = ((close - currentE120) / currentE120) * 100;
  const bias20 = ((close - currentE20) / currentE20) * 100;
  const high60 = Math.max(...highs.slice(-60));
  const low60 = Math.min(...lows.slice(-60));
  const maWidth = ((currentE20 - currentE120) / currentE120) * 100;
  const dif = e20.map((v, i) => v - e60[i]);
  const macdPct = (last(dif) / currentE60) * 100;
  const slope20 = ((last(e20) - last(e20, 6)) / last(e20, 6)) * 100;
  const priorSlope20 = ((last(e20, 6) - last(e20, 11)) / last(e20, 11)) * 100;
  const slopeChange = slope20 - priorSlope20;
  const volumeValues = rows.map((row) => Number(row.volume) || 0);
  const volumeBase = average(volumeValues.slice(-21, -1));
  const volumeRatio = volumeBase > 0 ? last(volumeValues) / volumeBase : null;
  const density = ((Math.max(currentE20, currentE60, currentE120) - Math.min(currentE20, currentE60, currentE120)) / close) * 100;
  const dense = density < 2.5;
  const deduction20 = closes.at(-20);
  const structure2B = detect2B(rows, close);
  const rangePosition = high60 === low60 ? 50 : ((close - low60) / (high60 - low60)) * 100;

  const bullConditions = [
    close > currentE20,
    last(e20) > last(e20, 2),
    last(e20) > last(e60),
    last(e20) > last(e60) && last(e60) > last(e120) && last(e60) > last(e60, 2),
    bias120 > 12 || close >= high60 * 0.995
  ];
  const bearConditions = [
    close < currentE20,
    last(e20) < last(e20, 2),
    last(e20) < last(e60),
    last(e20) < last(e60) && last(e60) < last(e120) && last(e60) < last(e60, 2),
    bias120 < -12 || close <= low60 * 1.005
  ];
  const bullSteps = sequentialSteps(bullConditions);
  const bearSteps = sequentialSteps(bearConditions);
  const bullScore = bullSteps.filter(Boolean).length;
  const bearScore = bearSteps.filter(Boolean).length;
  const dominantDirection = bullScore > bearScore ? "bull" : bearScore > bullScore ? "bear" : "none";
  const dominantScore = Math.max(bullScore, bearScore);
  let systemStage = dense ? "均线密集 / 行情准备" : "转折观察";
  if (dominantScore === 1 || dominantScore === 2) systemStage = "转折";
  if (dominantScore === 3) systemStage = "开始";
  if (dominantScore === 4) systemStage = "发展";
  if (dominantScore === 5) systemStage = "极端";
  if (dominantScore === 5 && ((dominantDirection === "bull" && slopeChange < 0) || (dominantDirection === "bear" && slopeChange > 0))) {
    systemStage = "极端后的转折预警";
  }
  if (structure2B.label !== "无" && dominantScore < 3) systemStage = "2B转折观察";

  let stageDays = 0;
  if (dominantDirection !== "none" && dominantScore > 0) {
    for (let index = closes.length - 1; index >= 120; index -= 1) {
      if (progressAt(index, dominantDirection, closes, highs, lows, e20, e60, e120) !== dominantScore) break;
      stageDays += 1;
    }
  }

  let humanState = "常态";
  if (bias120 >= 25) humanState = "正乖离极端 / 亢奋";
  else if (bias120 >= 15) humanState = "正乖离偏高";
  else if (bias120 <= -25) humanState = "负乖离极端 / 恐慌";
  else if (bias120 <= -15) humanState = "负乖离偏低";
  if (volumeRatio >= 1.8 && Math.abs(bias120) >= 15) humanState += " + 放量";

  let riskReward = null;
  let riskRewardText = "等待方向形成";
  if (dominantDirection === "bull" && close > currentE20) {
    const stop = currentE20;
    const target = Math.max(currentE60, high60);
    const risk = close - stop;
    const reward = target - close;
    if (risk > 0 && reward > 0) riskReward = reward / risk;
    riskRewardText = riskReward ? `${riskReward.toFixed(1)} : 1` : "目标空间不足";
  } else if (dominantDirection === "bear" && close < currentE20) {
    const stop = currentE20;
    const target = Math.min(currentE60, low60);
    const risk = stop - close;
    const reward = close - target;
    if (risk > 0 && reward > 0) riskReward = reward / risk;
    riskRewardText = riskReward ? `${riskReward.toFixed(1)} : 1` : "目标空间不足";
  }

  let phase = "横向整理";
  let tone = "neutral";
  let next = "等待价格有效站上或跌破 EMA20，再进入转折跟踪。";
  let bottomLine = `底线看 EMA20：${fmtNumber(currentE20)}。`;

  if (bullScore >= bearScore && bullScore > 0) {
    tone = bullScore >= 4 ? "up" : "info";
    if (bullScore === 5) {
      phase = "上升第5步：正乖离/加速";
      next = "赚钱效应强，重点观察放量滞涨、跌破 EMA20 与短线拐头。";
    } else if (bullScore === 4) {
      phase = "上升第4步：多头排列";
      next = "趋势进入发展段，观察能否沿 EMA20/60 推进，并防止排列被破坏。";
    } else if (bullScore === 3) {
      phase = crossedUp(e20, e60) ? "上升第3步：刚金叉" : "上升第3步：金叉后";
      next = "下一步看 EMA60 与 EMA120 能否跟上，形成多头排列。";
    } else if (bullScore === 2) {
      phase = "上升第2步：短均拐头";
      next = "下一步等 EMA20 上穿 EMA60，失败则回到原级别处理。";
    } else {
      phase = "上升第1步：站上短均";
      next = "下一步看 EMA20 是否拐头向上，避免只是假突破。";
    }
    bottomLine = `多头底线：收盘跌回 EMA20(${fmtNumber(currentE20)}) 或 EMA20 拐头失败。`;
  }

  if (bearScore > bullScore && bearScore > 0) {
    tone = bearScore >= 4 ? "down" : "warn";
    if (bearScore === 5) {
      phase = "下降第5步：负乖离/杀跌";
      next = "恐慌段可能出现引力回归，观察是否重新站回 EMA20。";
    } else if (bearScore === 4) {
      phase = "下降第4步：空头排列";
      next = "趋势进入下行发展段，反弹若不能收复 EMA20/60，仍偏弱。";
    } else if (bearScore === 3) {
      phase = crossedDown(e20, e60) ? "下降第3步：刚死叉" : "下降第3步：死叉后";
      next = "下一步看 EMA60 与 EMA120 是否转为空头排列。";
    } else if (bearScore === 2) {
      phase = "下降第2步：短均拐头";
      next = "下一步警惕 EMA20 下穿 EMA60；若收复短均则转入修复。";
    } else {
      phase = "下降第1步：跌破短均";
      next = "下一步看 EMA20 是否拐头向下，避免只是假跌破。";
    }
    bottomLine = `空头修复线：重新站回 EMA20(${fmtNumber(currentE20)}) 且短均拐头。`;
  }

  return {
    phase,
    tone,
    next,
    bottomLine,
    bullSteps,
    bearSteps,
    bullScore,
    bearScore,
    ema20: currentE20,
    ema60: currentE60,
    ema120: currentE120,
    bias20,
    bias120,
    maWidth,
    macdPct,
    systemStage,
    stageDays,
    slope20,
    slopeChange,
    volumeRatio,
    density,
    dense,
    deduction20,
    structure2B,
    rangePosition,
    humanState,
    riskReward,
    riskRewardText,
    close,
    prevClose
  };
}

function renderChips() {
  els.watchChips.innerHTML = "";
  watchlist.forEach((secid) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `<span>${secid}</span>`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "移除";
    remove.addEventListener("click", () => {
      watchlist = watchlist.filter((item) => item !== secid);
      saveWatchlist();
      renderChips();
      refresh();
    });
    chip.append(remove);
    els.watchChips.append(chip);
  });
}

function renderMarket(market) {
  els.breadthLabel.textContent = "监控池上涨 / 下跌";
  els.amountLabel.textContent = "当前最强";
  els.upDown.textContent = `${market.up} / ${market.down}`;
  els.upRatio.textContent = `${(market.upRatio * 100).toFixed(1)}%`;
  els.marketAmount.textContent = market.topGainers[0]?.name || "--";
  els.mainFlow.textContent = `${market.total} 个`;
  els.mainFlow.className = "info";
  els.leadersList.innerHTML = market.topGainers.map((item) => `
    <div class="leader">
      <span>${item.name} <span class="neutral">${item.code}</span></span>
      <b class="${Number(item.pct) >= 0 ? "up" : "down"}">${fmtNumber(item.pct)}%</b>
    </div>
  `).join("");
}

function renderSignals(quotes, klines) {
  const quoteMap = new Map(quotes.map((q) => [q.secid, q]));
  els.signalGrid.innerHTML = klines.map((payload) => {
    const quote = quoteMap.get(payload.secid) || {};
    const analysis = analyzeKlines(payload, quote);
    const pctClass = Number(quote.pct) > 0 ? "up" : Number(quote.pct) < 0 ? "down" : "neutral";
    const steps = stepLabels.map((label, index) => {
      const cls = analysis.bullSteps[index] ? "hitBull" : analysis.bearSteps[index] ? "hitBear" : "";
      return `<div class="step ${cls}"><b>${index + 1}</b><br>${label}</div>`;
    }).join("");
    const slopeClass = analysis.slope20 > 0 ? "up" : analysis.slope20 < 0 ? "down" : "neutral";
    const slopeText = analysis.slope20 === null ? "--" : `${analysis.slope20 >= 0 ? "+" : ""}${fmtNumber(analysis.slope20)}%`;
    const volumeText = analysis.volumeRatio === null ? "--" : `${fmtNumber(analysis.volumeRatio)}x`;
    const rangeText = analysis.rangePosition === null ? "--" : `${fmtNumber(analysis.rangePosition, 0)}%`;
    const stale = isQuoteStale(quote.quoteTime);
    return `
      <article class="card">
        <div class="cardHead">
          <div>
            <div class="name">${quote.name || payload.name || payload.code}</div>
            <div class="code">${payload.secid}</div>
            <div class="quoteTime${stale ? " stale" : ""}">数据 ${fmtQuoteTime(quote.quoteTime)}${stale ? " · 可能延迟" : ""}</div>
          </div>
          <div class="price">
            <strong>${fmtNumber(quote.price || analysis.close)}</strong>
            <span class="${pctClass}">${fmtNumber(quote.pct)}%</span>
          </div>
        </div>
        <div class="phase">
          <div>
            <span class="systemStage">${analysis.systemStage}</span>
            <b class="${analysis.tone}">${analysis.phase}</b>
          </div>
          <span class="score">多头进程 ${analysis.bullScore}/5 · 空头进程 ${analysis.bearScore}/5</span>
        </div>
        <div class="steps">${steps}</div>
        <div class="dimensionGrid">
          <div><span>价</span><b>60日位置 ${rangeText}</b></div>
          <div><span>量</span><b>${volumeText}</b></div>
          <div><span>时</span><b>${analysis.stageDays || 0} 个交易日</b></div>
          <div><span>空</span><b>120乖离 ${fmtNumber(analysis.bias120)}%</b></div>
        </div>
        <div class="facts">
          <div class="fact"><span>EMA20斜率 / 加速度</span><b class="${slopeClass}">${slopeText} / ${fmtNumber(analysis.slopeChange)}%</b></div>
          <div class="fact"><span>均线密集度</span><b class="${analysis.dense ? "info" : "neutral"}">${fmtNumber(analysis.density)}% ${analysis.dense ? "· 密集" : ""}</b></div>
          <div class="fact"><span>明日MA20抵扣价</span><b>${fmtNumber(analysis.deduction20)}</b></div>
          <div class="fact"><span>2B结构</span><b class="${analysis.structure2B.tone}">${analysis.structure2B.label}</b></div>
          <div class="fact"><span>人性 / 乖离状态</span><b>${analysis.humanState}</b></div>
          <div class="fact"><span>参考盈亏比</span><b class="${analysis.riskReward >= 3 ? "up" : analysis.riskReward ? "warn" : "neutral"}">${analysis.riskRewardText}</b></div>
        </div>
        <p class="plan">${analysis.next}<br>${analysis.bottomLine}</p>
      </article>
    `;
  }).join("");
}

async function refresh() {
  if (!watchlist.length) return;
  els.lastUpdate.textContent = "刷新中...";
  try {
    const response = await fetch(`/api/batch?secids=${encodeURIComponent(watchlist.join(","))}`);
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || "刷新失败");
    renderMarket(json.data.market);
    renderSignals(json.data.quotes, json.data.klines);
    els.lastUpdate.textContent = `更新于 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`;
  } catch (error) {
    els.lastUpdate.textContent = `刷新失败：${error.message}`;
  }
}

function schedule() {
  clearInterval(timer);
  if (els.autoRefresh.checked) timer = setInterval(refresh, 30000);
}

els.refreshBtn.addEventListener("click", refresh);
els.autoRefresh.addEventListener("change", schedule);
els.addSymbol.addEventListener("click", () => {
  if (searchItems[activeSearchIndex]) {
    addToWatchlist(searchItems[activeSearchIndex].secid);
    return;
  }
  addToWatchlist(els.symbolInput.value);
});
els.symbolInput.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" && searchItems.length) {
    event.preventDefault();
    activeSearchIndex = (activeSearchIndex + 1) % searchItems.length;
    updateActiveSearch();
  } else if (event.key === "ArrowUp" && searchItems.length) {
    event.preventDefault();
    activeSearchIndex = (activeSearchIndex - 1 + searchItems.length) % searchItems.length;
    updateActiveSearch();
  } else if (event.key === "Enter") {
    event.preventDefault();
    els.addSymbol.click();
  } else if (event.key === "Escape") {
    hideSearchResults();
  }
});
els.symbolInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const query = els.symbolInput.value.trim();
  if (!query) return hideSearchResults();
  if (/^[01]?\.\d{0,6}$/.test(query) || /^\d{1,6}$/.test(query)) {
    hideSearchResults();
    return;
  }
  searchTimer = setTimeout(() => searchByName(query), 250);
});
els.symbolInput.addEventListener("blur", () => setTimeout(hideSearchResults, 120));

renderChips();
schedule();
refresh();
