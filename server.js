import http from "node:http";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 5173);
const execFileAsync = promisify(execFile);
const yahooCache = new Map();
const yahooCacheMs = 5 * 60 * 1000;
const yahooFailureCacheMs = 45 * 1000;
const yahooRequestGapMs = 800;
let yahooQueue = Promise.resolve();
let lastYahooRequestAt = 0;

const defaultSymbols = [
  "sh000001",
  "sz399001",
  "sz399006",
  "sh000300",
  "sh000905",
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
const shanghaiIndexCodes = new Set([
  "000001",
  "000016",
  "000300",
  "000688",
  "000852",
  "000905"
]);
const globalCatalog = [
  { name: "北证50", code: "899050", symbol: "bj899050", market: "中国" },
  { name: "上证指数", code: "000001", symbol: "sh000001", market: "中国" },
  { name: "深证成指", code: "399001", symbol: "sz399001", market: "中国" },
  { name: "创业板指", code: "399006", symbol: "sz399006", market: "中国" },
  { name: "沪深300", code: "000300", symbol: "sh000300", market: "中国" },
  { name: "中证500", code: "000905", symbol: "sh000905", market: "中国" },
  { name: "中证1000", code: "000852", symbol: "sh000852", market: "中国" },
  { name: "科创50", code: "000688", symbol: "sh000688", market: "中国" },
  { name: "恒生指数", code: "HSI", symbol: "hkHSI", market: "香港" },
  { name: "标普500", code: "INX", symbol: "usINX", market: "美国" },
  { name: "纳斯达克综合", code: "IXIC", symbol: "usIXIC", market: "美国" },
  { name: "道琼斯工业", code: "DJI", symbol: "usDJI", market: "美国" },
  { name: "标普500波动率", code: "VIX", symbol: "usVIX", market: "美国" },
  { name: "日经225", code: "N225", symbol: "yfN225", market: "日本" },
  { name: "韩国综合指数", code: "KS11", symbol: "yfKS11", market: "韩国" },
  { name: "德国DAX", code: "GDAXI", symbol: "yfGDAXI", market: "德国" },
  { name: "英国富时100", code: "UKX", symbol: "ukUKX", market: "英国" },
  { name: "CME比特币连续期货", code: "BTC=F", symbol: "yfBTCF", market: "加密期货" },
  { name: "美元指数", code: "DX-Y.NYB", symbol: "yfDXY", market: "外汇" },
  { name: "彭博大宗商品指数", code: "BCOM", symbol: "yfBCOM", market: "大宗商品" },
  { name: "COMEX黄金连续期货", code: "GC=F", symbol: "yfGCF", market: "大宗商品" },
  { name: "WTI原油连续期货", code: "CL=F", symbol: "yfCLF", market: "大宗商品" },
  { name: "布伦特原油连续期货", code: "BZ=F", symbol: "yfBZF", market: "大宗商品" },
  { name: "COMEX铜连续期货", code: "HG=F", symbol: "yfHGF", market: "大宗商品" },
  { name: "COMEX白银连续期货", code: "SI=F", symbol: "yfSIF", market: "大宗商品" },
  { name: "天然气连续期货", code: "NG=F", symbol: "yfNGF", market: "大宗商品" },
  { name: "玉米连续期货", code: "ZC=F", symbol: "yfZCF", market: "农产品" },
  { name: "小麦连续期货", code: "ZW=F", symbol: "yfZWF", market: "农产品" },
  { name: "大豆连续期货", code: "ZS=F", symbol: "yfZSF", market: "农产品" }
];
const yahooSymbols = {
  ukUKX: "^FTSE",
  yfN225: "^N225",
  yfKS11: "^KS11",
  yfGDAXI: "^GDAXI",
  yfBTCF: "BTC=F",
  yfDXY: "DX-Y.NYB",
  yfBCOM: "^BCOM",
  yfGCF: "GC=F",
  yfCLF: "CL=F",
  yfBZF: "BZ=F",
  yfHGF: "HG=F",
  yfSIF: "SI=F",
  yfNGF: "NG=F",
  yfZCF: "ZC=F",
  yfZWF: "ZW=F",
  yfZSF: "ZS=F"
};
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function normalizeSymbol(input = "") {
  const raw = String(input).trim();
  if (!raw) return "";
  const catalogMatch = globalCatalog.find((item) => item.symbol.toLowerCase() === raw.toLowerCase());
  if (catalogMatch) return catalogMatch.symbol;
  if (/^(sh|sz|bj)\d{6}$/i.test(raw)) return `${raw.slice(0, 2).toLowerCase()}${raw.slice(2)}`;
  if (/^(hk|us|uk|yf)[a-z0-9.]+$/i.test(raw)) {
    return `${raw.slice(0, 2).toLowerCase()}${raw.slice(2).toUpperCase()}`;
  }
  if (/^[01]\.\d{6}$/.test(raw)) {
    const [market, code] = raw.split(".");
    return `${market === "1" ? "sh" : "sz"}${code}`;
  }
  const code = raw.replace(/[^\d]/g, "").slice(-6);
  if (!/^\d{6}$/.test(code)) return "";
  if (code === "899050") return "bj899050";
  const market = code.startsWith("6") || code.startsWith("9") || shanghaiIndexCodes.has(code) ? "sh" : "sz";
  return `${market}${code}`;
}

function symbolToSecid(symbol) {
  const id = normalizeSymbol(symbol);
  if (!/^(sh|sz)\d{6}$/.test(id)) return "";
  return `${id.startsWith("sh") ? "1" : "0"}.${id.slice(2)}`;
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(body);
}

async function fetchJson(url, options = {}) {
  const maxTime = String(options.maxTime || 12);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { stdout } = await execFileAsync("curl", [
        "-sS",
        "-L",
        "--compressed",
        "--retry",
        "1",
        "--max-time",
        maxTime,
        "-H",
        "Accept: application/json,text/plain,*/*",
        "-H",
        "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        String(url).replaceAll("%2C", ",")
      ], { maxBuffer: 8 * 1024 * 1024 });
      const text = String(stdout || "").trimStart();
      if (!/^[\[{]/.test(text)) {
        throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 90).replace(/\s+/g, " ")}`);
      }
      return JSON.parse(stdout);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runYahooRequest(task) {
  const run = yahooQueue.then(async () => {
    const waitMs = Math.max(0, yahooRequestGapMs - (Date.now() - lastYahooRequestAt));
    if (waitMs) await sleep(waitMs);
    lastYahooRequestAt = Date.now();
    return task();
  });
  yahooQueue = run.catch(() => {});
  return run;
}

async function fetchYahooChart(yahooSymbol, query) {
  const encoded = encodeURIComponent(yahooSymbol);
  const hosts = ["query2.finance.yahoo.com", "query1.finance.yahoo.com"];
  const cacheKey = `${yahooSymbol}?${query}`;
  const cached = yahooCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.error) throw new Error(cached.error);
    return cached.data;
  }
  let lastError;
  for (const host of hosts) {
    try {
      const data = await runYahooRequest(() => fetchJson(`https://${host}/v8/finance/chart/${encoded}?${query}`, { maxTime: 5 }));
      yahooCache.set(cacheKey, { data, expiresAt: Date.now() + yahooCacheMs });
      return data;
    } catch (error) {
      lastError = error;
      if (String(error?.message || error).includes("Too Many Requests")) break;
    }
  }
  yahooCache.set(cacheKey, { error: compactError(lastError), expiresAt: Date.now() + yahooFailureCacheMs });
  throw lastError;
}

