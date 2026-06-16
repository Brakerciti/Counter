// lis.am visitor counter — Vercel serverless function + Upstash Redis

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const DASH_KEY    = process.env.DASHBOARD_KEY || "changeme";

// ─── Upstash Redis helpers ────────────────────────────────────────────────────
async function redisCmd(...args) {
  const res = await fetch(`${REDIS_URL}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  const json = await res.json();
  return json.result;
}
const incr   = (k)         => redisCmd("INCR", k);
const get    = (k)         => redisCmd("GET", k);
const lpush  = (k, v)      => redisCmd("LPUSH", k, v);
const ltrim  = (k, s, e)   => redisCmd("LTRIM", k, String(s), String(e));
const lrange = (k, s, e)   => redisCmd("LRANGE", k, String(s), String(e));

// ─── Bot detection ────────────────────────────────────────────────────────────
const BOT_PATTERNS = [
  /bot/i, /crawl/i, /spider/i, /slurp/i, /curl/i, /wget/i,
  /python-requests/i, /go-http-client/i, /java\//i, /httpclient/i,
  /axios/i, /node-fetch/i, /lighthouse/i, /headless/i, /phantomjs/i,
  /selenium/i, /puppeteer/i, /playwright/i, /scrapy/i, /libwww/i,
  /facebookexternalhit/i, /twitterbot/i, /linkedinbot/i, /whatsapp/i,
  /googlebot/i, /bingbot/i, /yandexbot/i, /baiduspider/i, /duckduckbot/i,
  /applebot/i, /semrushbot/i, /ahrefsbot/i, /mj12bot/i, /dotbot/i,
  /censys/i, /shodan/i, /masscan/i, /zgrab/i, /nmap/i, /nuclei/i,
  /dataforseo/i, /petalbot/i, /bytespider/i, /amazonbot/i,
];

function detectBot(req) {
  const ua = (req.headers["user-agent"] || "").trim();
  if (!ua)                                          return { isBot: true, reason: "no-ua" };
  if (BOT_PATTERNS.some((p) => p.test(ua)))         return { isBot: true, reason: "ua-match" };
  const accept = req.headers["accept"] || "";
  if (!accept.includes("text/html") && !accept.includes("*/*"))
                                                    return { isBot: true, reason: "no-html-accept" };
  return { isBot: false, reason: null };
}

// ─── Device / OS / browser parsing (no library) ──────────────────────────────
function parseUA(ua = "") {
  // Device type
  let device = "Desktop";
  if (/mobile/i.test(ua))  device = "Mobile";
  else if (/tablet|ipad/i.test(ua)) device = "Tablet";

  // OS
  let os = "Unknown OS";
  if      (/windows nt 10/i.test(ua))  os = "Windows 10/11";
  else if (/windows nt 6\.3/i.test(ua)) os = "Windows 8.1";
  else if (/windows/i.test(ua))         os = "Windows";
  else if (/android (\d+)/i.test(ua))   os = `Android ${ua.match(/android (\d+)/i)[1]}`;
  else if (/iphone os ([\d_]+)/i.test(ua)) os = `iOS ${ua.match(/iphone os ([\d_]+)/i)[1].replace(/_/g,".")}`;
  else if (/ipad.*os ([\d_]+)/i.test(ua))  os = `iPadOS ${ua.match(/os ([\d_]+)/i)[1].replace(/_/g,".")}`;
  else if (/mac os x ([\d_]+)/i.test(ua))  os = `macOS ${ua.match(/mac os x ([\d_]+)/i)[1].replace(/_/g,".")}`;
  else if (/linux/i.test(ua))           os = "Linux";
  else if (/cros/i.test(ua))            os = "ChromeOS";

  // Browser
  let browser = "Unknown";
  if      (/edg\//i.test(ua))           browser = "Edge";
  else if (/opr\//i.test(ua))           browser = "Opera";
  else if (/brave/i.test(ua))           browser = "Brave";
  else if (/chrome\/([\d]+)/i.test(ua)) browser = `Chrome ${ua.match(/chrome\/([\d]+)/i)[1]}`;
  else if (/firefox\/([\d]+)/i.test(ua))browser = `Firefox ${ua.match(/firefox\/([\d]+)/i)[1]}`;
  else if (/safari\/([\d]+)/i.test(ua) && !/chrome/i.test(ua)) browser = "Safari";

  return { device, os, browser };
}

// ─── Get real IP (Vercel passes it via headers) ───────────────────────────────
function getIP(req) {
  return (
    req.headers["x-real-ip"] ||
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    "unknown"
  );
}

// ─── Landing page ─────────────────────────────────────────────────────────────
function landingHtml(humans) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>lis.am</title>
  <style>
    *, *::before, *::after { margin:0;padding:0;box-sizing:border-box; }
    body {
      background:#080808; color:#e8e8e8;
      font-family:'Courier New',monospace;
      min-height:100vh; display:flex; flex-direction:column;
      align-items:center; justify-content:center; gap:2.5rem;
    }
    .domain { font-size:clamp(2rem,8vw,3.5rem); font-weight:700; letter-spacing:0.08em; color:#fff; }
    .box { border:1px solid #252525; padding:2.5rem 3.5rem; text-align:center; background:#0f0f0f; }
    .label { font-size:0.7rem; color:#555; letter-spacing:0.25em; text-transform:uppercase; margin-bottom:0.75rem; }
    .count { font-size:clamp(3rem,10vw,5rem); font-weight:700; color:#00ff88; line-height:1; }
    .note  { font-size:0.75rem; color:#333; margin-top:1.25rem; }
    .hp { display:none !important; visibility:hidden !important; position:absolute; left:-9999px; }
  </style>
</head>
<body>
  <div class="domain">lis.am</div>
  <div class="box">
    <div class="label">humans who accidentally landed here</div>
    <div class="count">${Number(humans || 0).toLocaleString()}</div>
    <div class="note">bots don't count.</div>
  </div>
  <a href="/trap" class="hp" tabindex="-1" aria-hidden="true">sitemap</a>
</body>
</html>`;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
async function dashboardHtml() {
  const [humans, bots] = await Promise.all([get("humans"), get("bots")]);
  const rawLog = await lrange("log", 0, 49);
  const log = rawLog.map((e) => { try { return JSON.parse(e); } catch { return null; } }).filter(Boolean);

  const h = Number(humans || 0);
  const b = Number(bots || 0);
  const total = h + b;
  const botPct = total ? Math.round((b / total) * 100) : 0;

  const deviceIcon = (d) => d === "Mobile" ? "📱" : d === "Tablet" ? "⬛" : "🖥";

  const rows = log.map((e) => {
    const { device, os, browser } = parseUA(e.ua);
    const isHuman = e.k === "human";
    return `<tr>
      <td>${new Date(e.t).toISOString().replace("T"," ").slice(0,19)}</td>
      <td style="color:${isHuman ? "#00ff88":"#ff4444"}">${isHuman ? "human" : "bot"}</td>
      <td style="color:#666;font-size:0.7rem">${e.r || "—"}</td>
      <td>${e.ip || "—"}</td>
      <td>${deviceIcon(device)} ${device}</td>
      <td>${os}</td>
      <td>${browser}</td>
      <td class="ua" title="${(e.ua||"").replace(/"/g,"")}">${(e.ua||"(none)").slice(0,60)}…</td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" style="color:#333;padding:1rem">no visits yet</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>lis.am · stats</title>
  <style>
    *, *::before, *::after { margin:0;padding:0;box-sizing:border-box; }
    body { background:#080808;color:#e8e8e8;font-family:'Courier New',monospace;padding:2rem;overflow-x:auto; }
    h1 { font-size:1rem;color:#fff;margin-bottom:2rem;letter-spacing:0.1em; }
    .stats { display:flex;gap:1.5rem;margin-bottom:2rem;flex-wrap:wrap; }
    .stat { border:1px solid #1a1a1a;padding:1rem 1.5rem;background:#0f0f0f;min-width:130px; }
    .sl { font-size:0.65rem;color:#444;text-transform:uppercase;letter-spacing:0.2em;margin-bottom:0.35rem; }
    .sv { font-size:1.8rem;font-weight:700; }
    .h{color:#00ff88} .b{color:#ff4444} .t{color:#888}
    table { width:100%;border-collapse:collapse;font-size:0.72rem;min-width:900px; }
    th { text-align:left;padding:0.5rem;color:#444;font-size:0.65rem;border-bottom:1px solid #1a1a1a;letter-spacing:0.1em;white-space:nowrap; }
    td { padding:0.4rem 0.6rem;border-bottom:1px solid #111;vertical-align:top;white-space:nowrap; }
    .ua { color:#333;max-width:200px;overflow:hidden;text-overflow:ellipsis;cursor:help; }
    .back { display:inline-block;margin-bottom:1.5rem;color:#333;text-decoration:none;font-size:0.75rem; }
    .back:hover{color:#666}
    .tag { display:inline-block;background:#111;border:1px solid #222;padding:0.1rem 0.4rem;border-radius:2px;font-size:0.65rem;color:#555; }
  </style>
</head>
<body>
  <a href="/" class="back">← back</a>
  <h1>LIS.AM · VISITOR STATS <span class="tag">private</span></h1>
  <div class="stats">
    <div class="stat"><div class="sl">humans</div><div class="sv h">${h.toLocaleString()}</div></div>
    <div class="stat"><div class="sl">bots</div><div class="sv b">${b.toLocaleString()}</div></div>
    <div class="stat"><div class="sl">bot rate</div><div class="sv t">${botPct}%</div></div>
    <div class="stat"><div class="sl">total hits</div><div class="sv t">${total.toLocaleString()}</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>TIME (UTC)</th>
        <th>TYPE</th>
        <th>BOT REASON</th>
        <th>IP</th>
        <th>DEVICE</th>
        <th>OS</th>
        <th>BROWSER</th>
        <th>USER-AGENT</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const parsedUrl = new URL(req.url, "https://lis.am");
  const path  = parsedUrl.pathname;
  const key   = parsedUrl.searchParams.get("key");

  // Honeypot
  if (path === "/trap") {
    await incr("bots");
    res.setHeader("Content-Type", "text/plain");
    return res.status(200).end("nothing here");
  }

  // Dashboard — password protected
  if (path === "/dashboard") {
    if (key !== DASH_KEY) {
      res.setHeader("Content-Type", "text/plain");
      return res.status(401).end("401 — not found");  // look like a 404 to snoopers
    }
    const html = await dashboardHtml();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).end(html);
  }

  // Root — count visitor
  if (path === "/" || path === "") {
    const { isBot, reason } = detectBot(req);
    const ip = getIP(req);
    const ua = (req.headers["user-agent"] || "").slice(0, 200);

    await incr(isBot ? "bots" : "humans");

    const entry = JSON.stringify({
      t:  Date.now(),
      k:  isBot ? "bot" : "human",
      r:  reason,
      ip,
      ua,
    });
    await lpush("log", entry);
    await ltrim("log", 0, 499);

    const humanCount = await get("humans");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).end(landingHtml(humanCount));
  }

  return res.status(404).end("not found");
}