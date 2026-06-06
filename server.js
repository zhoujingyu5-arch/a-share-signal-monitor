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

const defaultSymbols = ["1.000001", "0.399001", "0.399006", "1.000300", "1.000905"];
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function normalizeSecid(input = "") {
  const raw = String(input).trim();
  if (!raw) return "";
  if (/^[01]\.\d{6}$/.test(raw)) return raw;
  const code = raw.replace(/[^\d]/g, "").slice(-6);
  if (!/^\d{6}$/.test(code)) return "";
  const market = code.startsWith("6") || code.startsWith("9") ? "1" : "0";
  return `${market}.${code}`;
}

function secidToSina(secid) {
  const id = normalizeSecid(secid);
  const [, code] = id.split(".");
  return `${id.startsWith("1.") ? "sh" : "sz"}${code}`;
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

async function getQuotes(secids) {
  const ids = secids.map(normalizeSecid).filter(Boolean);
  const sinaCodes = ids.map(secidToSina);
  const { stdout } = await execFileAsync("curl", [
    "-sS",
    "-L",
    "--max-time",
    "12",
    "-H",
    "Referer: https://finance.sina.com.cn",
    `https://hq.sinajs.cn/list=${sinaCodes.join(",")}`
  ], { encoding: "binary", maxBuffer: 2 * 1024 * 1024 });
  const text = new TextDecoder("gb18030").decode(Buffer.from(stdout, "binary"));
  return text.split(/\n+/).map((line) => {
    const codeMatch = line.match(/hq_str_(s[hz]\d{6})="/);
    const dataMatch = line.match(/="([^"]*)"/);
    if (!codeMatch || !dataMatch || !dataMatch[1]) return null;
    const secid = ids[sinaCodes.indexOf(codeMatch[1])] || "";
    const [, code] = secid.split(".");
    const fields = dataMatch[1].split(",");
    const previousClose = Number(fields[2]);
    const price = Number(fields[3]);
    const change = price - previousClose;
    const pct = previousClose ? (change / previousClose) * 100 : 0;
    return {
      secid,
      code,
      market: Number(secid.slice(0, 1)),
      name: fields[0],
      price,
      pct,
      change,
      volume: Number(fields[8]),
      amount: Number(fields[9]),
      high: Number(fields[4]),
      low: Number(fields[5]),
      open: Number(fields[1]),
      previousClose,
      totalMarketValue: null,
      floatMarketValue: null,
      mainNetInflow: null,
      quoteTime: `${fields[30] || ""} ${fields[31] || ""}`.trim()
    };
  }).filter(Boolean);
}

async function getEastmoneyKlines(secid, limit = 260, klt = "101") {
  const id = normalizeSecid(secid);
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
    secid: id,
    code: json.data?.code,
    name: json.data?.name,
    klines: (json.data?.klines || []).map(parseKline)
  };
}

async function getTencentKlines(secid, limit = 260) {
  const id = normalizeSecid(secid);
  const sinaCode = secidToSina(id);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${sinaCode},day,,,${limit},qfq`;
  const json = await fetchJson(url);
  const block = json.data?.[sinaCode] || {};
  const rows = block.qfqday || block.day || [];
  const [, code] = id.split(".");
  return {
    secid: id,
    code,
    name: code,
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

async function getKlines(secid, limit = 260) {
  try {
    const data = await getTencentKlines(secid, limit);
    if (data.klines.length) return data;
  } catch {
    // Fall through to Eastmoney as a backup because either source may throttle.
  }
  return getEastmoneyKlines(secid, limit);
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
    if (url.pathname === "/api/batch") {
      const secids = (url.searchParams.get("secids") || defaultSymbols.join(",")).split(",").map(normalizeSecid).filter(Boolean);
      const [quotes, marketResult, ...klines] = await Promise.all([
        getQuotes(secids),
        getMarketSnapshot().catch(() => null),
        ...secids.map((id) => getKlines(id))
      ]);
      const market = marketResult || {
        sample: true,
        total: quotes.length,
        up: quotes.filter((q) => q.pct > 0).length,
        down: quotes.filter((q) => q.pct < 0).length,
        flat: quotes.filter((q) => q.pct === 0).length,
        upRatio: quotes.length ? quotes.filter((q) => q.pct > 0).length / quotes.length : 0,
        amount: quotes.reduce((sum, q) => sum + (Number(q.amount) || 0), 0),
        mainNetInflow: 0,
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