function catalogItem(symbol) {
  return globalCatalog.find((item) => item.symbol === symbol);
}

function compactError(error) {
  return String(error?.message || error || "数据源不可用").slice(0, 140);
}

function placeholderQuote(secid, error) {
  const symbol = normalizeSymbol(secid);
  const item = catalogItem(symbol);
  return {
    secid: symbol,
    code: item?.code || symbol.slice(2),
    market: item?.market || symbol.slice(0, 2),
    name: item?.name || symbol,
    price: null,
    pct: null,
    change: null,
    volume: null,
    amount: 0,
    high: null,
    low: null,
    open: null,
    previousClose: null,
    totalMarketValue: null,
    floatMarketValue: null,
    mainNetInflow: null,
    quoteTime: "",
    sourceError: compactError(error)
  };
}

function placeholderKlines(secid, error) {
  const symbol = normalizeSymbol(secid);
  const item = catalogItem(symbol);
  return {
    secid: symbol,
    code: item?.code || symbol.slice(2),
    name: item?.name || symbol,
    klines: [],
    sourceError: compactError(error)
  };
}

function parseKline(row) {
  const [date, open, close, high, low, volume, amount, amplitude, pct, change, turnover] = row.split(",");
  return {
    date,
    open: Number(open),
    close: Number(close),
    high: Number(high),
    low: Number(low),
    volume: Number(volume),
    amount: Number(amount),
    amplitude: Number(amplitude),
    pct: Number(pct),
    change: Number(change),
    turnover: Number(turnover)
  };
}

