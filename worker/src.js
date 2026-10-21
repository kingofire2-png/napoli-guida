const UPSTREAM = "https://orariotreni.eavsrl.it/teleindicatori/ws_getData_pis.php";
const ALLOWED = ["https://kingofire2-png.github.io", "https://napoli-guida.kingofire2.workers.dev", "https://napoli-guida.pages.dev", "http://127.0.0.1:8095", "http://localhost:8095"];
const PAGE = "https://orariotreni.eavsrl.it/teleindicatori/";
const CACHE_SECONDS = 30;
const PARAMS = new Map();

async function boardParams(st) {
  if (PARAMS.has(st)) return PARAMS.get(st);
  const r = await fetch(PAGE + "?stazione=" + st + "&tipo=P", { headers: { "User-Agent": "NapoliGuida-test/0.1" } });
  if (!r.ok) return null;
  const h = await r.text();
  const val = (n) => {
    const m = h.match(new RegExp('name="' + n + '"[^>]*value="([^"]*)"'));
    return m ? m[1] : "";
  };
  const p = { device: val("nomeDevice"), codLoc: val("codLoc"), touchpoint: val("touchpoint") };
  if (!p.codLoc) return null;
  PARAMS.set(st, p);
  return p;
}

const txt = (h) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

export function parseBoard(html) {
  const name = (html.match(/class="nomeLocalita"[^>]*>(.*?)<\/td>/s) || [])[1];
  const trains = [];
  for (const row of html.split(/<tr\b/).slice(1)) {
    if (!/class="numTreno"/.test(row)) continue;
    const cell = (c) => {
      const m2 = row.match(new RegExp('class="' + c + '"[^>]*>(.*?)</td>', "s"));
      return m2 ? txt(m2[1]) : "";
    };
    const info = cell("informazioni");
    const stops = [];
    const m = info.match(/Ferma a:\s*(.*)$/i);
    if (m) for (const part of m[1].split(/\),\s*/)) {
      const s = part.match(/^(.*?)\s*\((\d{1,2}:\d{2})\)?$/);
      if (s) stops.push({ name: s[1].trim(), time: s[2] });
    }
    const delay = parseInt(cell("ritardo"), 10);
    const blink = cell("blink");
    const cancelled = /soppress|cancell|annull|non effettuat|sostitutiv/i.test(info + " " + blink);
    trains.push({
      train: cell("numTreno"),
      cat: cell("categoria"),
      dest: cell("destinazione"),
      platform: cell("binario"),
      time: cell("orario"),
      delay: Number.isFinite(delay) ? delay : 0,
      note: m ? "" : info,
      blink,
      cancelled,
      stops
    });
  }
  return { station: txt(name || ""), trains };
}

const FEED = "https://www.eavsrl.it/category/infomobilita-ferrovia/feed/";
const decode = (x) => x.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&#8211;|&#8212;/g, "-").replace(/&#8217;|&#8216;/g, "'").replace(/&#8220;|&#8221;/g, '"').replace(/&amp;/g, "&").replace(/&#038;/g, "&").replace(/&nbsp;/g, " ");
const IMPORTANT = /sospes|interruz|soppress|sciopero|sostitutiv|ritard|circolazione|frana|guasto|rallent|variazioni al programma|variazione temporanea/i;
const NOISE = /impianti di risalita|ascensor|montascale|tap ?& ?go|accessibilit|benevento|cervinara/i;

export function parseFeed(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const tag = (t) => {
      const r = it.match(new RegExp("<" + t + "[^>]*>([\\s\\S]*?)</" + t + ">"));
      return r ? decode(r[1]).trim() : "";
    };
    const cats = [...it.matchAll(/<category>([\s\S]*?)<\/category>/g)].map((c) => decode(c[1]).trim());
    const title = tag("title");
    const text = tag("description").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    items.push({ title, link: tag("link"), date: tag("pubDate"), cats, summary: text.slice(0, 180), important: IMPORTANT.test(title) && !NOISE.test(title) });
  }
  return items;
}

