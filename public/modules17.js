/* EMON OVERRUNS E-PORTAL - 3.99.116: OUTLETS (the shops: SHOP-1, SHOP-2 …)
   Outlets (menu) lists the shops with today's sales, this month's net sales and the balance; the totals of all shops are
   on top (and on the Dashboard). A shop's profile: address, opening / closing hours, monthly rental and its due day, the
   employees assigned to it, its customer account (its stock comes as orders and invoices like a customer; every payment of
   that account is taken off the shop's money), the DAILY SALES with the cash breakdown (cash, GCash, Maya, bank, card,
   other) and a photo of the sales report, the EXPENSES (rental, supplier, bills, salary, other) and the BALANCE:
   net sales − expenses − payments, for the month and in all. The monthly statement (SOA) prints as a ledger.
   109_outlets.sql must be run first. */
(() => {
  const E = window.EO;
  const V = (window.EO_VIEWS = window.EO_VIEWS || {});
  const { sb, S, C, esc, $, $$, isAdmin, toast, fail, ic, busy, peso, num, mdy } = E;

  const PAY = [["cash", "Cash"], ["gcash", "GCash"]];
  const nonCash = (r) => Math.max(0, num(r?.total) - num(r?.cash)); // 3.99.257: GCash etc.: already out of the shop (cash out) // 3.99.117: only Cash and GCash (the server keeps the other columns at 0)
  const KIND = { daily: "Daily Operation Cost", rent: "Monthly Rental", supplier: "Supplier Payment", bills: "Bills / Utilities", salary: "Salary", other: "Other Expense", deposit: "Bank Deposit", cashout: "Cash Out" };
  const USE = ["rent", "supplier", "bills", "salary", "other", "deposit"]; // 3.99.221: paid from the cash taken out (Net Balance)
  const missing = (e) => /outlet|does not exist|schema cache|PGRST20[25]|42P01/.test(`${e?.message || ""} ${e?.code || ""}`);
  const needSql = `<div class="empty">The Outlets need the database update <b>109</b>. Run it on the updates page, then open this page again.</div>`;
  const today = () => E.isoToday();
  const monthNow = () => today().slice(0, 7);
  const monthEnd = (m) => { const [y, mo] = m.split("-").map(Number); return `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, "0")}`; };
  const canEdit = () => E.canWrite("outlets");
  const sum = (list, f) => list.reduce((s, r) => s + num(typeof f === "function" ? f(r) : r[f]), 0);
  const isoNow = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const me = () => String(S.profile?.full_name || "").toUpperCase();
  // 3.99.162: the opening / closing hours are chosen on a time wheel (HH:MM) and shown the same everywhere: 7:00 AM
  const to24 = (v) => {
    const t = String(v || "").toUpperCase().replace(/\./g, "").trim(), mm = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/.exec(t);
    if (!mm) return "";
    let h = Number(mm[1]); const mi = Number(mm[2] || 0), ap = mm[3];
    if (ap === "PM" && h < 12) h += 12; if (ap === "AM" && h === 12) h = 0;
    return h > 23 || mi > 59 ? "" : `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  };
  const hourText = (v) => { const t = to24(v); if (!t) return String(v || "").trim(); const [h, mi] = t.split(":").map(Number); return `${h % 12 || 12}:${String(mi).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
  const hoursOf = (o) => (o.opens || o.closes ? `${hourText(o.opens) || "—"} – ${hourText(o.closes) || "—"}` : "");
  const shortDay = (d) => String(mdy(d) || "").replace(/^([A-Za-z]{3})[A-Za-z]*/, "$1");
  // 3.99.177: the shop's Branch ID is made by the server (EO- and 8 random digits, 124); before that update: from its code
  const bidText = (o) => shopId(o).replace(/^EO-/, ""); // 3.99.184: the Branch ID shown without "EO-"
  const shopId = (o) => { if (o?.branch_id) return o.branch_id; const c = String(o?.code || "").toUpperCase().replace(/[^A-Z0-9]/g, ""), m = /^(.*?)(\d+)$/.exec(c); return `EO-${m ? m[1] + m[2].padStart(2, "0") : c}`; };
  E.shopId = shopId;
  // 3.99.176: the STORE LOGO of a shop (made by itself): the company logo in a blue & gold ring with the branch code on top and
  // the branch (the last words of the address) at the bottom
  // the branch: the place words of the address ("NOVALICHES CITY QUEZON CITY" -> "NOVALICHES QUEZON CITY")
  const branchOf = (o) => {
    let w = String(o?.address || "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean)
      .filter((x) => !/^(AVE|AVENUE|ST|STREET|RD|ROAD|BLVD|NO|BLDG|BRGY)$/.test(x));
    w = w.filter((x, k) => x !== "CITY" || k === w.lastIndexOf("CITY"));
    return (w.length > 3 ? w.slice(-3) : w).join(" ") || String(o?.code || "");
  };
  let logoN = 0;
  function storeLogo(o, cls = "") {
    const k = `sl${++logoN}`, top = "EMON OVERRUNS RETAIL STORE", bot = [String(o.code || "").toUpperCase(), bidText(o)].filter(Boolean).join(" · "); // 3.99.235 · 3.99.328: code + branch code only (fits at every size)
    const fit = (t, max) => Math.min(t.length * 5.1, max).toFixed(1);
    return `<span class="store-logo ${cls}" aria-label="${esc(top)} · ${esc(bot)}"><svg viewBox="0 0 120 120" aria-hidden="true">
      <defs><path id="${k}t" d="M18.7 75 A44 44 0 1 1 101.3 75"/><path id="${k}b" d="M11.7 68.5 A49 49 0 0 0 108.3 68.5"/></defs>
      <circle cx="60" cy="60" r="58" class="sl-out"/><circle cx="60" cy="60" r="56" class="sl-gold"/><circle cx="60" cy="60" r="33" class="sl-in"/>
      ${[30.5, 27, 23.5, 20, 16.5].map((r, n) => `<path fill="none" id="${k}m${n}" d="M${60 - r} 60 a${r} ${r} 0 1 1 ${2 * r} 0 a${r} ${r} 0 1 1 ${-2 * r} 0"/><text class="sl-micro"><textPath href="#${k}m${n}" textLength="${(2 * Math.PI * r - 1).toFixed(1)}" lengthAdjust="spacingAndGlyphs">${esc(`${String(o.code || "").toUpperCase()} · EMON OVERRUNS · ${bidText(o)} · `.repeat(4))}</textPath></text>`).join("")}
      <text class="sl-t"><textPath href="#${k}t" startOffset="50%" text-anchor="middle" textLength="${fit(top, 160)}" lengthAdjust="spacingAndGlyphs">${esc(top)}</textPath></text>
      <text class="sl-b"><textPath href="#${k}b" startOffset="50%" text-anchor="middle" textLength="${fit(bot, 118)}" lengthAdjust="spacingAndGlyphs">${esc(bot)}</textPath></text></svg><img class="sl-img" src="brand/logo-clear.png" alt=""></span>`;
  }
  E.storeLogo = storeLogo;
  // 3.99.227: THE SHOP ON GOOGLE MAPS: the exact place from the pasted link (or the address); "Open in Google Maps"
  const mapQuery = (o) => {
    const u = String(o.map_url || "");
    const at = u.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/) || u.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/) || u.match(/[?&](?:q|query|ll)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/);
    return at ? `${at[1]},${at[2]}` : String(o.address || "").trim();
  };
  const mapBox = (o) => {
    const q = mapQuery(o); if (!q) return "";
    const open = o.map_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
    return `<section class="os-map"><div class="os-daily-h"><b>${ic("pin")} Location</b><a class="btn small" href="${esc(open)}" target="_blank" rel="noopener">${ic("globe")} Open in Google Maps</a></div>
      <div class="os-map-frame"><iframe title="Map of ${esc(o.code)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=16&output=embed"></iframe></div>
      ${o.address ? `<small class="os-map-ad">${esc(o.address)}</small>` : ""}</section>`;
  };
  // 3.99.223: the round seal on a shop card: rings of microtext (company, shop, branch ID, branch) and the shop's own logo
  let sealN = 0;
  const cardSeal = (o) => {
    const k = `cs${++sealN}`, idNo = bidText(o);
    const ring = (r, txt, n) => `<path id="${k}r${r}" d="M150 ${150 - r} a${r} ${r} 0 1 1 -0.01 0"/><text><textPath href="#${k}r${r}" textLength="${(2 * Math.PI * r).toFixed(1)}" lengthAdjust="spacing">${esc(Array.from({ length: n }, () => txt).join(" · "))}</textPath></text>`;
    const line = (cls) => `<span class="ol-top-micro ${cls}">${Array.from({ length: 10 }, () => `<i>EMON OVERRUNS</i><i>${esc(idNo)}</i><i>${esc(o.code)}</i>`).join("")}</span>`;
    return `${line("t")}${line("b")}<span class="ol-card-seal" aria-hidden="true"><svg viewBox="0 0 300 300"><g fill="none">${ring(142, `EMON OVERRUNS · ${o.code} · ${o.name || ""}`, 3)}${ring(121, `${idNo} · ${o.code} · EMON OVERRUNS`, 3)}${ring(100, `${branchOf(o)} BRANCH · ${o.code}`, 3)}${ring(80, `${idNo} · EMON OVERRUNS · ${o.code}`, 2)}${ring(61, `${o.code} · ${idNo}`, 2)}${ring(43, `EMON OVERRUNS`, 2)}</g>
      <text class="seal-no" x="150" y="148" text-anchor="middle">${esc(idNo)}</text><text class="seal-sub" x="150" y="164" text-anchor="middle">${esc(o.code)}</text></svg></span>`;
  };
  // the next branch code: SHOP-1, SHOP-2, SHOP-3 … (the highest number + 1)
  const nextCode = (list) => `SHOP-${Math.max(0, ...list.map((x) => Number((/(\d+)$/.exec(String(x.code || "")) || [])[1] || 0))) + 1}`;
  const empName = (e) => [e?.first_name, e?.middle_name, e?.last_name].filter(Boolean).join(" ").toUpperCase();
  const empty = (t) => `<div class="ol-empty">${t}</div>`; // 3.99.153: for every part of the page (the employee list too)
  // the rental of a month: paid (a rental expense in the month) or its due date
  // 3.99.193: the rent is PAID only when the month's rent payments reach the monthly rent; until then: the amount still unpaid
  const phpAmt = (v) => peso(v); // 3.99.217: PHP 10,000.00
  const MON3 = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const dDay = (iso) => { const v = String(iso || "").slice(0, 10).split("-"); return v.length === 3 ? `${MON3[Number(v[1]) - 1] || ""}-${v[2]}-${v[0]}` : ""; }; // NOV-11-2026
  // 3.99.221: the rent tag: PAID NOV-11-2026 · UNPAID PHP 10,000.00 · DUE NOV-25-2026 PHP 70,000.00 · OVERDUE NOV-10-2026 PHP 70,000.00
  const rentPill = (rs) => rs.k === "paid" ? `<span class="pill ol-rent paid"><small>PAID</small><b>${dDay(rs.last)}</b></span>`
    : rs.k === "overdue" ? `<span class="pill ol-rent overdue"><small>OVERDUE · ${dDay(rs.due)}</small><b>PHP ${peso(rs.left)}</b></span>`
    : rs.k === "unpaid" ? `<span class="pill ol-rent ${rs.paidAmt > 0 ? "pending" : "due"}"><small>${rs.paidAmt > 0 ? "UNPAID" : `DUE · ${dDay(rs.due)}`}</small><b>PHP ${peso(rs.left)}</b></span>` : "";
  const rentLine = (rs) => rs.k === "paid" ? `PAID ${dDay(rs.last)}` : rs.k === "overdue" ? `OVERDUE PHP ${peso(rs.left)} · ${dDay(rs.due)}`
    : rs.k === "unpaid" ? (rs.paidAmt > 0 ? `UNPAID PHP ${peso(rs.left)}` : `DUE PHP ${peso(rs.left)} · ${dDay(rs.due)}`) : "";
  const rentState = (o, exps, m) => {
    const rents = exps.filter((x) => x.kind === "rent"), paidAmt = rents.reduce((s, x) => s + num(x.amount), 0), rent = num(o.monthly_rent);
    const last = rents.map((x) => x.exp_date).sort().pop();
    if (rents.length && (!rent || paidAmt >= rent - 0.005)) return { k: "paid", label: `PAID ${mdy(last)}`, short: "RENT PAID", left: 0, last, paidAmt, rent };
    if (!rent) return { k: "none", label: "NO RENTAL", short: "", left: 0 };
    const day = Math.min(Number(o.rent_day) || 1, Number(monthEnd(m).slice(8)));
    const due = `${m}-${String(day).padStart(2, "0")}`, left = rent - paidAmt, part = rents.length > 0;
    return due < today() ? { k: "overdue", label: `DUE ${mdy(due)} · OVERDUE`, short: part ? "RENT PARTLY PAID" : "RENT OVERDUE", left, paidAmt, rent, due }
      : { k: "unpaid", label: `DUE ${mdy(due)}`, short: part ? "RENT PARTLY PAID" : "RENT NOT PAID", left, paidAmt, rent, due };
  };
  // 3.99.193: THE STORE NOW (Manila time): open, lunch break (1 to 2 PM) or closed, and how long until the next change
  const minOf = (t) => { const v = to24(t); if (!v) return null; const [h, mi] = v.split(":").map(Number); return h * 60 + mi; };
  const dur = (m) => { m = Math.max(0, Math.round(m)); const h = Math.floor(m / 60), mi = m % 60; return h ? `${h} Hr${mi ? ` ${mi} Min` : ""}` : `${mi} Min`; };
  const storeNow = (o) => {
    if (o._closed) return { k: "closed", word: "CLOSED", t: "Non-working day · opens tomorrow", sales: "" };
    const op = minOf(o._today?.opens || o.opens), cl = minOf(o._today?.closes || o.closes); // 3.99.204: today's hours first
    if (op == null || cl == null || cl <= op) return null;
    const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" })), now = d.getHours() * 60 + d.getMinutes();
    const ls = 13 * 60, le = 14 * 60, lunch = op < ls && cl > le, sales = cl - op - (lunch ? 60 : 0);
    let k, t;
    if (now < op) [k, t] = ["closed", `Opens in ${dur(op - now)}`];
    else if (lunch && now < ls) [k, t] = ["open", `Lunch in ${dur(ls - now)}`];
    else if (lunch && now < le) [k, t] = ["lunch", `Back in ${dur(le - now)}`];
    else if (now < cl) [k, t] = ["open", `Closes in ${dur(cl - now)}`];
    else [k, t] = ["closed", `Opens in ${dur((minOf(o.opens) ?? op) + 1440 - now)}`]; // tomorrow: the normal opening
    return { k, word: { open: "OPEN", lunch: "LUNCH BREAK", closed: "CLOSED" }[k], t, sales: dur(sales) };
  };
  const todayText = (o) => `${hourText(o._today?.opens || o.opens) || "—"} – ${hourText(o._today?.closes || o.closes) || "—"}`;
  const cardLive = (o) => { const s = storeNow(o); return s ? `<i></i><b>${s.word}</b> ${esc(s.t)}` : ""; };
  const liveHtml = (o) => { const s = storeNow(o); return s ? `<i></i><b>${s.word}</b>` : ""; };
  const liveNext = (o) => { const s = storeNow(o); return s ? esc(s.t) : ""; }; // 3.99.205: one line (the sales hours in the tip)

  // the money of the shops for a month (and today): sales, expenses, payments of their customer accounts
  async function monthMoney(outlets, m) {
    const ids = outlets.map((o) => o.id), custs = outlets.map((o) => o.customer_id).filter(Boolean);
    if (!ids.length) return { sales: [], exps: [], pays: [] };
    const [s, x, p] = await Promise.all([
      E.allRows(() => sb.from("outlet_sales").select("outlet_id, sale_date, total, cash").in("outlet_id", ids).gte("sale_date", `${m}-01`).lte("sale_date", monthEnd(m))),
      E.allRows(() => sb.from("outlet_expenses").select("outlet_id, exp_date, kind, amount").in("outlet_id", ids).gte("exp_date", `${m}-01`).lte("exp_date", monthEnd(m))),
      custs.length ? E.allRows(() => sb.from("payments_received").select("customer_id, paid_date, amount").in("customer_id", custs).gte("paid_date", `${m}-01`).lte("paid_date", monthEnd(m))) : { data: [] }]);
    if (s.error || x.error || p.error) throw s.error || x.error || p.error;
    return { sales: s.data || [], exps: x.data || [], pays: p.data || [] };
  }
  function monthTotals(sales, exps, pays) {
    const net = sum(sales, "total"), paid = sum(pays, "amount");
    const operation = sum(exps.filter((r) => r.kind === "daily"), "amount");
    const otherCosts = sum(exps.filter((r) => USE.includes(r.kind)), "amount");
    const withdrawals = sum(exps.filter((r) => r.kind === "cashout"), "amount");
    const cash = withdrawals + sales.reduce((total, sale) => total + nonCash(sale), 0);
    return { net, paid, cash, op: operation, out: sum(exps, "amount") - withdrawals,
      drawer: net - operation - cash, pool: cash - otherCosts - paid, used: otherCosts + paid };
  }
  const shopMoney = (o, money) => {
    const sales = money.sales.filter((r) => r.outlet_id === o.id);
    const exps = money.exps.filter((r) => r.outlet_id === o.id);
    const pays = o.customer_id ? money.pays.filter((r) => r.customer_id === o.customer_id && r.paid_date >= String(o.created_at).slice(0, 10)) : [];
    return { ...monthTotals(sales, exps, pays), exps, hasActivity: Boolean(sales.length || exps.length || pays.length),
      today: sum(sales.filter((r) => r.sale_date === today()), "total"),
      todayOut: sum(exps.filter((r) => r.exp_date === today() && r.kind === "daily"), "amount") };
  };

  async function statementMonths(outlet, mine) {
    const id = outlet.id;
    const visible = (query) => mine ? query.eq("created_by", E.meId()) : query;
    const results = await Promise.all([
      E.allRows(() => visible(sb.from("outlet_sales").select("sale_date").eq("outlet_id", id)).order("sale_date")),
      E.allRows(() => visible(sb.from("outlet_expenses").select("exp_date").eq("outlet_id", id)).order("exp_date").order("id")),
      !mine && outlet.customer_id ? E.allRows(() => sb.from("payments_received").select("paid_date").eq("customer_id", outlet.customer_id)
        .gte("paid_date", String(outlet.created_at).slice(0, 10)).order("paid_date").order("id")) : { data: [] }
    ]);
    if (results.some((result) => result.error)) return null;
    return [...new Set(results.flatMap(({ data }) => data.map((row) => (row.sale_date || row.exp_date || row.paid_date).slice(0, 7))))].sort().reverse();
  }

  // ---------- the Dashboard box: all the shops ----------
  E.outletsBox = async (holder) => {
    const gone = () => holder?.closest(".box")?.remove();
    if (!holder || !E.hasModule("outlets") || (S.hideMoney && !isAdmin())) return gone(); // 3.99.175: no money: no box
    const { data: outlets, error } = await sb.from("outlets").select("*").eq("status", "active").order("code");
    if (error || !outlets?.length) return gone();
    let mm; try { mm = await monthMoney(outlets, monthNow()); } catch (_) { return gone(); }
    const rows = outlets.map((o) => ({ o, ...shopMoney(o, mm) }));
    const T = (f) => rows.reduce((s, r) => s + f(r), 0);
    holder.innerHTML = `<div class="ol-dash">
      <div class="ol-kpis k4">${kpi("Today's Net Sales", T((r) => r.today))}${kpi("Today's Expenses", T((r) => r.todayOut))}${kpi("Today's Net", T((r) => r.today - r.todayOut))}${kpi("Net Balance", T((r) => r.pool), "bal")}</div>
      ${rows.map((r) => `<a class="ol-row" href="#outlet/${esc(r.o.id)}"><b>${esc(r.o.code)}<span class="ol-rk" data-oid="${esc(r.o.id)}"></span></b><span>${esc(r.o.name !== r.o.code ? r.o.name : r.o.address || "")}</span><em>₱ ${peso(r.today)}</em><small class="${r.pool < 0 ? "neg" : ""}">Net Balance ₱ ${peso(r.pool)}</small></a>`).join("")}</div>`;
    rankCards(holder, monthNow());
  };
  // 3.99.178: the month's rank (Top 10 by net sales) on each shop
  const rankCards = (holder) => (E.outletWeekRanks || E.outletRanks)(monthNow()).then((rk) => holder?.querySelectorAll(".ol-rk").forEach((el) => {
    const r = rk.get(el.dataset.oid);
    if (r) el.innerHTML = E.rankTag(r.rank); // 3.99.201: #1, #2 (not a round number)
  }));
  const kpi = (k, v, cls = "") => `<div class="ol-kpi ${cls}${num(v) < 0 ? " neg" : ""}"><small>${esc(k)}</small><b>₱ ${peso(v)}</b></div>`;

  // ---------- Outlets: the list of the shops ----------
  V.outlets = async () => {
    E.shell("outlets", "Retail Outlets", `<div id="olBody">${busy()}</div>`);
    const here = E.stillHere();
    const { data: outlets, error } = await sb.from("outlets").select("*").order("code");
    if (!here()) return;
    if (error) { $("#olBody").innerHTML = missing(error) ? needSql : `<div class="empty">${esc(error.message)}</div>`; return; }
    const m = monthNow();
    let mm = { sales: [], exps: [], pays: [] };
    try { mm = await monthMoney(outlets, m); } catch (e) { console.warn(e); }
    if (!here()) return;
    const rows = outlets.map((o) => ({ o, ...shopMoney(o, mm) }));
    const act = rows.filter((r) => r.o.status === "active");
    $("#olBody").innerHTML = `
      <div class="ol-kpis">${kpi("Today's Net Sales", act.reduce((s, r) => s + r.today, 0))}${kpi("Today's Expenses", act.reduce((s, r) => s + r.todayOut, 0))}${kpi("Today's Net", act.reduce((s, r) => s + r.today - r.todayOut, 0))}
        ${kpi(`Net Sales · ${E.monthText(m)}`, act.reduce((s, r) => s + r.net, 0))}${kpi("Cash Out", act.reduce((s, r) => s + r.cash, 0))}${kpi("Net Balance", act.reduce((s, r) => s + r.pool, 0), "bal")}</div>
      ${isAdmin() ? `<div class="pg-more"><button type="button" class="pg-more-btn" id="olMore" aria-label="More" aria-haspopup="true">⋯</button><div class="pg-more-list" id="olMoreList" hidden><button type="button" id="olNew">${ic("plus")} Add Store</button></div></div>` : ""}
      <div class="ol-cards">${rows.length ? rows.map((r) => {
        const rs = rentState(r.o, r.exps, m);
        return `<a class="ol-card${r.o.status === "closed" ? " closed" : ""}" href="#outlet/${esc(r.o.id)}"><div class="ol-card-micro" aria-hidden="true">${Array.from({ length: 6 }, () => `<span>EMON OVERRUNS</span><span>${esc(bidText(r.o))}</span><span>${esc(r.o.code)}</span>`).join("")}</div>
          <div class="ol-card-top">${cardSeal(r.o)}<div class="ol-card-h">${storeLogo(r.o)}<div><div class="ol-code-row"><b class="ol-code">${esc(r.o.code)}</b><span class="ol-rk" data-oid="${esc(r.o.id)}"></span></div><small class="ol-bid">${esc(bidText(r.o))}</small><span>${esc(r.o.name !== r.o.code ? r.o.name : "")}</span></div></div>
          <div class="ol-card-s">${r.o.status === "closed" ? E.pill("closed", "CLOSED") : rentPill(rs)}</div>
          ${r.o.address ? `<div class="ol-card-a">${ic("pin")} ${esc(r.o.address)}</div>` : ""}
          ${hoursOf(r.o) ? `<div class="ol-card-t">${ic("clock")}<span class="ol-hours" data-oid="${esc(r.o.id)}">${esc(hoursOf(r.o))}</span>${r.o.status !== "closed" && storeNow(r.o) ? `<span class="ol-live st-${storeNow(r.o).k}" data-oid="${esc(r.o.id)}">${cardLive(r.o)}</span>` : ""}</div>` : ""}
          </div>
          <div class="ol-card-n"${r.hasActivity ? "" : " hidden"}><div><small>Today</small><b>₱ ${peso(r.today)}</b></div><div><small>Net Sales</small><b>₱ ${peso(r.net)}</b></div><div><small>Expenses</small><b>₱ ${peso(r.op)}</b></div>
            <div><small>Cash Out</small><b>₱ ${peso(r.cash)}</b></div><div><small>Cash Left</small><b>₱ ${peso(r.drawer)}</b></div><div class="bal${r.pool < 0 ? " neg" : ""}"><small>Net Balance</small><b>₱ ${peso(r.pool)}</b></div></div></a>`;
      }).join("") : `<div class="empty">${isAdmin() ? "No store yet. Press <b>⋯</b> at the top right, then <b>Add Store</b>: it gets SHOP-1." : "No shop is assigned to you yet. EMON HASAN assigns you on the outlet's page."}</div>`}</div>`;
    rankCards($("#olBody"), m);
    sb.from("outlet_day_hours").select("*").eq("day", today()).then(({ data }) => (data || []).forEach((h) => { // 3.99.204: today's hours
      const o = outlets.find((x) => x.id === h.outlet_id); if (!o) return;
      o._today = h;
      const hs = document.querySelector(`#olBody .ol-hours[data-oid="${h.outlet_id}"]`), lv = document.querySelector(`#olBody .ol-live[data-oid="${h.outlet_id}"]`);
      if (hs) hs.innerHTML = `Today ${esc(todayText(o))}`; // 3.99.226: no "changed" word
      const s2 = storeNow(o); if (lv && s2) { lv.className = `ol-live st-${s2.k}`; lv.innerHTML = cardLive(o); }
    }), () => {});
    // 3.99.202: the store now on each card, counting by itself (every 30 seconds while the list is open)
    const tick = setInterval(() => {
      const els = $$("#olBody .ol-live");
      if (!els.length) { clearInterval(tick); return; }
      els.forEach((el) => { const o = outlets.find((x) => x.id === el.dataset.oid), s = o && storeNow(o); if (s) { el.className = `ol-live st-${s.k}`; el.innerHTML = cardLive(o); } });
    }, 30000);
    sb.from("outlet_closures").select("outlet_id").eq("day", today()).eq("status", "approved").then(({ data }) => (data || []).forEach((c) => {
      const h = document.querySelector(`#olBody .ol-card[href="#outlet/${c.outlet_id}"] .ol-card-h`);
      if (h && !h.querySelector(".nwd-pill")) h.insertAdjacentHTML("beforeend", `<span class="nwd-pill">${E.pill("overdue", "CLOSED TODAY")}</span>`);
      const o = outlets.find((x) => x.id === c.outlet_id), lv = document.querySelector(`#olBody .ol-live[data-oid="${c.outlet_id}"]`);
      if (o) o._closed = true;
      if (o && lv) { lv.className = "ol-live st-closed"; lv.innerHTML = cardLive(o); }
    }), () => {});
    if ($("#olMore")) {
      const list = $("#olMoreList"), close = () => { list.hidden = true; document.removeEventListener("click", away, true); };
      const away = (e) => { if (!e.target.closest(".pg-more")) close(); };
      $("#olMore").onclick = () => { list.hidden = !list.hidden; if (!list.hidden) document.addEventListener("click", away, true); };
      $("#olNew").onclick = () => { close(); editOutlet(null, outlets.length, nextCode(outlets)); };
    }
    E.setRecords(`Outlets: ${outlets.length}`);
  };

  // ---------- add or change a shop ----------
  async function editOutlet(o, count = 0, code = "") {
    const preset = o?.customer_id ? await E.getCustomer(o.customer_id).catch(() => null) : null;
    const v = (k, d = "") => esc(o?.[k] ?? d);
    const m = E.modal(o ? `${o.code} · Edit Shop Details` : `Add Store · ${code || `SHOP-${count + 1}`}`, `<div class="formgrid ol-form shop-details-form">
        ${o?.branch_id ? `<div class="span2"><label>Branch ID</label><input value="${esc(String(o.branch_id).replace(/^EO-/, ""))}" readonly class="ro" title="Made by the system, never changed"></div>` : ""}
        <div><label for="olCode">Branch Code</label><input id="olCode" maxlength="30" value="${esc(o ? o.code : code || `SHOP-${count + 1}`)}" readonly class="ro" title="Given by the system"></div>
        <div><label for="olName">Store Name *</label><input id="olName" maxlength="120" value="${v("name", "RETAIL OUTLET")}" required></div>
        <div class="span2"><label for="olAddr">Address</label><input id="olAddr" maxlength="300" value="${v("address")}"></div>
        <div class="span2"><label for="olMap">Google Maps Location <button type="button" class="linkbtn" id="olMapTry">Check on Google Maps</button></label><input id="olMap" maxlength="1000" data-case="keep" placeholder="Paste the Google Maps link of the shop" value="${v("map_url")}"></div>
        <div><label for="olOpen">Opens at</label><input id="olOpen" type="time" step="300" value="${esc(to24(o?.opens) || (o ? "" : "09:00"))}"></div>
        <div><label for="olClose">Closes at</label><input id="olClose" type="time" step="300" value="${esc(to24(o?.closes) || (o ? "" : "21:00"))}"></div>
        <div><label for="olRent">Monthly Rental (₱)</label><input id="olRent" type="number" min="0" step="0.01" value="${v("monthly_rent", "0")}"></div>
        <div><label for="olDay">Rent due day (1–31)</label><input id="olDay" type="number" min="1" max="31" value="${v("rent_day")}"></div>
        <div class="span2"><label>Customer Account (the shop's stock: orders, invoices, payments)</label><div id="olCust"></div></div>
        <div class="span2"><label for="olNote">Notes</label><textarea id="olNote" rows="2" maxlength="1000">${v("notes")}</textarea></div>
        ${o ? "" : `<div class="span2"><label for="olLease">Contract of Lease (photos of its pages or a PDF; the pages are saved as one document)</label><input id="olLease" type="file" accept="image/*,application/pdf" multiple></div>`}
        ${o ? `<div><label for="olSt">Status</label><select id="olSt"><option value="active"${o.status === "active" ? " selected" : ""}>Open</option><option value="closed"${o.status === "closed" ? " selected" : ""}>Closed</option></select></div>` : ""}
      </div>`, `<button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" id="olSave">${ic("check")} Save</button>`, { wide: true });
    let cust = o?.customer_id || null;
    E.customerPicker($("#olCust", m.el), { statuses: ["active", "suspended"], preset: preset || undefined, onPick: (c) => (cust = c?.id || null) });
    $("[data-x]", m.el).onclick = () => m.close();
    if ($("#olMapTry", m.el)) $("#olMapTry", m.el).onclick = () => { const u = $("#olMap", m.el).value.trim(), ad = $("#olAddr", m.el).value.trim(); window.open(u || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ad || "")}`, "_blank", "noopener"); };
    $("#olSave", m.el).onclick = async (e) => {
      const row = { code: $("#olCode", m.el).value.trim().toUpperCase(), name: $("#olName", m.el).value.trim().toUpperCase(), address: $("#olAddr", m.el).value.trim().toUpperCase() || null,
        opens: hourText($("#olOpen", m.el).value) || null, closes: hourText($("#olClose", m.el).value) || null, monthly_rent: num($("#olRent", m.el).value),
        rent_day: Number($("#olDay", m.el).value) || null, customer_id: cust, notes: $("#olNote", m.el).value.trim() || null, ...(o ? { status: $("#olSt", m.el).value } : {}) };
      const mapUrl = $("#olMap", m.el)?.value.trim() || null;
      if (mapUrl && !/^https:\/\/([a-z0-9-]+\.)*(google\.[a-z.]+|goo\.gl|maps\.app\.goo\.gl)\//i.test(mapUrl)) return toast("Paste a Google Maps link (https://maps.google.com/… or https://maps.app.goo.gl/…).", true);
      if (mapUrl || o?.map_url) row.map_url = mapUrl;
      if (!row.code || !row.name) return toast("Enter a shop name.", true);
      if (!$("#olRent", m.el).reportValidity() || !$("#olDay", m.el).reportValidity()) return;
      e.target.disabled = true;
      let r = o ? await sb.from("outlets").update(row).eq("id", o.id).select().single() : await sb.from("outlets").insert(row).select().single();
      if (r.error && "map_url" in row && /map_url|schema cache|PGRST204/i.test(r.error.message || "")) { // the map needs SQL 137: the rest is saved
        delete row.map_url; toast("The map link needs the database update 137; the rest is saved.", true);
        r = o ? await sb.from("outlets").update(row).eq("id", o.id).select().single() : await sb.from("outlets").insert(row).select().single();
      }
      e.target.disabled = false;
      if (r.error) return fail(r.error, /duplicate|unique/i.test(r.error.message) ? `The code ${row.code} is already used.` : "Could not save the outlet");
      const lease = o ? [] : Array.from($("#olLease", m.el)?.files || []);
      m.close(); toast(o ? "Outlet saved." : `${row.code} added.`);
      if (lease.length) await saveLease(r.data, lease);
      location.hash = "outlet/" + r.data.id; if (o) E.route();
    };
  }

  // ---------- a shop's profile ----------
  // 3.99.224: leaving the page closes an open INFO sheet
  window.addEventListener("hashchange", () => { document.querySelectorAll("body > .os-info").forEach((x) => x.remove()); document.body.classList.remove("os-info-open"); });
  V.outlet = async (id, month) => {
    E.shell("outlets", "Retail Outlets", `<div id="olBody">${busy()}</div>`);
    const here = E.stillHere();
    const m = /^\d{4}-\d{2}$/.test(month || "") ? month : monthNow();
    const { data: o, error } = await sb.from("outlets").select("*").eq("id", id).maybeSingle();
    if (!here()) return;
    if (error || !o) { $("#olBody").innerHTML = error && missing(error) ? needSql : `<div class="empty">This outlet was not found. <a href="#outlets">Back to Outlets</a></div>`; return; }
    const first = `${m}-01`, last = monthEnd(m), start = String(o.created_at).slice(0, 10);
    const mine = !!S.hideMoney && !isAdmin();
    const [st, sales, exps, pays, invs, cust, soaMonths, clos, dayH] = await Promise.all([
      sb.from("outlet_staff").select(STAFF_SEL).eq("outlet_id", id).then((r) => r.data || []),
      sb.from("outlet_sales").select("*").eq("outlet_id", id).gte("sale_date", first).lte("sale_date", last).order("sale_date", { ascending: false }).then((r) => r.data || []),
      sb.from("outlet_expenses").select("*").eq("outlet_id", id).gte("exp_date", first).lte("exp_date", last).order("exp_date", { ascending: false }).then((r) => r.data || []),
      o.customer_id ? sb.from("payments_received").select("id, receipt_no, paid_date, amount, method").eq("customer_id", o.customer_id).gte("paid_date", first).lte("paid_date", last).order("paid_date", { ascending: false }).then((r) => r.data || []) : [],
      o.customer_id ? sb.from("invoice_balances").select("id, invoice_no, invoice_date, due_date, total_amount, balance, pay_status").eq("customer_id", o.customer_id).gt("balance", 0).order("invoice_date").then((r) => r.data || []) : [],
      o.customer_id ? sb.from("customers").select("id, first_name, middle_name, last_name, account_no, business_name").eq("id", o.customer_id).maybeSingle().then((r) => r.data) : null,
      statementMonths(o, mine),
      sb.from("outlet_closures").select("*").eq("outlet_id", id).gte("day", first < today() ? first : today()).order("day").limit(120).then((r) => (r.error ? null : r.data || []), () => null),
      sb.from("outlet_day_hours").select("*").eq("outlet_id", id).eq("day", today()).maybeSingle().then((r) => (r.error ? undefined : r.data), () => undefined)]);
    if (!here()) return;
    o._closed = (clos || []).some((c) => c.day === today() && c.status === "approved"); // 3.99.196: an approved non-working day
    o._today = dayH || null; o._dayHoursOk = dayH !== undefined; // 3.99.204: today's hours (late open / early close)
    // 3.99.175: an employee without "13 See Balances & History": only the sales and expenses he or she recorded (with their
    // amounts); no totals, balance, stock account or monthly statement
    if (mine) { const me = E.meId(); sales.splice(0, sales.length, ...sales.filter((r) => r.created_by === me)); exps.splice(0, exps.length, ...exps.filter((r) => r.created_by === me)); }
    const peso = mine ? (n) => Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : E.peso;
    const ids = [...sales.map((r) => r.id), ...exps.map((r) => r.id)];
    const docs = await E.attachmentsOf("outlet", id).catch(() => []); // 3.99.119: the shop's documents
    const files = ids.length ? ((await sb.from("attachments").select("*").in("owner_type", ["outlet_sales", "outlet_expense"]).in("owner_id", ids).order("created_at", { ascending: false })).data || []) : [];
    if (!here()) return;
    const { net, out, paid, cash, drawer, pool, op: opCost, used: usedM } = monthTotals(sales, exps, pays);
    const hasActivity = Boolean(sales.length || exps.length || pays.length);
    const owed = sum(invs, "balance"), rs = rentState(o, exps, m), edit = canEdit();
    const byPay = PAY.map(([k, l]) => [l, sum(sales, k)]).filter(([, v]) => v > 0);
    const filesOf = (oid) => files.filter((f) => f.owner_id === oid);
    const photoBtn = (oid) => { const n = filesOf(oid).length; return n ? `<button type="button" class="btn small" data-files="${esc(oid)}">${ic("image")} ${n}</button>` : ""; };
    const del = () => ""; // 3.99.262: no delete on the shop's records (the Director edits them; the paper says CORRECTED)

    // 3.99.153: the shop page in a new layout: the head, 4 boxes, the buttons, and tabs (Daily Sales · Expenses & Cash Out ·
    // Stock Account · Employees · Documents). Daily Sales is a day by day table: sales, the day's expenses, cash out, cash left.
    const tools = (tbl, r) => `<span class="ol-tools">${photoBtn(r.id)}${tbl === "outlet_sales" ? (isAdmin() ? `<button type="button" class="btn small" data-esale="${esc(r.id)}" title="Edit sales" aria-label="Edit sales">${ic("edit")}</button>` : "") : isAdmin() ? `<button type="button" class="btn small" data-eexp="${esc(r.id)}" title="${isAdmin() ? "Edit" : "Correct (one time)"}">${ic("edit")}</button>` : ""}${del(tbl, r.id)}</span>`;
    const dayOf = (d, k) => sum(exps.filter((x) => x.exp_date === d && x.kind === k), "amount");
    // 3.99.220: CASH LEFT goes on to the next day: the cash left of yesterday + today's sales − the daily operation cost − the cash out
    const days = chainDays(sales, exps).reverse().map((x) => ({ ...x, d: x.dt }));
    const prevOf = (date) => prevLeft(sales, exps, date);
    const cashNow = days[0]?.left ?? 0;
    const dEx = sum(days, "ex"), dCo = sum(days, "co");
    const pc = (v) => (num(v) ? peso(v) : "");
    const narrow = matchMedia("(max-width: 640px)").matches; // 3.99.298: a phone: the row's buttons under ⋯
    const salesTab = days.length ? `<div class="grid-scroll"><table class="os-t os-days"><thead><tr><th>DATE</th><th class="num os-prev">YESTERDAY CASH</th><th class="num"><span class="d-l">TOTAL SALES</span><span class="d-s">SALES</span></th><th class="num">EXPENSES</th><th class="num">CASH OUT</th><th class="num">BALANCE</th><th></th></tr></thead><tbody>
        ${days.map((x) => `<tr class="os-day" data-dayrow="${esc(x.d)}"><td${num(x.prev) ? ` title="+ ₱ ${peso(x.prev)} from yesterday"` : ""}><b class="d-l">${esc(mdy(x.d))}</b><b class="d-s">${esc(new Date(x.d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "2-digit" }).toUpperCase())}</b></td><td class="num os-prev">${pc(x.prev)}</td><td class="num" data-label="Sales"><b class="os-in">${peso(x.t)}</b></td><td class="num" data-label="Expenses">${peso(x.ex)}</td><td class="num" data-label="Cash out">${peso(x.co)}</td><td class="num" data-label="Balance"><b class="${x.left < 0 ? "os-neg" : ""}">${peso(x.left)}</b></td><td class="os-actc"><details class="os-act"${narrow ? "" : " open"}><summary aria-label="Actions">⋯</summary><span class="ol-tools"><button type="button" class="btn small" data-day="${esc(x.d)}" title="Day Report">${ic("print")}</button>${x.r ? tools("outlet_sales", x.r) : isAdmin() ? `<button type="button" class="btn small" data-addsale="${esc(x.d)}" title="Add this day's sales">${ic("plus")} Sales</button>` : ""}${isAdmin() ? `<button type="button" class="btn small danger" data-delday="${esc(x.d)}" title="Delete this day">${ic("trash")}</button>` : ""}</span></details></td></tr>`).join("")}</tbody>
        <tfoot><tr><td>TOTAL</td><td class="os-prev"></td><td class="num" data-label="Sales">${peso(net)}</td><td class="num" data-label="Expenses">${peso(dEx)}</td><td class="num" data-label="Cash out">${peso(dCo)}</td><td class="num" data-label="Balance">${peso(cashNow)}</td><td></td></tr></tfoot></table></div>`
      : empty("No sales recorded this month.");
    const xps = exps.filter((r) => r.kind !== "cashout"), cos = exps.filter((r) => r.kind === "cashout");
    const expTab = xps.length ? `<div class="grid-scroll"><table class="os-t"><thead><tr><th>DATE</th><th>TYPE</th><th>PAID TO / NOTE</th><th class="num">AMOUNT</th><th></th></tr></thead><tbody>
        ${xps.map((r) => `<tr><td><b>${esc(mdy(r.exp_date))}</b></td><td><span class="os-kind k-${esc(r.kind)}">${esc(KIND[r.kind] || r.kind)}</span></td><td>${esc([r.payee, r.note].filter(Boolean).join(" · ") || "—")}</td><td class="num"><b>${peso(r.amount)}</b></td><td>${tools("outlet_expenses", r)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="3">TOTAL EXPENSES</td><td class="num">${peso(out)}</td><td></td></tr></tfoot></table></div>`
      : empty("No expense this month.");
    const cashTab = cash > 0 ? `<div class="grid-scroll"><table class="os-t"><thead><tr><th>DATE</th><th>CASH OUT TO</th><th>NOTE</th><th class="num">AMOUNT</th><th></th></tr></thead><tbody>
        ${sales.filter((r) => nonCash(r) > 0).map((r) => `<tr class="os-gc"><td><b>${esc(mdy(r.sale_date))}</b></td><td><b>GCash</b></td><td>—</td><td class="num"><b class="os-co">${peso(nonCash(r))}</b></td><td></td></tr>`).join("")}
        ${cos.map((r) => `<tr><td><b>${esc(mdy(r.exp_date))}</b></td><td><b>${esc(r.payee || "—")}</b></td><td>${esc(r.note || "—")}</td><td class="num"><b class="os-co">${peso(r.amount)}</b></td><td>${tools("outlet_expenses", r)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="3">TOTAL CASH OUT</td><td class="num">${peso(cash)}</td><td></td></tr></tfoot></table></div>`
      : empty("No cash out this month.");
    const invRows = invs.map((r) => `<a class="ol-li link" href="#invoice/${esc(r.id)}"><div class="ol-li-m"><b class="mono">${esc(r.invoice_no)}</b><small>${esc(mdy(r.invoice_date))} · due ${esc(mdy(r.due_date))}</small></div><em class="ol-amt out">₱ ${peso(r.balance)}</em></a>`).join("");
    const payRows = pays.map((r) => `<a class="ol-li link" href="#payment/${esc(r.id)}"><div class="ol-li-m"><b class="mono">${esc(r.receipt_no)}</b><small>${esc(mdy(r.paid_date))}</small></div><em class="ol-amt out">₱ ${peso(r.amount)}</em></a>`).join("");
    const stockTab = cust ? `<a class="ol-acct" href="#customer/${esc(cust.id)}">${ic("user")}<div><b>${esc(E.fullName(cust))}</b><small>${esc(cust.account_no || "")}</small></div><em>To pay ₱ ${peso(owed)}</em></a>
        <div class="os-two"><div><div class="ol-sub">Unpaid Invoices</div>${invRows || empty("No unpaid invoice.")}</div>
          <div><div class="ol-sub">Payments ${esc(E.monthText(m))} <small>taken off the balance</small></div>${payRows || empty("No payment this month.")}</div></div>
        ${E.canWrite("payments") || E.canWrite("invoices") ? `<div class="btnrow"><a class="btn primary small" href="#newpayment/${esc(cust.id)}">${ic("wallet")} Record Payment</a></div>` : ""}`
      : empty(`No customer account linked.${isAdmin() ? " Choose <b>Edit Shop Details</b> and choose the account that receives this outlet's stock." : ""}`);
    const docTab = `${docs.length ? E.filesHtml(docs) : empty(`No document yet.${isAdmin() ? " Add the <b>Contract of Lease</b>." : ""}`)}
      ${isAdmin() ? `<div class="btnrow"><button type="button" class="btn small primary" id="olLeaseBtn">${ic("doc")} Contract of Lease</button><label class="btn small" for="olDocUp">${ic("upload")} Upload</label><input type="file" id="olDocUp" accept="image/*,application/pdf" multiple hidden></div>` : ""}
      ${o.notes ? `<div class="ol-sub">Notes</div><p class="ol-notes">${esc(o.notes)}</p>` : ""}`;
    const box = (cls, k, v, sub = "") => `<div class="os-kpi ${cls}"><small>${k}</small><b>₱ ${peso(v)}</b>${sub ? `<span>${sub}</span>` : ""}</div>`;
    const monthLink = (target, icon, label) => target
      ? `<a href="#outlet/${esc(id)}/${esc(target)}" aria-label="${label}, ${esc(E.monthText(target))}">${ic(icon)}</a>`
      : '<span aria-hidden="true"></span>';
    const previous = soaMonths?.find((value) => value < m);
    const next = soaMonths?.filter((value) => value > m).pop();
    const soaTab = mine ? "" : soaMonths?.length ? `<div class="soa-list">${soaMonths.map((x) => `<button type="button" class="ol-li soa-li" data-soa="${esc(x)}">${ic("print")}<div class="ol-li-m"><b class="mono">SOA-${esc(o.code)}-${esc(x.replace("-", ""))}</b><small>${esc(E.monthText(x))}${x === monthNow() ? " · to date" : ""}</small></div><em>Print</em></button>`).join("")}</div>` : empty(soaMonths ? "No monthly statements yet." : "Statement history could not be loaded. Refresh to try again.");
    const tabs = [["Expenses", xps.length, expTab], ["Cash Out", cos.length, cashTab], ...(mine ? [] : [["Stock Account", invs.length, stockTab]]), ["Employees", st.length, staffHtml(st)], ["Achieved", 0, `<div id="osAchTab" data-oid="${esc(o.id)}">${busy()}</div>`], ["Documents", docs.length, docTab], ...(mine ? [] : [["Monthly SOA", soaMonths?.length || 0, soaTab]])];
    const moreBtns = [`<button type="button" id="olInfo">${ic("folder")} Info</button>`, mapQuery(o) ? `<button type="button" id="olMapOpen">${ic("pin")} Location</button>` : "", edit ? `<button type="button" id="olCash">${ic("wallet")} Cash Out</button><button type="button" id="olExp">${ic("plus")} Expense / Bill</button>` : "",
      edit && !mine ? `<button type="button" id="olDep">${ic("building")} Bank Deposit</button>` : "",
      edit && !mine && (rs.k === "unpaid" || rs.k === "overdue") ? `<button type="button" id="olPayRent">${ic("receipt")} Pay Rent ₱ ${peso(rs.left)}</button>` : "",
      mine || !hasActivity ? "" : `<button type="button" id="olSoa">${ic("print")} Monthly Statement</button>`,
      isAdmin() || edit ? `<button type="button" id="olHours">${ic("clock")} Today's Hours</button><button type="button" id="olNwd">${ic("clock")} Non-Working Days</button>` : ""].join("");
    $("#olBody").innerHTML = `
      ${moreBtns ? `<div class="pg-more"><button type="button" class="pg-more-btn" id="osMore" aria-label="More" aria-haspopup="true">⋯</button><div class="pg-more-list" id="osMoreList" hidden>${moreBtns}</div></div>` : ""}
      <section class="os-hero">
        <div class="os-hero-top"><div class="os-logo-col">${storeLogo(o, "big")}<span class="os-rk" id="osRank" data-oid="${esc(o.id)}" data-m="${esc(m)}" hidden></span></div>
          <div class="os-hero-m"><div class="os-code-row"><span class="os-code">${esc(o.code)}</span></div><h2>${esc(o.name)}</h2>${o.address ? `<p>${ic("pin")} ${esc(o.address)}</p>` : ""}</div></div>
        <div class="os-chips"><span class="os-bid">${ic("lock")} Branch ID ${esc(bidText(o))}</span>${o._today ? "" : `<span>${ic("clock")} ${esc(hoursOf(o) || "Hours not set")}</span>`}${storeNow(o) && o.status !== "closed" ? `<span class="os-live st-${storeNow(o).k}" id="osLive" title="${storeNow(o).sales ? `Sales hours ${o._today ? "today" : "a day"}: ${storeNow(o).sales}` : ""}">${liveHtml(o)}</span><span class="os-next" id="osNext">${ic("clock")} ${liveNext(o)}</span>` : ""}${o._today ? `<span class="os-todayh" title="Changed for today${o._today.set_by_name ? ` by ${esc(o._today.set_by_name)}` : ""}${o._today.note ? ` · ${esc(o._today.note)}` : ""}">${ic("clock")} Today ${esc(todayText(o))}</span>` : ""}
          ${rs.k === "none" ? "" : `<span class="r-${rs.k}">${rs.k === "paid" ? ic("check") + " " : ""}${esc(rentLine(rs))}</span>`}${o.status === "closed" ? `<span class="r-overdue">CLOSED</span>` : ""}</div>
        ${isAdmin() ? `<div class="os-details-action"><button type="button" class="btn small" id="olEdit">${ic("edit")} Edit Shop Details</button></div>` : ""}
        <div class="os-month">${monthLink(previous, "back", "Previous recorded month")}<b>${esc(E.monthText(m))}</b>${monthLink(next, "next", "Next recorded month")}</div>
      </section>
      ${o._closed ? `<div class="banner warn os-nwd">${ic("clock")} <span><b>TODAY IS A NON-WORKING DAY</b> · the store is closed and opens again tomorrow.</span></div>` : ""}
      ${mine ? `<div class="banner info os-mine">${ic("shield")} Your records only</div>` : ""}
      <div class="os-kpis"${mine || !hasActivity ? " hidden" : ""}>${box("in", "Net Sales", net, byPay.map(([l, v]) => `${esc(l)} ₱ ${peso(v)}`).join(" · "))}${box("out", "Expenses", opCost, "Daily operation cost")}${box("co", "Cash Out", cash, `${cos.length} time(s)`)}${box("left", "Cash Left", drawer, "This month")}
        <div class="os-kpi bal${pool < 0 ? " neg" : ""}"><small>Net Balance</small><b>₱ ${peso(pool)}</b><span>Cash out not used yet · used this month ₱ ${peso(usedM)} (rent · stock · bank · bills)</span></div></div>
      <div class="os-actions">${edit ? `<button type="button" class="btn primary" id="olSale">${ic("plus")} Add Daily Sales</button>` : ""}</div>
      <section class="os-daily"><div class="os-daily-h"><b>Daily Sales · ${esc(E.monthText(m))}</b>${mine || !hasActivity ? "" : `<button type="button" class="btn small" id="olSoa2">${ic("print")} Print</button>`}</div>${salesTab}</section>
      <section class="os-info" id="osInfo" hidden><div class="os-info-head"><b>${ic("folder")} Info · ${esc(o.code)}</b><button type="button" class="btn small" id="osInfoClose">${ic("x")} Close</button></div>
        <div class="tabs os-tabs" id="osTabs">${tabs.map(([t, n], k) => `<button type="button" class="${k ? "" : "on"}" data-t="${k}">${esc(t)}${n ? ` <em>${n}</em>` : ""}</button>`).join("")}</div>
        <div class="tabpanes os-panes" id="osPanes">${tabs.map(([, , html], k) => `<div data-p="${k}" class="os-pane"${k ? " hidden" : ""}>${html}</div>`).join("")}</div></section>`;
    if ($("#osMore")) { // 3.99.221: the ⋯ menu
      const list = $("#osMoreList"), close = () => { list.hidden = true; document.removeEventListener("click", away, true); };
      const away = (e) => { if (!e.target.closest(".pg-more")) close(); };
      $("#osMore").onclick = () => { list.hidden = !list.hidden; if (!list.hidden) document.addEventListener("click", away, true); };
      list.addEventListener("click", (e) => { if (e.target.closest("button")) close(); });
    }
    $$("#osTabs button").forEach((t) => (t.onclick = () => { $$("#osTabs button").forEach((x) => x.classList.toggle("on", x === t)); $$("#osPanes > div").forEach((q) => (q.hidden = q.dataset.p !== t.dataset.t)); }));
    E.keepTab("#osTabs", "outlet:" + id);
    if ($("#olEdit")) $("#olEdit").onclick = () => editOutlet(o);
    if ($("#olLeaseBtn")) $("#olLeaseBtn").onclick = () => leaseForm(o);
    if ($("#olDocUp")) $("#olDocUp").onchange = async (e) => {
      const f = await E.uploadRecords("outlet", o.id, "other", Array.from(e.target.files || []));
      toast(f ? `${f} file(s) could not be uploaded.` : "Document saved.", !!f); E.route();
    };
    E.bindFiles($("#olBody"));
    if ($("#olSale")) $("#olSale").onclick = () => saleForm(o, null, sales, prevOf, exps, m === monthNow() ? today() : first);
    $$("[data-delday]").forEach((b) => (b.onclick = async (e) => { // 3.99.289: the Director deletes the whole day (SQL 148)
      e.stopPropagation(); const d = b.dataset.delday;
      if (!(await E.confirmBox(`Delete <b>${esc(mdy(d))}</b>?<br><br>Its sales, daily operation cost and cash out are all deleted. This cannot be undone.`, { title: "Delete Day", ok: "Delete", danger: true }))) return;
      const { data: n, error } = await sb.rpc("outlet_day_delete", { p_outlet: o.id, p_date: d });
      if (error) return fail(error);
      toast(`${mdy(d)} deleted (${n || 0} record(s)).`); E.route();
    }));
    $$("[data-addsale]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); saleForm(o, null, sales, prevOf, exps, b.dataset.addsale); })); // 3.99.288: a day without its sales
    $$("[data-esale]").forEach((b) => (b.onclick = () => saleForm(o, sales.find((r) => r.id === b.dataset.esale), sales, prevOf, exps)));
    if ($("#olExp")) $("#olExp").onclick = () => expenseForm(o);
    // 3.99.224: INFO: expenses, cash out, stock account, employees, achieved, documents and every month's SOA
    // the sheet goes to the top of the page while it is open (the page's slide-in would keep it under the top bar)
    const info = $("#osInfo"), home = info?.parentElement, infoClose = () => { info.hidden = true; document.body.classList.remove("os-info-open"); if (home?.isConnected) home.appendChild(info); else info.remove(); };
    if ($("#olMapOpen")) $("#olMapOpen").onclick = () => { const m = E.modal(`${o.code} · Location`, mapBox(o), `<button type="button" class="btn" data-x>Close</button>`); $("[data-x]", m.el).onclick = m.close; }; // 3.99.235
    if ($("#olInfo")) $("#olInfo").onclick = () => { document.body.appendChild(info); info.hidden = false; document.body.classList.add("os-info-open"); info.scrollTop = 0; };
    if ($("#osInfoClose")) $("#osInfoClose").onclick = infoClose;
    $$("[data-soa]").forEach((b) => (b.onclick = () => {
      const x = b.dataset.soa;
      if (x === m) { infoClose(); $("#olSoa")?.click(); return; }
      try { sessionStorage.setItem("eoSoaPrint", `${id}:${x}`); } catch (_) {}
      infoClose(); location.hash = `outlet/${id}/${x}`;
    }));
    if ($("#olSoa2")) $("#olSoa2").onclick = () => $("#olSoa")?.click();
    if ($("#olDep")) $("#olDep").onclick = () => expenseForm(o, null, "", { kind: "deposit", amount: pool > 0 ? pool.toFixed(2) : "", payee: "BANK", note: "" });
    if ($("#olCash")) $("#olCash").onclick = () => expenseForm(o, null, "cashout", m === monthNow() ? { amount: cashNow > 0 ? cashNow.toFixed(2) : "", cashNow } : { date: first });
    $$("[data-eexp]").forEach((b) => (b.onclick = () => {
      const expense = exps.find((r) => r.id === b.dataset.eexp);
      if (!expense) return;
      const d = expense.exp_date;
      const sale = sales.find((r) => r.sale_date === d);
      const suggested = expense.kind === "cashout" && sale
        ? num(sale.cash) - dayOf(d, "daily") - (dayOf(d, "cashout") - num(expense.amount))
        : null;
      if (info && !info.hidden) infoClose();
      expenseForm(o, expense, "", { suggested });
    }));
    bindStaff($("#olBody"), "outlet", { id: o.id, label: o.code }, st);
    // the store status counts by itself (every 30 seconds while this page is open)
    const live = setInterval(() => { const el = $("#osLive"), s = storeNow(o); if (!el || !s) { clearInterval(live); return; } el.className = `os-live st-${s.k}`; el.innerHTML = liveHtml(o); const nx = $("#osNext"); if (nx) nx.innerHTML = `${ic("clock")} ${liveNext(o)}`; }, 30000);
    (E.outletWeekRanks || E.outletRanks)(m).then((rk) => { // 3.99.226: the rank of THIS WEEK (Monday to Sunday) under the store logo
      const el = $("#osRank"), r = rk.get(o.id);
      if (!r || !el || el.dataset.oid !== o.id) return;
      el.innerHTML = E.rankTag(r.rank); el.title = `Rank ${r.rank} of ${r.shops} shops · this week (Monday to Sunday)`; el.hidden = false;
    });
    E.achievements("outlet", o.id).then((a) => { const p = $("#osAchTab"); if (p && p.dataset.oid === o.id) p.innerHTML = E.achHtml(a, "outlet"); });
    $$("[data-del]").forEach((b) => (b.onclick = async () => {
      const [tbl, rid] = b.dataset.del.split(":");
      if (!(await E.confirmBox("Remove this record? This cannot be undone.", { title: "Remove", ok: "Remove", danger: true }))) return;
      const r = await sb.from(tbl).delete().eq("id", rid);
      if (r.error) return fail(r.error, "Could not remove"); toast("Removed."); E.route();
    }));
    $$("[data-files]").forEach((b) => (b.onclick = () => {
      const list = filesOf(b.dataset.files);
      const mm = E.modal("Files", `<div id="olFiles">${E.filesHtml(list)}</div>`, `<button type="button" class="btn" data-x>Close</button>`);
      $("[data-x]", mm.el).onclick = () => mm.close(); E.bindFiles(mm.el);
    }));
    $$("[data-day]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); printDay(o, b.dataset.day, sales, exps, mine, prevOf(b.dataset.day), st); }));
    $$("[data-dayrow]").forEach((tr) => (tr.onclick = (e) => { if (!e.target.closest("button, a, label, details")) printDay(o, tr.dataset.dayrow, sales, exps, mine, prevOf(tr.dataset.dayrow), st); })); // 3.99.221: press a day: its report
    if ($("#olNwd")) $("#olNwd").onclick = () => nwdForm(o, clos, m);
    if ($("#olHours")) $("#olHours").onclick = () => hoursForm(o, m);
    if ($("#olPayRent")) $("#olPayRent").onclick = () => expenseForm(o, null, "", { kind: "rent", amount: rs.left.toFixed(2), payee: "Landlord", note: `Rent ${E.monthText(m)}${rs.paidAmt > 0 ? " (the rest)" : ""}` });
    if ($("#olSoa")) $("#olSoa").onclick = () => printSoa(o, m, { sales, exps, pays, net, out, cash, paid, cust, owed: cust ? owed : null, op: opCost, used: usedM, pool, drawer, staff: st });
    E.setRecords(`Outlet: ${o.code}`);
    document.body.classList.remove("os-info-open");
    let want = ""; try { want = sessionStorage.getItem("eoSoaPrint") || ""; } catch (_) {}
    if (want === `${id}:${m}`) { try { sessionStorage.setItem("eoSoaPrint", ""); } catch (_) {} setTimeout(() => $("#olSoa")?.click(), 200); }
  };

  // 3.99.220: the days of a month in order, each with the cash left of the day before (prev) and its own cash left
  function chainDays(sales, exps) {
    const dayOf = (d, k) => sum(exps.filter((x) => x.exp_date === d && x.kind === k), "amount");
    let prev = 0;
    return [...new Set([...sales.map((r) => r.sale_date), ...exps.filter((x) => x.kind === "daily" || x.kind === "cashout").map((x) => x.exp_date)])].sort()
      .map((dt) => { const r = sales.find((x) => x.sale_date === dt), t = num(r?.total), ex = dayOf(dt, "daily"), co = dayOf(dt, "cashout") + nonCash(r), x = { dt, r, t, ex, co, prev, left: prev + t - ex - co }; prev = x.left; return x; });
  }
  const prevLeft = (sales, exps, date) => {
    const month = date.slice(0, 7);
    const before = chainDays(sales.filter((r) => r.sale_date.startsWith(month)), exps.filter((r) => r.exp_date.startsWith(month)))
      .filter((day) => day.dt < date);
    return before.at(-1)?.left ?? 0;
  };

  // ---------- daily sales: the cash breakdown and the report photo ----------
  function saleForm(o, row, existing, prevOf = () => 0, exps = [], day = "") {
    const m = E.modal(`${o.code} · ${row ? "Edit Daily Sales" : "Add Daily Sales"}`, `<div class="formgrid ol-form sales-entry-form">
        <div class="span2"><label for="osDate">Sales date</label><input id="osDate" type="date" required value="${esc(row?.sale_date || day || today())}" aria-describedby="osDateHelp">
          <small id="osDateHelp">${row ? "Changing the sales date leaves separately recorded expenses and cash outs on their original dates." : "Choose the date the sales were made."}</small></div>
        <p class="span2 hint err" id="osSaveError" role="alert" hidden></p>
        <div class="span2"><label for="osNet">Total Net Sales *</label><input id="osNet" class="os-amt os-net" type="number" min="0" step="0.01" inputmode="decimal" value="${row && num(row.total) ? esc(row.total) : ""}" placeholder="0.00"></div>
        <div><label for="os_gcash">GCash</label><input id="os_gcash" class="os-amt" type="number" min="0" step="0.01" inputmode="decimal" value="${row && num(row.gcash) ? esc(row.gcash) : ""}" placeholder="0.00"></div>
        <div><label for="os_cash">${ic("lock")} Cash</label><input id="os_cash" class="locked" type="number" readonly tabindex="-1" value="${row ? esc(num(row.cash)) : ""}" placeholder="0.00"></div>

        ${row ? "" : `<div class="span2 ol-prev">${ic("lock")} Cash Left from Yesterday <b id="osPrev">₱ 0.00</b></div>
        <div class="span2"><label for="osExp">Daily Operation</label><input id="osExp" class="os-amt" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></div>
        <div><label for="osOut">Cash Out <button type="button" class="linkbtn os-all" id="osAll">All</button></label><input id="osOut" class="os-amt" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></div>
        <div><label for="osOutN">${ic("lock")} Cash Out To <button type="button" class="linkbtn" id="osOutEdit" hidden>✎ Change</button></label><input id="osOutN" maxlength="120" value="EMON HASAN" readonly class="locked"></div>
        <div class="span2 ol-left"><span>Cash Left in the Shop</span><b id="osLeft">₱ 0.00</b></div>`}
        ${row && nonCash(row) > 0 ? `<label class="span2 os-all-cash"><input type="checkbox" id="osAllCash"> Record the full sales amount as cash</label>` : ""}
        <div class="span2"><label for="osNote">Note</label><input id="osNote" maxlength="500" value="${esc(row?.note || "")}"></div>
        <div class="span2"><label for="osPic">Sales report attachments</label><input id="osPic" type="file" accept="image/*,application/pdf" multiple></div>
      </div>`, `<button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" id="osSave">${ic("check")} Save</button>`, { wide: true });
    const legacyKeys = ["maya", "bank", "card", "other"];
    const legacyOther = legacyKeys.reduce((sum, key) => sum + num(row?.[key]), 0);
    const allCash = $("#osAllCash", m.el);
    const gcash = $("#os_gcash", m.el);
    const otherPayments = () => allCash?.checked ? 0 : legacyOther;
    const gcashAmount = () => allCash?.checked ? 0 : val("os_gcash");
    const total = () => val("os_cash") + gcashAmount() + otherPayments();
    const val = (id) => num($("#" + id, m.el)?.value);
    // 3.99.220: the cash left of the day before is added by itself (locked); the day's expenses and cash out already saved count too
    const dateNow = () => $("#osDate", m.el).value || today();
    const dayX = (k) => sum(exps.filter((x) => x.exp_date === dateNow() && x.kind === k), "amount");
    const prev = () => num(prevOf(dateNow()));
    const avail = () => prev() + num($("#os_cash", m.el)?.value) - dayX("daily") - dayX("cashout") - val("osExp"); // 3.99.257: GCash is not in the shop
    const show = () => {
      const net = num($("#osNet", m.el).value), gc = gcashAmount(); // 3.99.337: Cash = Net Sales − GCash (locked)
      $("#os_cash", m.el).value = (Math.max(0, net - gc - otherPayments())).toFixed(2);
      $("#os_gcash", m.el).classList.toggle("bad", gc + otherPayments() > net + 0.004);
      if ($("#osPrev", m.el)) $("#osPrev", m.el).textContent = `₱ ${peso(prev())}`;
      if ($("#osOutEdit", m.el)) $("#osOutEdit", m.el).hidden = !(val("osOut") > 0); // 3.99.338
      if ($("#osLeft", m.el)) { const left = avail() - val("osOut"); $("#osLeft", m.el).textContent = `₱ ${peso(left)}`; $("#osLeft", m.el).classList.toggle("neg", left < 0); }
    };
    if (allCash) allCash.onchange = () => { gcash.disabled = allCash.checked; show(); };
    $$(".os-amt", m.el).forEach((i) => (i.oninput = show)); show();
    if ($("#osOutEdit", m.el)) $("#osOutEdit", m.el).onclick = () => { const i = $("#osOutN", m.el); i.readOnly = false; i.classList.remove("locked"); i.select(); i.focus(); };
    if ($("#osAll", m.el)) $("#osAll", m.el).onclick = () => { $("#osOut", m.el).value = Math.max(0, avail()).toFixed(2); show(); };
    $("[data-x]", m.el).onclick = () => m.close();
    const errorBox = $("#osSaveError", m.el);
    const showError = (message) => { errorBox.textContent = message; errorBox.hidden = false; };
    const dateField = $("#osDate", m.el);
    dateField.onchange = () => { errorBox.hidden = true; show(); };
    $("#osSave", m.el).onclick = async (e) => {
      const button = e.currentTarget, date = dateField.value;
      errorBox.hidden = true;
      if (!dateField.reportValidity()) return;
      if (!$("#osNet", m.el).reportValidity() || !$("#os_gcash", m.el).reportValidity()) return;
      if (!total()) return showError("Enter the total net sales.");
      if (gcashAmount() + otherPayments() > val("osNet") + 0.004) return showError("Non-cash payments cannot exceed total net sales.");
      const occupied = `${mdy(date)} already has a sales report. Edit that report, or move it to its correct date first.`;
      if (existing.some((sale) => sale.sale_date === date && sale.id !== row?.id)) return showError(occupied);
      const data = { outlet_id: o.id, sale_date: date, note: $("#osNote", m.el).value.trim() || null };
      if (!row) data.created_by_name = me();
      data.cash = val("os_cash");
      data.gcash = gcashAmount();
      if (allCash?.checked) legacyKeys.forEach((key) => { data[key] = 0; });
      button.disabled = true;
      const r = row
        ? await sb.from("outlet_sales").update(data).eq("id", row.id).eq("sale_date", row.sale_date).select().maybeSingle()
        : await sb.from("outlet_sales").insert(data).select().single();
      if (r.error || !r.data) {
        button.disabled = false;
        return showError(r.error?.code === "23505" ? occupied : r.error ? "Could not save the sales report. Check your connection and try again." : "This report changed or you no longer have permission to edit it. Reopen it and try again.");
      }
      // 3.99.140: the day's expenses and the cash taken out, saved with the sales
      const outs = row ? [] : [["daily", val("osExp"), null, "DAILY OPERATION COST"], ["cashout", val("osOut"), $("#osOutN", m.el).value.trim().toUpperCase() || null, null]].filter((x) => x[1] > 0);
      let bad = null;
      for (const [kind, amount, payee, note] of outs) {
        const x = await sb.from("outlet_expenses").insert({ outlet_id: o.id, exp_date: date, kind, amount, payee, note, created_by_name: me() });
        if (x.error) { bad = x.error; console.warn(x.error.message); }
      }
      const pics = Array.from($("#osPic", m.el).files || []);
      const failed = pics.length ? await E.uploadRecords("outlet_sales", r.data.id, "sales_report", pics) : 0;
      m.close();
      const why = bad ? (bad.code === "23514" || /kind_check/.test(bad.message || "") ? "run the database update 113 on the updates page, then add them with Expense / Bill" : bad.message || "try again with Expense / Bill") : "";
      toast(bad ? `Sales saved, but the expenses / cash out were NOT saved: ${why}.` : failed ? `Sales saved; ${failed} photo(s) could not be uploaded.` : `Sales saved: ₱ ${peso(r.data.total)}${outs.length ? ` · out ₱ ${peso(outs.reduce((t, x) => t + x[1], 0))}` : ""}.`, !!(bad || failed));
      const destination = `#outlet/${o.id}/${date.slice(0, 7)}`;
      const currentMonth = location.hash.split("/")[2] || monthNow();
      if (date.slice(0, 7) !== currentMonth) location.hash = destination;
      else E.route();
    };
  }

  // ---------- an expense, bill, supplier payment or the rental ----------
  function expenseForm(o, row = null, kind = "", pre = null) {
    if (row && !isAdmin()) return toast("Only the Director (EMON HASAN) edits an expense.", true); // 3.99.155
    const v = (k) => esc(row?.[k] ?? "");
    const isCash = (row?.kind || kind) === "cashout"; // 3.99.157: Cash Out has its own simple form
    const kinds = Object.entries(KIND).filter(([k]) => k !== "cashout");
    const m = E.modal(`${o.code} · ${isCash ? (row ? "Edit Cash Out" : "Cash Out") : row ? "Edit Expense" : "Expense / Bill"}`, `<div class="formgrid ol-form">
        <div><label for="oxDate">Date *</label><input id="oxDate" type="date" value="${row ? v("exp_date") : esc(pre?.date || today())}"></div>
        ${isCash ? `<input type="hidden" id="oxKind" value="cashout">${!row && pre?.cashNow != null ? `<div class="span2 ol-prev">${ic("wallet")} Cash in the Shop <b>₱ ${peso(pre.cashNow)}</b><small>less than all: the rest goes on to the next day</small></div>` : ""}<div><label for="oxAmt">Amount (₱) *</label>${row && pre?.suggested > 0 ? `<button type="button" class="linkbtn" id="oxSuggest">Use that day’s remaining sales cash (₱ ${peso(pre.suggested)})</button>` : ""}<input id="oxAmt" type="number" min="0.01" step="0.01" inputmode="decimal" value="${v("amount")}"></div>
        <div class="span2"><label for="oxPayee">Cash Out To *</label><input id="oxPayee" maxlength="120" placeholder="e.g. EMON HASAN / bank deposit" value="${v("payee")}"></div>`
        : `<div><label for="oxKind">Type *</label><select id="oxKind">${kinds.map(([k, l]) => `<option value="${k}"${row?.kind === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
        <div><label for="oxPayee">Paid To</label><input id="oxPayee" maxlength="120" placeholder="Supplier / landlord / company" value="${v("payee")}"></div>
        <div><label for="oxAmt">Amount (₱) *</label><input id="oxAmt" type="number" min="0.01" step="0.01" inputmode="decimal" value="${v("amount")}"></div>`}
        <div class="span2"><label for="oxNote">Note</label><input id="oxNote" maxlength="500" value="${v("note")}"></div>
        <div class="span2"><label for="oxPic">${row ? "Add Receipt Photo" : "Receipt Photo"}</label><input id="oxPic" type="file" accept="image/*,application/pdf" multiple></div>
      </div>`, `<button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" id="oxSave">${ic("check")} Save</button>`, { wide: true });
    if (pre && !row) { // 3.99.204: Pay Rent: the type, the amount still unpaid, the landlord and a note
      const set = (sel, v) => { const x = m.el.querySelector(sel); if (x && v != null) x.value = v; };
      set("#oxKind", pre.kind); set("#oxAmt", pre.amount); set("#oxPayee", pre.payee); set("#oxNote", pre.note);
    }
    const suggestion = $("#oxSuggest", m.el);
    if (suggestion) {
      suggestion.onclick = () => { $("#oxAmt", m.el).value = pre.suggested.toFixed(2); };
      $("#oxDate", m.el).addEventListener("change", (e) => { suggestion.hidden = e.target.value !== row.exp_date; });
    }
    if (!isCash) $("#oxKind", m.el).onchange = (e) => { if (e.target.value === "rent" && !$("#oxAmt", m.el).value && num(o.monthly_rent)) $("#oxAmt", m.el).value = num(o.monthly_rent).toFixed(2); };
    $("[data-x]", m.el).onclick = () => m.close();
    $("#oxSave", m.el).onclick = async (e) => {
      const data = { outlet_id: o.id, exp_date: $("#oxDate", m.el).value, kind: $("#oxKind", m.el).value, payee: $("#oxPayee", m.el).value.trim().toUpperCase() || null,
        amount: num($("#oxAmt", m.el).value), note: $("#oxNote", m.el).value.trim() || null, ...(row ? {} : { created_by_name: me() }) };
      if (!data.exp_date) return toast("Choose the date.", true);
      if (!(data.amount > 0)) return toast("Type the amount.", true);
      if (isCash && !data.payee) return toast("Type who took the cash (Cash Out To).", true);
      e.target.disabled = true;
      const once = !!row; // 3.99.285: a change goes through the Director's safe edit (every field)
      const r = once ? await sb.rpc("outlet_expense_edit", { p_id: row.id, p_date: data.exp_date, p_kind: data.kind, p_payee: data.payee, p_amount: data.amount, p_note: data.note })
        : row ? await sb.from("outlet_expenses").update(data).eq("id", row.id).select().single() : await sb.from("outlet_expenses").insert(data).select().single();
      if (r.error) { e.target.disabled = false; return fail(r.error, /kind_check|23514/.test(`${r.error.code} ${r.error.message}`) ? "Bank Deposit needs the database update 135 (updates page)" : /outlet_expense_edit|PGRST202|schema cache/.test(r.error.message || "") ? "Run the database update 147 first (updates page)" : "Could not save"); }
      const pics = Array.from($("#oxPic", m.el).files || []);
      const failed = pics.length ? await E.uploadRecords("outlet_expense", once ? row.id : r.data.id, "receipt", pics) : 0;
      m.close(); toast(failed ? `Saved; ${failed} photo(s) could not be uploaded.` : `${KIND[data.kind]} ${row ? "changed" : "saved"}: ₱ ${peso(data.amount)}.`, !!failed); E.route();
    };
  }

  // ---------- the Contract of Lease: its pages saved as ONE document ----------
  // photos of the pages (or scanned pages) become one PDF, a page each; a PDF is kept as it is
  async function pagesToPdf(images, name) {
    const lib = await E.needLib("jspdf");
    const pdf = new lib.jsPDF({ unit: "mm", format: "a4", compress: true });
    for (let i = 0; i < images.length; i++) {
      const url = URL.createObjectURL(images[i]);
      try {
        const img = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = url; });
        const k = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        if (i) pdf.addPage("a4", "portrait");
        const pw = 210, ph = 297, m = 6, s = Math.min((pw - 2 * m) / c.width, (ph - 2 * m) / c.height);
        pdf.addImage(c.toDataURL("image/jpeg", 0.85), "JPEG", (pw - c.width * s) / 2, (ph - c.height * s) / 2, c.width * s, c.height * s, undefined, "FAST");
      } finally { URL.revokeObjectURL(url); }
    }
    return new File([pdf.output("blob")], `${name}.pdf`, { type: "application/pdf" });
  }
  async function saveLease(o, files) {
    const imgs = files.filter((f) => /^image\//.test(f.type)), pdfs = files.filter((f) => f.type === "application/pdf");
    const list = [...pdfs];
    try { if (imgs.length) list.unshift(await pagesToPdf(imgs, `${o.code} Contract of Lease`)); }
    catch (e) { console.error(e); return toast("The pages could not be joined into one document. Try again.", true); }
    const failed = await E.uploadRecords("outlet", o.id, "contract", list);
    toast(failed ? "The Contract of Lease could not be saved. Try again." : `Contract of Lease saved${imgs.length > 1 ? ` (${imgs.length} pages in one document)` : ""}.`, !!failed);
    E.route();
  }
  function leaseForm(o) {
    const pages = [];
    const m = E.modal(`${o.code} · Contract of Lease`, `<p class="muted" style="margin-top:0">All pages · one document</p>
        <div class="btnrow"><label class="btn" for="lfAdd">${ic("image")} Add Pages</label><input id="lfAdd" type="file" accept="image/*,application/pdf" multiple hidden>
          <label class="btn" for="lfCam">${ic("camera")} Take Photo</label><input id="lfCam" type="file" accept="image/*" capture="environment" hidden>
          ${window.EOApp?.scan ? `<button type="button" class="btn" id="lfScan">${ic("scan")} Scan Page</button>` : ""}</div>
        <div class="lf-pages" id="lfPages"></div>`,
      `<button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" id="lfSave" disabled>${ic("check")} Save as One Document</button>`, { wide: true });
    const draw = () => {
      $("#lfPages", m.el).innerHTML = pages.length ? pages.map((f, i) => `<div class="lf-page">${/^image\//.test(f.type) ? `<img src="${f._url || (f._url = URL.createObjectURL(f))}" alt="Page ${i + 1}">` : `<span class="lf-pdf">${ic("doc")} PDF</span>`}
        <small>Page ${i + 1}</small><button type="button" class="btn small danger" data-rmp="${i}" title="Remove">${ic("x")}</button></div>`).join("") : `<div class="empty small">No page yet.</div>`;
      $$("[data-rmp]", m.el).forEach((b) => (b.onclick = () => { pages.splice(Number(b.dataset.rmp), 1); draw(); }));
      $("#lfSave", m.el).disabled = !pages.length;
    };
    const add = (e) => { pages.push(...Array.from(e.target.files || [])); e.target.value = ""; draw(); };
    $("#lfAdd", m.el).onchange = add; $("#lfCam", m.el).onchange = add;
    if ($("#lfScan", m.el)) $("#lfScan", m.el).onclick = async (e) => {
      e.target.disabled = true;
      try {
        const r = await window.EOApp.scan({ dialog: true });
        if (r?.ok) { const blob = await (await fetch(`data:${r.type || "image/jpeg"};base64,${r.data}`)).blob(); pages.push(new File([blob], r.name || `Scan_${Date.now()}.jpg`, { type: r.type || "image/jpeg" })); draw(); }
        else if (!r?.cancelled) toast(r?.error || "The scan did not work.", true);
      } finally { e.target.disabled = false; }
    };
    $("[data-x]", m.el).onclick = () => m.close();
    $("#lfSave", m.el).onclick = async (e) => { e.target.disabled = true; e.target.innerHTML = `<span class="spin sm light"></span> Saving…`; const list = pages.slice(); m.close(); await saveLease(o, list); };
    draw();
  }

  // ---------- 3.99.142: assigned employees (a shop, or a company in Billing): assign, transfer, remove ----------
  // The employee gets a notification each time (the server sends it: 114_staff_assign_notify.sql).
  const STAFF = { outlet: { tbl: "outlet_staff", col: "outlet_id" }, company: { tbl: "pay_company_staff", col: "company_id" } };
  const STAFF_SEL = "employee_id, employees(id, first_name, last_name, employee_no, position, profile_id)";
  const need114 = (er, word) => (new RegExp(word).test((er && er.message) || "") ? "Run the database update 114 first" : null);
  function staffHtml(st) {
    return `${st.length ? st.map((x) => `<div class="ol-emp"><a href="#employee/${esc(x.employee_id)}"><b>${esc(empName(x.employees))}${x.role ? ` <span class="st-role ${x.role === "authorizer" ? "auth" : ""}">${x.role === "authorizer" ? "AUTHORIZER" : "EMPLOYEE"}</span>` : ""}</b><small>${esc([x.employees?.employee_no, x.employees?.position].filter(Boolean).join(" · "))}</small></a>${isAdmin() ? `<span class="ol-emp-btns">${x.role ? `<button type="button" class="btn small" data-strole="${esc(x.employee_id)}" data-to="${x.role === "authorizer" ? "employee" : "authorizer"}">${x.role === "authorizer" ? "Make Employee" : "Make Authorizer"}</button>` : ""}<button type="button" class="btn small" data-stmove="${esc(x.employee_id)}">${ic("next")} Transfer</button><button type="button" class="btn small" data-stdel="${esc(x.employee_id)}" title="Remove">${ic("x")}</button></span>` : ""}</div>`).join("") : empty("No employee assigned.")}
      ${isAdmin() ? `<div class="btnrow"><button type="button" class="btn small" data-stadd>${ic("plus")} Assign Employee</button></div>` : ""}`;
  }
  function bindStaff(root, kind, place, st) {
    const k = STAFF[kind];
    $$("[data-stadd]", root).forEach((b) => (b.onclick = () => assignForm(kind, place, st.map((x) => x.employee_id))));
    $$("[data-stdel]", root).forEach((b) => (b.onclick = async () => {
      if (!(await E.confirmBox(`Remove this employee from ${place.label}? The employee gets a notification.`, { title: "Assigned Employee", ok: "Remove" }))) return;
      const r = await sb.from(k.tbl).delete().eq(k.col, place.id).eq("employee_id", b.dataset.stdel);
      if (r.error) return fail(r.error, "Could not remove");
      toast("Removed. The employee is notified."); E.route();
    }));
    $$("[data-stmove]", root).forEach((b) => (b.onclick = () => transferForm(kind, place, st.find((x) => x.employee_id === b.dataset.stmove))));
    $$("[data-strole]", root).forEach((b) => (b.onclick = async () => { // 3.99.326: a company's AUTHORIZER or EMPLOYEE (SQL 152)
      const { error } = await sb.rpc("company_staff_role", { p_company: place.id, p_employee: b.dataset.strole, p_role: b.dataset.to });
      if (error) return fail(error, /company_staff_role|PGRST202|schema cache/.test(error.message || "") ? "Run the database update 152 first" : "Could not change");
      toast(b.dataset.to === "authorizer" ? "Now an AUTHORIZER of the company." : "Now an EMPLOYEE of the company."); E.route();
    }));
  }
  async function activeOfficePosts() {
    const results = await Promise.all(["manila", "dhaka"].map(office => sb.rpc("office_director_post", { p_office: office })));
    for (const result of results) if (result.error) throw result.error;
    return new Set(results.flatMap(result => (result.data || []).map(employee => employee.id)));
  }
  async function assignForm(kind, place, have) {
    const { data, error } = await sb.from("employees").select("id, first_name, last_name, employee_no, position, status").order("first_name");
    if (error) return fail(error, "Could not load the employees");
    let posted;
    try { posted = await activeOfficePosts(); } catch (error) { return fail(error, "Could not check office posts"); }
    const list = (data || []).filter((x) => !posted.has(x.id) && !have.includes(x.id) && !["closed", "suspended", "rejected", "terminated"].includes(x.status));
    if (!list.length) return toast("No eligible employees are available.");
    const m = E.modal(`${place.label} · Assign Employee`, `<label for="oaEmp">Employee</label><select id="oaEmp">${list.map((x) => `<option value="${esc(x.id)}">${esc(empName(x))}${x.employee_no ? ` · ${esc(x.employee_no)}` : ""}${x.position ? ` · ${esc(x.position)}` : ""}</option>`).join("")}</select>
      <small class="muted">This becomes the employee’s workplace and replaces their previous assignment.</small>`,
      `<button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" id="oaSave">${ic("check")} Assign</button>`);
    $("[data-x]", m.el).onclick = () => m.close();
    $("#oaSave", m.el).onclick = async (e) => {
      e.target.disabled = true;
      const r = await sb.rpc("employee_place_set", { p_kind: kind, p_to: place.id, p_employee: $("#oaEmp", m.el).value });
      if (r.error) { e.target.disabled = false; return fail(r.error, need114(r.error, "pay_company_staff") || "Could not assign"); }
      m.close(); toast("Employee assigned. The employee is notified."); E.route();
    };
  }
  async function transferForm(kind, place, x) {
    if (!x) return;
    const [os, cs] = await Promise.all([
      sb.from("outlets").select("id, code, name, status").order("code").then((r) => r.data || [], () => []),
      sb.from("pay_companies").select("id, name, status").order("name").then((r) => r.data || [], () => [])]);
    const opt = (k, r, label) => (k === kind && r.id === place.id ? "" : `<option value="${k}:${esc(r.id)}">${esc(label)}</option>`);
    const shops = os.filter((r) => r.status !== "closed").map((r) => opt("outlet", r, r.name && r.name.toUpperCase() !== r.code.toUpperCase() ? `${r.code} · ${r.name}` : r.code)).join("");
    const cos = cs.filter((r) => r.status !== "closed").map((r) => opt("company", r, r.name)).join("");
    const m = E.modal(`Transfer ${empName(x.employees)}`, `<div class="ol-from">From <b>${esc(place.label)}</b></div>
      <label for="otTo">Transfer To</label><select id="otTo"><option value="office:">EO OFFICE</option>${shops ? `<optgroup label="Shops">${shops}</optgroup>` : ""}${cos ? `<optgroup label="Companies">${cos}</optgroup>` : ""}</select>
      `,
      `<button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" id="otSave">${ic("check")} Transfer</button>`);
    $("[data-x]", m.el).onclick = () => m.close();
    $("#otSave", m.el).onclick = async (e) => {
      e.target.disabled = true;
      const [tk, tid] = $("#otTo", m.el).value.split(":");
      const r = await sb.rpc("employee_transfer", { p_employee: x.employee_id, p_from_kind: kind, p_from: place.id, p_to_kind: tk, p_to: tid || null });
      if (r.error) { e.target.disabled = false; return fail(r.error, need114(r.error, "employee_transfer") || "Could not transfer"); }
      m.close(); toast(`Transferred to ${String(r.data || "").split(" · ")[0]}. The employee is notified.`); E.route();
    };
  }
  E.assignStaff = assignForm; E.staffHtml = staffHtml; E.bindStaff = bindStaff; E.STAFF_SEL = STAFF_SEL;
  // 3.99.326: the ASSIGNED EMPLOYEES of a regional office (Manila / Dhaka), on top of its page; the Director assigns
  const OFFICE_NAME = { manila: "REGIONAL OFFICE MANILA", dhaka: "REGIONAL OFFICE DHAKA" };
  async function officeStaff(el, office) {
    if (!el) return;
    const [{ data, error }, post] = await Promise.all([
      sb.rpc("office_staff", { p_office: office }), sb.rpc("office_director_post", { p_office: office })
    ]);
    if (error) { el.hidden = true; return; }
    const holder = post.data?.[0];
    const list = (data || []).filter(x => x.id !== holder?.id);
    el.innerHTML = `<section class="off-slot"><div class="off-h"><h3>AUTHORIZED RESPONSIVE</h3>${isAdmin() && !post.error ? `<button type="button" class="btn small" id="offPost">${holder ? "Replace" : "Appoint employee"}</button>` : ""}</div>
      ${post.error ? "Office post unavailable. Apply database update 157." : holder ? `<a class="off-emp" href="#employee/${esc(holder.id)}"><b>${esc(holder.full_name)}</b><small>${esc([holder.card_no,holder.job_position].filter(Boolean).join(" · "))}</small></a>` : "No employee appointed."}</section>
      <section class="off-slot"><div class="off-h"><h3>${ic("users")} Assigned Employees</h3>${isAdmin() ? `<button type="button" class="btn small primary" id="offAdd">${ic("plus")} Assign Employee</button>` : ""}</div>
      ${list.length ? `<div class="off-list">${list.map((x) => `<a class="off-emp" href="#employee/${esc(x.id)}"><b>${esc(String(x.full_name || "").toUpperCase())}</b><small>${esc([x.employee_no, x.job_position].filter(Boolean).join(" · ").toUpperCase())}</small></a>`).join("")}</div>` : `<div class="muted off-none">No employees are assigned to this office yet.</div>`}</section>`;
    el.hidden = false;
    const choose = async (postRole) => {
      const { data: emps, error: empError } = await sb.from("employees").select("id, first_name, last_name, employee_no, position, status").neq("status", "terminated").order("first_name");
      if (empError) return fail(empError, "Could not load employees");
      let posted;
      try { posted = await activeOfficePosts(); } catch (error) { return fail(error, "Could not check office posts"); }
      const have = new Set(list.map((x) => x.id));
      const rows = (emps || []).filter((x) => !posted.has(x.id) && x.status === "active" && (postRole || !have.has(x.id)));
      const m = E.modal(`${postRole ? "AUTHORIZED RESPONSIVE" : "Assign Employee"} · ${OFFICE_NAME[office]}`, `<p class="muted">${postRole ? "This becomes the employee’s only workplace. They hold this post until replaced." : "The employee moves to this office and receives an assignment notification."}</p>
        <div class="asg-list">${rows.map((x) => `<label class="asg-row"><input type="radio" name="offEmp" value="${esc(x.id)}"><span><b>${esc(`${x.first_name || ""} ${x.last_name || ""}`.trim().toUpperCase())}</b><small>${esc([x.employee_no, x.position].filter(Boolean).join(" · "))}</small></span></label>`).join("") || `<div class="muted">No other employee.</div>`}</div>`,
        `<button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" data-ok>${ic("check")} Assign</button>`);
      $("[data-x]", m.el).onclick = m.close;
      $("[data-ok]", m.el).onclick = async (e) => {
        const id = $("input[name=offEmp]:checked", m.el)?.value; if (!id) return toast("Choose the employee.", true);
        const button = e.currentTarget;
        E.setBusy(button, true);
        const { error: er } = postRole ? await sb.rpc("set_office_director_post", { p_employee: id, p_office: office }) : await sb.rpc("employee_place_set", { p_employee: id, p_kind: office, p_to: null });
        if (er) { E.setBusy(button, false); return fail(er, /Unknown place|employee_place_set/.test(er.message || "") ? "Run the database update 152 first" : "Could not assign"); }
        E.refreshNotifications();
        m.close(); toast(postRole ? "AUTHORIZED RESPONSIVE updated." : "Employee assigned."); officeStaff(el, office);
      };
    };
    if ($("#offAdd", el)) $("#offAdd", el).onclick = () => choose(false);
    if ($("#offPost", el)) $("#offPost", el).onclick = () => choose(true);
  }
  E.officeStaff = officeStaff;

  // ---------- the monthly statement (SOA): a ledger of the month ----------
  // 3.99.175: the DAILY SALES REPORT of one shop for ONE day: the sales (cash, GCash), the day's expenses and cash out, the cash
  // left, who recorded it, and the signatures. Report No DSR-<shop>-<date>.
  // 3.99.204: TODAY'S HOURS (SQL 131): opened late, closed early or closed now; only for today (tomorrow: the normal hours)
  function hoursForm(o, m) {
    if (!o._dayHoursOk) { toast("Run the database update 131 first (Today's Hours).", true); return; }
    const nowHM = () => new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false });
    const op = to24(o._today?.opens || o.opens), cl = to24(o._today?.closes || o.closes);
    const tmr = (() => { const d = new Date(`${today()}T00:00:00`); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
    const md = E.modal(`${o.code} · Today's Hours`, `
      <p class="muted" style="margin:0 0 10px">Normal: <b>${esc(hoursOf(o) || "not set")}</b> · that day only</p>
      <div class="formgrid ol-form"><div class="span2"><label for="hrDay">Day</label><select id="hrDay"><option value="${today()}">Today · ${esc(mdy(today()))}</option><option value="${tmr}">Tomorrow · ${esc(mdy(tmr))}</option></select></div></div>
      <div class="btnrow hr-quick" id="hrQuick"><button type="button" class="btn" id="hrOpenNow">${ic("check")} Open Now</button><button type="button" class="btn danger" id="hrCloseNow">${ic("x")} Close Now</button></div>
      <div class="formgrid ol-form"><div><label for="hrOpen">Opens at</label><input type="time" id="hrOpen" value="${esc(op || "")}"></div>
        <div><label for="hrClose">Closes at</label><input type="time" id="hrClose" value="${esc(cl || "")}"></div>
        <div class="span2"><label for="hrNote">Reason</label><input id="hrNote" maxlength="200" placeholder="Opened late, closed early, power out …" value="${esc(o._today?.note || "")}"></div></div>`,
      `<button type="button" class="btn" id="hrReset"${o._today ? "" : " hidden"}>Normal Hours</button><button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" id="hrSave">${ic("check")} Save</button>`);
    const el = md.el, reload = () => { md.close(); V.outlet(o.id, m); };
    el.querySelector("[data-x]").onclick = md.close;
    const day = () => el.querySelector("#hrDay").value, old = (e) => /outlet_set_day|outlet_clear_day|schema cache|PGRST202|function/i.test(`${e?.code} ${e?.message}`);
    // tomorrow: its own hours (if any were set), no Open Now / Close Now
    el.querySelector("#hrDay").onchange = async () => {
      const t = day() === today(); el.querySelector("#hrQuick").hidden = !t;
      const { data } = t ? { data: o._today } : await sb.from("outlet_day_hours").select("*").eq("outlet_id", o.id).eq("day", day()).maybeSingle().then((r) => r, () => ({ data: null }));
      el.querySelector("#hrOpen").value = to24(data?.opens || o.opens) || ""; el.querySelector("#hrClose").value = to24(data?.closes || o.closes) || "";
      el.querySelector("#hrNote").value = data?.note || ""; el.querySelector("#hrReset").hidden = !data;
    };
    const save = async (opens, closes) => {
      const args = { p_outlet: o.id, p_opens: opens || null, p_closes: closes || null, p_note: el.querySelector("#hrNote").value };
      let { error } = await sb.rpc("outlet_set_day", { ...args, p_day: day() });
      if (error && old(error) && day() === today()) ({ error } = await sb.rpc("outlet_set_today", args));
      if (error) return fail(error, old(error) ? "Hours for tomorrow need the database update 136" : "Could not save the hours");
      toast(day() === today() ? "Today's hours saved." : `Hours saved for ${mdy(day())}.`); reload();
    };
    el.querySelector("#hrOpenNow").onclick = () => save(nowHM(), el.querySelector("#hrClose").value);
    el.querySelector("#hrCloseNow").onclick = () => save(el.querySelector("#hrOpen").value, nowHM());
    el.querySelector("#hrSave").onclick = () => save(el.querySelector("#hrOpen").value, el.querySelector("#hrClose").value);
    if (el.querySelector("#hrReset")) el.querySelector("#hrReset").onclick = async () => {
      let { error } = await sb.rpc("outlet_clear_day", { p_outlet: o.id, p_day: day() });
      if (error && old(error) && day() === today()) ({ error } = await sb.rpc("outlet_clear_today", { p_outlet: o.id }));
      if (error) return fail(error, "Could not reset");
      toast("Normal hours again."); reload();
    };
  }
  // 3.99.196: NON-WORKING DAYS (SQL 128): the days ahead (approved, waiting, not approved) and a calendar to ask for new ones
  function nwdForm(o, clos, m) {
    if (clos === null) { toast("Run the database update 128 first (Non-Working Days).", true); return; }
    const t = today(), up = clos.filter((c) => c.day >= t);
    const ST = { approved: ["paid", "APPROVED"], pending: ["pending", "WAITING"], rejected: ["overdue", "NOT APPROVED"] };
    const rows = up.map((c) => `<div class="nwd-row"><div><b>${esc(mdy(c.day))}</b><small>${esc([c.reason, c.requested_by_name ? `asked by ${c.requested_by_name}` : ""].filter(Boolean).join(" · "))}</small></div>${E.pill(ST[c.status][0], ST[c.status][1])}
      <span class="nwd-act">${isAdmin() && c.status === "pending" ? `<button type="button" class="btn small ok" data-nok="${esc(c.id)}">Approve</button><button type="button" class="btn small" data-nno="${esc(c.id)}">Refuse</button>` : ""}${isAdmin() || (c.status === "pending" && c.requested_by === E.meId()) ? `<button type="button" class="btn small danger" data-ndel="${esc(c.id)}" aria-label="Take back" title="Take back">${ic("x")}</button>` : ""}</span></div>`).join("");
    const md = E.modal(`${o.code} · Non-Working Days`, `
      <div class="nwd-list">${rows || `<div class="empty">No non-working day ahead.</div>`}</div>
      <div class="formgrid ol-form nwd-form"><div class="span2 ol-sub">Ask for non-working day(s)</div>
        <div><label for="nwdFrom">From *</label><input type="date" id="nwdFrom" min="${t}" value="${t}"></div>
        <div><label for="nwdTo">To</label><input type="date" id="nwdTo" min="${t}" value="${t}"></div>
        <div class="span2"><label for="nwdWhy">Reason</label><input id="nwdWhy" maxlength="300" placeholder="Holiday, inventory, repair …"></div>
        <p class="span2 muted" style="margin:0">${isAdmin() ? "Your days are approved at once; the shop's employees are notified." : "EMON HASAN approves the days. On an approved day the store is CLOSED and opens again the next day."}</p></div>`,
      `<button type="button" class="btn" data-x>Close</button><button type="button" class="btn primary" id="nwdGo">${ic("check")} Submit</button>`);
    const el = md.el, reload = () => { md.close(); V.outlet(o.id, m); };
    el.querySelector("[data-x]").onclick = md.close;
    el.querySelector("#nwdFrom").onchange = (e) => { const to = el.querySelector("#nwdTo"); to.min = e.target.value; if (to.value < e.target.value) to.value = e.target.value; };
    el.querySelector("#nwdGo").onclick = async (e) => {
      const a = el.querySelector("#nwdFrom").value, b = el.querySelector("#nwdTo").value || a, btn = e.currentTarget;
      if (!a) return toast("Choose the day.", true);
      const days = [];
      for (let d = new Date(`${a}T00:00:00`); E.isoDay(d) <= b && days.length < 32; d.setDate(d.getDate() + 1)) days.push(E.isoDay(d));
      if (days.length > 31) return toast("At most 31 days at a time.", true);
      btn.disabled = true;
      const { data, error } = await sb.rpc("outlet_closure_request", { p_outlet: o.id, p_days: days, p_reason: el.querySelector("#nwdWhy").value });
      if (error) { btn.disabled = false; return fail(error, "Could not submit"); }
      toast(data ? (isAdmin() ? `${data} non-working day(s) saved.` : `${data} day(s) sent to EMON HASAN for approval.`) : "These days were already asked.");
      reload();
    };
    el.querySelectorAll("[data-nok],[data-nno]").forEach((b) => (b.onclick = async () => {
      const { error } = await sb.rpc("outlet_closure_decide", { p_id: b.dataset.nok || b.dataset.nno, p_ok: !!b.dataset.nok });
      if (error) return fail(error, "Could not save");
      E.refreshNotifications();
      toast(b.dataset.nok ? "Approved: the store is closed on that day." : "Not approved: the store stays open."); reload();
    }));
    el.querySelectorAll("[data-ndel]").forEach((b) => (b.onclick = async () => {
      if (!(await E.confirmBox("Take this non-working day back? The store will be open on that day.", { title: "Non-Working Day", ok: "Take Back", danger: true }))) return;
      const { error } = await sb.rpc("outlet_closure_cancel", { p_id: b.dataset.ndel });
      if (error) return fail(error, "Could not take it back");
      E.refreshNotifications();
      toast("Taken back."); reload();
    }));
  }
  // 3.99.219: the sales reports end with ISSUED BY (the name only) and APPROVED BY: a signature line, the name, the
  // position and the EOID of EMON HASAN. No boxes.
  const BOSS = "EMON HASAN";
  // The assigned Director's personnel number is resolved to the issued EOID before printing.
  const bossStamp = id => {
    const data = E.stampOf?.(id, BOSS, "", true);
    return { ...data, name: BOSS, eoid: data?.eoid || "EO-20260601", boss: true };
  };
  const loadBoss = async (more = []) => { await E.loadSignatures?.().catch(() => {}); const id = E.directorId?.(BOSS); await E.loadSigners?.([id, ...more].filter(Boolean)).catch(() => {}); return id; };
  const dsrNo = (o, d) => `DSR-${String(o.code || "").replace(/[^A-Z0-9]/gi, "").toUpperCase()}-${String(d || "").replace(/-/g, "")}`;
  // 3.99.220: a PDF417 barcode of the report no above ISSUED BY
  // 3.99.232: the sign-off. Left: the report no (PDF417) and STORE RESPONSIBLE BY: the employee assigned to the store (their
  // stamp and signature); with no one assigned, who recorded it. Right: the cash left stamp, room to sign, the Director's
  // stamp, and the TRX ID (word and PDF417) to check the approval on the Verify page.
  const nameBoxes = (prep, no, bossId, trx = "", prepId = "", stamp = "", resp = null, when = "") => {
    const code = (t) => { try { return t && E.pdf417DataUrl ? E.pdf417DataUrl(String(t)) : ""; } catch (_) { return ""; } };
    const bar = code(no), tbar = code(trx && String(trx).toUpperCase());
    const st = resp ? { name: `${resp.first_name || ""} ${resp.last_name || ""}`.trim(), pos: resp.position || "", eoid: resp.employee_no || "" } : prepId ? E.stampOf?.(prepId, prep) : null;
    const pic = E.sigPicOf?.(resp ? resp.profile_id : prepId) || "";
    const issued = E.stampHtml?.({ ...(st && st.name ? st : { name: prep }), date: when }) || `<b>${esc(String(prep || "").toUpperCase())}</b>`;
    const boss = E.stampHtml?.({ ...bossStamp(bossId), date: when }) || `<b>${esc(BOSS)}</b>`; // 3.99.268: the date inside the stamps
    return `<div class="sign-off"><div class="so-left">${bar ? `<div class="so-bar"><span>${esc(no)}</span><img src="${bar}" alt=""></div>` : ""}<div class="so-issued"><small>${resp || prepId ? "STORE RESPONSIBLE BY" : "ISSUED BY"}</small><div class="so-sign">${pic ? `<img src="${esc(pic)}" alt="Signature">` : ""}</div>${issued}${tbar ? `<div class="so-appr-space"></div>` : ""}</div></div>
      <div class="so-ok">${stamp}<div class="so-sign"></div>${boss}${tbar ? `<div class="so-tbar so-appr"><span>TRX ID <b>${esc(String(trx).toUpperCase())}</b></span><img src="${tbar}" alt=""></div>` : ""}</div></div>`; };
  // 3.99.300: the Daily Sales Report sign-off: left the CASH LEFT stamp and the report no (PDF417); right the line, the
  // Director's stamp and the TRX ID (PDF417)
  const dsrSign = (no, bossId, trx, stamp, when) => {
    const code = (t) => { try { return t && E.pdf417DataUrl ? E.pdf417DataUrl(String(t)) : ""; } catch (_) { return ""; } };
    const bar = code(no), tbar = code(trx && String(trx).toUpperCase());
    const boss = E.stampHtml?.({ ...bossStamp(bossId), date: when }) || `<b>${esc(BOSS)}</b>`;
    return `<div class="dsr-sign"><div class="ds-left">${stamp || ""}${bar ? `<div class="ds-bar ds-foot-l"><img src="${bar}" alt=""><span>${esc(no)}</span></div>` : ""}</div>
      <div class="ds-right"><small>VERIFIED BY</small><div class="ds-line"></div>${boss}${tbar ? `<div class="ds-bar ds-foot-r"><img src="${tbar}" alt=""><span>TRX ID ${esc(String(trx).toUpperCase())}</span></div>` : ""}</div></div>`;
  };
  // 3.99.311: the shop papers: the store logo in place of the company logo; EMON OVERRUNS, then the shop and its branch
  // code, then the shop's address
  const storeHead = (o) => $$(".preview .page .ph2").forEach((h) => {
    if (h.classList.contains("ph-shop3")) return;
    h.classList.add("ph-shop3");
    const ring = h.querySelector(".ph-logo-ring"); if (ring) ring.outerHTML = storeLogo(o, "ph-store");
    const tg = h.querySelector(".ph-tag"); if (tg) tg.textContent = `${String(o.code || "").toUpperCase()} · BRANCH ${bidText(o)}`;
    const ad = h.querySelector(".ph-addr"); if (ad) ad.textContent = String(o.address || "").toUpperCase();
  });
  // 3.99.309: dates on the shop papers read NOV-11-2026
  const shopDate = (d) => { const t = String(d || "").slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return mdy(d); const x = new Date(t + "T00:00:00");
    return `${x.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}-${String(x.getDate()).padStart(2, "0")}-${x.getFullYear()}`; };
  async function printDay(o, date, sales, exps, mine, prev = 0, staff = []) {
    const mdy = shopDate; // 3.99.309
    const r = sales.find((x) => x.sale_date === date) || {}, day = exps.filter((x) => x.exp_date === date);
    // 3.99.229: the sales records before and after this day (the cash left came from / went to)
    const near = (op, asc) => sb.from("outlet_sales").select("id, sale_date, created_at").eq("outlet_id", o.id)[op]("sale_date", date).order("sale_date", { ascending: asc }).limit(1)
      .then(({ data }) => (data || []).filter((x) => (asc ? x.sale_date > date : x.sale_date < date)).sort((a, b) => (asc ? 1 : -1) * String(a.sale_date).localeCompare(String(b.sale_date)))[0] || null, () => null);
    const resp = ((staff || []).map((x) => x.employees).filter(Boolean))[0] || null; // the employee assigned to the store
    const [bossId, dh, before, after] = await Promise.all([loadBoss([r.created_by, resp?.profile_id]), sb.from("outlet_day_hours").select("*").eq("outlet_id", o.id).eq("day", date).maybeSingle().then((r) => r.data, () => null), near("lt", false), near("gt", true)]);
    const xp = day.filter((x) => x.kind === "daily"), co = day.filter((x) => x.kind === "cashout");
    const fmt = (n) => Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const P = mine ? fmt : peso, tot = num(r.total), ex = sum(xp, "amount"), gc = nonCash(r), cash = sum(co, "amount") + gc, left = num(prev) + tot - ex - cash;
    const no = dsrNo(o, date);
    const row = (k, v, cls = "") => `<tr class="${cls}"><td>${k}</td><td class="num">${v}</td></tr>`;
    // 3.99.229: the CASH LEFT stamp: nothing left: VERIFIED; cash left: VERIFIED once the next sales record took it (its date,
    // record no, TRX ID and system time), PENDING until then; less than nothing: CASH SHORT
    const vst = (cls, lines) => `<div class="dsr-cash"><span class="eo-stamp vst ${cls}">${lines}</span></div>`;
    const cashStamp = !r.id ? "" : Math.abs(left) < 0.005 ? vst("ok", `<b>✔ VERIFIED</b><em>CASH LEFT ₱ ${P(0)}</em>`) // 3.99.306: simple: the word and the amount only
      : left < 0 ? vst("bad", `<b>CASH SHORT</b><em>₱ ${P(-left)}</em>`)
      : after ? vst("ok", `<b>✔ VERIFIED</b><em>CASH LEFT ₱ ${P(left)}</em>`)
      : vst("wait", `<b>PENDING</b><em>CASH LEFT ₱ ${P(left)}</em>`);
    const list = (title, rows, cols) => `<div class="soa-sec"><h4>${title}</h4>${rows.length ? `<table class="soa-t"><thead><tr>${cols.map(([l, n]) => `<th${n ? ' class="num"' : ""}>${l}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>` : `<div class="soa-none">None this day.</div>`}</div>`;
    const page = `<div class="soa-doc">${E.printHead("DAILY SALES REPORT", `<div class="soa-no"><small>Sales Record No</small><b class="mono">${esc(no)}</b><small>${esc(mdy(date))}</small>${r.id && r.updated_at && String(r.updated_at).slice(0, 16) !== String(r.created_at).slice(0, 16) ? `<small class="soa-corr">CORRECTED ${esc(mdy(new Date(r.updated_at).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" })))}</small>` : ""}${r.id ? `<small class="soa-trx">TRX ID<span>${esc(String(r.id).toUpperCase())}</span></small>` : ""}</div>`)}
      <div class="soa-info"><div><small>Outlet</small><b>${esc(o.code)}${o.name !== o.code ? ` · ${esc(o.name)}` : ""}</b></div><div><small>Date</small><b>${esc(mdy(date))}</b></div>
        <div class="w2"><small>Address</small><b>${esc(o.address || "—")}</b></div><div><small>Opening Hours</small><b>${esc(hoursOf(o) || "—")}</b></div><div><small>Issued By</small><b>${esc(String(r.created_by_name || "").toUpperCase())}${(() => { const e = r.created_by ? E.stampOf?.(r.created_by, r.created_by_name)?.eoid : ""; return e ? ` <i class="dsr-eoid">· ${esc(e)}</i>` : ""; })()}${r.id && r.updated_at && String(r.updated_at).slice(0, 16) !== String(r.created_at).slice(0, 16) ? ` · CORRECTED BY ${esc(BOSS)}` : ""}</b></div>
        <div class="dsr-resp"><small>Store Responsible</small><b>${resp ? `${esc(`${resp.first_name || ""} ${resp.last_name || ""}`.trim().toUpperCase())}${resp.employee_no ? `<i>${esc(resp.employee_no)}</i>` : ""}${resp.position ? `<i>${esc(String(resp.position).toUpperCase().replace(/^OPERATIONS OFFICER$/, "OPERATIONAL OFFICER"))}</i>` : ""}` : "—"}</b></div>
        <div class="dsr-resp"><small>Report Submitted By</small><b>${esc(BOSS)}${(() => { const e = bossStamp(bossId).eoid; return e ? `<i>${esc(e)}</i>` : ""; })()}</b></div>
        ${r.note ? `<div class="w3"><small>Note</small><b>${esc(r.note)}</b></div>` : ""}</div>
      <div class="soa-tiles t5">${[["Total Sales", tot, "in"], ["From Yesterday", prev, "pay"], ["Expenses", ex, "out"], ["Cash Out", cash, "co"], ["Cash Left", left, `bal${left < 0 ? " neg" : ""}`]].map(([k, v, c]) => `<div class="soa-tile ${c}"><small>${k}</small><b>₱ ${P(v)}</b></div>`).join("")}</div>
      <div class="soa-sec"><h4>Sales</h4><table class="soa-t"><tbody>${PAY.map(([k, l]) => row(l, P(r[k]))).join("")}${row("<b>TOTAL SALES</b>", `<b>${P(tot)}</b>`, "tot")}</tbody></table></div>
      ${list("Expenses", xp.map((x) => `<tr><td>DAILY OPERATION COST</td><td class="num"><b>${P(x.amount)}</b></td></tr>`), [["Description"], ["Amount (₱)", 1]])}
      ${list("Cash Out", [...(gc > 0 ? [`<tr><td>GCash</td><td class="num"><b>${P(gc)}</b></td></tr>`] : []), ...co.map((x) => `<tr><td>${esc(x.payee || "—")}</td><td class="num"><b>${P(x.amount)}</b></td></tr>`)], [["Cash Out To"], ["Amount (₱)", 1]])}
      ${(() => { // 3.99.226: every activity of the day, each with its TRX ID; the employees on duty
        const tm = (at) => (at ? new Date(at).toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }) : "—");
        const acts = [
          ...(r.id && prev > 0.004 && before ? [{ at: r.created_at, what: `Cash left from ${mdy(before.sale_date)} added · ₱ ${P(prev)}`, by: "SYSTEM", id: before.id }] : []),
          ...(r.id ? [{ at: r.created_at, what: `Sales recorded · ₱ ${P(tot)}`, by: r.created_by_name, id: r.id }] : []),
          ...(r.id && r.updated_at && String(r.updated_at).slice(0, 16) !== String(r.created_at).slice(0, 16) ? [{ at: r.updated_at, what: "Sales changed", by: "", id: r.id }] : []),
          ...xp.map((x) => ({ at: x.created_at, what: `Daily operation cost · ₱ ${P(x.amount)}`, by: x.created_by_name, id: x.id })),
          ...co.map((x) => ({ at: x.created_at, what: `Cash out to ${x.payee || "—"} · ₱ ${P(x.amount)}`, by: x.created_by_name, id: x.id })),
          ...(dh ? [{ at: dh.updated_at, what: `Hours of the day · ${dh.opens || "—"} – ${dh.closes || "—"}${dh.note ? ` · ${dh.note}` : ""}`, by: dh.set_by_name, id: "" }] : [])
        ].sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
        const duty = (staff || []).map((x) => x.employees).filter(Boolean);
        return `${acts.length ? `<div class="soa-sec dsr-acts"><h4>Activities</h4><table class="soa-t"><thead><tr><th>Time</th><th>Activity</th><th>By</th><th>TRX ID</th></tr></thead><tbody>
          ${acts.map((a) => `<tr><td>${esc(tm(a.at))}</td><td>${esc(String(a.what || "").replace(/₱\s?/g, "PHP ").toUpperCase())}</td><td>${esc(String(a.by || "—").toUpperCase())}</td><td class="mono dsr-trx">${esc(String(a.id || "—").toUpperCase())}</td></tr>`).join("")}</tbody></table></div>` : ""}
          ${duty.length > 1 ? `<div class="soa-sec dsr-duty"><h4>Employees on Duty</h4>${duty.length ? `<div class="dsr-names">${duty.map((e) => `<span><b>${esc(`${e.first_name || ""} ${e.last_name || ""}`.trim().toUpperCase())}</b>${e.employee_no ? ` · ${esc(e.employee_no)}` : ""}${e.position ? ` · ${esc(String(e.position).toUpperCase())}` : ""}</span>`).join("")}</div>` : `<div class="soa-none">No employee assigned.</div>`}</div>` : ""}`;
      })()}
      ${dsrSign(no, bossId, r.id || "", cashStamp, mdy(date))}</div>`; // 3.99.300: no Store Responsible signature (the name is in the box on top)
    E.openPreview(`Daily Sales Report ${o.code} ${mdy(date)}`, [page], { trx: r.id, issuedOn: date });
    // 3.99.301: the two barcodes go to the bottom of the page: the report no on the left, the TRX ID on the right
    storeHead(o);
    // 3.99.303: the report no barcode goes up into the head, under DAILY SALES REPORT
    $$(".preview .page").forEach((pg) => { pg.classList.add("dsr-page"); const mid = pg.querySelector(".ph2 .ph-mid"), l = pg.querySelector(".ds-foot-l");
      if (l && mid) { l.classList.replace("ds-foot-l", "ds-head-bar"); mid.appendChild(l); } pg.querySelectorAll(".ds-foot-r").forEach((b) => pg.appendChild(b)); });
  }

  // 3.99.164: the OUTLET STATEMENT in a document layout: the company head, the shop, 5 summary boxes, the daily sales,
  // the expenses, the cash out and the stock payments (each a table with its total), and the signatures. A long month
  // goes on to the next page (the table head is repeated there).
  async function printSoa(o, m, d) {
    const mdy = shopDate; // 3.99.309
    const resp = ((d.staff || []).map((x) => x.employees).filter(Boolean))[0] || null; // 3.99.282: the store's own employee signs, not who prints
    const bossId = await loadBoss([resp?.profile_id].filter(Boolean));
    const days = chainDays(d.sales, d.exps); // 3.99.220: the cash left goes on to the next day
    const xps = d.exps.filter((r) => r.kind !== "cashout").sort((a, b) => (a.exp_date < b.exp_date ? -1 : 1));
    const cos = d.exps.filter((r) => r.kind === "cashout").sort((a, b) => (a.exp_date < b.exp_date ? -1 : 1));
    const pays = [...d.pays].sort((a, b) => (a.paid_date < b.paid_date ? -1 : 1));
    const P = (v) => peso(v), Z = (v) => (num(v) ? peso(v) : "");
    const soaNo = `SOA-${o.code}-${m.replace("-", "")}`;
    const sdate = (x) => String(mdy(x) || "").replace(/^([A-Za-z]{3})[A-Za-z]*/, "$1");
    // the blocks of the statement, each with its height in "rows" (to fill the pages)
    const blocks = [];
    const head = `${E.printHead("OUTLET STATEMENT", `<div class="soa-no"><small>Statement No</small><b class="mono">${esc(soaNo)}</b><small>${esc(E.monthText(m))}</small></div>`)}`;
    const info = `<div class="soa-info">
        <div><small>Outlet</small><b>${esc(o.code)}${o.name !== o.code ? ` · ${esc(o.name)}` : ""}</b></div>
        <div><small>Period</small><b>${esc(E.monthText(m))}</b></div>
        <div class="w2"><small>Address</small><b>${esc(o.address || "—")}</b></div>
        <div><small>Opening Hours</small><b>${esc(hoursOf(o) || "—")}</b></div>
        <div><small>Monthly Rental</small><b>₱ ${P(o.monthly_rent)}</b></div>
        ${d.cust ? `<div class="w2"><small>Stock Account</small><b>${esc(E.fullName(d.cust))} · ${esc(d.cust.account_no || "")}</b></div>` : ""}
        <div class="w2 dsr-resp"><small>Store Responsible</small><b>${resp ? `${esc(`${resp.first_name || ""} ${resp.last_name || ""}`.trim().toUpperCase())}${resp.employee_no ? `<i>${esc(resp.employee_no)}</i>` : ""}${resp.position ? `<i>${esc(String(resp.position).toUpperCase().replace(/^OPERATIONS OFFICER$/, "OPERATIONAL OFFICER"))}</i>` : ""}` : "—"}</b></div>
        <div class="w2 dsr-resp"><small>Report Submitted By</small><b>${esc(BOSS)}${(() => { const e = bossStamp(bossId).eoid; return e ? `<i>${esc(e)}</i>` : ""; })()}</b></div></div>`; // 3.99.305
    const tile = (k, v, cls = "") => `<div class="soa-tile ${cls}"><small>${k}</small><b>₱ ${P(v)}</b></div>`;
    const tiles = `<div class="soa-tiles">${tile("Net Sales", d.net, "in")}${tile("Expenses", d.op ?? d.out, "out")}${tile("Cash Out", d.cash || 0, "co")}${tile(m === monthNow() ? "Cash Left to Date" : "Closing Cash Left", d.drawer, "pay")}${tile(m === monthNow() ? "Net Balance to Date" : "Closing Net Balance", d.pool, `bal${d.pool < 0 ? " neg" : ""}`)}</div>
      <div class="soa-pay">${PAY.map(([k, l]) => `<span>${esc(l)} <b>₱ ${P(sum(d.sales, k))}</b></span>`).join("")}<span>Sales days <b>${d.sales.length}</b></span>${d.owed != null ? `<span>Stock to pay <b>₱ ${P(d.owed)}</b></span>` : ""}</div>`;
    blocks.push(head + info + tiles);
    // a table: its title, its head, its rows (split over pages) and its total
    const table = (title, cols, rows, foot) => {
      const th = `<tr>${cols.map(([l, n]) => `<th${n ? ' class="num"' : ""}>${l}</th>`).join("")}</tr>`;
      if (!rows.length) { blocks.push(`<div class="soa-sec"><h4>${title}</h4><div class="soa-none">None this month.</div></div>`); return; }
      blocks.push(`<div class="soa-sec"><h4>${title}</h4><table class="soa-t"><thead>${th}</thead><tbody>${rows.join("")}</tbody><tfoot>${foot}</tfoot></table></div>`);
    };
    table("Daily Sales", [["Date"], ...PAY.map(([, l]) => [l, 1]), ["Total Sales", 1], ["Expenses", 1], ["Cash Out", 1], ["Cash Left", 1]],
      days.map((x) => `<tr><td>${esc(sdate(x.dt))}</td>${PAY.map(([k]) => `<td class="num">${Z(x.r?.[k])}</td>`).join("")}<td class="num"><b>${Z(x.t)}</b></td><td class="num">${Z(x.ex)}</td><td class="num">${Z(x.co)}</td><td class="num"><b>${P(x.left)}</b></td></tr>`),
      `<tr><td>TOTAL</td>${PAY.map(([k]) => `<td class="num">${P(sum(d.sales, k))}</td>`).join("")}<td class="num">${P(d.net)}</td><td class="num">${P(sum(days, "ex"))}</td><td class="num">${P(sum(days, "co"))}</td><td class="num">${P(d.drawer)}</td></tr>`);
    table("Expenses &amp; Bills", [["Date"], ["Type"], ["Paid To / Note"], ["Amount (₱)", 1]],
      xps.map((r) => `<tr><td>${esc(sdate(r.exp_date))}</td><td>${esc(KIND[r.kind] || r.kind)}</td><td>${esc([r.payee, r.note].filter(Boolean).join(" · ") || "—")}</td><td class="num"><b>${P(r.amount)}</b></td></tr>`),
      `<tr><td colspan="3">TOTAL EXPENSES</td><td class="num">${P(d.out)}</td></tr>`);
    table("Cash Out", [["Date"], ["Cash Out To"], ["Note"], ["Amount (₱)", 1]],
      [...d.sales.filter((r) => nonCash(r) > 0).map((r) => ({ exp_date: r.sale_date, payee: "GCash", amount: nonCash(r) })), ...cos].sort((a, b) => (a.exp_date < b.exp_date ? -1 : 1)).map((r) => `<tr><td>${esc(sdate(r.exp_date))}</td><td>${esc(r.payee || "—")}</td><td>${esc(r.note || "—")}</td><td class="num"><b>${P(r.amount)}</b></td></tr>`),
      `<tr><td colspan="3">TOTAL CASH OUT</td><td class="num">${P(d.cash || 0)}</td></tr>`);
    table("Stock Payments", [["Receipt No"], ["Date"], ["Amount (₱)", 1]],
      pays.map((r) => `<tr><td class="mono">${esc(r.receipt_no || "")}</td><td>${esc(sdate(r.paid_date))}</td><td class="num"><b>${P(r.amount)}</b></td></tr>`),
      `<tr><td colspan="2">TOTAL STOCK PAYMENTS</td><td class="num">${P(d.paid)}</td></tr>`);
    // the signatures
    blocks.push(dsrSign(soaNo, bossId, "", "", mdy(isoNow()))); // 3.99.305: no Store Responsible signature // 3.99.228: no sum line box; the tiles show it
    const html = [`<div class="soa-doc">${blocks.join("")}</div>`];
    E.openPreview(`Outlet Statement ${o.code} ${E.monthText(m)}`, html, { trx: null });
    storeHead(o);
    $$(".preview .page").forEach((pg, i) => { const mid = pg.querySelector(".ph2 .ph-mid"), l = pg.querySelector(".ds-foot-l"); // 3.99.305: the statement no barcode in the head
      if (l && mid) { l.classList.replace("ds-foot-l", "ds-head-bar"); mid.appendChild(l); } else if (l) l.remove(); });
  }

  // ======================================================================
  // 3.99.156: REGIONAL OFFICE: one menu item with Purchase Order, Billing and E-Bill inside
  // ======================================================================
  E.regTabs = (on) => { const it = E.regionalItems(); return it.length > 1 ? `<nav class="subnav reg-nav" aria-label="Dhaka office sections"><a href="#regional" class="${on === "regional" ? "on" : ""}">${ic("globe")} Regional Office Dhaka</a>${it.map(([k, l]) => `<a href="#${k}" class="${k === on ? "on" : ""}">${esc(l)}</a>`).join("")}</nav>` : ""; };
  const REG_SAY = { purchase: "Purchase requests, negotiations and approvals", billing: "Company payments and vouchers", inventory: "Shipment bills, release status and payments" };
  V.regional = async () => {
    const it = E.regionalItems();

    E.shell("regional", "Regional Office Dhaka", `<section class="off-staff" id="offStaff" hidden></section><div class="reg-cards">${it.map(([k, l, icon]) => `<a class="reg-card" href="#${k}"><span class="reg-ic">${ic(icon)}</span><div><b>${esc(l)}</b><small>${esc(REG_SAY[k] || "")}</small><em id="regN-${k}"></em></div><span class="reg-go">${ic("next")}</span></a>`).join("")}</div>`);
    const here = E.stillHere();
    officeStaff($("#offStaff"), "dhaka"); E.officeReport?.("Regional Office Dhaka"); // 3.99.326
    const cnt = (q) => q.then((r) => (r.error ? null : r.count), () => null);
    const ask = {
      purchase: () => cnt(sb.from("purchase_orders").select("id", { count: "exact", head: true }).in("status", ["pending", "negotiation"])).then((n) => (n == null ? "" : n ? `${n} waiting for approval` : "Nothing waiting")),
      billing: () => cnt(sb.from("pay_companies").select("id", { count: "exact", head: true }).eq("office","dhaka")).then((n) => (n == null ? "" : `${n} compan${n === 1 ? "y" : "ies"}`)),
      inventory: () => cnt(sb.from("stock_bills").select("id", { count: "exact", head: true }).neq("status", "paid")).then((n) => (n == null ? "" : n ? `${n} not paid yet` : "All paid"))
    };
    await Promise.all(it.map(([k]) => (ask[k] ? ask[k]().then((t) => { if (here() && $(`#regN-${k}`)) $(`#regN-${k}`).textContent = t; }) : null)));
    E.setRecords(`Regional Office Dhaka: ${it.length}`);
  };
})();
