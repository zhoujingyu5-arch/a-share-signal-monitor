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
  yfN225: "^N225",
  yfKS11: "^KS11",
  yfGDAXI: "^GDAXI",
  yfBTCF: "BTC=F",
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

async function fetchJson(url) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { stdout } = await execFileAsync("curl", [
        "-sS",
        "-L",
        "--retry",
        "1",
        "--max-time",
        "12",
        "-H",
        "Accept: application/json,text/plain,*/*",
        "-H",
        "User-Agent: Mozilla/5.0 AShareSignalMonitor/1.0",
        String(url).replaceAll("%2C", ",")
      ], { maxBuffer: 8 * 1024 * 1024 });
      return JSON.parse(stdout);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
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
  const json = await fetchJson(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=5d&interval=1d`);
  const result = json.chart?.result?.[0];
  const meta = result?.meta || {};
  const closes = (result?.indicators?.quote?.[0]?.close || []).filter((value) => Number.isFinite(Number(value))).map(Number);
  const price = closes.at(-1) ?? Number(meta.regularMarketPrice);
  const previousClose = closes.at(-2) ?? Number(meta.previousClose || meta.chartPreviousClose);
  const change = price - previousClose;
  return {
    secid: symbol,
    code: yahooSymbol.replace("^", ""),
    market: "yf",
    name: globalCatalog.find((item) => item.symbol === symbol)?.name || meta.shortName || yahooSymbol,
    price,
    pct: previousClose ? (change / previousClose) * 100 : 0,
    change,
    volume: Number(meta.regularMarketVolume) || 0,
    amount: 0,
    high: Number(meta.regularMarketDayHigh) || price,
    low: Number(meta.regularMarketDayLow) || price,
    open: Number(meta.regularMarketOpen) || price,
    previousClose,
    totalMarketValue: null,
    floatMarketValue: null,
    mainNetInflow: null,
    quoteTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : ""
  };
}

async function getQuotes(secids) {
  const ids = secids.map(normalizeSymbol).filter(Boolean);
  const tencentIds = ids.filter((id) => !id.startsWith("yf"));
  const yahooIds = ids.filter((id) => id.startsWith("yf"));
  const [tencentQuotes, yahooQuotes] = await Promise.all([
    getTencentQuotes(tencentIds),
    Promise.all(yahooIds.map(getYahooQuote))
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
    }))
  };
}

async function getYahooKlines(secid, limit = 260) {
  const symbol = normalizeSymbol(secid);
  const yahooSymbol = yahooSymbols[symbol];
  const json = await fetchJson(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=2y&interval=1d`);
  const result = json.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const rows = timestamps.map((timestamp, index) => ({
    date: new Date(timestamp * 1000).toISOString().slice(0, 10),
    open: Number(quote.open?.[index]),
    close: Number(quote.close?.[index]),
    high: Number(quote.high?.[index]),
    low: Number(quote.low?.[index]),
    volume: Number(quote.volume?.[index]) || 0,
    amount: null,
    amplitude: null,
    pct: null,
    change: null,
    turnover: null
  })).filter((row) => Number.isFinite(row.close));
  return {
    secid: symbol,
    code: yahooSymbol.replace("^", ""),
    name: globalCatalog.find((item) => item.symbol === symbol)?.name || yahooSymbol,
    klines: rows.slice(-limit)
  };
}

async function getKlines(secid, limit = 260) {
  if (normalizeSymbol(secid).startsWith("yf")) {
    return getYahooKlines(secid, limit);
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
    const symbol = normalizeSymbol(secid);
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
        ...secids.map((id) => getKlines(id))
      ]);
      const market = {
        sample: true,
        total: quotes.length,
        up: quotes.filter((q) => q.pct > 0).length,
        down: quotes.filter((q) => q.pct < 0).length,
        flat: quotes.filter((q) => q.pct === 0).length,
        upRatio: quotes.length ? quotes.filter((q) => q.pct > 0).length / quotes.length : 0,
        amount: quotes.reduce((sum, q) => sum + (Number(q.amount) || 0), 0),
        mainNetInflow: null,
        topGainers: quotes.slice().sort((a, b) => b.pct - a.pct).slice(0, 8)
      };
      return send(res, 200, JSON.stringify({ ok: true, data: { quotes, market, klines } }));
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