function quoteDate(quoteTime = "") {
  const text = String(quoteTime);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const slashed = text.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (slashed) return `${slashed[1]}-${slashed[2]}-${slashed[3]}`;
  return "";
}

function mergeLatestQuote(klineData, quote, limit = 260) {
  const rows = klineData.klines || [];
  const date = quoteDate(quote?.quoteTime);
  const lastDate = rows.at(-1)?.date || "";
  if (!date || !Number.isFinite(Number(quote?.price)) || date <= lastDate) return klineData;
  return {
    ...klineData,
    klines: [...rows, {
      date,
      open: Number(quote.open) || Number(quote.price),
      close: Number(quote.price),
      high: Number(quote.high) || Number(quote.price),
      low: Number(quote.low) || Number(quote.price),
      volume: Number(quote.volume) || 0,
      amount: Number(quote.amount) || null,
      amplitude: null,
      pct: Number(quote.pct),
      change: Number(quote.change),
      turnover: null
    }].slice(-limit)
  };
}

async function getTencentQuotes(ids) {
  if (!ids.length) return [];
  const { stdout } = await execFileAsync("curl", [
    "-sS",
    "-L",
    "--max-time",
    "12",
    `https://qt.gtimg.cn/q=${ids.join(",")}`
  ], { encoding: "binary", maxBuffer: 2 * 1024 * 1024 });
  const text = new TextDecoder("gb18030").decode(Buffer.from(stdout, "binary"));
  return text.split(/\n+/).map((line) => {
    const codeMatch = line.match(/^v_([^=]+)=/);
    const dataMatch = line.match(/="([^"]*)"/);
    if (!codeMatch || !dataMatch || !dataMatch[1]) return null;
    const symbol = codeMatch[1];
    const fields = dataMatch[1].split("~");
    const previousClose = Number(fields[4]);
    const price = Number(fields[3]);
    const change = Number(fields[31]) || price - previousClose;
    const pct = Number(fields[32]) || (previousClose ? (change / previousClose) * 100 : 0);
    return {
      secid: symbol,
      code: fields[2],
      market: symbol.slice(0, 2),
      name: fields[1],
      price,
      pct,
      change,
      volume: Number(fields[6]),
      amount: Number(fields[37]) || 0,
      high: Number(fields[33]),
      low: Number(fields[34]),
      open: Number(fields[5]),
      previousClose,
      totalMarketValue: null,
      floatMarketValue: null,
      mainNetInflow: null,
      quoteTime: fields[30] || ""
    };
  }).filter(Boolean);
}

