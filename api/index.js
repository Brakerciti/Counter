// lis.am visitor counter — Vercel serverless function + Upstash Redis
// Upstash Redis is called via plain fetch (no SDK needed)

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// ─── Upstash Redis helpers (REST API, no npm package needed) ─────────────────
async function redisCmd(...args) {
  const res = await fetch(`${REDIS_URL}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  const json = await res.json();
  return json.result;
}

async function incr(key) { return redisCmd("INCR", key); }
async function get(key)  { return redisCmd("GET", key); }
async function lpush(key, val) { return redisCmd("LPUSH", key, val); }
async function ltrim(key, start, stop) { return redisCmd("LTRIM", key, String(start), String(stop)); }
async function lrange(key, start, stop) { return redisCmd("LRANGE", key, String(start), String(stop)); }

// ─── Bot detection ────────────────────────────────────────────────────────────
const BOT_PATTERNS = [
  /bot/i, /crawl/i, /spider/i, /slurp/i, /curl/i, /wget/i,
  /python-requests/i, /go-http-client/i, /java\//i, /httpclient/i,
  /axios/i, /node-fetch/i, /lighthouse/i, /headless/i, /phantomjs/i,
  /selenium/i, /puppeteer/i, /playwright/i, /scrapy/i, /libwww/i,
  /facebookexternalhit/i, /twitterbot/i, /linkedinbot/i, /whatsapp/i,
  /googlebot/i, /bingbot/i, /yandexbot/i, /baiduspider/i, /duckduckbot/i,
  /applebot/i, /semrushbot/i, /ahrefsbot/i, /mj12bot/i, /dotbot/i,
];

function detectBot(req) {
  const ua = (req.headers["user-agent"] || "").trim();
  if (!ua) return { isBot: true, reason: "no user-agent" };
  if (BOT_PATTERNS.some((p) => p.test(ua))) return { isBot: true, reason: "ua-match" };
  const accept = req.headers["accept"] || "";
  if (!accept.includes("text/html") && !accept.includes("*/*"))
    return { isBot: true, reason: "no-html-accept" };
  return { isBot: false };
}

// ─── HTML pages ───────────────────────────────────────────────────────────────
function landingHtml(humans) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>lis.am</title>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #080808;
      color: #e8e8e8;
      font-family: 'Courier New', monospace;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2.5rem;
    }
    .domain {
      font-size: clamp(2rem, 8vw, 3.5rem);
      font-weight: 700;
      letter-spacing: 0.08em;
      color: #fff;
    }
    .box {
      border: 1px solid #252525;
      padding: 2.5rem 3.5rem;
      text-align: center;
      background: #0f0f0f;
    }
    .label {
      font-size: 0.7rem;
      color: #555;
      letter-spacing: 0.25em;
      text-transform: uppercase;
      margin-bottom: 0.75rem;
    }
    .count {
      font-size: clamp(3rem, 10vw, 5rem);
      font-weight: 700;
      color: #00ff88;
      line-height: 1;
    }
    .note { font-size: 0.75rem; color: #333; margin-top: 1.25rem; }
    .dash { font-size: 0.65rem; color: #252525; text-decoration: none; margin-top: 3rem; }
    .dash:hover { color: #444; }
    /* Honeypot — invisible to humans, crawlers follow it */
    .hp { display: none !important; visibility: hidden !important; position: absolute; left: -9999px; }
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
  <a href="/dashboard" class="dash">→ stats</a>
</body>
</html>`;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const path = req.url.split("?")[0];

  // Honeypot — bots that follow hidden links
  if (path === "/trap") {
    await incr("bots");
    res.setHeader("Content-Type", "text/plain");
    res.status(200).end("nothing here");
    return;
  }

  // Stats dashboard
  if (path === "/dashboard") {
    const [humans, bots] = await Promise.all([get("humans"), get("bots")]);
    const rawLog = await lrange("log", 0, 29);
    const log = rawLog.map((e) => {
      try { return JSON.parse(e); } catch { return null; }
    }).filter(Boolean);

    const h = Number(humans || 0);
    const b = Number(bots || 0);
    const total = h + b;
    const botPct = total ? Math.round((b / total) * 100) : 0;

    const rows = log.map((e) => `
      <tr>
        <td>${new Date(e.t).toISOString().replace("T"," ").slice(0,19)}</td>
        <td style="color:${e.k==="human"?"#00ff88":"#ff4444"}">${e.k}</td>
        <td class="ua">${(e.ua||"(none)").slice(0,120)}</td>
      </tr>`).join("") || '<tr><td colspan="3" style="color:#333;padding:1rem">no visits yet</td></tr>';

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>lis.am · stats</title>
  <style>
    *, *::before, *::after { margin:0;padding:0;box-sizing:border-box; }
    body { background:#080808;color:#e8e8e8;font-family:'Courier New',monospace;padding:2rem; }
    h1 { font-size:1rem;color:#fff;margin-bottom:2rem;letter-spacing:0.1em; }
    .stats { display:flex;gap:1.5rem;margin-bottom:2rem;flex-wrap:wrap; }
    .stat { border:1px solid #1a1a1a;padding:1rem 1.5rem;background:#0f0f0f;min-width:130px; }
    .sl { font-size:0.65rem;color:#444;text-transform:uppercase;letter-spacing:0.2em;margin-bottom:0.35rem; }
    .sv { font-size:1.8rem;font-weight:700; }
    .h{color:#00ff88} .b{color:#ff4444} .t{color:#888}
    table { width:100%;border-collapse:collapse;font-size:0.75rem; }
    th { text-align:left;padding:0.5rem;color:#444;font-size:0.65rem;border-bottom:1px solid #1a1a1a;letter-spacing:0.1em; }
    td { padding:0.4rem 0.5rem;border-bottom:1px solid #111;vertical-align:top; }
    .ua { color:#333;max-width:350px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .back { display:inline-block;margin-bottom:1.5rem;color:#333;text-decoration:none;font-size:0.75rem; }
    .back:hover{color:#666}
  </style>
</head>
<body>
  <a href="/" class="back">← back</a>
  <h1>LIS.AM · VISITOR STATS</h1>
  <div class="stats">
    <div class="stat"><div class="sl">humans</div><div class="sv h">${h.toLocaleString()}</div></div>
    <div class="stat"><div class="sl">bots</div><div class="sv b">${b.toLocaleString()}</div></div>
    <div class="stat"><div class="sl">bot rate</div><div class="sv t">${botPct}%</div></div>
    <div class="stat"><div class="sl">total hits</div><div class="sv t">${total.toLocaleString()}</div></div>
  </div>
  <table>
    <thead><tr><th>TIME (UTC)</th><th>TYPE</th><th>USER-AGENT</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`);
    return;
  }

  // Root — count and serve landing page
  if (path === "/" || path === "") {
    const { isBot, reason } = detectBot(req);
    const key = isBot ? "bots" : "humans";

    const [, humans] = await Promise.all([
      incr(key),
      isBot ? get("humans") : incr("humans").then(() => get("humans")),
    ]);

    // Log the visit (keep last 200)
    const entry = JSON.stringify({
      t: Date.now(),
      k: isBot ? "bot" : "human",
      ua: (req.headers["user-agent"] || "").slice(0, 150),
      r: reason || null,
    });
    await lpush("log", entry);
    await ltrim("log", 0, 199);

    // Get fresh human count for display
    const humanCount = await get("humans");

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).end(landingHtml(humanCount));
    return;
  }

  res.status(404).end("not found");
}
