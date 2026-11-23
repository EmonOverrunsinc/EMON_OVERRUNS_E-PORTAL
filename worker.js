// 3.99.335: the website (static files of public/) + /api/push: sends a WEB PUSH alert to the phones / computers of a
// person when a notification is saved (the database calls this; see supabase/154_web_push.sql). The push has no
// content (no encryption needed): the phone shows "EMON OVERRUNS E-PORTAL · You have a new notification".
// Only the push services of the browsers are called; the VAPID key comes with the call from the database.

const PUSH_HOSTS = [/\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.notify\.windows\.com$/, /\.push\.apple\.com$/];
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0));
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

async function vapidHeader(jwk, endpoint) {
  const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "https://www.emonoverruns.online" })}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  const pub = new Uint8Array(65); pub[0] = 4; pub.set(fromB64u(jwk.x), 1); pub.set(fromB64u(jwk.y), 33);
  return `vapid t=${unsigned}.${b64u(sig)}, k=${b64u(pub)}`;
}

async function push(request) {
  let body; try { body = await request.json(); } catch (_) { return json({ error: "bad body" }, 400); }
  const jwk = body && body.jwk, list = Array.isArray(body && body.endpoints) ? body.endpoints.slice(0, 20) : [];
  if (!jwk || !jwk.d || !jwk.x || !jwk.y || !list.length) return json({ error: "nothing to send" }, 400);
  const out = [];
  for (const ep of list) {
    let host = ""; try { host = new URL(ep).hostname; } catch (_) { out.push({ ep, status: "bad" }); continue; }
    if (!PUSH_HOSTS.some((r) => r.test(host))) { out.push({ ep, status: "not a push service" }); continue; }
    try {
      const r = await fetch(ep, { method: "POST", headers: { Authorization: await vapidHeader(jwk, ep), TTL: "86400", Urgency: "high", "Content-Length": "0" } });
      out.push({ ep, status: r.status });
    } catch (e) { out.push({ ep, status: "error" }); }
  }
  return json({ sent: out });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/push") return request.method === "POST" ? push(request) : json({ ok: true });
    return env.ASSETS.fetch(request);
  }
};