async function getYahooQuote(symbol) {
  const yahooSymbol = yahooSymbols[symbol];
  const json = await fetchYahooChart(yahooSymbol, "range=5d&interval=1d");
  const result = json.chart?.result?.[0];
  const meta = result?.meta || {};
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const allPoints = (quote.close || []).map((value, index) => ({
    close: value === null || value === undefined ? null : Number(value),
    open: quote.open?.[index] === null || quote.open?.[index] === undefined ? null : Number(quote.open[index]),
    high: quote.high?.[index] === null || quote.high?.[index] === undefined ? null : Number(quote.high[index]),
    low: quote.low?.[index] === null || quote.low?.[index] === undefined ? null : Number(quote.low[index]),
    volume: quote.volume?.[index] === null || quote.volume?.[index] === undefined ? null : Number(quote.volume[index]),
    timestamp: timestamps[index]
  }));
  const points = allPoints.filter((point) => Number.isFinite(point.close));
  const latest = points.at(-1);
  const previous = points.at(-2);
  const finalPoint = allPoints.at(-1);
  const metaPrice = Number(meta.regularMarketPrice);
  const metaTimestamp = Number(meta.regularMarketTime);
  const newestChartTimestamp = Number(finalPoint?.timestamp || latest?.timestamp || 0);
  const metaIsCurrent = Number.isFinite(metaPrice) && metaPrice > 0 &&
    Number.isFinite(metaTimestamp) && Math.abs(metaTimestamp - newestChartTimestamp) <= 60 * 60 * 48;
  const chartHasLatestClose = Number.isFinite(finalPoint?.close);
  const useMetaPrice = !chartHasLatestClose && metaIsCurrent;
  const price = useMetaPrice ? metaPrice : latest?.close;
  const previousClose = useMetaPrice ? latest?.close : previous?.close;
  if (!Number.isFinite(price) || !Number.isFinite(previousClose)) {
    throw new Error(`Invalid quote data for ${yahooSymbol}`);
  }
  const change = price - previousClose;
  return {
    secid: symbol,
    code: yahooSymbol.replace("^", ""),
    market: "yf",
    name: catalogItem(symbol)?.name || meta.shortName || yahooSymbol,
    price,
    pct: previousClose ? (change / previousClose) * 100 : 0,
    change,
    volume: useMetaPrice ? (Number(meta.regularMarketVolume) || latest?.volume || 0) : (latest?.volume || 0),
    amount: 0,
    high: useMetaPrice ? (Number(meta.regularMarketDayHigh) || price) : (latest?.high ?? price),
    low: useMetaPrice ? (Number(meta.regularMarketDayLow) || price) : (latest?.low ?? price),
    open: useMetaPrice ? (Number(meta.regularMarketOpen) || price) : (latest?.open ?? price),
    previousClose,
    totalMarketValue: null,
    floatMarketValue: null,
    mainNetInflow: null,
    quoteTime: new Date((useMetaPrice ? metaTimestamp : latest.timestamp) * 1000).toISOString()
  };
}

async function getQuotes(secids) {
  const ids = secids.map(normalizeSymbol).filter(Boolean);
  const tencentIds = ids.filter((id) => !yahooSymbols[id]);
  const yahooIds = ids.filter((id) => yahooSymbols[id]);
  const [tencentQuotes, yahooQuotes] = await Promise.all([
    getTencentQuotes(tencentIds).catch((error) => tencentIds.map((id) => placeholderQuote(id, error))),
    Promise.all(yahooIds.map((id) => (
      withTimeout(getYahooQuote(id), 12000, `Yahoo quote timeout for ${id}`)
        .catch((error) => placeholderQuote(id, error))
    )))
  ]);
  const quoteMap = new Map([...tencentQuotes, ...yahooQuotes].map((quote) => [quote.secid, quote]));
  return ids.map((id) => quoteMap.get(id)).filter(Boolean);
}

async function searchSymbols(keyword) {
  const query = String(keyword || "").trim();
  if (!query) return [];
  const localResults = globalCatalog.filter((item) => {
    const haystack = `${item.name} ${item.code} ${item.symbol}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  }).map((item) => ({ ...item, secid: item.symbol }));
  let content = "";
  try {
    const { stdout } = await execFileAsync("curl", [
      "-sS",
      "-L",
      "--max-time",
      "10",
      "-H",
      "Referer: https://finance.sina.com.cn",
      `https://suggest3.sinajs.cn/suggest/type=11,12,13,14,15&key=${encodeURIComponent(query)}`
    ], { encoding: "binary", maxBuffer: 1024 * 1024 });
    const text = new TextDecoder("gb18030").decode(Buffer.from(stdout, "binary"));
    content = text.match(/suggestvalue="([^"]*)"/)?.[1] || "";
  } catch {
    // Keep the built-in global index catalog available if remote search fails.
  }
  const chinaResults = content.split(";").map((row) => {
    const fields = row.split(",");
    const marketCode = fields[3] || "";
    if (!/^(sh|sz)\d{6}$/.test(marketCode)) return null;
    return {
      name: fields[0],
      code: fields[2],
      secid: marketCode,
      market: marketCode.startsWith("sh") ? "沪" : "深",
      symbol: marketCode
    };
  }).filter(Boolean);
  const merged = [...localResults, ...chinaResults];
  return merged.filter((item, index) =>
    merged.findIndex((candidate) => candidate.symbol === item.symbol) === index
  ).slice(0, 12);
}

