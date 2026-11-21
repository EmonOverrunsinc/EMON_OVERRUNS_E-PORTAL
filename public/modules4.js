/* EMON OVERRUNS E-PORTAL — 10 E-Bill: e-bills in BDT with their own item columns and rows (and the bill uploaded), the
   shipping company, the Released Notice (an order letter: price per box × boxes × exchange rate + shipping fee), the
   Sales Report (net sales, EOO fees, other fees and penalties with receipts; more can be added after PAID), the steps
   1 SHIP → 2 RELEASED → 3 SALES → 4 PAID, the payments (memos in the Director Portal, in PESOS, paid in BDT), the
   profit or loss (shown after PAID) and one E-Bill document with every record, like a statement of account. */
(function () {
  "use strict";
  const E = window.EO;
  const { sb, S, C, esc, peso, isoToday, mdy, $, $$, isAdmin, ebillStep, ebillPill, toast, fail, words, ic, busy, num, qtyText, bdt, verifyUrl } = E;
  const V = window.EO_VIEWS;
  const tools = (...a) => (E.recordTools ? E.recordTools(...a) : "");
  const bindTools = (root) => E.bindRecordTools && E.bindRecordTools(root);
  const signed = (n) => (num(n) < 0 ? "−" : "") + peso(Math.abs(num(n)));
  const sd = (d) => String(mdy(d) || "").replace(/^([A-Za-z]{3})[A-Za-z]*/, "$1"); // 3.99.137: NOV 11 2026 in the print tables (never broken)
  const cap = (s) => String(s || "").replace(/^./, (x) => x.toUpperCase());

  // the steps: 1 SHIP, 2 RELEASED, 3 SALES, 4 PAID (an e-bill marked "arrived" before Update 2.0 is still at SHIP)
  const STATUS = ["shipped", "released", "sold", "paid"];
  const STATUS_NAME = { shipped: "Ship", arrived: "Ship", released: "Released", sold: "Sold", paid: "Paid" };
  const STATUS_AT = { shipped: "created_at", arrived: "arrived_at", released: "released_at", sold: "sold_at", paid: "paid_at" };
  const stepOf = (st) => (st === "arrived" ? 0 : STATUS.indexOf(st));
  const ENTRY = { sales: "Net Sales", eoo_fee: "EOO Fee", fee: "Other Fee", penalty: "Penalty", operational: "Operational Cost" };
  const MAX_COLS = 10;
  const isOpen = (st) => st === "shipped" || st === "arrived";
  // The Released Notice of an e-bill: older ones are order letters; since 3.7 it is written on the e-bill itself.
  const noticesOf = (b, orders) => (orders && orders.length ? orders : b.release_bdt != null
    ? [{ id: "bill", order_no: b.release_order_no, order_date: b.released_at || b.release_date, release_date: b.release_date, status: "applied", release_bdt: b.release_bdt, release_php: b.release_php,
      price_per_box: b.release_price_per_box, exchange_rate: b.release_exchange_rate, shipping_cost: b.shipping_cost, shipping_bill_no: b.shipping_bill_no, approved_by_name: "", created_by_name: "" }] : []);
  const isNum = (c) => c.type !== "text";
  const colHead = (c) => c.name + (c.type === "price" || c.type === "total" ? " (BDT)" : "");
  const cellText = (c, v) => (c.type === "qty" ? qtyText(v) : c.type === "price" || c.type === "total" ? peso(v) : String(v ?? ""));
  // Total Cost = the bill (items) + the released charge + the shipping fee; Total Expenses also counts the EOO fees,
  // other fees and penalties.
  const totalCost = (b) => num(b.total_cost) + num(b.release_bdt) + num(b.shipping_cost);
  const rate = (n) => Number(n || 0).toLocaleString("en-PH", { maximumFractionDigits: 4 });
  // "45 boxes × PHP 3,200.00 = PHP 144,000.00 × 2" — how the released charge was counted
  const chargeText = (b) => `${b.total_boxes ?? 0} boxes × PHP ${peso(b.release_price_per_box)} = PHP ${peso(b.release_php)} × ${rate(b.release_exchange_rate)}`;
  const feesOf = (b) => num(b.eoo_fees) + num(b.other_fees) + num(b.penalties);
  const expensesOf = (b) => totalCost(b) + feesOf(b);
  const profitOf = (b) => num(b.net_sales) - expensesOf(b);
  const profitHtml = (r) => (r.status !== "paid" || r.profit == null ? `<small class="muted">After PAID</small>`
    : `<b class="${num(r.profit) < 0 ? "loss" : "gain"}">${signed(r.profit)}</b>`);

  // ======================================================================
  // E-Bill: the list of e-bills
  // ======================================================================
  const LIST_COLS = [
    { label: "E-Bill No", get: (r) => r.bill_no }, { label: "Bill Date", get: (r) => mdy(r.bill_date) }, { label: "Company", get: (r) => r.company_name || "" },
    { label: "Batch No", get: (r) => r.batch_no || "" }, { label: "Serials", html: (r) => (r._ser ? `<span class="nw mono">${esc(r._ser)}</span>` : "") }, { label: "Ship Date", get: (r) => mdy(r.shipment_date) },
    { label: "Boxes", num: true, get: (r) => r.total_boxes ?? "" },
    { label: "Total Cost (BDT)", key: "cost", num: true, html: (r) => `<b class="bdt">${peso(totalCost(r))}</b>` },
    { label: "Balance (BDT)", key: "bal", num: true, get: (r) => peso(totalCost(r) - num(r.paid_bdt)) },
    { label: "Profit / Loss (BDT)", num: true, html: profitHtml }, { label: "Status", html: (r) => ebillPill(r.status) }
  ];
  V.inventory = async () => {
    const w = E.canWrite("inventory");
    E.shell("inventory", "E-Bill", `${E.regTabs ? E.regTabs("inventory") : ""}
      <div class="tiles" id="ivTiles">${["E-Bills", "At SHIP (Not Released)", "Total Cost (BDT)", "Balance (BDT)", "Net Balance (BDT)"].map((k) => `<div class="tile"><div class="k">${k}</div><div class="v"><span class="spin sm"></span></div></div>`).join("")}</div>
      <div class="btnrow">${w ? `<a class="btn primary" href="#newstockbill">${ic("plus")} Add E-Bill</a>` : ""}</div>
      <div class="tabs" id="ivF"><button type="button" class="on" data-f="">All</button>${STATUS.map((s) => `<button type="button" data-f="${s}">${STATUS_NAME[s].toUpperCase()}</button>`).join("")}</div>
      <div class="inv-find"><input type="search" id="ivQ" placeholder="Search by e-bill no, company, batch no, bill no, system record no or shipping company" aria-label="Search e-bills"></div>
      <div id="ivRes">${busy()}</div>`,
      "E-bills of the goods bought, in BDT. <b>Add E-Bill</b> records the bill with its items. Add the <b>Sales Report</b>, then EMON HASAN marks it <b>PAID</b>: the profit or loss shows after that.");
    const here = E.stillHere();
    // 3.35: every e-bill (also past the 1000 rows the server sends at once), so the tiles count them all
    const { data, error } = await E.allRows(() => sb.from("stock_bill_totals")
      .select("id, bill_no, bill_date, company_name, supplier_bill_no, batch_no, shipment_no, shipment_date, total_boxes, total_qty, total_cost, release_bdt, shipping_cost, paid_bdt, status, profit, shipping_company, shipping_company_code, created_at")
      .order("created_at", { ascending: false }).order("id"));
    if (!here()) return; // another page was opened while the list loaded
    if (error) return fail(error, "Could not load the e-bills (run the 2.1 database update)");
    const all = data || [];
    // 3.99.131: the serial range of each e-bill
    const ser = await E.allRows(() => sb.from("stock_bills").select("id, serial_from, serial_to")).then((r) => r.data || [], () => []);
    if (!here()) return;
    const serOf = new Map(ser.map((x) => [x.id, x.serial_from ? `${x.serial_from}${x.serial_to ? ` – ${x.serial_to}` : ""}` : ""]));
    all.forEach((r) => (r._ser = serOf.get(r.id) || ""));
    const paid = all.filter((r) => r.status === "paid"), profit = paid.reduce((s, r) => s + num(r.profit), 0);
    const due = all.reduce((s, r) => s + totalCost(r) - num(r.paid_bdt), 0);
    const tiles = [["", String(all.length)], ["warn", String(all.filter((r) => isOpen(r.status)).length)], ["", bdt(all.reduce((s, r) => s + totalCost(r), 0))],
      [due > 0 ? "warn" : "ok", bdt(due)], [profit < 0 ? "bad" : "ok", (profit < 0 ? "− " : "") + bdt(Math.abs(profit))]];
    $$("#ivTiles .tile").forEach((t, i) => { t.className = "tile " + tiles[i][0]; $(".v", t).textContent = tiles[i][1]; });
    let f = "";
    const show = () => {
      const q = $("#ivQ").value.trim().toLowerCase();
      const rows = all.filter((r) => (!f || STATUS[stepOf(r.status)] === f)
        && (!q || [r.bill_no, r.company_name, r.batch_no, r.shipment_no, r.supplier_bill_no, r.shipping_company, r.shipping_company_code].join(" ").toLowerCase().includes(q)));
      $("#ivRes").innerHTML = E.grid({ cols: LIST_COLS, rows, onRow: true, foot: { cost: `<b class="bdt">${peso(rows.reduce((s, r) => s + totalCost(r), 0))}</b>`,
        bal: peso(rows.reduce((s, r) => s + totalCost(r) - num(r.paid_bdt), 0)) },
        empty: all.length ? "No e-bills match." : w ? "No e-bills yet. Press Add E-Bill." : "No e-bills yet." });
      E.bindGrid($("#ivRes"), rows, (r) => (location.hash = "stockbill/" + r.id));
      E.setRecords(`E-bills: ${rows.length}`);
    };
    $$("#ivF button").forEach((b) => (b.onclick = () => { $$("#ivF button").forEach((x) => x.classList.toggle("on", x === b)); f = b.dataset.f; show(); }));
    let timer = null;
    $("#ivQ").oninput = () => { clearTimeout(timer); if (all.length > 300) timer = setTimeout(show, 150); else show(); }; // 3.35: a long list is drawn once typing pauses
    show();
  };

  // ======================================================================
  // Add E-Bill: the item table has its own columns (Add Column, rename, remove) and rows (Add Row)
  // ======================================================================
  V.newstockbill = async () => {
    if (!E.canWrite("inventory")) { location.hash = "inventory"; return; }
    E.shell("newstockbill", "Add E-Bill", busy());
    const here = E.stillHere();
    const { data: cos, error } = await sb.from("pay_companies").select("id, name, status").order("name");
    if (!here()) return; // 3.35: not drawn over the page the person went to
    if (error) return fail(error, "Could not load the companies");
    if (!(cos || []).length) {
      $("#main").innerHTML = `<div class="empty">Add the company in Billing first.${E.canWrite("billing") ? ` <a class="btn primary" href="#newpaycompany">Add Company</a>` : " Ask EMON HASAN to add it."}</div>`;
      return;
    }
    const boxCost = await sb.from("ai_settings").select("value").eq("key", "box_cost").maybeSingle().then((r) => num(r.data?.value?.amount) || 3200, () => 3200);
    if (!here()) return;
    $("#main").innerHTML = `
      <form class="window" id="sbForm" novalidate><div class="wtitle">E-Bill (BDT)</div><div class="wbody">
        <div class="summary-box"><div class="fields wide"><span>E-Bill No</span><b id="sbNoPrev"></b><span>Prepared By</span><b>${esc(S.profile.full_name || "")}</b></div></div>
        <fieldset class="opt"><legend>E-Bill</legend><div class="formgrid">
          <div class="fields wide">
            <label for="sbCo">Company *</label><select id="sbCo"><option value="">— Choose company —</option>${cos.map((c) => `<option value="${c.id}">${esc(c.name)}${c.status === "suspended" ? " (SUSPENDED)" : ""}</option>`).join("")}</select>
            <label for="sbAmt">Total Bill Amount (BDT) *</label><input type="number" id="sbAmt" min="0.01" step="0.01" inputmode="decimal" placeholder="e.g. 250000">
            <label for="sbBatch">Batch No *</label><input type="text" id="sbBatch" placeholder="e.g. LL-17">
            <label for="sbBoxes">Total Boxes *</label><input type="number" id="sbBoxes" min="1" step="1" placeholder="e.g. 50">
          </div>
          <div class="fields wide">
            <label for="sbShipDate">Ship Date</label><input type="date" id="sbShipDate" value="${isoToday()}">
            <label for="sbDate">Bill Date</label><input type="date" id="sbDate" value="${isoToday()}">
            <label for="sbRef">Bill No</label><input type="text" id="sbRef" placeholder="Number on the company's bill (optional)">
          </div></div></fieldset>
        <fieldset class="opt"><legend>Box Serial Numbers</legend><div class="formgrid">
          <div class="fields wide">
            <label for="sbCode">Code</label><input type="text" id="sbCode" maxlength="10" placeholder="e.g. A">
            <label for="sbFrom">From Serial</label><input type="text" id="sbFrom" maxlength="40" placeholder="e.g. A2026001">
            <label for="sbTo">To Serial</label><input type="text" id="sbTo" maxlength="40" placeholder="e.g. A2026050">
          </div>
          <div class="fields wide"><span>Boxes in the range</span><b id="sbRange">—</b><span>Shipping bill (at release)</span><b id="sbShipCalc">—</b></div></div></fieldset>
        <fieldset class="opt"><legend>E-Bill Copy</legend><div class="fields wide">
          <label for="sbFile">Upload E-Bill (photo or PDF)</label><input type="file" id="sbFile" accept="image/*,application/pdf" multiple>
          <span>Or</span><label class="btn" for="sbCam">${ic("camera")} Scan / Take Photo</label><input type="file" id="sbCam" accept="image/*" capture="environment" multiple hidden>
          <span></span><div id="sbPrev" class="rcpt-prev">No file chosen</div>
          <label for="sbNotes">Notes</label><input type="text" id="sbNotes"></div></fieldset>
      </div><div class="wfoot"><a class="btn" href="#inventory">Cancel</a><button type="submit" class="btn primary">Save E-Bill</button></div></form>`;
    E.setRecords("New e-bill");
    // The e-bill number: the company's letters, the year and the next number (for example MF-2026-0001).
    let prevAsk = 0;
    const showNo = async () => {
      const co = $("#sbCo").value, ask = ++prevAsk;
      if (!co) { $("#sbNoPrev").textContent = `Choose the company (for example MF-${($("#sbDate").value || isoToday()).slice(0, 4)}-0001)`; return; }
      $("#sbNoPrev").textContent = "…";
      const { data } = await sb.rpc("preview_ebill_no", { p_company: co, p_date: $("#sbDate").value || null });
      if (!$("#sbNoPrev") || ask !== prevAsk) return;
      $("#sbNoPrev").textContent = data ? `${data} (preview)` : "Assigned on save";
    };
    $("#sbCo").addEventListener("change", showNo);
    $("#sbDate").addEventListener("change", showNo);
    showNo();
    // the serial range: A2026001 to A2026050 = 50 boxes (the code and the number of boxes fill each other in)
    const numPart = (v) => { const m = /(\d+)\s*$/.exec(String(v || "")); return m ? m[1] : ""; };
    const calc = () => {
      const f = numPart($("#sbFrom").value), t = numPart($("#sbTo").value), boxes = Math.floor(num($("#sbBoxes").value));
      const n = f && t ? Number(t) - Number(f) + 1 : 0;
      $("#sbRange").textContent = n > 0 ? `${n} box${n === 1 ? "" : "es"}${boxes && boxes !== n ? ` · Total Boxes says ${boxes}` : ""}` : "—";
      $("#sbShipCalc").textContent = boxes ? `${boxes} × PHP ${peso(boxCost)} = PHP ${peso(boxes * boxCost)}` : "—";
    };
    $("#sbFrom").addEventListener("input", () => {
      const v = $("#sbFrom").value.trim().toUpperCase(), code = (/^[A-Z]+/.exec(v) || [""])[0];
      if (code && !$("#sbCode").value.trim()) $("#sbCode").value = code;
      const boxes = Math.floor(num($("#sbBoxes").value)), f = numPart(v);
      if (f && boxes > 0 && !$("#sbTo").dataset.typed) $("#sbTo").value = (v.slice(0, v.length - f.length)) + String(Number(f) + boxes - 1).padStart(f.length, "0");
      calc();
    });
    $("#sbTo").addEventListener("input", () => { $("#sbTo").dataset.typed = "1"; calc(); });
    $("#sbBoxes").addEventListener("input", () => { if ($("#sbFrom").value.trim()) $("#sbFrom").dispatchEvent(new Event("input")); else calc(); });
    const pics = [];
    const showFiles = () => { const fs = [...Array.from($("#sbFile").files || []), ...pics];
      $("#sbPrev").innerHTML = !fs.length ? "No file chosen" : fs.map((f) => /^image\//.test(f.type) ? `<img src="${URL.createObjectURL(f)}" alt="${esc(f.name)}">` : `<span>${esc(f.name)}</span>`).join(""); };
    $("#sbFile").onchange = showFiles;
    $("#sbCam").onchange = (e) => { pics.push(...Array.from(e.target.files || [])); e.target.value = ""; showFiles(); };
    $("#sbForm").onsubmit = async (e) => {
      e.preventDefault();
      const co = $("#sbCo").value, amt = Math.round(num($("#sbAmt").value) * 100) / 100, boxes = Math.floor(num($("#sbBoxes").value));
      if (!co) return toast("Choose the company.", true);
      if (!(amt > 0)) return toast("Enter the total bill amount.", true);
      if (!$("#sbBatch").value.trim()) return toast("Enter the batch no.", true);
      if (boxes < 1) return toast("Enter the total boxes.", true);
      E.setBusy(e.target, true, "Saving");
      const up = (v) => v.trim().toUpperCase() || null;
      const { data: b, error: err } = await sb.from("stock_bills").insert({
        company_id: co, bill_date: $("#sbDate").value || isoToday(), supplier_bill_no: $("#sbRef").value.trim() || null,
        item_columns: [{ name: "Item", type: "text" }, { name: "Qty", type: "qty" }, { name: "Price", type: "price" }, { name: "Total", type: "total" }],
        items: [["TOTAL BILL AMOUNT", 1, amt, amt]], total_boxes: boxes, batch_no: $("#sbBatch").value.trim(), shipment_date: $("#sbShipDate").value || null,
        notes: $("#sbNotes").value.trim() || null, serial_code: up($("#sbCode").value), serial_from: up($("#sbFrom").value), serial_to: up($("#sbTo").value)
      }).select("id, bill_no, total_cost").single();
      if (err) { E.setBusy(e.target, false); return fail(err, /serial_/.test(err.message || "") ? "Run the database update 112 first" : "Could not save the e-bill"); }
      const failed = await E.uploadRecords("stock_bill", b.id, "bill", [...E.filesOf("sbFile"), ...pics]);
      toast(`E-Bill ${b.bill_no} saved — ${bdt(b.total_cost)}.${failed ? " The e-bill copy failed to upload: upload it again on the Files tab." : ""}`, failed > 0);
      location.hash = "stockbill/" + b.id;
    };
  };

  // ======================================================================
  // The e-bill page: status, cost, sales report, Released Notice, payments, files and history
  // ======================================================================
  // Every file of an e-bill: its own, its sales report lines' receipts, its Released Notice's and its payments'.
  async function billFiles(b, entries, orders, vouchers = []) {
    const q = (type, ids) => (ids.length ? sb.from("attachments").select("*").eq("owner_type", type).in("owner_id", ids).order("created_at") : Promise.resolve({ data: [] }));
    const r = await Promise.all([q("stock_bill", [b.id]), q("stock_bill_entry", entries.map((x) => x.id)), q("order_letter", orders.map((x) => x.id)), q("pay_voucher", vouchers.map((x) => x.id))]);
    return r.flatMap((x) => x.data || []);
  }
  function itemsGrid(b) {
    const cols = b.item_columns || [];
    const rows = (b.items || []).map((r, i) => [i + 1, ...r]);
    return E.grid({ cols: [{ label: "No.", num: true, get: (r) => r[0] },
      ...cols.map((c, ci) => ({ label: colHead(c), num: isNum(c), key: c.type === "qty" ? "q" : c.type === "total" ? "t" : undefined, get: (r) => cellText(c, r[ci + 1]) }))],
      rows, foot: { q: qtyText(b.total_qty), t: `<b class="bdt">${peso(b.total_cost)}</b>` }, empty: "No items." });
  }
  const stepsHtml = (b) => `<div class="sb-steps">${STATUS.map((s, i) => {
    const done = stepOf(b.status) >= i, at = b[STATUS_AT[s]];
    return `<div class="sb-step${done ? " on" : ""}${i === stepOf(b.status) ? " cur" : ""}"><span class="dot">${done ? ic("check") : i + 1}</span><b>${STATUS_NAME[s].toUpperCase()}</b><small>${done ? esc(at ? mdy(at) : "—") : ""}</small></div>`;
  }).join("")}</div>`;

  V.stockbill = async (id) => {
    E.shell("stockbill", "E-Bill", busy());
    const here = E.stillHere();
    const [bq, eq, pq, vq, oq, evq] = await Promise.all([
      sb.from("stock_bill_totals").select("*").eq("id", id).maybeSingle(),
      sb.from("stock_bill_entries").select("*").eq("stock_bill_id", id).order("entry_date").order("created_at"),
      sb.from("stock_bill_payments").select("*").eq("stock_bill_id", id).order("pay_date").order("created_at"),
      // payment vouchers linked to the e-bill in Billing before 2.1
      sb.from("pay_vouchers").select("id, voucher_no, pay_date, amount_bdt, method, reference_no").eq("stock_bill_id", id).order("pay_date").order("voucher_no"),
      sb.from("order_letters").select("*").eq("stock_bill_id", id).order("created_at", { ascending: false }),
      sb.from("stock_bill_events").select("*").eq("stock_bill_id", id).order("created_at", { ascending: false }).order("id", { ascending: false })
    ]);
    const b = bq.data;
    if (!here()) return; // another page was opened while this one loaded
    if (!b) { $("#main").innerHTML = `<div class="empty">E-bill not found. <a href="#inventory">Back</a></div>`; return; }
    const entries = eq.data || [], pays = pq.data || [], vouchers = vq.data || [], orders = noticesOf(b, oq.data || []), events = evq.data || [];
    const files = await billFiles(b, entries, orders.filter((o) => o.id !== "bill"), vouchers);
    // 3.99.131: the serial range, the box cost and the net sales of the boxes of the range that are sold
    const sb2 = (await sb.from("stock_bills").select("serial_code, serial_from, serial_to").eq("id", id).maybeSingle().then((r) => r.data, () => null)) || {};
    const boxCost = await sb.from("ai_settings").select("value").eq("key", "box_cost").maybeSingle().then((r) => num(r.data?.value?.amount) || 3200, () => 3200);
    let autoSales = 0, autoBoxes = 0, boxRows = [];
    if (sb2.serial_from && sb2.serial_to) {
      const bx = await E.allRows(() => sb.from("box_stock").select("serial_no, product, brand, ctn, style, qty, batch, price, ship_date, arrival_date, sold_date, sheet_invoice, extra").gte("serial_no", sb2.serial_from).lte("serial_no", sb2.serial_to)).then((r) => r.data || [], () => []);
      const inRange = bx.filter((x) => x.serial_no.length === sb2.serial_from.length);
      const sales = inRange.length ? await sb.from("box_sales").select("serial_no, total").in("serial_no", inRange.slice(0, 900).map((x) => x.serial_no)).then((r) => r.data || [], () => []) : [];
      const sold = new Map(sales.map((x) => [x.serial_no, num(x.total)]));
      for (const x of inRange) {
        const amt = sold.get(x.serial_no) ?? (num(x.price) > 0 ? num(x.price) * num(x.qty) : 0);
        if (amt > 0) { autoSales += amt; autoBoxes++; }
        boxRows.push({ ...x, _sold: amt > 0, _amt: amt });
      }
      boxRows.sort((a, c) => a.serial_no.localeCompare(c.serial_no));
    }
    if (!here()) return;
    const w = E.canWrite("inventory"), admin = isAdmin(), st = b.status;
    const paid = num(b.paid_bdt), balance = totalCost(b) - paid;
    const autoGap = Math.max(0, autoSales - num(b.net_sales));
    const opCost = entries.filter((x) => x.entry_type === "operational").reduce((t, x) => t + num(x.amount), 0);
    const reload = () => V.stockbill(id);
    $(".band h1").textContent = `E-Bill ${b.bill_no}`;
    const banner = st === "paid" ? `<div class="banner ok">✔ PAID — marked by ${esc(b.paid_by_name || "")} on ${mdy(b.paid_at)}. The profit or loss and the secret code are on the E-Bill. More sales reports can still be added.</div>` : "";
    const profitTile = st === "paid"
      ? [profitOf(b) < 0 ? "bad" : "ok", profitOf(b) < 0 ? "Net Loss (BDT)" : "Net Profit (BDT)", peso(Math.abs(profitOf(b)))]
      : ["muted", "Net Profit / Loss", "Shown after PAID"];
    const tiles = [["", "Bill Cost (BDT)", peso(b.total_cost)], ["", "Shipping Fee (BDT)", b.release_bdt == null && b.shipping_cost == null ? "—" : peso(num(b.release_bdt) + num(b.shipping_cost))], ["", "Total Cost (BDT)", peso(totalCost(b))],
      ["ok", "Paid (BDT)", peso(paid)], [balance > 0 ? "warn" : "ok", "Balance (BDT)", peso(balance)],
      ["warn", "Fees and Penalties (BDT)", peso(feesOf(b))], ["ok", "Net Sales (BDT)", peso(b.net_sales)], profitTile];
    const acts = [];
    if (w && isOpen(st)) acts.push(`<button type="button" class="btn primary" id="sbRelease">${ic("doc")} Released Notice</button>`);
    if (admin && st === "released" && !entries.some((x) => x.entry_type === "sales") && b.release_order_no) acts.push(`<button type="button" class="btn danger" id="sbUnrelease">${ic("back")} Undo Released Notice</button>`);
    // sales reports, fees and penalties can still be added after PAID
    if (w && !isOpen(st)) acts.push(`<button type="button" class="btn primary" id="sbSales">${ic("plus")} Add Sales Report</button>`);
    if (w) acts.push(`<button type="button" class="btn" id="sbFee">${ic("plus")} Add Cost / Fee</button>`);
    if (w && st === "released") acts.push(`<button type="button" class="btn" id="sbSold">${ic("check")} Mark as SOLD</button>`);
    if (admin && st === "sold") acts.push(`<button type="button" class="btn ok" id="sbPaid">${ic("check")} Mark as PAID</button>`);
    const entryFile = (r) => files.find((a) => a.owner_type === "stock_bill_entry" && a.owner_id === r.id);
    const receiptCell = (r) => {
      const f = entryFile(r);
      if (f) return `<button type="button" class="btn small" data-open="${esc(f.storage_path)}" data-mime="${esc(f.mime || "")}" data-name="${esc(f.file_name)}">${ic("eye")} View</button>`;
      if (r.entry_type !== "fee" && r.entry_type !== "penalty") return "—";
      return `<span class="pill unpaid">MISSING</span>${w ? ` <label class="btn small" for="up_${r.id}">${ic("upload")} Upload</label><input type="file" id="up_${r.id}" hidden accept="image/*,application/pdf" data-save-now data-entry="${r.id}">` : ""}`;
    };
    const entryCols = [
      { label: "Date", get: (r) => mdy(r.entry_date) }, { label: "Type", html: (r) => `<span class="et ${r.entry_type}">${esc(ENTRY[r.entry_type] || r.entry_type)}</span>` },
      { label: "Receipt No", get: (r) => r.receipt_no || "" }, { label: "Description", get: (r) => r.description || "" },
      { label: "Amount (BDT)", num: true, html: (r) => `<b>${peso(r.amount)}</b>` }, { label: "Receipt", html: receiptCell }, { label: "Added By", get: (r) => r.created_by_name || "" },
      { label: "", html: (r) => tools("stock_bill_entries", r, `${ENTRY[r.entry_type] || ""} ${bdt(r.amount)} on ${b.bill_no}`, { reload }) }
    ];
    // Payments: the memos paid before 3.5 (and payment vouchers linked in Billing before 2.1)
    const payRows = payRowsOf(pays, vouchers);
    const payCols = [{ label: "Date", get: (r) => mdy(r.date) }, { label: "Memo No", get: (r) => r.no }, { label: "Subject", get: (r) => r.what },
      { label: "Amount (PHP)", num: true, get: (r) => (r.php == null ? "" : peso(r.php)) }, { label: "Rate", num: true, get: (r) => (r.rate == null ? "" : rate(r.rate)) },
      { label: "Amount (BDT)", key: "a", num: true, html: (r) => `<b class="bdt">${peso(r.bdt)}</b>` }, { label: "Approved By", get: (r) => r.by || "" }];
    const evCols = [{ label: "Date / Time", get: (r) => E.dateTime(r.created_at) }, { label: "What Happened", get: (r) => cap(r.action) }, { label: "Note", get: (r) => r.note || "" }, { label: "By", get: (r) => r.actor_name || "" }];
    const sum4 = [["Net Sales", b.net_sales, "ok"], ["EOO Fees", b.eoo_fees], ["Other Fees", b.other_fees], ["Penalties", b.penalties]];
    const balText = balance > 0 ? `balance ${bdt(balance)}` : balance < 0 ? `overpaid ${bdt(-balance)}` : "fully paid";
    $("#main").innerHTML = `${banner}
      <section class="cust-hero sb-hero st-${esc(st)}"><div class="ch-photo sb-ic">${ic("box")}</div>
        <div class="ch-main"><div class="ch-name"><h2>${esc(b.bill_no)}</h2>${ebillPill(st)}</div>
          <div class="ch-sub"><b>${esc(b.company_name || "")}</b>${b.supplier_bill_no ? ` · Bill No ${esc(b.supplier_bill_no)}` : ""} · Bill Date ${mdy(b.bill_date)}</div>
          <div class="ch-ids">${E.idBox("Batch No", b.batch_no)}${E.idBox("Total Boxes", b.total_boxes == null ? "" : String(b.total_boxes))}${E.idBox("Serials", sb2.serial_from ? `${sb2.serial_from}${sb2.serial_to ? " – " + sb2.serial_to : ""}` : "")}${E.idBox("Ship Date", mdy(b.shipment_date))}${E.idBox("Released Date", mdy(b.release_date))}${b.shipment_no ? E.idBox("System Record No", b.shipment_no) : ""}${b.shipping_company ? E.idBox("Shipping Company", b.shipping_company) : ""}</div></div></section>
      ${stepsHtml(b)}
      ${st === "paid" ? `<section class="sb-final"><header>${ic("check")} <b>E-BILL SUMMARY · PAID</b><button type="button" class="btn small primary" id="sbFinalDl">${ic("download")} Download E-Bill</button></header>
        <table><tbody>
          <tr class="in"><th>Total Net Sales</th><td>${bdt(b.net_sales)}</td></tr>
          <tr><th>Bill Amount</th><td>${bdt(b.total_cost)}</td></tr>
          <tr><th>Shipping Fee</th><td>${bdt(num(b.release_bdt) + num(b.shipping_cost))}</td></tr>
          <tr><th>Operational Cost</th><td>${bdt(opCost)}</td></tr>
          <tr><th>EOO Fees · Other Fees · Penalties</th><td>${bdt(num(b.eoo_fees) + num(b.other_fees) - opCost + num(b.penalties))}</td></tr>
          <tr class="sub"><th>Sub Total · All Costs</th><td>${bdt(expensesOf(b))}</td></tr>
          <tr class="${profitOf(b) < 0 ? "loss" : "gain"}"><th>${profitOf(b) < 0 ? "Net Loss" : "Net Profit"}</th><td>${profitOf(b) < 0 ? "− " : ""}${bdt(Math.abs(profitOf(b)))}</td></tr>
        </tbody></table></section>` : ""}
      <div class="tiles sb-tiles">${tiles.map(([k, l, v]) => `<div class="tile ${k}"><div class="k">${l}</div><div class="v">${esc(v)}</div></div>`).join("")}</div>
      ${b.release_bdt != null ? `<div class="due-info">Shipping fee: <b>${esc(chargeText(b))}${num(b.shipping_cost) ? ` + BDT ${peso(b.shipping_cost)}` : ""} = ${bdt(num(b.release_bdt) + num(b.shipping_cost))}</b></div>` : ""}
      <div class="actionbar">${acts.join("")}<span class="grow"></span>${tools("stock_bills", b, `E-Bill ${b.bill_no}`, { reload, afterDelete: () => (location.hash = "inventory") })}</div>
      <div class="docgrid">${E.docCard({ key: "sb", title: `E-Bill ${b.batch_no || b.bill_no}`, ownerType: "stock_bill", ownerId: b.id, att: [], print: () => printEbill(b.id), canUpload: false,
        sub: `${b.bill_no} · every record, like a statement of account · total cost ${bdt(totalCost(b))} · ${balText}${st === "paid" ? " · with the profit or loss and the secret code" : ""}` })}</div>
      <div class="tabs" id="sbTabs">${[`Bill`, `Sales Report (${entries.length})`, `Released Notice (${orders.length})`, `Payments (${payRows.length})`, `Files (${files.length})`, ...(sb2.serial_from ? [`Boxes (${boxRows.length})`] : []), `History (${events.length})`]
        .map((l, i) => `<button type="button" class="${i ? "" : "on"}" data-t="${i}">${l}</button>`).join("")}</div>
      <div class="tabpanes" id="sbPanes">
        <div data-p="0">${(b.items || []).length === 1 && /^TOTAL BILL AMOUNT$/.test(String((b.items[0] || [])[0])) ? `<div class="sb-sum"><div class="ok"><small>Total Bill Amount (BDT)</small><b>${peso(b.total_cost)}</b></div><div><small>Total Boxes</small><b>${esc(b.total_boxes ?? 0)}</b></div><div><small>Serials</small><b class="mono">${esc(sb2.serial_from || "—")}${sb2.serial_to ? ` – ${esc(sb2.serial_to)}` : ""}</b></div></div>` : itemsGrid(b)}${b.notes ? `<p class="muted"><b>Notes:</b> ${esc(b.notes)}</p>` : ""}</div>
        <div data-p="1" hidden><div class="sb-sum">${sum4.map(([k, v, c]) => `<div class="${c || ""}"><small>${k} (BDT)</small><b>${peso(v)}</b></div>`).join("")}</div>
          <div id="sbEntries">${E.grid({ cols: entryCols, rows: entries, empty: isOpen(st) ? "No sales report yet. Net sales can be added after the e-bill is released; EOO fees, other fees and penalties at any time." : "No sales report yet." })}</div></div>
        <div data-p="2" hidden><div id="sbOrders">${E.grid({ cols: [{ label: "Notice No", get: (r) => r.order_no }, { label: "Date", get: (r) => mdy(r.order_date) }, { label: "Released", get: (r) => mdy(r.release_date) },
          { label: "Charge (BDT)", num: true, get: (r) => (r.release_bdt == null ? "" : peso(r.release_bdt)) }, { label: "Shipping (BDT)", num: true, get: (r) => (r.shipping_cost == null ? "" : peso(r.shipping_cost)) }], rows: orders, empty: "No Released Notice yet. Press Released Notice to write it." })}</div>
          ${orders.length ? `<div class="btnrow"><button type="button" class="btn" id="sbNoticePrint">${ic("print")} Print Released Notice</button></div>` : w && isOpen(st) ? `<div class="btnrow"><button type="button" class="btn primary" data-release>${ic("doc")} Released Notice</button></div>` : ""}</div>
        <div data-p="3" hidden><div class="due-info">Total Cost: <b>${bdt(totalCost(b))}</b> · Paid: <b>${bdt(paid)}</b> · Balance: <b>${bdt(balance)}</b></div>
          <div id="sbPays">${E.grid({ cols: payCols, rows: payRows, onRow: E.canOpen("voucher"), foot: { a: `<b class="bdt">${peso(paid)}</b>` },
            empty: "No payments yet." })}</div></div>
        <div data-p="4" hidden>${E.filesHtml(files, "No files uploaded.")}
          ${w ? `<div class="sb-up"><label for="sbUpKind">Add File</label><select id="sbUpKind">${[["bill", "E-Bill Copy"], ["shipping_bill", "Shipping Fee Receipt"], ["sales_report", "Sales Report"], ["receipt", "Receipt"], ["other", "Other"]].map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
            <label class="btn" for="sbUpFile">${ic("upload")} Choose File</label><input type="file" id="sbUpFile" hidden multiple accept="image/*,application/pdf" data-save-now></div>` : ""}</div>
        <div data-p="${sb2.serial_from ? 6 : 5}" hidden>${E.grid({ cols: evCols, rows: events, empty: "No history yet." })}</div>
        ${sb2.serial_from ? `<div data-p="5" hidden>
          <div class="sb-sum"><div><small>Boxes</small><b>${boxRows.length} of ${esc(b.total_boxes ?? 0)}</b></div><div><small>In Stock</small><b>${boxRows.filter((x) => !x._sold).length}</b></div><div class="ok"><small>Sold</small><b>${autoBoxes}</b></div><div class="ok"><small>Net Sales</small><b>${peso(autoSales)}</b></div></div>
          ${w && autoGap > 0.004 && !isOpen(st) ? `<div class="btnrow"><button type="button" class="btn primary" id="sbAutoAdd">${ic("plus")} Add Net Sales ${esc(bdt(autoGap))}</button></div>` : ""}
          <div id="sbBoxes">${E.grid({ cols: [{ label: "Serial", html: (x) => `<b class="mono nw">${esc(x.serial_no)}</b>` }, { label: "Product", get: (x) => x.product || "" }, { label: "Brand", get: (x) => x.brand || "" },
            { label: "CTN", get: (x) => x.ctn || "" }, { label: "Style", get: (x) => (x.style && x.style !== "-" ? x.style : "") }, { label: "Qty", num: true, key: "q", get: (x) => qtyText(x.qty) },
            { label: "Ship Date", get: (x) => mdy(x.ship_date || b.shipment_date) }, { label: "Company", get: (x) => x.extra?.COMPANY || b.company_name || "" },
            { label: "Code", get: (x) => sb2.serial_code || (/^[A-Z]+/i.exec(x.serial_no) || [""])[0].toUpperCase() },
            { label: "Status", html: (x) => (x._sold ? E.pill("paid", "SOLD") : E.pill("pending", "IN STOCK")) }], rows: boxRows, onRow: true,
            foot: { q: qtyText(boxRows.reduce((t, x) => t + num(x.qty), 0)) }, empty: "No box of this serial range is on the server yet (EVA Records › Read Sheet)." })}</div></div>` : ""}
      </div>`;
    $$("#sbTabs button").forEach((t) => (t.onclick = () => { $$("#sbTabs button").forEach((x) => x.classList.toggle("on", x === t)); $$("#sbPanes > div").forEach((p) => (p.hidden = p.dataset.p !== t.dataset.t)); }));
    E.keepTab("#sbTabs", "ebill:" + id);
    E.bindGrid($("#sbPays"), payRows, (r) => {
      if (r.vid && E.canOpen("voucher")) location.hash = "voucher/" + r.vid;
    });
    if ($("#sbBoxes")) E.bindGrid($("#sbBoxes"), boxRows, (x) => (location.hash = "find/" + encodeURIComponent(x.serial_no)));
    E.bindFiles($("#main"));
    E.bindDocCards($("#main"), reload);
    bindTools($("#main"));
    $$("#sbRelease, [data-release]").forEach((x) => (x.onclick = () => releaseDialog({ ...b, _boxCost: boxCost }, reload)));
    // 3.99.131: the net sales worked out from the sold boxes of the serial range: add the part not recorded yet
    if ($("#sbAutoAdd")) $("#sbAutoAdd").onclick = async (e) => {
      e.target.disabled = true;
      const { error } = await sb.from("stock_bill_entries").insert({ stock_bill_id: b.id, entry_type: "sales", entry_date: isoToday(), amount: Math.round(autoGap * 100) / 100,
        description: `NET SALES OF THE SOLD BOXES ${sb2.serial_from || ""}${sb2.serial_to ? " – " + sb2.serial_to : ""}`.trim() });
      if (error) { e.target.disabled = false; return fail(error, "Could not add the net sales"); }
      toast(`Net sales ${bdt(autoGap)} added.`); reload();
    };
    if ($("#sbUnrelease")) $("#sbUnrelease").onclick = async () => {
      if (!(await E.confirmBox(`Undo the Released Notice <b>${esc(b.release_order_no)}</b> of <b>${esc(b.bill_no)}</b>? The e-bill goes back to SHIP and the released charge and shipping fee are taken off.`, { ok: "Undo", danger: true }))) return;
      const { error } = await sb.rpc("unrelease_stock_bill", { p_id: b.id });
      if (error) return fail(error, "Could not undo the Released Notice");
      toast("Released Notice undone. The e-bill is at SHIP again."); reload();
    };
    if ($("#sbFinalDl")) $("#sbFinalDl").onclick = () => printEbill(b.id);
    if ($("#sbNoticePrint")) $("#sbNoticePrint").onclick = () => E.openPreview(`Released Notice ${orders[0]?.order_no || b.bill_no}`, [noticePage(b, orders[0])]);
    if ($("#sbSold")) $("#sbSold").onclick = () => statusDialog(b, "sold", reload);
    if ($("#sbPaid")) $("#sbPaid").onclick = () => statusDialog(b, "paid", reload);
    if ($("#sbSales")) $("#sbSales").onclick = () => salesDialog(b, reload);
    if ($("#sbFee")) $("#sbFee").onclick = () => feeDialog(b, reload);
    $$("[data-entry]").forEach((inp) => (inp.onchange = async (e) => {
      const fs = Array.from(e.target.files).slice(0, 1); if (!fs.length) return;
      const here = E.stillHere(), f = await E.uploadRecords("stock_bill_entry", inp.dataset.entry, "receipt", fs);
      toast(f ? "The receipt failed to upload." : "Receipt uploaded.", f > 0);
      if (here()) reload();
    }));
    if ($("#sbUpFile")) $("#sbUpFile").onchange = async (e) => {
      const fs = Array.from(e.target.files); if (!fs.length) return;
      const here = E.stillHere(), f = await E.uploadRecords("stock_bill", id, $("#sbUpKind").value, fs);
      toast(f ? `${f} file(s) failed to upload.` : "File uploaded.", f > 0);
      if (here()) reload();
    };
    E.setRecords(`E-Bill: ${b.bill_no}`);
  };
  // The payments of an e-bill, oldest first: memos approved in the Director Portal (PHP × rate = BDT), and payment
  // vouchers linked to it in Billing before 2.1.
  const payRowsOf = (pays, vouchers) => [
    ...pays.map((p) => ({ date: p.pay_date, no: p.order_no, oid: p.order_id, what: p.subject || "Memo", php: p.amount_php, rate: p.exchange_rate, bdt: num(p.amount_bdt), by: p.approved_by_name || "" })),
    ...vouchers.map((v) => ({ date: v.pay_date, no: v.voucher_no, vid: v.id, what: "Payment voucher", php: null, rate: null, bdt: num(v.amount_bdt), by: "" }))
  ].sort((x, y) => String(x.date).localeCompare(String(y.date)));

  // Mark as SALES (inventory) or PAID (the Director), with an optional note.
  // Released Notice: written on the e-bill. price per box x total boxes = PHP; x exchange rate = released charge (BDT); + shipping fee.
  function releaseDialog(b, reload) {
    const boxes = num(b.total_boxes);
    const m = E.modal(`Released Notice — ${b.batch_no || b.bill_no}`, `
      <div class="summary-box"><div class="fields wide"><span>E-Bill</span><b>${esc(b.bill_no)}${b.batch_no ? " · batch " + esc(b.batch_no) : ""}</b><span>Company</span><b>${esc(b.company_name || "")}</b>
        <span>Total Boxes</span><b>${boxes}</b><span>Bill Cost (BDT)</span><b>${peso(b.total_cost)}</b></div></div>
      <div class="fields wide" style="margin-top:10px">
        <label for="rnDate">Released Date *</label><input type="date" id="rnDate" value="${isoToday()}">
        <label for="rnPrice">Price per Box (PHP) *</label><input type="number" id="rnPrice" min="0" step="0.01" inputmode="decimal">
        <label for="rnRate">Exchange Rate (BDT for 1 PHP) *</label><input type="number" id="rnRate" min="0" step="0.0001" inputmode="decimal">
        <label for="rnShip">Shipping Fee (BDT) *</label><input type="number" id="rnShip" min="0" step="0.01" inputmode="decimal" placeholder="0 if none">
        <label for="rnBill">Shipping Bill No</label><input type="text" id="rnBill" maxlength="60" placeholder="Optional"></div>
      <div class="rn-calc" id="rnCalc"></div>`,
      `<button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" data-ok>Release E-Bill</button>`, { wide: true });
    const calc = () => {
      const price = num($("#rnPrice", m.el).value), rt = num($("#rnRate", m.el).value), ship = num($("#rnShip", m.el).value);
      const php = Math.round(price * boxes * 100) / 100, chg = Math.round(php * rt * 100) / 100;
      $("#rnCalc", m.el).innerHTML = price > 0 && rt > 0 ? `${boxes} boxes × PHP ${peso(price)} = <b>PHP ${peso(php)}</b> × ${rate(rt)} = <b>BDT ${peso(chg)}</b> released charge<br>+ shipping fee BDT ${peso(ship)}
        → total cost <b>BDT ${peso(num(b.total_cost) + chg + ship)}</b>` : `<span class="muted">Write the price per box and the exchange rate: the released charge is worked out here.</span>`;
    };
    $$("input", m.el).forEach((i) => (i.oninput = calc)); calc();
    $("[data-x]", m.el).onclick = m.close;
    $("[data-ok]", m.el).onclick = async () => {
      const g = (id) => $("#" + id, m.el).value;
      if (!g("rnDate")) return toast("Enter the released date.", true);
      if (!(num(g("rnPrice")) > 0)) return toast("Enter the price per box (PHP).", true);
      if (!(num(g("rnRate")) > 0)) return toast("Enter the exchange rate (BDT for 1 PHP).", true);
      if (g("rnShip") === "") return toast("Enter the shipping fee (0 if there is none).", true);
      const btn = $("[data-ok]", m.el); btn.disabled = true;
      const { data, error } = await sb.rpc("release_stock_bill", { p_id: b.id, p_data: { release_date: g("rnDate"), price_per_box: num(g("rnPrice")), exchange_rate: num(g("rnRate")), shipping_cost: num(g("rnShip")), shipping_bill_no: g("rnBill") } });
      btn.disabled = false;
      if (error) return fail(error, /release_stock_bill|schema cache/i.test(error.message || "") ? "Run the database update 027_ebill_release.sql first" : "Could not release the e-bill");
      m.close(); toast(`${b.bill_no} is RELEASED (${data.release_order_no}). The released charge and the shipping fee are added to its total cost.`); await reload();
    };
  }
  // The Released Notice on paper.
  function noticePage(b, n) {
    const row = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
    return `${E.printHead("RELEASED NOTICE", `<img src="${E.pdf417DataUrl("EMONRN|" + (n?.order_no || b.bill_no))}" alt="" class="ph-bar"><div class="mono">${esc(n?.order_no || "")}</div>`)}
      <div class="cert-no"><span>Notice No: <b>${esc(n?.order_no || "")}</b></span><span>Released Date: <b>${esc(mdy(n?.release_date || b.release_date))}</b></span></div>
      <div class="ol-sec">E-BILL</div>
      <table class="ol-grid"><tbody>${row("E-Bill No", esc(b.bill_no))}${row("Batch No", esc(b.batch_no || "—"))}${row("Company", esc(b.company_name || "—"))}${row("Shipment", esc([b.shipment_no, b.shipment_date ? mdy(b.shipment_date) : ""].filter(Boolean).join(" · ") || "—"))}
        ${row("Total Boxes", String(num(b.total_boxes)))}${row("Bill Cost (BDT)", peso(b.total_cost))}</tbody></table>
      <div class="ol-sec">RELEASED CHARGE</div>
      <table class="ol-grid"><tbody>${row("Price per Box (PHP)", peso(n?.price_per_box))}${row("Total (PHP)", `${num(b.total_boxes)} boxes × ${peso(n?.price_per_box)} = <b>${peso(n?.release_php)}</b>`)}
        ${row("Exchange Rate (BDT for 1 PHP)", rate(n?.exchange_rate))}${row("Released Charge (BDT)", `<b>${peso(n?.release_bdt)}</b>`)}${row("Shipping Fee (BDT)", peso(n?.shipping_cost))}
        ${n?.shipping_bill_no ? row("Shipping Bill No", esc(n.shipping_bill_no)) : ""}${row("Total Cost (BDT)", `<b>${peso(num(b.total_cost) + num(n?.release_bdt) + num(n?.shipping_cost))}</b>`)}</tbody></table>
      <p class="pdecl">The released charge and the shipping fee are added to the total cost of this e-bill.</p>
      ${E.sigs("Prepared by", "Approved by")}`;
  }

  function statusDialog(b, action, reload) {
    const what = { sold: "SALES", paid: "PAID" }[action];
    const p = profitOf(b), bal = totalCost(b) - num(b.paid_bdt);
    const body = action === "paid" ? `<p>Mark <b>${esc(b.bill_no)}</b> as <b>PAID</b>?</p>
        <table class="kv-sum"><tbody><tr><th>Net Sales</th><td>${bdt(b.net_sales)}</td></tr><tr><th>Total Cost (bill + released charge + shipping fee)</th><td>− ${bdt(totalCost(b))}</td></tr>
          <tr><th>EOO Fees, Other Fees and Penalties</th><td>− ${bdt(feesOf(b))}</td></tr><tr class="${p < 0 ? "loss" : "gain"}"><th>${p < 0 ? "Net Loss" : "Net Profit"}</th><td>${bdt(Math.abs(p))}</td></tr></tbody></table>
        <p class="muted">After PAID, the profit or loss is shown and the E-Bill gets its secret code. More sales reports can still be added. No payment is needed to mark it PAID.</p>
        ${bal > 0 ? `<div class="hint">Paid so far: ${bdt(b.paid_bdt)} · balance ${bdt(bal)}.</div>` : ""}`
      : `<p>Mark <b>${esc(b.bill_no)}</b> as <b>SALES</b>? Net sales so far: <b>${bdt(b.net_sales)}</b>.</p><p class="muted">Sales reports, fees and penalties can still be added until EMON HASAN marks it PAID.</p>`;
    const m = E.modal(`Mark as ${what} — ${b.bill_no}`, `${body}<label class="fl" for="stNote">Note (optional)</label><input type="text" id="stNote">`,
      `<button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" data-ok>Mark as ${what}</button>`);
    $("[data-x]", m.el).onclick = m.close;
    $("[data-ok]", m.el).onclick = async () => {
      const btn = $("[data-ok]", m.el); btn.disabled = true;
      const { error } = await sb.rpc("stock_bill_action", { p_id: b.id, p_action: action, p_note: $("#stNote", m.el).value.trim() || null });
      btn.disabled = false;
      if (error) return fail(error, `Could not mark the e-bill as ${what}`);
      m.close();
      toast(`${b.bill_no} is now at ${what}.${action === "paid" ? " The E-Bill shows the profit or loss and the secret code." : ""}`);
      await reload();
      // marking PAID opens the E-Bill with the profit or loss and the secret code straight away
      if (action === "paid") printEbill(b.id);
    };
  }

  // Sales Report: the total net sales (and the EOO fees) for a period, with the sales report file.
  function salesDialog(b, reload) {
    const m = E.modal(`Add Sales Report — ${b.bill_no}`, `
      <div class="fields wide">
        <label for="slDate">Date</label><input type="date" id="slDate" value="${isoToday()}">
        <label for="slSales">Total Net Sales (BDT) *</label><input type="number" id="slSales" min="0.01" step="0.01" placeholder="e.g. 250000">
        <label for="slEoo">EOO Fees (BDT)</label><input type="number" id="slEoo" min="0" step="0.01" placeholder="Leave empty if none">
        <label for="slNote">Note</label><input type="text" id="slNote" placeholder="e.g. Sales report, week 1">
        ${E.fileField("slFile", "Sales Report File", 'accept="image/*,application/pdf"')}
      </div><p class="muted">Net sales: the amount sold after returns and discounts. More sales reports can be added at any time, also after the e-bill is marked PAID.</p>`,
      `<button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" data-ok>Save Sales Report</button>`);
    $("[data-x]", m.el).onclick = m.close;
    $("[data-ok]", m.el).onclick = async () => {
      const sales = num($("#slSales", m.el).value), eoo = num($("#slEoo", m.el).value), note = $("#slNote", m.el).value.trim() || null, date = $("#slDate", m.el).value || isoToday();
      if (sales <= 0) return toast("Enter the total net sales.", true);
      if (eoo < 0) return toast("EOO fees cannot be less than 0.", true);
      const btn = $("[data-ok]", m.el); btn.disabled = true;
      const rows = [{ stock_bill_id: b.id, entry_type: "sales", entry_date: date, amount: sales, description: note }];
      if (eoo > 0) rows.push({ stock_bill_id: b.id, entry_type: "eoo_fee", entry_date: date, amount: eoo, description: note });
      const { data, error } = await sb.from("stock_bill_entries").insert(rows).select("id, entry_type");
      if (error) { btn.disabled = false; return fail(error, "Could not save the sales report"); }
      const sale = (data || []).find((x) => x.entry_type === "sales");
      const f = sale ? await E.uploadRecords("stock_bill_entry", sale.id, "sales_report", E.filesOf("slFile")) : 0;
      m.close();
      toast(`Sales report added: net sales ${bdt(sales)}${eoo > 0 ? `, EOO fees ${bdt(eoo)}` : ""}.${f ? " The file failed to upload." : ""}`, f > 0);
      reload();
    };
  }

  // EOO fee, other fee or penalty. A fee or penalty needs its receipt number and the receipt itself.
  function feeDialog(b, reload) {
    const m = E.modal(`Add Fee / Penalty — ${b.bill_no}`, `
      <div class="subj-grid">${[["operational", "Operational Cost"], ["eoo_fee", "EOO Fee"], ["fee", "Other Fee"], ["penalty", "Penalty"]].map(([k, l], i) => `<label class="subj"><input type="radio" name="fpType" value="${k}" ${i ? "" : "checked"}><span>${l}</span></label>`).join("")}</div>
      <div class="fields wide" style="margin-top:8px">
        <label for="fpDate">Date</label><input type="date" id="fpDate" value="${isoToday()}">
        <label for="fpAmt">Amount (BDT) *</label><input type="number" id="fpAmt" min="0.01" step="0.01">
        <label for="fpRcpt" id="fpRcptL">Receipt No</label><input type="text" id="fpRcpt" placeholder="Number on the receipt">
        <label for="fpFile" id="fpFileL">Receipt (photo or PDF)</label><input type="file" id="fpFile" accept="image/*,application/pdf">
        <label for="fpDesc">Description</label><input type="text" id="fpDesc" placeholder="e.g. Port storage fee, late document penalty">
      </div><p class="muted" id="fpHint"></p>`,
      `<button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" data-ok>Save</button>`);
    const type = () => $("input[name=fpType]:checked", m.el).value;
    const mode = () => {
      const need = type() === "fee" || type() === "penalty";
      $("#fpRcptL", m.el).textContent = need ? "Receipt No *" : "Receipt No";
      $("#fpFileL", m.el).textContent = need ? "Receipt (photo or PDF) *" : "Receipt (photo or PDF)";
      $("#fpHint", m.el).textContent = need ? "A fee or penalty needs its receipt number and the receipt, so it can be checked." : "The receipt is optional for EOO fees.";
    };
    $$("input[name=fpType]", m.el).forEach((r) => (r.onchange = mode)); mode();
    $("[data-x]", m.el).onclick = m.close;
    $("[data-ok]", m.el).onclick = async () => {
      const t = type(), amt = num($("#fpAmt", m.el).value), rc = $("#fpRcpt", m.el).value.trim(), files = E.filesOf("fpFile");
      if (amt <= 0) return toast("Enter the amount.", true);
      if ((t === "fee" || t === "penalty") && !rc) return toast("Enter the receipt number.", true);
      if ((t === "fee" || t === "penalty") && !files.length) return toast("Upload the receipt (photo or PDF).", true);
      const btn = $("[data-ok]", m.el); btn.disabled = true;
      const { data, error } = await sb.from("stock_bill_entries").insert({ stock_bill_id: b.id, entry_type: t, entry_date: $("#fpDate", m.el).value || isoToday(), amount: amt,
        receipt_no: rc || null, description: $("#fpDesc", m.el).value.trim() || null }).select("id").single();
      if (error) { btn.disabled = false; return fail(error, "Could not save the fee or penalty"); }
      const f = files.length ? await E.uploadRecords("stock_bill_entry", data.id, "receipt", files) : 0;
      m.close();
      toast(`${ENTRY[t]} of ${bdt(amt)} added.${f ? " The receipt failed to upload: upload it again on the Sales Report tab." : ""}`, f > 0);
      reload();
    };
  }

  // ======================================================================
  // Prints
  // ======================================================================
  // Printed tables have fixed column widths (in % of the 182 mm table), so the lines a row takes can be counted:
  // a long text wraps in its column, about one character per 1.9 mm of width (1.75 mm in a tight table).
  const colgroup = (widths) => `<colgroup>${widths.map((w) => `<col style="width:${w.toFixed(2)}%">`).join("")}</colgroup>`;
  const linesFor = (texts, widths, tight) =>
    Math.max(1, ...texts.map((t, i) => Math.ceil(String(t ?? "").length / Math.max(3, ((widths[i] / 100) * 182 - 2) / (tight ? 1.75 : 1.9)))));
  // The item table: No. 5%, Qty 8%, Price 11%, Total 13%, the text columns share the rest.
  const itemWidths = (cols) => {
    const fixed = { qty: 8, price: 11, total: 13 }, texts = cols.filter((c) => !isNum(c)).length;
    const left = 100 - 5 - cols.reduce((sum, c) => sum + (fixed[c.type] || 0), 0);
    const w = [5, ...cols.map((c) => fixed[c.type] || left / Math.max(1, texts))];
    const tot = w.reduce((a, x) => a + x, 0);
    return w.map((x) => (x * 100) / tot); // no text column: the numbers share the whole width
  };
  // Column widths that keep every word of a column name, every number and every short code on one line: a column that
  // is too narrow takes the room it needs from the columns that have room to spare (measured in the print font).
  const textWidth = (() => {
    const ctx = document.createElement("canvas").getContext("2d");
    return (text, px, bold) => { ctx.font = `${bold ? "bold " : ""}${px}px Arial, "Helvetica Neue", Helvetica, sans-serif`; return ctx.measureText(String(text ?? "")).width; };
  })();
  const TABLE_PX = (182 * 96) / 25.4; // the printed table is 182 mm wide
  function fitWidths(widths, heads, values, tight) {
    const px = tight ? 9.5 : 10.5;
    const need = widths.map((w, i) => {
      let m = Math.max(0, ...String(heads[i] || "").split(/\s+/).map((x) => textWidth(x, px, true)));
      for (const v of values[i] || []) for (const x of String(v ?? "").split(/\s+/)) if (x.length <= 16) m = Math.max(m, textWidth(x, px, true));
      return ((m + 11) / TABLE_PX) * 100; // + the padding and the borders of the cell
    });
    const short = widths.reduce((a, w, i) => a + Math.max(0, need[i] - w), 0);
    if (short <= 0.01) return widths;
    const spare = widths.map((w, i) => Math.max(0, w - need[i])), room = spare.reduce((a, x) => a + x, 0);
    const cut = room > 0 ? Math.min(1, short / room) : 0;
    const out = widths.map((w, i) => Math.max(w, need[i]) - spare[i] * cut);
    const tot = out.reduce((a, x) => a + x, 0);
    return out.map((x) => (x * 100) / tot);
  }
  const companyOf = async (b) => (await sb.from("pay_companies").select("name, contact_person, contact, address, country").eq("id", b.company_id).maybeSingle()).data || {};
  const pageFoot = (label, n, of) => `<div class="rp-foot"><span>${esc(E.APP)} — ${esc(label)}</span><span>Page ${n} of ${of}</span></div>`;
  const contHead = (text) => `<div class="sb-cont"><b>${esc(C.company.name)}</b><span>${esc(text)}</span></div>`;

  // Report sections laid out over A4 pages: a section continues on the next page when it does not fit.
  function sectionHtml(s, rows, cont, last) {
    return `<div class="sb-sec">${esc(s.title)}</div>
      <table class="rp sb-items fixed${s.tight ? " tight" : ""}">${colgroup(s.widths)}<thead><tr>${s.cols.map((c) => `<th class="${c.num ? "num" : ""}">${esc(c.label)}</th>`).join("")}</tr></thead>
      <tbody>${rows.length ? rows.map((r) => `<tr>${s.cols.map((c) => `<td class="${c.num ? "num" : ""}">${esc(c.get(r))}</td>`).join("")}</tr>`).join("")
        : `<tr><td colspan="${s.cols.length}">${esc(s.empty || "None.")}</td></tr>`}</tbody>
      ${last && s.foot && rows.length ? `<tfoot><tr>${s.foot.map((v, i) => `<td class="${s.cols[i].num ? "num" : ""}">${esc(v)}</td>`).join("")}</tr></tfoot>` : ""}</table>`;
  }
  // Lines per page: budget; the first page has `first` lines left under its own boxes. Returns the pages (the first
  // one goes under those boxes, and may be empty) and the lines left on the last page.
  function flowPages(sections, budget, first = budget) {
    for (const s of sections) s.widths = fitWidths(s.widths, s.cols.map((c) => c.label), s.cols.map((c, i) => [...s.rows.map((r) => c.get(r)), ...(s.foot ? [s.foot[i]] : [])]), s.tight);
    const pages = [[]];
    let left = first;
    const next = () => { pages.push([]); left = budget; };
    for (const s of sections) {
      const lines = (r) => linesFor(s.cols.map((c) => c.get(r)), s.widths, s.tight);
      let i = 0, cont = false;
      do {
        if (left < 7) next();
        let take = 0, need = 3 + (s.foot ? 1 : 0);
        while (i + take < s.rows.length && need + lines(s.rows[i + take]) <= left) need += lines(s.rows[i + take++]);
        if (!take && s.rows.length) {
          if (left < budget) { next(); continue; }
          need += lines(s.rows[i]); take = 1; // a very long row on a page of its own
        }
        const end = i + take >= s.rows.length;
        pages[pages.length - 1].push(sectionHtml(s, s.rows.slice(i, i + take), cont, end));
        left -= need + 1; i += take; cont = true;
        if (!end) next();
      } while (i < s.rows.length);
    }
    return { pages: pages.map((p) => p.join("")), left };
  }

  // ======================================================================
  // The E-Bill: one document with every record of the e-bill, like a statement of account. The title is "E-BILL" and
  // the batch no (E-BILL I-17). Page 1: the company and shipment, the steps and the account summary (total cost, paid,
  // balance); after PAID also the profit or loss and the secret code, with its QR code at the top. Then the items, the
  // statement (charges and payments with the running balance), the Sales Report, the Released Notice, the payments,
  // the history and the uploaded files (photos printed).
  // ======================================================================
  async function printEbill(id) {
    const [bq, eq, pq, vq, oq, evq, sq] = await Promise.all([
      sb.from("stock_bill_totals").select("*").eq("id", id).maybeSingle(),
      sb.from("stock_bill_entries").select("*").eq("stock_bill_id", id).order("entry_date").order("created_at"),
      sb.from("stock_bill_payments").select("*").eq("stock_bill_id", id).order("pay_date").order("created_at"),
      sb.from("pay_vouchers").select("id, voucher_no, pay_date, amount_bdt, method, reference_no").eq("stock_bill_id", id).order("pay_date").order("voucher_no"),
      sb.from("order_letters").select("id, order_no, order_date, subject, status, release_date, shipping_cost, shipping_bill_no, price_per_box, exchange_rate, release_php, release_bdt, approved_by_name, created_by_name").eq("stock_bill_id", id).order("created_at"),
      sb.from("stock_bill_events").select("*").eq("stock_bill_id", id).order("created_at").order("id"),
      sb.from("stock_bill_secrets").select("secret_code").eq("stock_bill_id", id).maybeSingle()
    ]);
    const b = bq.data;
    if (!b) return toast("This e-bill could not be opened.", true);
    const entries = eq.data || [], pays = pq.data || [], vouchers = vq.data || [], orders = noticesOf(b, oq.data || []), events = evq.data || [];
    const [files, co] = await Promise.all([billFiles(b, entries, orders.filter((o) => o.id !== "bill"), vouchers), companyOf(b)]);
    const imgs = files.filter((f) => E.isImage(f));
    const urls = await Promise.all(imgs.map((f) => E.signedUrl(f.storage_path, 3600)));
    E.openPreview(`E-Bill ${b.batch_no || b.bill_no}`, ebillPages(b, { co, entries, pays, vouchers, orders, events, files,
      photos: imgs.map((f, i) => ({ ...f, url: urls[i] })).filter((f) => f.url), secret: b.status === "paid" ? sq.data?.secret_code || "" : "" }));
  }
  function ebillPages(b, d) {
    const cols = b.item_columns || [];
    const total = totalCost(b), paid = num(b.paid_bdt), bal = total - paid, isPaid = b.status === "paid" && !!d.secret;
    const profit = profitOf(b), loss = profit < 0;
    const label = `E-Bill ${b.batch_no || b.bill_no}`;
    const payRows = payRowsOf(d.pays, d.vouchers);
    const sumType = (t) => d.entries.filter((x) => x.entry_type === t).reduce((s, x) => s + num(x.amount), 0);
    const belongs = (f) => f.owner_type === "stock_bill" ? "E-Bill"
      : f.owner_type === "stock_bill_entry" ? (() => { const x = d.entries.find((e) => e.id === f.owner_id); return x ? `${ENTRY[x.entry_type]}${x.receipt_no ? " " + x.receipt_no : ""}` : "Sales Report"; })()
      : f.owner_type === "order_letter" ? (d.orders.find((o) => o.id === f.owner_id)?.order_no || "Released Notice")
      : f.owner_type === "pay_voucher" ? (d.vouchers.find((v) => v.id === f.owner_id)?.voucher_no || "Payment") : "";
    const KINDS = { bill: "E-Bill Copy", shipping_bill: "Shipping Fee Receipt", sales_report: "Sales Report", receipt: "Receipt", signed_form: "Signed Copy", other: "Other" };
    // the top right: the batch no; after PAID the QR code of the secret code
    // 3.99.137: the batch no and the e-bill no in separate boxes; the e-bill no as company-batch-year-boxes (MF-QQ-13-2026-88) with its PDF417
    const ebRef = [String(b.bill_no || "").split("-")[0], b.batch_no, String(b.bill_date || "").slice(0, 4), b.total_boxes].filter((x) => x != null && x !== "").join("-");
    const right = `<div class="sb-heads"><div class="sb-no"><small>Batch No</small><b>${esc(b.batch_no || "—")}</b>${b.supplier_bill_no ? `<small>Bill No: ${esc(b.supplier_bill_no)}</small>` : ""}</div>
      <div class="sb-no eb"><small>E-Bill No</small><img src="${E.pdf417DataUrl("EMONEB|" + b.bill_no)}" alt=""><b class="mono">${esc(ebRef)}</b></div></div>`;
    const words2 = (n) => (n < 0 ? `OVERPAID — ${words(-n, "TAKA")}` : words(n, "TAKA"));
    const first = `${E.printHead(`E-BILL${b.batch_no ? " " + b.batch_no : ""}`, right)}
      <div class="vno-row"><span>E-Bill No: <b>${esc(b.bill_no)}</b></span><span>Bill Date: <b>${esc(mdy(b.bill_date))}</b></span><span>Status: <b>${esc(ebillStep(b.status))}</b></span><span>Prepared By: <b>${esc(b.created_by_name || "")}</b></span></div>
      ${E.box("Company and Shipment", `<div class="pgrid2">${E.cell("Company", d.co.name || b.company_name, "hl")}${E.cell("Contact Person", d.co.contact_person)}${E.cell("Address", d.co.address || d.co.country)}${E.cell("Phone / Email", d.co.contact)}</div>
        <div class="pgrid4">${E.cell("Batch No", b.batch_no)}${E.cell("Bill No", b.supplier_bill_no)}${E.cell("System Record No", b.shipment_no)}${E.cell("Shipment Date", mdy(b.shipment_date))}
        ${E.cell("Shipping Company", b.shipping_company)}${E.cell("Shipping Company Code", b.shipping_company_code)}${E.cell("Total Boxes", b.total_boxes ?? "")}${E.cell("Total Qty", qtyText(b.total_qty))}</div>`)}
      ${E.box("Status", `<div class="sb-psteps">${STATUS.map((s) => `<div><b>${STATUS_NAME[s].toUpperCase()}</b><span>${esc(mdy(b[STATUS_AT[s]]) || "—")}</span></div>`).join("")}</div>`)}
      ${E.box("Account Summary (BDT)", `<table class="rp v-amt"><tbody>
        <tr><td>Bill Cost (items)</td><td class="num">BDT ${peso(b.total_cost)}</td></tr>
        ${b.release_bdt != null || b.shipping_cost != null ? `<tr><td>Shipping Fee${b.release_bdt != null ? ` (${esc(chargeText(b))}${num(b.shipping_cost) ? ` + BDT ${peso(b.shipping_cost)}` : ""})` : ""}</td><td class="num">BDT ${peso(num(b.release_bdt) + num(b.shipping_cost))}</td></tr>` : ""}
        <tr class="v-bdt"><td>Total Cost</td><td class="num">BDT ${peso(total)}</td></tr>
        <tr class="v-bdt"><td>Balance</td><td class="num">BDT ${peso(bal)}</td></tr></tbody></table>
        <div class="pcell"><div class="pl">Balance in Words</div><div class="pv words">${esc(words2(bal))}</div></div>`)}
      ${isPaid ? `${E.box("Profit and Loss (BDT)", `<table class="rp sb-pl"><tbody>
          <tr class="sub"><td>Net Sales</td><td class="num">${peso(b.net_sales)}</td></tr>
          <tr><td>Total Cost (bill + shipping fee)</td><td class="num">${peso(total)}</td></tr>
          <tr><td>EOO Fees, Other Fees and Penalties</td><td class="num">${peso(feesOf(b))}</td></tr>
          <tr class="grand ${loss ? "loss" : "gain"}"><td>${loss ? "NET LOSS" : "NET PROFIT"}</td><td class="num">BDT ${peso(Math.abs(profit))}</td></tr></tbody></table>
        <div class="sb-formula">Net Sales ${peso(b.net_sales)} − Total Expenses ${peso(expensesOf(b))} = ${loss ? "−" : ""}${peso(Math.abs(profit))} · ${esc(words(Math.abs(profit), "TAKA"))}</div>`)}
        ${E.box("Secret Code", `<div class="sb-secret"><b>${esc(d.secret)}</b><span>Scan the QR code at the top of this e-bill (or type the code) in Verification to check it. The e-bill and its profit or loss are shown only with this secret code. Keep this e-bill private.</span></div>`)}` : ""}`;
    // The statement: the bill cost first, then the released charge, the shipping fee and the payments by date (charges
    // before payments on the same day), with the running balance.
    const later = [];
    // 3.99.138: the released charge and the shipping fee are ONE line: Shipping fee
    if (b.release_bdt != null || b.shipping_cost != null) later.push({ date: b.release_date, what: `Shipping fee${b.release_bdt != null ? ` (${chargeText(b)}${num(b.shipping_cost) ? ` + BDT ${peso(b.shipping_cost)}` : ""})` : ""}`, ref: b.batch_no || "", chg: num(b.release_bdt) + num(b.shipping_cost), pay: 0 });
    // 3.99.135: the statement lists the charges only (no payments column)
    later.sort((x, y) => String(x.date || "").localeCompare(String(y.date || "")) || y.chg - x.chg);
    const lines = [{ date: b.bill_date, what: "Bill cost (items)", ref: b.supplier_bill_no ? `Bill No ${b.supplier_bill_no}` : b.bill_no, chg: num(b.total_cost), pay: 0 }, ...later];
    let run = 0;
    lines.forEach((x) => { run += x.chg - x.pay; x.bal = run; });
    const itemCols = [{ label: "No.", num: true, get: (r) => r[0] }, ...cols.map((c, ci) => ({ label: colHead(c), num: isNum(c), get: (r) => cellText(c, r[ci + 1]) }))];
    const sections = [
      { title: "ITEMS", cols: itemCols, rows: (b.items || []).map((r, i) => [i + 1, ...r]), tight: cols.length > 7, widths: itemWidths(cols),
        foot: itemCols.map((c, i) => (cols[i - 1]?.type === "qty" ? qtyText(b.total_qty) : cols[i - 1]?.type === "total" ? peso(b.total_cost)
          : i === cols.findIndex((x) => !isNum(x)) + 1 ? "TOTAL" : "")) },
      { title: "STATEMENT (BDT)", rows: lines, widths: [12, 42, 16, 15, 15],
        cols: [{ label: "Date", get: (r) => sd(r.date) }, { label: "Particulars", get: (r) => r.what }, { label: "Reference", get: (r) => r.ref || "" },
          { label: "Charges", num: true, get: (r) => (r.chg ? peso(r.chg) : "") }, { label: "Balance", num: true, get: (r) => peso(r.bal) }],
        foot: ["", "TOTAL", "", peso(total), peso(total)] },
      { title: "SALES REPORT (BDT)", rows: d.entries, empty: "No sales report yet.", widths: [12, 11, 12, 34, 16, 15],
        cols: [{ label: "Date", get: (r) => sd(r.entry_date) }, { label: "Type", get: (r) => ENTRY[r.entry_type] || r.entry_type }, { label: "Receipt No", get: (r) => r.receipt_no || "" },
          { label: "Description", get: (r) => r.description || "" }, { label: "Added By", get: (r) => r.created_by_name || "" }, { label: "Amount", num: true, get: (r) => peso(r.amount) }],
        foot: ["", "", "", `Net Sales ${peso(sumType("sales"))} · Fees and Penalties ${peso(sumType("eoo_fee") + sumType("fee") + sumType("penalty"))}`, "", ""] },
      { title: "PAYMENTS (MEMOS IN THE DIRECTOR PORTAL)", rows: payRows, empty: "No payments yet.", widths: [11, 17, 25, 13, 8, 13, 13],
        cols: [{ label: "Date", get: (r) => sd(r.date) }, { label: "Memo No", get: (r) => r.no }, { label: "Subject", get: (r) => r.what },
          { label: "Amount (PHP)", num: true, get: (r) => (r.php == null ? "" : peso(r.php)) }, { label: "Rate", num: true, get: (r) => (r.rate == null ? "" : rate(r.rate)) },
          { label: "Amount (BDT)", num: true, get: (r) => peso(r.bdt) }, { label: "Approved By", get: (r) => r.by || "" }],
        foot: ["", "", "Total Paid", "", "", peso(paid), ""] },
      { title: "HISTORY", rows: d.events, empty: "No history.", widths: [20, 28, 34, 18],
        cols: [{ label: "Date / Time", get: (r) => E.dateTime(r.created_at) }, { label: "What Happened", get: (r) => cap(r.action) }, { label: "Note", get: (r) => r.note || "" }, { label: "By", get: (r) => r.actor_name || "" }] },
      { title: "UPLOADED FILES", rows: d.files, empty: "No files were uploaded.", widths: [5, 33, 15, 18, 12, 17],
        cols: [{ label: "No.", num: true, get: (r) => d.files.indexOf(r) + 1 }, { label: "File", get: (r) => r.file_name }, { label: "Kind", get: (r) => KINDS[r.kind] || cap(r.kind) },
          { label: "Belongs To", get: belongs }, { label: "Uploaded", get: (r) => mdy(r.created_at) }, { label: "Printed", get: (r) => (d.photos.some((p) => p.id === r.id) ? "Photo below" : E.isImage(r) ? "—" : "Open in the portal") }] }
    ];
    // Lines on page 1 under the boxes (a page holds about 48 lines): the header 9, the company and shipment 8, the
    // steps 3 and the account summary 10; after PAID also the profit or loss 9 and the secret code 4.
    const { pages, left } = flowPages(sections, 46, 48 - 30 - (isPaid ? 13 : 0));
    pages[0] = first + pages[0];
    const sys = `${isPaid ? `<div class="doc-qr"><img src="${E.qrDataUrl(verifyUrl(d.secret))}" alt="Secret code QR"><small>SECRET CODE ${esc(d.secret)}</small></div>` : ""}<div class="soa-sys">This is a system-generated e-bill. No signature is required.</div>`;
    if (left < 3) pages.push(sys); else pages[pages.length - 1] += sys;
    // the photos, four on a page
    for (let i = 0; i < d.photos.length; i += 4) {
      pages.push(`<div class="sb-sec">UPLOADED PHOTOS</div><div class="sb-photos">${d.photos.slice(i, i + 4).map((p, k) => `<figure class="sb-photo"><img src="${esc(p.url)}" alt="${esc(p.file_name)}">
        <figcaption>${i + k + 1}. ${esc(p.file_name)} — ${esc(KINDS[p.kind] || cap(p.kind))} · <span class="nw">${esc(belongs(p))}</span> · <span class="nw">${esc(mdy(p.created_at))}</span></figcaption></figure>`).join("")}</div>`);
    }
    return pages.map((p, i) => (i ? contHead(`${label} · ${b.bill_no} — Page ${i + 1} of ${pages.length}`) : "") + p + pageFoot(label, i + 1, pages.length));
  }

  // E-bills are no longer in Billing: an old link to one opens the e-bill.
  V.ebill = (id) => {
    if (E.canOpen("stockbill")) { location.replace("#stockbill/" + id); return; }
    toast("E-bills are in the E-Bill section now. Ask EMON HASAN for access.", true);
    location.replace("#billing");
  };

  Object.assign(E, { qtyText, printEbill });
})();
