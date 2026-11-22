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

  const PAY = [["cash", "Cash"], ["gcash", "GCash"]]; // 3.99.117: only Cash and GCash (the server keeps the other columns at 0)
  const KIND = { daily: "Daily Expense", rent: "Monthly Rental", supplier: "Supplier Payment", bills: "Bills / Utilities", salary: "Salary", other: "Other Expense", cashout: "Cash Out" };
  const missing = (e) => /outlet|does not exist|schema cache|PGRST20[25]|42P01/.test(`${e?.message || ""} ${e?.code || ""}`);
  const needSql = `<div class="empty">The Outlets need the database update <b>109</b>. Run it on the updates page, then open this page again.</div>`;
  const today = () => E.isoToday();
  const monthNow = () => today().slice(0, 7);
  const monthEnd = (m) => { const [y, mo] = m.split("-").map(Number); return `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, "0")}`; };
  const shiftMonth = (m, d) => { const [y, mo] = m.split("-").map(Number); const t = new Date(y, mo - 1 + d, 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`; };
  const canEdit = () => E.canWrite("outlets");
  const sum = (list, f) => list.reduce((s, r) => s + num(typeof f === "function" ? f(r) : r[f]), 0);
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
    const k = `sl${++logoN}`, top = `EMON OVERRUNS OUTLET · ${String(o.code || "").toUpperCase()}`, bot = `${branchOf(o)} BRANCH`;
    const fit = (t, max) => Math.min(t.length * 5.1, max).toFixed(1);
    return `<span class="store-logo ${cls}" aria-label="${esc(top)} · ${esc(bot)}"><svg viewBox="0 0 120 120" aria-hidden="true">
      <defs><path id="${k}t" d="M18.7 75 A44 44 0 1 1 101.3 75"/><path id="${k}b" d="M11.7 68.5 A49 49 0 0 0 108.3 68.5"/></defs>
      <circle cx="60" cy="60" r="58" class="sl-out"/><circle cx="60" cy="60" r="56" class="sl-gold"/><circle cx="60" cy="60" r="33" class="sl-in"/>
      <text class="sl-t"><textPath href="#${k}t" startOffset="50%" text-anchor="middle" textLength="${fit(top, 160)}" lengthAdjust="spacingAndGlyphs">${esc(top)}</textPath></text>
      <text class="sl-b"><textPath href="#${k}b" startOffset="50%" text-anchor="middle" textLength="${fit(bot, 128)}" lengthAdjust="spacingAndGlyphs">${esc(bot)}</textPath></text></svg>${E.logoHtml("sl-img")}</span>`;
  }
  E.storeLogo = storeLogo;
  // the next branch code: SHOP-1, SHOP-2, SHOP-3 … (the highest number + 1)
  const nextCode = (list) => `SHOP-${Math.max(0, ...list.map((x) => Number((/(\d+)$/.exec(String(x.code || "")) || [])[1] || 0))) + 1}`;
  const empName = (e) => [e?.first_name, e?.middle_name, e?.last_name].filter(Boolean).join(" ").toUpperCase();
  const empty = (t) => `<div class="ol-empty">${t}</div>`; // 3.99.153: for every part of the page (the employee list too)
  // the rental of a month: paid (a rental expense in the month) or its due date
  const rentState = (o, exps, m) => {
    const paid = exps.find((x) => x.kind === "rent");
    if (paid) return { k: "paid", label: `PAID ${mdy(paid.exp_date)}`, short: "RENT PAID" };
    if (!num(o.monthly_rent)) return { k: "none", label: "NO RENTAL", short: "" };
    const day = Math.min(Number(o.rent_day) || 1, Number(monthEnd(m).slice(8)));
    const due = `${m}-${String(day).padStart(2, "0")}`;
    return due < today() ? { k: "overdue", label: `DUE ${mdy(due)} · OVERDUE`, short: "RENT OVERDUE" } : { k: "unpaid", label: `DUE ${mdy(due)}`, short: "RENT NOT PAID" };
  };

  // the money of the shops for a month (and today): sales, expenses, payments of their customer accounts
  async function monthMoney(outlets, m) {
    const ids = outlets.map((o) => o.id), custs = outlets.map((o) => o.customer_id).filter(Boolean);
    if (!ids.length) return { sales: [], exps: [], pays: [] };
    const [s, x, p] = await Promise.all([
      E.allRows(() => sb.from("outlet_sales").select("outlet_id, sale_date, total").in("outlet_id", ids).gte("sale_date", `${m}-01`).lte("sale_date", monthEnd(m))),
      E.allRows(() => sb.from("outlet_expenses").select("outlet_id, exp_date, kind, amount").in("outlet_id", ids).gte("exp_date", `${m}-01`).lte("exp_date", monthEnd(m))),
      custs.length ? E.allRows(() => sb.from("payments_received").select("customer_id, paid_date, amount").in("customer_id", custs).gte("paid_date", `${m}-01`).lte("paid_date", monthEnd(m))) : { data: [] }]);
    if (s.error) throw s.error;
    return { sales: s.data || [], exps: x.data || [], pays: p.data || [] };
  }
  const shopMoney = (o, mm) => {
    const sales = mm.sales.filter((r) => r.outlet_id === o.id), exps = mm.exps.filter((r) => r.outlet_id === o.id);
    const pays = o.customer_id ? mm.pays.filter((r) => r.customer_id === o.customer_id) : [];
    const cash = sum(exps.filter((x) => x.kind === "cashout"), "amount"); // 3.99.157: the cash taken out, apart from the expenses
    const net = sum(sales, "total"), out = sum(exps, "amount") - cash, paid = sum(pays, "amount");
    return { today: sum(sales.filter((r) => r.sale_date === today()), "total"), net, out, cash, paid, bal: net - out - cash - paid, exps };
  };

  // ---------- the Dashboard box: all the shops ----------
  E.outletsBox = async (holder) => {
    const gone = () => holder?.closest(".box")?.remove();
    if (!holder || !E.hasModule("outlets") || (S.hideMoney && !isAdmin())) return gone(); // 3.99.175: no money: no box
    const { data: outlets, error } = await sb.from("outlets").select("*").eq("status", "active").order("code");
    if (error || !outlets?.length) return gone();
    let mm; try { mm = await monthMoney(outlets, monthNow()); } catch (_) { return gone(); }
    const rows = outlets.map((o) => ({ o, ...shopMoney(o, mm) }));
    holder.innerHTML = `<div class="ol-dash">
      <div class="ol-kpis">${kpi("Today · All Outlets", rows.reduce((s, r) => s + r.today, 0))}${kpi(E.monthText(monthNow()), rows.reduce((s, r) => s + r.net, 0))}${kpi("Balance This Month", rows.reduce((s, r) => s + r.bal, 0), "bal")}</div>
      ${rows.map((r) => `<a class="ol-row" href="#outlet/${esc(r.o.id)}"><b>${esc(r.o.code)}<span class="ol-rk" data-oid="${esc(r.o.id)}"></span></b><span>${esc(r.o.name !== r.o.code ? r.o.name : r.o.address || "")}</span><em>₱ ${peso(r.net)}</em><small class="${r.bal < 0 ? "neg" : ""}">Balance ₱ ${peso(r.bal)}</small></a>`).join("")}</div>`;
    rankCards(holder, monthNow());
  };
  // 3.99.178: the month's rank (Top 10 by net sales) on each shop
  const rankCards = (holder, m) => E.outletRanks(m).then((rk) => holder?.querySelectorAll(".ol-rk").forEach((el) => {
    const r = rk.get(el.dataset.oid);
    if (r) el.innerHTML = E.rankNo(r.rank);
  }));
  const kpi = (k, v, cls = "") => `<div class="ol-kpi ${cls}${num(v) < 0 ? " neg" : ""}"><small>${esc(k)}</small><b>₱ ${peso(v)}</b></div>`;

  // ---------- Outlets: the list of the shops ----------
  V.outlets = async () => {
    E.shell("outlets", "Outlets", `<div id="olBody">${busy()}</div>`);
    const here = E.stillHere();
    const { data: outlets, error } = await sb.from("outlets").select("*").order("code");
    if (!here()) return;
    if (error) { $("#olBody").innerHTML = missing(error) ? needSql : `<div class="empty">${esc(error.message)}</div>`; return; }
    const m = monthNow();
    let mm = { sales: [], exps: [], pays: [] };
    try { mm = await monthMoney(outlets.filter((o) => o.status === "active"), m); } catch (e) { console.warn(e); }
    if (!here()) return;
    const rows = outlets.map((o) => ({ o, ...shopMoney(o, mm) }));
    const act = rows.filter((r) => r.o.status === "active");
    $("#olBody").innerHTML = `
      <div class="ol-kpis">${kpi("Today's Sales", act.reduce((s, r) => s + r.today, 0))}${kpi(E.monthText(m), act.reduce((s, r) => s + r.net, 0))}
        ${kpi("Expenses", act.reduce((s, r) => s + r.out, 0))}${kpi("Cash Out", act.reduce((s, r) => s + r.cash, 0))}${kpi("Stock Payments", act.reduce((s, r) => s + r.paid, 0))}${kpi("Balance", act.reduce((s, r) => s + r.bal, 0), "bal")}</div>
      ${isAdmin() ? `<div class="pg-more"><button type="button" class="pg-more-btn" id="olMore" aria-label="More" aria-haspopup="true">⋯</button><div class="pg-more-list" id="olMoreList" hidden><button type="button" id="olNew">${ic("plus")} Add Store</button></div></div>` : ""}
      <div class="ol-cards">${rows.length ? rows.map((r) => {
        const rs = rentState(r.o, r.exps, m);
        return `<a class="ol-card${r.o.status === "closed" ? " closed" : ""}" href="#outlet/${esc(r.o.id)}"><div class="ol-card-micro" aria-hidden="true">${Array.from({ length: 6 }, () => `<span>EMON OVERRUNS</span><span>${esc(bidText(r.o))}</span><span>OFFICIAL OUTLET</span>`).join("")}</div>
          <div class="ol-card-h">${storeLogo(r.o)}<div><div class="ol-code-row"><b class="ol-code">${esc(r.o.code)}</b><span class="ol-rk" data-oid="${esc(r.o.id)}"></span></div><small class="ol-bid">${esc(bidText(r.o))}</small><span>${esc(r.o.name !== r.o.code ? r.o.name : "")}</span></div>${r.o.status === "closed" ? E.pill("closed", "CLOSED") : rs.short ? E.pill(rs.k === "paid" ? "paid" : rs.k === "overdue" ? "overdue" : "pending", rs.short) : ""}</div>
          <div class="ol-card-a">${r.o.address ? `${ic("pin")} ${esc(r.o.address)}` : ""}${r.o.address && hoursOf(r.o) ? " · " : ""}${hoursOf(r.o) ? esc(hoursOf(r.o)) : ""}</div>
          <div class="ol-card-n"><div><small>Today</small><b>₱ ${peso(r.today)}</b></div><div><small>Net Sales</small><b>₱ ${peso(r.net)}</b></div><div><small>Expenses</small><b>₱ ${peso(r.out)}</b></div>
            <div><small>Cash Out</small><b>₱ ${peso(r.cash)}</b></div><div><small>Stock Payments</small><b>₱ ${peso(r.paid)}</b></div><div class="bal${r.bal < 0 ? " neg" : ""}"><small>Balance</small><b>₱ ${peso(r.bal)}</b></div></div></a>`;
      }).join("") : `<div class="empty">${isAdmin() ? "No store yet. Press <b>⋯</b> at the top right, then <b>Add Store</b>: it gets SHOP-1." : "No shop is assigned to you yet. EMON HASAN assigns you on the outlet's page."}</div>`}</div>`;
    rankCards($("#olBody"), m);
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
    const m = E.modal(o ? `Edit ${o.code}` : `Add Store · ${code || `SHOP-${count + 1}`}`, `<div class="formgrid ol-form">
        ${o?.branch_id ? `<div class="span2"><label>Branch ID</label><input value="${esc(String(o.branch_id).replace(/^EO-/, ""))}" readonly class="ro" title="Made by the system, never changed"></div>` : ""}
        <div><label for="olCode">Branch Code</label><input id="olCode" maxlength="30" value="${esc(o ? o.code : code || `SHOP-${count + 1}`)}" readonly class="ro" title="Given by the system"></div>
        <div><label for="olName">Store Name *</label><input id="olName" maxlength="120" value="${v("name", "RETAIL OUTLET")}" required></div>
        <div class="span2"><label for="olAddr">Address</label><input id="olAddr" maxlength="300" value="${v("address")}"></div>
        <div><label for="olOpen">Opening Hours</label><input id="olOpen" type="time" step="300" value="${esc(to24(o?.opens) || (o ? "" : "09:00"))}"></div>
        <div><label for="olClose">Closing Hours</label><input id="olClose" type="time" step="300" value="${esc(to24(o?.closes) || (o ? "" : "21:00"))}"></div>
        <div><label for="olRent">Monthly Rental (₱)</label><input id="olRent" type="number" min="0" step="0.01" value="${v("monthly_rent", "0")}"></div>
        <div><label for="olDay">Rental Due Day (1–31)</label><input id="olDay" type="number" min="1" max="31" value="${v("rent_day")}"></div>
        <div class="span2"><label>Customer Account (the shop's stock: orders, invoices, payments)</label><div id="olCust"></div></div>
        <div class="span2"><label for="olNote">Notes</label><textarea id="olNote" rows="2" maxlength="1000">${v("notes")}</textarea></div>
        ${o ? "" : `<div class="span2"><label for="olLease">Contract of Lease (photos of its pages or a PDF; the pages are saved as one document)</label><input id="olLease" type="file" accept="image/*,application/pdf" multiple></div>`}
        ${o ? `<div><label for="olSt">Status</label><select id="olSt"><option value="active"${o.status === "active" ? " selected" : ""}>Open</option><option value="closed"${o.status === "closed" ? " selected" : ""}>Closed</option></select></div>` : ""}
      </div>`, `<button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" id="olSave">${ic("check")} Save</button>`, { wide: true });
    let cust = o?.customer_id || null;
    E.customerPicker($("#olCust", m.el), { statuses: ["active", "suspended"], preset: preset || undefined, onPick: (c) => (cust = c?.id || null) });
    $("[data-x]", m.el).onclick = () => m.close();
    $("#olSave", m.el).onclick = async (e) => {
      const row = { code: $("#olCode", m.el).value.trim().toUpperCase(), name: $("#olName", m.el).value.trim().toUpperCase(), address: $("#olAddr", m.el).value.trim().toUpperCase() || null,
        opens: hourText($("#olOpen", m.el).value) || null, closes: hourText($("#olClose", m.el).value) || null, monthly_rent: num($("#olRent", m.el).value),
        rent_day: Number($("#olDay", m.el).value) || null, customer_id: cust, notes: $("#olNote", m.el).value.trim() || null, ...(o ? { status: $("#olSt", m.el).value } : {}) };
      if (!row.code || !row.name) return toast("Type the outlet code and name.", true);
      e.target.disabled = true;
      const r = o ? await sb.from("outlets").update(row).eq("id", o.id).select().single() : await sb.from("outlets").insert(row).select().single();
      e.target.disabled = false;
      if (r.error) return fail(r.error, /duplicate|unique/i.test(r.error.message) ? `The code ${row.code} is already used.` : "Could not save the outlet");
      const lease = o ? [] : Array.from($("#olLease", m.el)?.files || []);
      m.close(); toast(o ? "Outlet saved." : `${row.code} added.`);
      if (lease.length) await saveLease(r.data, lease);
      location.hash = "outlet/" + r.data.id; if (o) E.route();
    };
  }

  // ---------- a shop's profile ----------
  V.outlet = async (id, month) => {
    E.shell("outlets", "Outlets", `<div id="olBody">${busy()}</div>`);
    const here = E.stillHere();
    const m = /^\d{4}-\d{2}$/.test(month || "") ? month : monthNow();
    const { data: o, error } = await sb.from("outlets").select("*").eq("id", id).maybeSingle();
    if (!here()) return;
    if (error || !o) { $("#olBody").innerHTML = error && missing(error) ? needSql : `<div class="empty">This outlet was not found. <a href="#outlets">Back to Outlets</a></div>`; return; }
    const first = `${m}-01`, last = monthEnd(m), start = String(o.created_at).slice(0, 10);
    const [st, sales, exps, pays, invs, cust, allS, allX, allP] = await Promise.all([
      sb.from("outlet_staff").select(STAFF_SEL).eq("outlet_id", id).then((r) => r.data || []),
      sb.from("outlet_sales").select("*").eq("outlet_id", id).gte("sale_date", first).lte("sale_date", last).order("sale_date", { ascending: false }).then((r) => r.data || []),
      sb.from("outlet_expenses").select("*").eq("outlet_id", id).gte("exp_date", first).lte("exp_date", last).order("exp_date", { ascending: false }).then((r) => r.data || []),
      o.customer_id ? sb.from("payments_received").select("id, receipt_no, paid_date, amount, method").eq("customer_id", o.customer_id).gte("paid_date", first).lte("paid_date", last).order("paid_date", { ascending: false }).then((r) => r.data || []) : [],
      o.customer_id ? sb.from("invoice_balances").select("id, invoice_no, invoice_date, due_date, total_amount, balance, pay_status").eq("customer_id", o.customer_id).gt("balance", 0).order("invoice_date").then((r) => r.data || []) : [],
      o.customer_id ? sb.from("customers").select("id, first_name, middle_name, last_name, account_no, business_name").eq("id", o.customer_id).maybeSingle().then((r) => r.data) : null,
      E.allRows(() => sb.from("outlet_sales").select("total").eq("outlet_id", id)).then((r) => r.data || []),
      E.allRows(() => sb.from("outlet_expenses").select("amount").eq("outlet_id", id)).then((r) => r.data || []),
      o.customer_id ? E.allRows(() => sb.from("payments_received").select("amount").eq("customer_id", o.customer_id).gte("paid_date", start)).then((r) => r.data || []) : []]);
    if (!here()) return;
    // 3.99.175: an employee without "13 See Balances & History": only the sales and expenses he or she recorded (with their
    // amounts); no totals, balance, stock account or monthly statement
    const mine = !!S.hideMoney && !isAdmin();
    if (mine) { const me = E.meId(); sales.splice(0, sales.length, ...sales.filter((r) => r.created_by === me)); exps.splice(0, exps.length, ...exps.filter((r) => r.created_by === me)); }
    const peso = mine ? (n) => Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : E.peso;
    const ids = [...sales.map((r) => r.id), ...exps.map((r) => r.id)];
    const docs = await E.attachmentsOf("outlet", id).catch(() => []); // 3.99.119: the shop's documents
    const files = ids.length ? ((await sb.from("attachments").select("*").in("owner_type", ["outlet_sales", "outlet_expense"]).in("owner_id", ids).order("created_at", { ascending: false })).data || []) : [];
    if (!here()) return;
    const cash = sum(exps.filter((x) => x.kind === "cashout"), "amount"); // 3.99.140: the cash taken out of the shop
    const net = sum(sales, "total"), out = sum(exps, "amount") - cash, paid = sum(pays, "amount"), bal = net - out - cash - paid;
    const allBal = sum(allS, "total") - sum(allX, "amount") - sum(allP, "amount");
    const owed = sum(invs, "balance"), rs = rentState(o, exps, m), edit = canEdit();
    const byPay = PAY.map(([k, l]) => [l, sum(sales, k)]).filter(([, v]) => v > 0);
    const filesOf = (oid) => files.filter((f) => f.owner_id === oid);
    const photoBtn = (oid) => { const n = filesOf(oid).length; return n ? `<button type="button" class="btn small" data-files="${esc(oid)}">${ic("image")} ${n}</button>` : ""; };
    const del = (tbl, rid) => (isAdmin() ? `<button type="button" class="btn small danger" data-del="${tbl}:${esc(rid)}" title="Remove">${ic("trash")}</button>` : "");

    // 3.99.153: the shop page in a new layout: the head, 4 boxes, the buttons, and tabs (Daily Sales · Expenses & Cash Out ·
    // Stock Account · Employees · Documents). Daily Sales is a day by day table: sales, the day's expenses, cash out, cash left.
    const tools = (tbl, r) => `<span class="ol-tools">${photoBtn(r.id)}${tbl === "outlet_sales" ? (edit ? `<button type="button" class="btn small" data-esale="${esc(r.id)}" title="Edit">${ic("edit")}</button>` : "") : isAdmin() ? `<button type="button" class="btn small" data-eexp="${esc(r.id)}" title="Edit (Director only)">${ic("edit")}</button>` : ""}${del(tbl, r.id)}</span>`;
    const dayOf = (d, k) => sum(exps.filter((x) => x.exp_date === d && x.kind === k), "amount");
    const days = [...new Set([...sales.map((r) => r.sale_date), ...exps.filter((x) => x.kind === "daily" || x.kind === "cashout").map((x) => x.exp_date)])].sort().reverse()
      .map((d) => { const r = sales.find((x) => x.sale_date === d), t = num(r?.total), ex = dayOf(d, "daily"), co = dayOf(d, "cashout"); return { d, r, t, ex, co, left: t - ex - co }; });
    const dEx = sum(days, "ex"), dCo = sum(days, "co");
    const pc = (v) => (num(v) ? peso(v) : "");
    const salesTab = days.length ? `<div class="grid-scroll"><table class="os-t"><thead><tr><th>DATE</th>${PAY.map(([, l]) => `<th class="num">${esc(l.toUpperCase())}</th>`).join("")}<th class="num">TOTAL SALES</th><th class="num">EXPENSES</th><th class="num">CASH OUT</th><th class="num">CASH LEFT</th><th></th></tr></thead><tbody>
        ${days.map((x) => `<tr><td><b>${esc(mdy(x.d))}</b>${x.r?.note ? `<small>${esc(x.r.note)}</small>` : ""}</td>${PAY.map(([k]) => `<td class="num">${pc(x.r?.[k])}</td>`).join("")}<td class="num"><b class="os-in">${pc(x.t)}</b></td><td class="num">${pc(x.ex)}</td><td class="num">${pc(x.co)}</td><td class="num"><b class="${x.left < 0 ? "os-neg" : ""}">${peso(x.left)}</b></td><td><span class="ol-tools"><button type="button" class="btn small" data-day="${esc(x.d)}" title="Day Report">${ic("print")}</button>${x.r ? tools("outlet_sales", x.r) : ""}</span></td></tr>`).join("")}</tbody>
        <tfoot><tr><td>TOTAL</td>${PAY.map(([k]) => `<td class="num">${peso(sum(sales, k))}</td>`).join("")}<td class="num">${peso(net)}</td><td class="num">${peso(dEx)}</td><td class="num">${peso(dCo)}</td><td class="num">${peso(net - dEx - dCo)}</td><td></td></tr></tfoot></table></div>`
      : empty("No sales recorded this month.");
    const xps = exps.filter((r) => r.kind !== "cashout"), cos = exps.filter((r) => r.kind === "cashout");
    const expTab = xps.length ? `<div class="grid-scroll"><table class="os-t"><thead><tr><th>DATE</th><th>TYPE</th><th>PAID TO / NOTE</th><th class="num">AMOUNT</th><th></th></tr></thead><tbody>
        ${xps.map((r) => `<tr><td><b>${esc(mdy(r.exp_date))}</b></td><td><span class="os-kind k-${esc(r.kind)}">${esc(KIND[r.kind] || r.kind)}</span></td><td>${esc([r.payee, r.note].filter(Boolean).join(" · ") || "—")}</td><td class="num"><b>${peso(r.amount)}</b></td><td>${tools("outlet_expenses", r)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="3">TOTAL EXPENSES</td><td class="num">${peso(out)}</td><td></td></tr></tfoot></table></div>`
      : empty("No expense this month.");
    const cashTab = cos.length ? `<div class="grid-scroll"><table class="os-t"><thead><tr><th>DATE</th><th>CASH OUT TO</th><th>NOTE</th><th class="num">AMOUNT</th><th></th></tr></thead><tbody>
        ${cos.map((r) => `<tr><td><b>${esc(mdy(r.exp_date))}</b></td><td><b>${esc(r.payee || "—")}</b></td><td>${esc(r.note || "—")}</td><td class="num"><b class="os-co">${peso(r.amount)}</b></td><td>${tools("outlet_expenses", r)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="3">TOTAL CASH OUT</td><td class="num">${peso(cash)}</td><td></td></tr></tfoot></table></div>`
      : empty("No cash out this month.");
    const invRows = invs.map((r) => `<a class="ol-li link" href="#invoice/${esc(r.id)}"><div class="ol-li-m"><b class="mono">${esc(r.invoice_no)}</b><small>${esc(mdy(r.invoice_date))} · due ${esc(mdy(r.due_date))}</small></div><em class="ol-amt out">₱ ${peso(r.balance)}</em></a>`).join("");
    const payRows = pays.map((r) => `<a class="ol-li link" href="#payment/${esc(r.id)}"><div class="ol-li-m"><b class="mono">${esc(r.receipt_no)}</b><small>${esc(mdy(r.paid_date))}</small></div><em class="ol-amt out">₱ ${peso(r.amount)}</em></a>`).join("");
    const stockTab = cust ? `<a class="ol-acct" href="#customer/${esc(cust.id)}">${ic("user")}<div><b>${esc(E.fullName(cust))}</b><small>${esc(cust.account_no || "")}</small></div><em>To pay ₱ ${peso(owed)}</em></a>
        <div class="os-two"><div><div class="ol-sub">Unpaid Invoices</div>${invRows || empty("No unpaid invoice.")}</div>
          <div><div class="ol-sub">Payments ${esc(E.monthText(m))} <small>taken off the balance</small></div>${payRows || empty("No payment this month.")}</div></div>
        ${E.canWrite("payments") || E.canWrite("invoices") ? `<div class="btnrow"><a class="btn primary small" href="#newpayment/${esc(cust.id)}">${ic("wallet")} Record Payment</a></div>` : ""}`
      : empty(`No customer account linked.${isAdmin() ? " Press <b>Edit Outlet</b> and choose the account that receives this outlet's stock." : ""}`);
    const docTab = `${docs.length ? E.filesHtml(docs) : empty(`No document yet.${isAdmin() ? " Add the <b>Contract of Lease</b>." : ""}`)}
      ${isAdmin() ? `<div class="btnrow"><button type="button" class="btn small primary" id="olLeaseBtn">${ic("doc")} Contract of Lease</button><label class="btn small" for="olDocUp">${ic("upload")} Upload</label><input type="file" id="olDocUp" accept="image/*,application/pdf" multiple hidden></div>` : ""}
      ${o.notes ? `<div class="ol-sub">Notes</div><p class="ol-notes">${esc(o.notes)}</p>` : ""}`;
    const box = (cls, k, v, sub = "") => `<div class="os-kpi ${cls}"><small>${k}</small><b>₱ ${peso(v)}</b>${sub ? `<span>${sub}</span>` : ""}</div>`;
    const tabs = [["Daily Sales", days.length, salesTab], ["Expenses", xps.length, expTab], ["Cash Out", cos.length, cashTab], ...(mine ? [] : [["Stock Account", invs.length, stockTab]]), ["Employees", st.length, staffHtml(st)], ["Achievements", 0, `<div id="osAchTab" data-oid="${esc(o.id)}">${busy()}</div>`], ["Documents", docs.length, docTab]];
    $("#olBody").innerHTML = `
      <section class="os-hero">
        <div class="os-hero-micro" aria-hidden="true">${Array.from({ length: 14 }, () => `<span>EMON OVERRUNS</span><span>${esc(bidText(o))}</span>`).join("")}</div>
        <div class="os-hero-micro low" aria-hidden="true">${Array.from({ length: 14 }, () => `<span>OFFICIAL OUTLET</span><span>${esc(o.code)}</span>`).join("")}</div>
        ${(() => { // 3.99.163: the identity in the rosette: rings of microtext and the shop's ID number
          const idNo = bidText(o); // 3.99.187: without "EO-"
          const ring = (r, txt, n) => `<path id="osR${r}" d="M150 ${150 - r} a${r} ${r} 0 1 1 -0.01 0"/><text><textPath href="#osR${r}" textLength="${(2 * Math.PI * r).toFixed(1)}" lengthAdjust="spacing">${esc(Array.from({ length: n }, () => txt).join(" · "))}</textPath></text>`;
          return `<svg class="os-hero-id" viewBox="0 0 300 300" aria-hidden="true"><g fill="none">${ring(132, `EMON OVERRUNS · ${o.code} · ${o.name}`, 3)}${ring(104, `${idNo} · OFFICIAL OUTLET IDENTITY`, 3)}${ring(78, `${o.code} · EMON OVERRUNS`, 3)}</g>
            <text class="os-id-no" x="150" y="146" text-anchor="middle">${esc(idNo)}</text><text class="os-id-sub" x="150" y="164" text-anchor="middle">OFFICIAL · EMON OVERRUNS</text></svg>`;
        })()}
        <div class="os-hero-top">${storeLogo(o, "big")}
          <div class="os-hero-m"><div class="os-code-row"><span class="os-code">${esc(o.code)}</span></div><h2>${esc(o.name)}</h2>${o.address ? `<p>${ic("pin")} ${esc(o.address)}</p>` : ""}</div></div>
        <div class="os-chips"><span class="os-rank" id="osRankChip" data-oid="${esc(o.id)}" data-m="${esc(m)}" hidden></span><span class="os-bid">${ic("lock")} Branch ID ${esc(bidText(o))}</span><span>${ic("clock")} ${esc(hoursOf(o) || "Hours not set")}</span>${num(o.monthly_rent) && !mine ? `<span>${ic("receipt")} Rent ₱ ${peso(o.monthly_rent)}</span>` : ""}
          ${rs.k === "none" ? "" : `<span class="r-${rs.k}">${rs.k === "paid" ? `${ic("check")} PAID ${esc(shortDay(exps.find((x) => x.kind === "rent")?.exp_date))}` : esc(rs.label)}</span>`}${o.status === "closed" ? `<span class="r-overdue">CLOSED</span>` : ""}</div>
        <div class="os-month"><a href="#outlet/${esc(id)}/${shiftMonth(m, -1)}" aria-label="Previous month">${ic("back")}</a><b>${esc(E.monthText(m))}</b><a href="#outlet/${esc(id)}/${shiftMonth(m, 1)}" aria-label="Next month">${ic("next")}</a></div>
      </section>
      ${mine ? `<div class="banner info os-mine">${ic("shield")} You see only the sales, expenses and cash out you recorded. The totals and the balance are for EMON HASAN.</div>` : ""}
      <div class="os-kpis"${mine ? " hidden" : ""}>${box("in", "Net Sales", net, byPay.map(([l, v]) => `${esc(l)} ₱ ${peso(v)}`).join(" · "))}${box("out", "Expenses", out, `${xps.length} expense(s)`)}${box("co", "Cash Out", cash, `${cos.length} time(s)`)}${box("pay", "Stock Payments", paid, cust ? `To pay ₱ ${peso(owed)}` : "")}
        <div class="os-kpi bal${bal < 0 ? " neg" : ""}"><small>Balance</small><b>₱ ${peso(bal)}</b><span class="${allBal < 0 ? "neg" : ""}">In all ₱ ${peso(allBal)}</span></div></div>
      <div class="os-actions">${edit ? `<button type="button" class="btn primary" id="olSale">${ic("plus")} Daily Sales</button><button type="button" class="btn" id="olExp">${ic("plus")} Expense / Bill</button><button type="button" class="btn" id="olCash">${ic("wallet")} Cash Out</button>` : ""}
        ${mine ? "" : `<button type="button" class="btn" id="olSoa">${ic("print")} Monthly Statement</button>`}${isAdmin() ? `<button type="button" class="btn" id="olEdit">${ic("edit")} Edit Outlet</button>` : ""}</div>
      <div class="tabs os-tabs" id="osTabs">${tabs.map(([t, n], k) => `<button type="button" class="${k ? "" : "on"}" data-t="${k}">${esc(t)}${n ? ` <em>${n}</em>` : ""}</button>`).join("")}</div>
      <div class="tabpanes os-panes" id="osPanes">${tabs.map(([, , html], k) => `<div data-p="${k}" class="os-pane"${k ? " hidden" : ""}>${html}</div>`).join("")}</div>`;
    $$("#osTabs button").forEach((t) => (t.onclick = () => { $$("#osTabs button").forEach((x) => x.classList.toggle("on", x === t)); $$("#osPanes > div").forEach((q) => (q.hidden = q.dataset.p !== t.dataset.t)); }));
    E.keepTab("#osTabs", "outlet:" + id);
    if ($("#olEdit")) $("#olEdit").onclick = () => editOutlet(o);
    if ($("#olLeaseBtn")) $("#olLeaseBtn").onclick = () => leaseForm(o);
    if ($("#olDocUp")) $("#olDocUp").onchange = async (e) => {
      const f = await E.uploadRecords("outlet", o.id, "other", Array.from(e.target.files || []));
      toast(f ? `${f} file(s) could not be uploaded.` : "Document saved.", !!f); E.route();
    };
    E.bindFiles($("#olBody"));
    if ($("#olSale")) $("#olSale").onclick = () => saleForm(o, null, sales);
    $$("[data-esale]").forEach((b) => (b.onclick = () => saleForm(o, sales.find((r) => r.id === b.dataset.esale), sales)));
    if ($("#olExp")) $("#olExp").onclick = () => expenseForm(o);
    if ($("#olCash")) $("#olCash").onclick = () => expenseForm(o, null, "cashout");
    $$("[data-eexp]").forEach((b) => (b.onclick = () => expenseForm(o, exps.find((r) => r.id === b.dataset.eexp))));
    bindStaff($("#olBody"), "outlet", { id: o.id, label: o.code }, st);
    E.outletRanks(m).then((rk) => { // 3.99.185: the rank of the month shown, as a status chip
      const el = $("#osRankChip"), r = rk.get(o.id);
      if (!r || !el || el.dataset.oid !== o.id || el.dataset.m !== m) return;
      el.innerHTML = `RANK ${E.rankNo(r.rank)}`; el.title = `Rank ${r.rank} of ${r.shops} shops · net sales ${E.monthText(m)}`; el.hidden = false;
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
    $$("[data-day]").forEach((b) => (b.onclick = () => printDay(o, b.dataset.day, sales, exps, mine)));
    if ($("#olSoa")) $("#olSoa").onclick = () => printSoa(o, m, { sales, exps, pays, net, out, cash, paid, bal, cust, owed: cust ? owed : null });
    E.setRecords(`Outlet: ${o.code}`);
  };

  // ---------- daily sales: the cash breakdown and the report photo ----------
  function saleForm(o, row, existing) {
    const m = E.modal(`${o.code} · Daily Sales`, `<div class="formgrid ol-form">
        <div><label for="osDate">Date *</label><input id="osDate" type="date" value="${esc(row?.sale_date || today())}" ${row ? "disabled" : ""}></div><div></div>
        ${PAY.map(([k, l]) => `<div><label for="os_${k}">${esc(l)} (₱)</label><input id="os_${k}" class="os-amt" type="number" min="0" step="0.01" inputmode="decimal" value="${row && num(row[k]) ? esc(row[k]) : ""}" placeholder="0.00"></div>`).join("")}
        <div class="span2 ol-total">Total Net Sales <b id="osTot">₱ 0.00</b></div>
        ${row ? "" : `<div><label for="osExp">Daily Expenses (₱)</label><input id="osExp" class="os-amt" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></div>
        <div><label for="osExpN">Expenses For</label><input id="osExpN" maxlength="300" placeholder="e.g. Snacks, transport, plastic bags"></div>
        <div><label for="osOut">Cash Out (₱)</label><input id="osOut" class="os-amt" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></div>
        <div><label for="osOutN">Cash Out To</label><input id="osOutN" maxlength="120" placeholder="e.g. EMON HASAN / bank deposit"></div>
        <div class="span2 ol-left">Cash Left in the Shop <b id="osLeft">₱ 0.00</b></div>`}
        <div class="span2"><label for="osNote">Note</label><input id="osNote" maxlength="500" value="${esc(row?.note || "")}"></div>
        <div class="span2"><label for="osPic">Sales Report Photo</label><input id="osPic" type="file" accept="image/*,application/pdf" multiple></div>
      </div>`, `<button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" id="osSave">${ic("check")} Save</button>`, { wide: true });
    const total = () => PAY.reduce((s, [k]) => s + num($(`#os_${k}`, m.el).value), 0);
    const val = (id) => num($("#" + id, m.el)?.value);
    const show = () => { $("#osTot", m.el).textContent = `₱ ${peso(total())}`; if ($("#osLeft", m.el)) $("#osLeft", m.el).textContent = `₱ ${peso(total() - val("osExp") - val("osOut"))}`; };
    $$(".os-amt", m.el).forEach((i) => (i.oninput = show)); show();
    $("[data-x]", m.el).onclick = () => m.close();
    $("#osSave", m.el).onclick = async (e) => {
      const date = $("#osDate", m.el).value;
      if (!date) return toast("Choose the date.", true);
      if (!total()) return toast("Type the sales amounts.", true);
      // 3.99.157: a day that has its sales already: asked, then changed (the expenses / cash out typed are kept)
      const had = !row && existing.find((r) => r.sale_date === date);
      if (had && !(await E.confirmBox(`<b>${esc(mdy(date))}</b> has its sales already: <b>₱ ${esc(peso(had.total))}</b>.<br><br>Change them to <b>₱ ${esc(peso(total()))}</b>?`, { title: "Daily Sales", ok: "Change" }))) return;
      const target = row || had;
      const data = { outlet_id: o.id, sale_date: date, note: $("#osNote", m.el).value.trim() || had?.note || null, ...(target ? {} : { created_by_name: me() }) };
      PAY.forEach(([k]) => (data[k] = num($(`#os_${k}`, m.el).value)));
      e.target.disabled = true;
      const r = target ? await sb.from("outlet_sales").update(data).eq("id", target.id).select().single() : await sb.from("outlet_sales").insert(data).select().single();
      if (r.error) { e.target.disabled = false; return fail(r.error, /duplicate|unique/i.test(r.error.message) ? `${mdy(date)} has its sales already.` : "Could not save the sales"); }
      // 3.99.140: the day's expenses and the cash taken out, saved with the sales
      const outs = row ? [] : [["daily", val("osExp"), null, $("#osExpN", m.el).value.trim() || null], ["cashout", val("osOut"), $("#osOutN", m.el).value.trim().toUpperCase() || null, null]].filter((x) => x[1] > 0);
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
      E.route();
    };
  }

  // ---------- an expense, bill, supplier payment or the rental ----------
  function expenseForm(o, row = null, kind = "") {
    if (row && !isAdmin()) return toast("Only the Director (EMON HASAN) edits an expense.", true); // 3.99.155
    const v = (k) => esc(row?.[k] ?? "");
    const isCash = (row?.kind || kind) === "cashout"; // 3.99.157: Cash Out has its own simple form
    const kinds = Object.entries(KIND).filter(([k]) => k !== "cashout");
    const m = E.modal(`${o.code} · ${isCash ? (row ? "Edit Cash Out" : "Cash Out") : row ? "Edit Expense" : "Expense / Bill"}`, `<div class="formgrid ol-form">
        <div><label for="oxDate">Date *</label><input id="oxDate" type="date" value="${row ? v("exp_date") : today()}"></div>
        ${isCash ? `<input type="hidden" id="oxKind" value="cashout"><div><label for="oxAmt">Amount (₱) *</label><input id="oxAmt" type="number" min="0.01" step="0.01" inputmode="decimal" value="${v("amount")}"></div>
        <div class="span2"><label for="oxPayee">Cash Out To *</label><input id="oxPayee" maxlength="120" placeholder="e.g. EMON HASAN / bank deposit" value="${v("payee")}"></div>`
        : `<div><label for="oxKind">Type *</label><select id="oxKind">${kinds.map(([k, l]) => `<option value="${k}"${row?.kind === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
        <div><label for="oxPayee">Paid To</label><input id="oxPayee" maxlength="120" placeholder="Supplier / landlord / company" value="${v("payee")}"></div>
        <div><label for="oxAmt">Amount (₱) *</label><input id="oxAmt" type="number" min="0.01" step="0.01" inputmode="decimal" value="${v("amount")}"></div>`}
        <div class="span2"><label for="oxNote">Note</label><input id="oxNote" maxlength="500" value="${v("note")}"></div>
        <div class="span2"><label for="oxPic">${row ? "Add Receipt Photo" : "Receipt Photo"}</label><input id="oxPic" type="file" accept="image/*,application/pdf" multiple></div>
      </div>`, `<button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" id="oxSave">${ic("check")} Save</button>`, { wide: true });
    if (!isCash) $("#oxKind", m.el).onchange = (e) => { if (e.target.value === "rent" && !$("#oxAmt", m.el).value && num(o.monthly_rent)) $("#oxAmt", m.el).value = num(o.monthly_rent).toFixed(2); };
    $("[data-x]", m.el).onclick = () => m.close();
    $("#oxSave", m.el).onclick = async (e) => {
      const data = { outlet_id: o.id, exp_date: $("#oxDate", m.el).value, kind: $("#oxKind", m.el).value, payee: $("#oxPayee", m.el).value.trim().toUpperCase() || null,
        amount: num($("#oxAmt", m.el).value), note: $("#oxNote", m.el).value.trim() || null, ...(row ? {} : { created_by_name: me() }) };
      if (!data.exp_date) return toast("Choose the date.", true);
      if (!(data.amount > 0)) return toast("Type the amount.", true);
      if (isCash && !data.payee) return toast("Type who took the cash (Cash Out To).", true);
      e.target.disabled = true;
      const r = row ? await sb.from("outlet_expenses").update(data).eq("id", row.id).select().single() : await sb.from("outlet_expenses").insert(data).select().single();
      if (r.error) { e.target.disabled = false; return fail(r.error, "Could not save the expense"); }
      const pics = Array.from($("#oxPic", m.el).files || []);
      const failed = pics.length ? await E.uploadRecords("outlet_expense", r.data.id, "receipt", pics) : 0;
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
    const m = E.modal(`${o.code} · Contract of Lease`, `<p class="muted" style="margin-top:0">Add every page of the contract (photos, scanned pages or a PDF). The pages are saved as <b>one document</b>, in this order.</p>
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
  const STAFF_SEL = "employee_id, employees(id, first_name, last_name, employee_no, position)";
  const need114 = (er, word) => (new RegExp(word).test((er && er.message) || "") ? "Run the database update 114 first" : null);
  function staffHtml(st) {
    return `${st.length ? st.map((x) => `<div class="ol-emp"><a href="#employee/${esc(x.employee_id)}"><b>${esc(empName(x.employees))}</b><small>${esc([x.employees?.employee_no, x.employees?.position].filter(Boolean).join(" · "))}</small></a>${isAdmin() ? `<span class="ol-emp-btns"><button type="button" class="btn small" data-stmove="${esc(x.employee_id)}">${ic("next")} Transfer</button><button type="button" class="btn small" data-stdel="${esc(x.employee_id)}" title="Remove">${ic("x")}</button></span>` : ""}</div>`).join("") : empty("No employee assigned.")}
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
  }
  async function assignForm(kind, place, have) {
    const { data, error } = await sb.from("employees").select("id, first_name, last_name, employee_no, position, status").order("first_name");
    if (error) return fail(error, "Could not load the employees");
    const list = (data || []).filter((x) => !have.includes(x.id) && !["closed", "suspended", "rejected", "terminated"].includes(x.status));
    if (!list.length) return toast("Every employee is assigned already (or there is none).");
    const m = E.modal(`${place.label} · Assign Employee`, `<label for="oaEmp">Employee</label><select id="oaEmp">${list.map((x) => `<option value="${esc(x.id)}">${esc(empName(x))}${x.employee_no ? ` · ${esc(x.employee_no)}` : ""}${x.position ? ` · ${esc(x.position)}` : ""}</option>`).join("")}</select>
      <small class="muted">The employee gets a notification.</small>`,
      `<button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" id="oaSave">${ic("check")} Assign</button>`);
    $("[data-x]", m.el).onclick = () => m.close();
    $("#oaSave", m.el).onclick = async (e) => {
      e.target.disabled = true;
      const k = STAFF[kind];
      const r = await sb.from(k.tbl).insert({ [k.col]: place.id, employee_id: $("#oaEmp", m.el).value });
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
      <small class="muted">The employee gets a notification, and the Assigned Location changes.</small>`,
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
  E.staffHtml = staffHtml; E.bindStaff = bindStaff; E.STAFF_SEL = STAFF_SEL;

  // ---------- the monthly statement (SOA): a ledger of the month ----------
  // 3.99.175: the DAILY SALES REPORT of one shop for ONE day: the sales (cash, GCash), the day's expenses and cash out, the cash
  // left, who recorded it, and the signatures. Report No DSR-<shop>-<date>.
  async function printDay(o, date, sales, exps, mine) {
    await Promise.all([E.loadSignatures?.().catch(() => {}), E.loadSigners?.([S.profile?.id]).catch(() => {})]);
    const r = sales.find((x) => x.sale_date === date) || {}, day = exps.filter((x) => x.exp_date === date);
    const xp = day.filter((x) => x.kind !== "cashout"), co = day.filter((x) => x.kind === "cashout");
    const fmt = (n) => Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const P = mine ? fmt : peso, tot = num(r.total), ex = sum(xp, "amount"), cash = sum(co, "amount"), left = tot - ex - cash;
    const no = `DSR-${String(o.code || "").replace(/[^A-Z0-9]/gi, "").toUpperCase()}-${date.replace(/-/g, "")}`;
    const row = (k, v, cls = "") => `<tr class="${cls}"><td>${k}</td><td class="num">${v}</td></tr>`;
    const list = (title, rows, cols) => `<div class="soa-sec"><h4>${title}</h4>${rows.length ? `<table class="soa-t"><thead><tr>${cols.map(([l, n]) => `<th${n ? ' class="num"' : ""}>${l}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>` : `<div class="soa-none">None this day.</div>`}</div>`;
    const dirSig = (() => { const x = E.approvedBy?.(null, "EMON HASAN"); return x?.pic ? `<img src="${esc(x.pic)}" alt="Signature">` : ""; })();
    const page = `<div class="soa-doc">${E.printHead("DAILY SALES REPORT", `<div class="soa-no"><small>Report No</small><b class="mono">${esc(no)}</b><small>${esc(mdy(date))}</small></div>`)}
      <div class="soa-info"><div><small>Outlet</small><b>${esc(o.code)}${o.name !== o.code ? ` · ${esc(o.name)}` : ""}</b></div><div><small>Date</small><b>${esc(mdy(date))}</b></div>
        <div class="w2"><small>Address</small><b>${esc(o.address || "—")}</b></div><div><small>Opening Hours</small><b>${esc(hoursOf(o) || "—")}</b></div><div><small>Recorded By</small><b>${esc(r.created_by_name || "—")}</b></div>
        <div class="w2"><small>Note</small><b>${esc(r.note || "—")}</b></div></div>
      <div class="soa-tiles">${[["Total Sales", tot, "in"], ["Expenses", ex, "out"], ["Cash Out", cash, "co"], ["Cash Left", left, `bal${left < 0 ? " neg" : ""}`]].map(([k, v, c]) => `<div class="soa-tile ${c}"><small>${k}</small><b>₱ ${P(v)}</b></div>`).join("")}</div>
      <div class="soa-sec"><h4>Sales</h4><table class="soa-t"><tbody>${PAY.map(([k, l]) => row(l, P(r[k]))).join("")}${row("<b>TOTAL SALES</b>", `<b>${P(tot)}</b>`, "tot")}</tbody></table></div>
      ${list("Expenses", xp.map((x) => `<tr><td>${esc(KIND[x.kind] || x.kind)}</td><td>${esc([x.payee, x.note].filter(Boolean).join(" · ") || "—")}</td><td class="num"><b>${P(x.amount)}</b></td></tr>`), [["Type"], ["Paid To / Note"], ["Amount (₱)", 1]])}
      ${list("Cash Out", co.map((x) => `<tr><td>${esc(x.payee || "—")}</td><td>${esc(x.note || "—")}</td><td class="num"><b>${P(x.amount)}</b></td></tr>`), [["Cash Out To"], ["Note"], ["Amount (₱)", 1]])}
      <div class="soa-result"><span>Total Sales ₱ ${P(tot)} − Expenses ₱ ${P(ex)} − Cash Out ₱ ${P(cash)}</span><b class="${left < 0 ? "neg" : ""}">CASH LEFT ₱ ${P(left)}</b></div>
      <div class="inv-sealsig soa-sign">${E.sigCol(`Prepared by: ${esc(r.created_by_name || me() || "")}`, E.signerBy?.(r.created_by))}<div class="inv-dir"><div class="inv-dir-sig">${dirSig}</div><div class="line"></div><b>EMON HASAN</b><small>OPERATIONAL DIRECTOR</small></div></div></div>`;
    E.openPreview(`Daily Sales Report ${o.code} ${mdy(date)}`, [page]);
  }

  // 3.99.164: the OUTLET STATEMENT in a document layout: the company head, the shop, 5 summary boxes, the daily sales,
  // the expenses, the cash out and the stock payments (each a table with its total), and the signatures. A long month
  // goes on to the next page (the table head is repeated there).
  async function printSoa(o, m, d) {
    await Promise.all([E.loadSignatures?.().catch(() => {}), E.loadSigners?.([S.profile?.id]).catch(() => {})]);
    const dayOf = (dt, k) => sum(d.exps.filter((x) => x.exp_date === dt && x.kind === k), "amount");
    const days = [...new Set([...d.sales.map((r) => r.sale_date), ...d.exps.filter((x) => x.kind === "daily" || x.kind === "cashout").map((x) => x.exp_date)])].sort()
      .map((dt) => { const r = d.sales.find((x) => x.sale_date === dt), t = num(r?.total), ex = dayOf(dt, "daily"), co = dayOf(dt, "cashout"); return { dt, r, t, ex, co, left: t - ex - co }; });
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
        ${d.cust ? `<div class="w2"><small>Stock Account</small><b>${esc(E.fullName(d.cust))} · ${esc(d.cust.account_no || "")}</b></div>` : ""}</div>`;
    const tile = (k, v, cls = "") => `<div class="soa-tile ${cls}"><small>${k}</small><b>₱ ${P(v)}</b></div>`;
    const tiles = `<div class="soa-tiles">${tile("Net Sales", d.net, "in")}${tile("Expenses", d.out, "out")}${tile("Cash Out", d.cash || 0, "co")}${tile("Stock Payments", d.paid, "pay")}${tile("Balance", d.bal, `bal${d.bal < 0 ? " neg" : ""}`)}</div>
      <div class="soa-pay">${PAY.map(([k, l]) => `<span>${esc(l)} <b>₱ ${P(sum(d.sales, k))}</b></span>`).join("")}<span>Sales days <b>${d.sales.length}</b></span>${d.owed != null ? `<span>Stock to pay <b>₱ ${P(d.owed)}</b></span>` : ""}</div>`;
    blocks.push({ h: 13, html: head + info + tiles });
    // a table: its title, its head, its rows (split over pages) and its total
    const table = (title, cols, rows, foot) => {
      const th = `<tr>${cols.map(([l, n]) => `<th${n ? ' class="num"' : ""}>${l}</th>`).join("")}</tr>`;
      if (!rows.length) { blocks.push({ h: 3, html: `<div class="soa-sec"><h4>${title}</h4><div class="soa-none">None this month.</div></div>` }); return; }
      const PER = 26;
      for (let k = 0; k < rows.length; k += PER) {
        const part = rows.slice(k, k + PER), last = k + PER >= rows.length;
        blocks.push({ h: part.length + 3 + (last ? 1 : 0), html: `<div class="soa-sec"><h4>${title}${k ? " <small>(continued)</small>" : ""}</h4><table class="soa-t"><thead>${th}</thead><tbody>${part.join("")}</tbody>${last ? `<tfoot>${foot}</tfoot>` : ""}</table></div>` });
      }
    };
    table("Daily Sales", [["Date"], ...PAY.map(([, l]) => [l, 1]), ["Total Sales", 1], ["Expenses", 1], ["Cash Out", 1], ["Cash Left", 1]],
      days.map((x) => `<tr><td>${esc(sdate(x.dt))}</td>${PAY.map(([k]) => `<td class="num">${Z(x.r?.[k])}</td>`).join("")}<td class="num"><b>${Z(x.t)}</b></td><td class="num">${Z(x.ex)}</td><td class="num">${Z(x.co)}</td><td class="num"><b>${P(x.left)}</b></td></tr>`),
      `<tr><td>TOTAL</td>${PAY.map(([k]) => `<td class="num">${P(sum(d.sales, k))}</td>`).join("")}<td class="num">${P(d.net)}</td><td class="num">${P(sum(days, "ex"))}</td><td class="num">${P(sum(days, "co"))}</td><td class="num">${P(d.net - sum(days, "ex") - sum(days, "co"))}</td></tr>`);
    table("Expenses &amp; Bills", [["Date"], ["Type"], ["Paid To / Note"], ["Amount (₱)", 1]],
      xps.map((r) => `<tr><td>${esc(sdate(r.exp_date))}</td><td>${esc(KIND[r.kind] || r.kind)}</td><td>${esc([r.payee, r.note].filter(Boolean).join(" · ") || "—")}</td><td class="num"><b>${P(r.amount)}</b></td></tr>`),
      `<tr><td colspan="3">TOTAL EXPENSES</td><td class="num">${P(d.out)}</td></tr>`);
    table("Cash Out", [["Date"], ["Cash Out To"], ["Note"], ["Amount (₱)", 1]],
      cos.map((r) => `<tr><td>${esc(sdate(r.exp_date))}</td><td>${esc(r.payee || "—")}</td><td>${esc(r.note || "—")}</td><td class="num"><b>${P(r.amount)}</b></td></tr>`),
      `<tr><td colspan="3">TOTAL CASH OUT</td><td class="num">${P(d.cash || 0)}</td></tr>`);
    table("Stock Payments", [["Receipt No"], ["Date"], ["Amount (₱)", 1]],
      pays.map((r) => `<tr><td class="mono">${esc(r.receipt_no || "")}</td><td>${esc(sdate(r.paid_date))}</td><td class="num"><b>${P(r.amount)}</b></td></tr>`),
      `<tr><td colspan="2">TOTAL STOCK PAYMENTS</td><td class="num">${P(d.paid)}</td></tr>`);
    // the result and the signatures
    const dirSig = (() => { const x = E.approvedBy?.(null, "EMON HASAN"); return x?.pic ? `<img src="${esc(x.pic)}" alt="Signature">` : ""; })();
    blocks.push({ h: 9, html: `<div class="soa-result"><span>Net Sales ₱ ${P(d.net)} − Expenses ₱ ${P(d.out)} − Cash Out ₱ ${P(d.cash || 0)} − Stock Payments ₱ ${P(d.paid)}</span><b class="${d.bal < 0 ? "neg" : ""}">BALANCE ₱ ${P(d.bal)}</b></div>
      <div class="inv-sealsig soa-sign">${E.sigCol(`Prepared by: ${esc(me() || "")}`, E.signerBy?.(S.profile?.id))}<div class="inv-dir"><div class="inv-dir-sig">${dirSig}</div><div class="line"></div><b>EMON HASAN</b><small>OPERATIONAL DIRECTOR</small></div></div>` });
    // fill the pages
    const CAP = 48, pages = [];
    let cur = [], used = 0;
    for (const b of blocks) {
      if (used + b.h > CAP && cur.length) { pages.push(cur); cur = []; used = 0; }
      cur.push(b.html); used += b.h;
    }
    if (cur.length) pages.push(cur);
    const html = pages.map((pg, i) => `<div class="soa-doc">${i ? `<div class="soa-cont"><b>${esc(C.company.name)}</b> · OUTLET STATEMENT · ${esc(o.code)} · ${esc(E.monthText(m))}<span>${esc(soaNo)}</span></div>` : ""}${pg.join("")}<div class="soa-pg">Page ${i + 1} of ${pages.length}</div></div>`);
    E.openPreview(`Outlet Statement ${o.code} ${E.monthText(m)}`, html);
  }

  // ======================================================================
  // 3.99.156: REGIONAL OFFICE: one menu item with Purchase Order, Billing and E-Bill inside
  // ======================================================================
  E.regTabs = (on) => { const it = E.regionalItems(); return it.length > 1 ? `<nav class="subnav reg-nav"><a href="#regional" class="${on === "regional" ? "on" : ""}">${ic("globe")} Regional Office Dhaka</a>${it.map(([k, l]) => `<a href="#${k}" class="${k === on ? "on" : ""}">${esc(l)}</a>`).join("")}</nav>` : ""; };
  const REG_SAY = { purchase: "Buying lots: requests, negotiation, approval", billing: "Payments to the companies and their vouchers", inventory: "E-Bills of the shipments: ship, released, sold, paid" };
  V.regional = async () => {
    const it = E.regionalItems();
    if (it.length === 1) { location.replace("#" + it[0][0]); return; } // only one page inside: open it
    E.shell("regional", "Regional Office Dhaka", `${E.regTabs("regional")}<div class="reg-cards">${it.map(([k, l, icon]) => `<a class="reg-card" href="#${k}"><span class="reg-ic">${ic(icon)}</span><div><b>${esc(l)}</b><small>${esc(REG_SAY[k] || "")}</small><em id="regN-${k}"></em></div><span class="reg-go">${ic("next")}</span></a>`).join("")}</div>`);
    const here = E.stillHere();
    const cnt = (q) => q.then((r) => (r.error ? null : r.count), () => null);
    const ask = {
      purchase: () => cnt(sb.from("purchase_orders").select("id", { count: "exact", head: true }).in("status", ["pending", "negotiation"])).then((n) => (n == null ? "" : n ? `${n} waiting for approval` : "Nothing waiting")),
      billing: () => cnt(sb.from("pay_companies").select("id", { count: "exact", head: true })).then((n) => (n == null ? "" : `${n} compan${n === 1 ? "y" : "ies"}`)),
      inventory: () => cnt(sb.from("stock_bills").select("id", { count: "exact", head: true }).neq("status", "paid")).then((n) => (n == null ? "" : n ? `${n} not paid yet` : "All paid"))
    };
    await Promise.all(it.map(([k]) => (ask[k] ? ask[k]().then((t) => { if (here() && $(`#regN-${k}`)) $(`#regN-${k}`).textContent = t; }) : null)));
    E.setRecords(`Regional Office Dhaka: ${it.length}`);
  };
})();