async function getEastmoneyKlines(secid, limit = 260, klt = "101") {
  const symbol = normalizeSymbol(secid);
  const id = symbolToSecid(symbol);
  if (!id) throw new Error("No Eastmoney fallback for this market");
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
  url.search = new URLSearchParams({
    secid: id,
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
    klt,
    fqt: "1",
    beg: "19900101",
    end: "20500101",
    lmt: String(limit)
  }).toString();
  const json = await fetchJson(url);
  return {
    secid: symbol,
    code: json.data?.code,
    name: json.data?.name,
    klines: (json.data?.klines || []).map(parseKline)
  };
}

async function getTencentKlines(secid, limit = 260) {
  const symbol = normalizeSymbol(secid);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=${symbol},day,,,${limit}`;
  const json = await fetchJson(url);
  const block = Object.values(json.data || {})[0] || {};
  const rows = block.day || block.qfqday || [];
  return {
    secid: symbol,
    code: symbol.slice(2),
    name: symbol,
    klines: rows.map(([date, open, close, high, low, volume]) => ({
      date,
      open: Number(open),
      close: Number(close),
      high: Number(high),
      low: Number(low),
      volume: Number(volume),
      amount: null,
      amplitude: null,
      pct: null,
      change: null,
      turnover: null
    })).slice(-limit)
  };
}

async function getYahooKlines(secid, limit = 260) {
  const symbol = normalizeSymbol(secid);
  const yahooSymbol = yahooSymbols[symbol];
  const json = await fetchYahooChart(yahooSymbol, "range=2y&interval=1d");
  const result = json.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const rows = timestamps.map((timestamp, index) => {
    const closeValue = quote.close?.[index];
    if (closeValue === null || closeValue === undefined || !Number.isFinite(Number(closeValue))) return null;
    return {
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      open: quote.open?.[index] === null || quote.open?.[index] === undefined ? Number(closeValue) : Number(quote.open[index]),
      close: Number(closeValue),
      high: quote.high?.[index] === null || quote.high?.[index] === undefined ? Number(closeValue) : Number(quote.high[index]),
      low: quote.low?.[index] === null || quote.low?.[index] === undefined ? Number(closeValue) : Number(quote.low[index]),
      volume: quote.volume?.[index] === null || quote.volume?.[index] === undefined ? 0 : Number(quote.volume[index]),
      amount: null,
      amplitude: null,
      pct: null,
      change: null,
      turnover: null
    };
  }).filter(Boolean);
  return {
    secid: symbol,
    code: yahooSymbol.replace("^", ""),
    name: catalogItem(symbol)?.name || yahooSymbol,
    klines: rows.slice(-limit)
  };
}

async function getKlines(secid, limit = 260) {
  const symbol = normalizeSymbol(secid);
  if (yahooSymbols[symbol]) {
    return getYahooKlines(symbol, limit).catch((error) => placeholderKlines(symbol, error));
  }
  try {
    const data = await getTencentKlines(secid, limit);
    if (data.klines.length) return data;
  } catch {
    // Fall through to Eastmoney as a backup because either source may throttle.
  }
  try {
    return await getEastmoneyKlines(secid, limit);
  } catch {
    return { secid: symbol, code: symbol.slice(2), name: symbol, klines: [] };
  }
}

async function getMarketSnapshot() {
  const url = new URL("https://push2.eastmoney.com/api/qt/clist/get");
  url.search = new URLSearchParams({
    pn: "1",
    pz: "6000",
    po: "1",
    np: "1",
    fltt: "2",
    invt: "2",
    fid: "f3",
    fs: "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23",
    fields: "f2,f3,f6,f12,f13,f14,f62"
  }).toString();
  const json = await fetchJson(url);
  const rows = json.data?.diff || [];
  const up = rows.filter((r) => Number(r.f3) > 0).length;
  const down = rows.filter((r) => Number(r.f3) < 0).length;
  const flat = rows.length - up - down;
  const amount = rows.reduce((sum, r) => sum + (Number(r.f6) || 0), 0);
  const mainNetInflow = rows.reduce((sum, r) => sum + (Number(r.f62) || 0), 0);
  return {
    sample: true,
    total: rows.length,
    up,
    down,
    flat,
    upRatio: rows.length ? up / rows.length : 0,
    amount,
    mainNetInflow,
    topGainers: rows.slice(0, 8).map((r) => ({
      secid: `${r.f13}.${r.f12}`,
      code: r.f12,
      name: r.f14,
      price: r.f2,
      pct: r.f3,
      amount: r.f6
    }))
  };
}

async function routeApi(req, res, url) {
  try {
    if (url.pathname === "/api/quotes") {
      const secids = (url.searchParams.get("secids") || defaultSymbols.join(",")).split(",");
      return send(res, 200, JSON.stringify({ ok: true, data: await getQuotes(secids) }));
    }
    if (url.pathname === "/api/kline") {
      const secid = url.searchParams.get("secid");
      return send(res, 200, JSON.stringify({ ok: true, data: await getKlines(secid) }));
    }
    if (url.pathname === "/api/search") {
      const keyword = url.searchParams.get("q") || "";
      return send(res, 200, JSON.stringify({ ok: true, data: await searchSymbols(keyword) }));
    }
    if (url.pathname === "/api/batch") {
      const secids = (url.searchParams.get("secids") || defaultSymbols.join(",")).split(",").map(normalizeSymbol).filter(Boolean);
      const [quotes, ...klines] = await Promise.all([
        getQuotes(secids),
        ...secids.map((id) => (
          withTimeout(getKlines(id), yahooSymbols[id] ? 16000 : 18000, `Kline timeout for ${id}`)
            .catch((error) => placeholderKlines(id, error))
        ))
      ]);
      const quoteMap = new Map(quotes.map((quote) => [quote.secid, quote]));
      const mergedKlines = klines.map((item) => mergeLatestQuote(item, quoteMap.get(item.secid)));
      const tradableQuotes = quotes.filter((q) => Number.isFinite(Number(q.pct)));
      const market = {
        sample: true,
        total: quotes.length,
        up: tradableQuotes.filter((q) => q.pct > 0).length,
        down: tradableQuotes.filter((q) => q.pct < 0).length,
        flat: quotes.length - tradableQuotes.filter((q) => q.pct > 0 || q.pct < 0).length,
        upRatio: tradableQuotes.length ? tradableQuotes.filter((q) => q.pct > 0).length / tradableQuotes.length : 0,
        amount: quotes.reduce((sum, q) => sum + (Number(q.amount) || 0), 0),
        mainNetInflow: null,
        topGainers: tradableQuotes.slice().sort((a, b) => b.pct - a.pct).slice(0, 8)
      };
      return send(res, 200, JSON.stringify({ ok: true, data: { quotes, market, klines: mergedKlines } }));
    }
    send(res, 404, JSON.stringify({ ok: false, error: "Unknown API route" }));
  } catch (error) {
    send(res, 502, JSON.stringify({ ok: false, error: error.message }));
  }
}

async function routeStatic(req, res, url) {
  const safePath = path.normalize(decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
  try {
    const data = await readFile(filePath);
    send(res, 200, data, mime[path.extname(filePath)] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) return routeApi(req, res, url);
  return routeStatic(req, res, url);
});

server.listen(port, () => {
  console.log(`A-share signal monitor: http://localhost:${port}`);
});