async function notices(cors) {
  const key = new Request("https://cache.local/notices");
  let res = await caches.default.match(key);
  if (!res) {
    const up = await fetch(FEED, { headers: { "User-Agent": "NapoliGuida-test/0.1" } });
    if (!up.ok) return new Response("Upstream error", { status: 502, headers: cors });
    const body = JSON.stringify({ items: parseFeed(await up.text()).slice(0, 30), updated: new Date().toISOString() });
    res = new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" } });
    await caches.default.put(key, res.clone());
  }
  const out = new Response(res.body, res);
  Object.entries(cors).forEach(([k, v]) => out.headers.set(k, v));
  return out;
}

async function sha(x) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("napoli-guida-fb:" + x));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function feedback(req, cors, env) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" } });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });
  let b;
  try {
    b = await req.json();
  } catch (e) {
    return new Response("Bad request", { status: 400, headers: cors });
  }
  const text = String(b.text || "").trim().slice(0, 1200);
  if (text.length < 3) return new Response("Too short", { status: 400, headers: cors });
  const rl = "rl:" + await sha(req.headers.get("CF-Connecting-IP") || "x");
  if (await env.FEEDBACK.get(rl)) return new Response("Too many requests", { status: 429, headers: cors });
  await env.FEEDBACK.put(rl, "1", { expirationTtl: 60 });
  const rec = {
    ts: new Date().toISOString(),
    text,
    contact: String(b.contact || "").slice(0, 120),
    screen: String(b.screen || "").slice(0, 40),
    ctx: String(b.ctx || "").slice(0, 300),
    lang: String(b.lang || "").slice(0, 8),
    v: String(b.v || "").slice(0, 20),
    ua: (req.headers.get("User-Agent") || "").slice(0, 160)
  };
  await env.FEEDBACK.put("fb:" + Date.now() + ":" + Math.random().toString(36).slice(2, 7), JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 365 });
  return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
}

async function weather(cors) {
  const key = new Request("https://cache.local/weather");
  let res = await caches.default.match(key);
  if (!res) {
    const up = await fetch("https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=40.8518&lon=14.2681", {
      headers: { "User-Agent": "NapoliGuida/0.1 https://napoli-guida.pages.dev" }
    });
    if (!up.ok) return new Response("Upstream error", { status: 502, headers: cors });
    const j = await up.json();
    const ts = j.properties && j.properties.timeseries || [];
    const now = ts[0];
    if (!now) return new Response("No data", { status: 502, headers: cors });
    const d = now.data;
    const sym = (d.next_1_hours || d.next_6_hours || d.next_12_hours || {}).summary;
    const rain6 = d.next_6_hours && d.next_6_hours.details ? d.next_6_hours.details.precipitation_amount : null;
    const body = JSON.stringify({
      t: Math.round(d.instant.details.air_temperature),
      sym: sym ? sym.symbol_code : "",
      rain6,
      time: now.time,
      updated: new Date().toISOString(),
      source: "MET Norway"
    });
    res = new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=1800" } });
    await caches.default.put(key, res.clone());
  }
  const out = new Response(res.body, res);
  Object.entries(cors).forEach(([k, v]) => out.headers.set(k, v));
  return out;
}

async function checkBoard(st, label) {
  try {
    const bp = await boardParams(st);
    if (!bp) return { name: label, ok: false, detail: "station parameters not found" };
    const up = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "NapoliGuida-test/0.1" },
      body: new URLSearchParams({ device: bp.device, tipoLista: "P", codLoc: bp.codLoc, touchpoint: bp.touchpoint, visualizzazione: "mobile" })
    });
    if (!up.ok) return { name: label, ok: false, detail: "HTTP " + up.status };
    const b = parseBoard(await up.text());
    const good = b.trains.filter((t) => /^\d{1,2}:\d{2}$/.test(t.time) && t.dest && t.platform);
    if (!b.station) return { name: label, ok: false, detail: "no station name in the page" };
    if (!good.length) return { name: label, ok: false, detail: "no readable train rows (format changed, or no service now)" };
    return { name: label, ok: true, detail: good.length + " trains" };
  } catch (e) {
    return { name: label, ok: false, detail: String(e).slice(0, 120) };
  }
}

