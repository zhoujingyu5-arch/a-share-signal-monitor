const DEFAULT_WATCHLIST = ["1.000001", "0.399001", "0.399006", "1.000300", "1.000905"];
const STORAGE_KEY = "ashare-signal-watchlist";
const stepLabels = ["破线", "拐头", "交叉", "排列", "乖离"];

let watchlist = loadWatchlist();
let timer = null;

const els = {
  refreshBtn: document.querySelector("#refreshBtn"),
  autoRefresh: document.querySelector("#autoRefresh"),
  symbolInput: document.querySelector("#symbolInput"),
  addSymbol: document.querySelector("#addSymbol"),
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

function normalizeSecid(input) {
  const raw = String(input || "").trim();
  if (/^[01]\.\d{6}$/.test(raw)) return raw;
  const code = raw.replace(/[^\d]/g, "").slice(-6);
  if (!/^\d{6}$/.test(code)) return "";
  const market = code.startsWith("6") || code.startsWith("9") ? "1" : "0";
  return `${market}.${code}`;
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

function analyzeKlines(payload, quote) {
  const rows = payload.klines || [];
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

  const bullSteps = [
    close > currentE20,
    last(e20) > last(e20, 2),
    last(e20) > last(e60),
    last(e20) > last(e60) && last(e60) > last(e120) && last(e60) > last(e60, 2),
    bias120 > 12 || close >= high60 * 0.995
  ];
  const bearSteps = [
    close < currentE20,
    last(e20) < last(e20, 2),
    last(e20) < last(e60),
    last(e20) < last(e60) && last(e60) < last(e120) && last(e60) < last(e60, 2),
    bias120 < -12 || close <= low60 * 1.005
  ];
  const bullScore = bullSteps.filter(Boolean).length;
  const bearScore = bearSteps.filter(Boolean).length;

  let phase = "横向整理";
  let tone = "neutral";
  let next = "等待价格有效站上或跌破 EMA20，再进入转折跟踪。";
  let bottomLine = `底线看 EMA20：${fmtNumber(currentE20)}。`;

  if (bullScore >= bearScore && bullScore > 0) {
    tone = bullScore >= 4 ? "up" : "info";
    if (bullSteps[4]) {
      phase = "上升第5步：正乖离/加速";
      next = "赚钱效应强，重点观察放量滞涨、跌破 EMA20 与短线拐头。";
    } else if (bullSteps[3]) {
      phase = "上升第4步：多头排列";
      next = "趋势进入发展段，观察能否沿 EMA20/60 推进，并防止排列被破坏。";
    } else if (bullSteps[2]) {
      phase = crossedUp(e20, e60) ? "上升第3步：刚金叉" : "上升第3步：金叉后";
      next = "下一步看 EMA60 与 EMA120 能否跟上，形成多头排列。";
    } else if (bullSteps[1]) {
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
    if (bearSteps[4]) {
      phase = "下降第5步：负乖离/杀跌";
      next = "恐慌段可能出现引力回归，观察是否重新站回 EMA20。";
    } else if (bearSteps[3]) {
      phase = "下降第4步：空头排列";
      next = "趋势进入下行发展段，反弹若不能收复 EMA20/60，仍偏弱。";
    } else if (bearSteps[2]) {
      phase = crossedDown(e20, e60) ? "下降第3步：刚死叉" : "下降第3步：死叉后";
      next = "下一步看 EMA60 与 EMA120 是否转为空头排列。";
    } else if (bearSteps[1]) {
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
  els.breadthLabel.textContent = market.sample ? "上涨家数样本" : "上涨家数";
  els.amountLabel.textContent = market.sample ? "样本成交额" : "全A成交额";
  els.upDown.textContent = `${market.up} / ${market.down}`;
  els.upRatio.textContent = `${(market.upRatio * 100).toFixed(1)}%`;
  els.marketAmount.textContent = fmtMoney(market.amount);
  els.mainFlow.textContent = fmtMoney(market.mainNetInflow);
  els.mainFlow.className = market.mainNetInflow >= 0 ? "up" : "down";
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
    return `
      <article class="card">
        <div class="cardHead">
          <div>
            <div class="name">${quote.name || payload.name || payload.code}</div>
            <div class="code">${payload.secid}</div>
          </div>
          <div class="price">
            <strong>${fmtNumber(quote.price || analysis.close)}</strong>
            <span class="${pctClass}">${fmtNumber(quote.pct)}%</span>
          </div>
        </div>
        <div class="phase">
          <b class="${analysis.tone}">${analysis.phase}</b>
          <span class="score">多 ${analysis.bullScore}/5 · 空 ${analysis.bearScore}/5</span>
        </div>
        <div class="steps">${steps}</div>
        <div class="facts">
          <div class="fact"><span>EMA20 / 60 / 120</span><b>${fmtNumber(analysis.ema20)} · ${fmtNumber(analysis.ema60)} · ${fmtNumber(analysis.ema120)}</b></div>
          <div class="fact"><span>120乖离</span><b class="${analysis.bias120 >= 0 ? "up" : "down"}">${fmtNumber(analysis.bias120)}%</b></div>
          <div class="fact"><span>MACD%强度</span><b class="${analysis.macdPct >= 0 ? "up" : "down"}">${fmtNumber(analysis.macdPct)}%</b></div>
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
  const secid = normalizeSecid(els.symbolInput.value);
  if (!secid || watchlist.includes(secid)) return;
  watchlist.push(secid);
  els.symbolInput.value = "";
  saveWatchlist();
  renderChips();
  refresh();
});
els.symbolInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") els.addSymbol.click();
});

renderChips();
schedule();
refresh();