async function runChecks(env) {
  const checks = [await checkBoard("38", "board Leopardi"), await checkBoard("3", "board Garibaldi"), await checkBoard("62", "board Sorrento")];
  try {
    const f = await fetch(FEED, { headers: { "User-Agent": "NapoliGuida-test/0.1" } });
    const items = f.ok ? parseFeed(await f.text()) : [];
    checks.push({ name: "EAV notices feed", ok: items.length > 0 && items.every((i) => i.title && i.link), detail: items.length + " items" });
  } catch (e) {
    checks.push({ name: "EAV notices feed", ok: false, detail: String(e).slice(0, 120) });
  }
  try {
    const r = await fetch("https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=40.8518&lon=14.2681", { headers: { "User-Agent": "NapoliGuida/0.1 https://napoli-guida.pages.dev" } });
    const j = r.ok ? await r.json() : null;
    const d = j && j.properties && j.properties.timeseries && j.properties.timeseries[0];
    checks.push({ name: "weather MET Norway", ok: !!(d && typeof d.data.instant.details.air_temperature === "number"), detail: r.ok ? "ok" : "HTTP " + r.status });
  } catch (e) {
    checks.push({ name: "weather MET Norway", ok: false, detail: String(e).slice(0, 120) });
  }
  const rec = { ts: new Date().toISOString(), ok: checks.every((c) => c.ok), checks };
  await env.FEEDBACK.put("health:last", JSON.stringify(rec));
  if (!rec.ok) await env.FEEDBACK.put("health:fail:" + Date.now(), JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 30 });
  return rec;
}

async function health(url, cors, env) {
  if (url.searchParams.get("run") === "1") {
    const last2 = await env.FEEDBACK.get("health:last");
    const age = last2 ? Date.now() - Date.parse(JSON.parse(last2).ts) : Infinity;
    if (age > 5 * 60 * 1e3) return new Response(JSON.stringify(await runChecks(env)), { headers: { ...cors, "Content-Type": "application/json" } });
  }
  const last = await env.FEEDBACK.get("health:last");
  return new Response(last || JSON.stringify({ ok: null, note: "no check yet" }), { headers: { ...cors, "Content-Type": "application/json" } });
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runChecks(env));
  },
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED.includes(origin) ? origin : ALLOWED[0],
      "Vary": "Origin"
    };
    const url = new URL(req.url);
    if (url.pathname === "/notices") return notices(cors);
    if (url.pathname === "/health") return health(url, cors, env);
    if (url.pathname === "/weather") return weather(cors);
    if (url.pathname === "/feedback") return feedback(req, cors, env);
    if (url.pathname !== "/board") return new Response("Not found", { status: 404, headers: cors });
    const st = url.searchParams.get("station") || "";
    if (!/^\d{1,3}$/.test(st)) return new Response("Bad station", { status: 400, headers: cors });
    const key = new Request("https://cache.local/board/" + st);
    const cache = caches.default;
    let res = await cache.match(key);
    if (!res) {
      const bp = await boardParams(st);
      if (!bp) return new Response("Unknown station", { status: 404, headers: cors });
      const up = await fetch(UPSTREAM, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "NapoliGuida-test/0.1" },
        body: new URLSearchParams({ device: bp.device, tipoLista: "P", codLoc: bp.codLoc, touchpoint: bp.touchpoint, visualizzazione: "mobile" })
      });
      if (!up.ok) return new Response("Upstream error", { status: 502, headers: cors });
      const body = JSON.stringify({ ...parseBoard(await up.text()), updated: new Date().toISOString() });
      res = new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=" + CACHE_SECONDS } });
      await cache.put(key, res.clone());
    }
    const out = new Response(res.body, res);
    Object.entries(cors).forEach(([k, v]) => out.headers.set(k, v));
    return out;
  }
};
