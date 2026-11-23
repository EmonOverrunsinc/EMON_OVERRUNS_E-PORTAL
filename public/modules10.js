/* EMON OVERRUNS E-PORTAL — Customer Order (3.37), in EO-Office.
   An order for a customer, like the paper order: the CUSTOMER (3.38.1: no Delivered To, the order goes to the customer it is for),
   ADDRESS, ACCOUNT NO, BATCH NO (3.39; was REFERENCES), DATE, DUE DATE, TERMS, NOTE and the
   lines QUANTITY | BOXES | CODE | PCS | LOT NO. | PRODUCT | PRICE | AMOUNT (QUANTITY = BOXES × PCS, AMOUNT = QUANTITY × PRICE), with up
   to 4 columns of its own (COLOR, SIZE …). The page of the order holds its boxes (the Delivery Sheet): each box is scanned from the QR
   or PDF417 code on its label (one after another, the camera stays open), read from a photo of the label, or typed. The Director
   approves (the authorized signature on the printed order; the Director's own orders are approved at once). The delivery: the boxes
   and the photos (3.45: no rider or car details); COMPLETE makes the customer's invoice by itself, and the printed order shows it.
   3.39: the status in 3 steps: 1 CREATE ORDER (waiting for the Director) → 2 PREPARED (approved) → 3 COMPLETE (delivered). The order
   paper carries a secret code in its barcode and QR code: whoever scans it — signed in or not — opens the order's Complete Delivery
   page (boxes, photos, COMPLETE DELIVERY; 3.45: without EO-Office sign-in it is SUBMITTED and the Director approves it). The printed order has no address and only the Director's approval signature;
   COMPLETE makes the invoice and bills it to the customer. A box whose serial no is in the box database (the Google Sheet, read on
   the EVA AI page) takes its items, brand, CTN, code, pcs and batch from it. */
(() => {
  "use strict";
  const E = window.EO;
  const { sb, S, esc, peso, isoToday, mdy, $, $$, isAdmin, meId, pill, toast, fail, ic, busy, num, fullName, qtyText } = E;
  const V = window.EO_VIEWS;
  const canW = () => E.canWrite("eooffice");
  const notSet = (e) => ["PGRST205", "PGRST202", "42P01"].includes(e?.code) || /customer_order|schema cache/i.test(e?.message || "");
  const needUpdate = `<div class="empty">Customer Order needs the database update <b>RUN_041_TO_046.sql</b>. Run it in the Supabase SQL Editor.</div>`;
  const rand = () => Math.random().toString(36).slice(2, 8);
  const MAX_LINES = 200, MAX_COLS = 4, MAX_PHOTOS = 5; // 3.99.32: one line per box: up to 200
  // the status of an order in 3 steps (3.39): 1 CREATE ORDER (made, waiting for the Director) → 2 PREPARED (approved: ready to
  // deliver) → 3 COMPLETE (delivered); or CANCELLED
  const STATUS = { pending: ["pending", "CREATE ORDER"], approved: ["approved", "CONFIRMED"], completed: ["applied", "COMPLETED"], cancelled: ["rejected", "CANCELLED"] };
  // 3.88: the tracking (like a courier): ORDER CREATED → CONFIRMED → SORTING → PREPARING → ASSIGNED FOR DELIVERY → OUT FOR
  // DELIVERY → DELIVERED → COMPLETED (→ PROOF OF DELIVERY: the photos, optional). The 4 middle steps are pressed on the order.
  const TRACK = { sorting: "SORTING", preparing: "PREPARING", assigned: "ASSIGNED FOR DELIVERY", out_for_delivery: "OUT FOR DELIVERY" };
  // 3.98: what each tracking line says (PREPARING, ASSIGNED and OUT FOR DELIVERY are no longer pressed; the lines of
  // orders tracked before still show)
  const TRACK_SAY = { sorting: "Order is being sorted", preparing: "Order is being prepared", assigned: "Delivery person assigned", out_for_delivery: "Order is out for delivery" };
  const lastTrack = (o) => (o._trk || []).at(-1) || null;
  const stPill = (o) => o.status === "approved" && o.delivery_request_at ? pill("pending", "DELIVERY SUBMITTED") // 3.45: waits for EMON HASAN
    : o.status === "approved" && lastTrack(o) ? pill("approved", TRACK[lastTrack(o).step] || "CONFIRMED")
    : pill(...(STATUS[o.status] || ["pending", String(o.status).toUpperCase()]));
  const open = (o) => ["pending", "approved"].includes(o.status);
  // 3.54: the Director also changes a COMPLETED order (and its boxes); its invoice changes with it
  const fixable = (o) => open(o) || (o.status === "completed" && isAdmin());
  const boxesText = (n) => `${qtyText(n)} BOX${num(n) === 1 ? "" : "ES"}`;
  // 3.46: a line with a serial no is a box; a line added without one (items, pcs) is kept but not counted as a box
  const nBoxes = (bs) => bs.filter((b) => b.serial_no).length;
  const serHtml = (b) => b.serial_no ? `<b class="mono">${esc(b.serial_no)}</b>` : `<span class="bx-loose" title="No serial no: not counted as a box">-</span>`;
  const boxNo = (bs, b) => b.serial_no ? String(bs.filter((x) => x.serial_no).indexOf(b) + 1) : "—";
  const boxName = (b) => b.serial_no ? `box <b>${esc(b.serial_no)}</b>` : `the line <b>${esc(b.items || "without serial no")}</b>`;
  // the due date: as written, or from the terms (30 DAYS after the order date …)
  const dueOf = (o) => o.due_date || E.termsDue(o.order_date, o.payment_terms) || "";
  const custName = (o) => fullName(o.customers || {});
  // 3.39: the Complete Delivery page of an order paper (its number and its secret code)
  const deliveryHash = (no, code) => `delivery/${encodeURIComponent(no)}/${encodeURIComponent(code)}`;
  const deliveryUrl = (no, code) => `${location.origin}${location.pathname}#${deliveryHash(no, code)}`;

  // ======================================================================
  // The list (EO-Office › Customer Order)
  // ======================================================================
  // 3.99.33: SOLD BOXES (box_sales, 099): the boxes of the invoiced orders with their price; search; Download CSV
  V.soldboxes = async () => {
    E.shell("soldboxes", "Sold Boxes", `${E.eoTabs("custorders")}<div id="sbBody">${busy()}</div>`);
    if (!E.hasModule("eooffice") || !E.isStaff()) { location.hash = "eooffice"; return; }
    const here = E.stillHere();
    const [sold, stock] = await Promise.all([E.allRows(() => sb.from("box_sales").select("*").order("sold_at", { ascending: false }).order("serial_no")),
      E.allRows(() => sb.from("box_stock").select("serial_no, product, brand, style, batch"))]);
    if (!here() || !$("#sbBody")) return;
    if (sold.error) { $("#sbBody").innerHTML = `<div class="empty">${/box_sales|schema cache|PGRST20/.test(sold.error.message || "") ? "Sold Boxes needs the database update <b>099</b> (RUN_050_BOXES_AND_099.sql)." : esc(sold.error.message)}</div>`; return; }
    const info = new Map((stock.data || []).map((b) => [b.serial_no, b]));
    const all = (sold.data || []).map((r) => { const b = info.get(r.serial_no) || {}; return { ...r, product: [b.product, b.brand && b.brand !== "-" ? b.brand : ""].filter(Boolean).join(" · "), code: b.style || "", batch: b.batch || "" }; });
    const cols = [{ label: "Date", get: (r) => mdy(r.sold_at) }, { label: "Serial No", html: (r) => `<b class="mono">${esc(r.serial_no)}</b>` }, { label: "Product", wrap: true, get: (r) => r.product },
      { label: "Code", phone: false, get: (r) => r.code }, { label: "Batch", phone: false, get: (r) => r.batch }, { label: "Pcs", num: true, get: (r) => qtyText(r.pcs) },
      { label: "Price (₱)", num: true, get: (r) => peso(r.price) }, { label: "Total (₱)", num: true, get: (r) => peso(r.total) },
      { label: "Invoice", html: (r) => (r.invoice_id && E.canOpen("invoice") ? `<a href="#invoice/${esc(r.invoice_id)}">${esc(r.invoice_no || "")}</a>` : esc(r.invoice_no || "")) },
      { label: "Order", phone: false, html: (r) => `<a href="#custorder/${esc(r.order_id)}">${esc(r.order_no || "")}</a>` }, { label: "Customer", wrap: true, get: (r) => r.customer_name || "" }];
    $("#sbBody").innerHTML = `<div class="window"><div class="wtitle">Sold Boxes</div><div class="wbody">

      <div class="btnrow"><input type="search" id="sbQ" placeholder="Search serial no, product, invoice, order or customer" style="flex:1;min-width:220px">
        <button type="button" class="btn primary" id="sbCsv">${ic("download")} Download (Excel / CSV)</button></div>
      <div class="rec-tiles" id="sbTiles"></div><div id="sbGrid"></div></div></div>`;
    let rows = all;
    const show = () => {
      const q = $("#sbQ").value.trim().toUpperCase();
      rows = q ? all.filter((r) => [r.serial_no, r.product, r.code, r.batch, r.invoice_no, r.order_no, r.customer_name].some((v) => String(v || "").toUpperCase().includes(q))) : all;
      const pcs = rows.reduce((s, r) => s + num(r.pcs), 0), tot = rows.reduce((s, r) => s + num(r.total), 0);
      $("#sbTiles").innerHTML = `<div class="rec-tile"><small>Boxes</small><b>${qtyText(rows.length)}</b></div><div class="rec-tile"><small>Pcs</small><b>${qtyText(pcs)}</b></div><div class="rec-tile ok"><small>Total</small><b>₱ ${peso(tot)}</b></div>`;
      $("#sbGrid").innerHTML = E.grid({ cols, rows, empty: all.length ? "No sold box matches." : "No sold box yet: boxes become SOLD when their order is completed and invoiced." });
    };
    $("#sbQ").oninput = show;
    $("#sbCsv").onclick = () => {
      const cell = (v) => { const t = String(v ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
      const head = ["Date", "Serial No", "Product", "Code", "Batch", "Pcs", "Price", "Total", "Invoice No", "Order No", "Customer"];
      const lines = [head, ...rows.map((r) => [mdy(r.sold_at), r.serial_no, r.product, r.code, r.batch, num(r.pcs), num(r.price).toFixed(2), num(r.total).toFixed(2), r.invoice_no || "", r.order_no || "", r.customer_name || ""])];
      const blob = new Blob(["\ufeff" + lines.map((l) => l.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `Sold-Boxes-${isoToday()}.csv`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    };
    show();
  };


  // ======================================================================
  // 3.99.175: BOX LIST: every box in the box database with its status now (AVAILABLE, ON ORDER, SOLD), sorted by batch; the batch
  // list (each batch's boxes and how many are sold); a search like the top search (a dash or a space does not matter:
  // QQ13 = QQ-13); Download (Excel / CSV) and Print of what is shown.
  // ======================================================================
  const keyOf = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); // QQ-13, QQ 13 and qq13 are the same
  E.boxKeyOf = keyOf;
  const BL_ST = { stock: ["bx-stock", "AVAILABLE"], shipped: ["bx-ship", "SHIPPED"], order: ["bx-order", "ON ORDER"], sold: ["bx-sold", "SOLD"] };
  V.boxlist = async (batchArg) => {
    E.shell("boxlist", "Box List", `${E.eoTabs("boxlist")}<div id="blxBody">${busy("Loading the boxes")}</div>`);
    const here = E.stillHere();
    const [st, on, sd, arr] = await Promise.all([
      E.allRows(() => sb.from("box_stock").select("serial_no, product, brand, ctn, style, qty, batch, price, arrival_date, ship_date, release_date, sold_date, sheet_invoice").order("serial_no")),
      E.allRows(() => sb.from("customer_order_boxes").select("serial_no, customer_orders(id, order_no, status)").order("id")),
      E.allRows(() => sb.from("box_sales").select("serial_no, invoice_no, sold_at").order("serial_no")).then((r) => r, () => ({ data: [] })),
      E.boxStatus?.hasArrival ? E.boxStatus.hasArrival().catch(() => false) : false]);
    if (!here() || !$("#blxBody")) return;
    if (st.error) { $("#blxBody").innerHTML = `<div class="empty">${/box_stock|schema cache|PGRST20/.test(st.error.message || "") ? "The Box List needs the box database (EVA Records › Read Sheet)." : esc(st.error.message)}</div>`; return; }
    const onOrder = new Map(), sold = new Map();
    for (const x of on.data || []) if (x.customer_orders && x.customer_orders.status !== "cancelled") onOrder.set(x.serial_no, x.customer_orders);
    for (const x of sd.data || []) sold.set(x.serial_no, x);
    const all = (st.data || []).map((b) => {
      const o = onOrder.get(b.serial_no), sl = sold.get(b.serial_no);
      const k = E.boxStatus ? E.boxStatus.key(b, o, sl, arr) : sl || o?.status === "completed" ? "sold" : o ? "order" : "stock";
      return { ...b, k, order: o, invoice: sl?.invoice_no || b.sheet_invoice || "", soldOn: sl?.sold_at ? String(sl.sold_at).slice(0, 10) : b.sold_date || "",
        hay: [b.serial_no, b.batch, b.product, b.brand, b.ctn, b.style, o?.order_no, sl?.invoice_no || b.sheet_invoice].map(keyOf).join(" ") };
    }).sort((a, b) => String(a.batch || "~").localeCompare(String(b.batch || "~"), "en", { numeric: true }) || String(a.serial_no).localeCompare(String(b.serial_no), "en", { numeric: true }));
    const isAvail = (r) => r.k === "stock" || r.k === "shipped";
    let filter = "avail", q = "", batch = batchArg ? decodeURIComponent(batchArg) : "", moreF = false; // 3.99.195: AVAILABLE first
    // 3.99.188: a SIMPLE LOG: one search row (search, batch, download, print / PDF), filter chips with their counts, then the
    // boxes as plain log lines under their batch (2 lines on a phone, never sideways)
    const allBatches = [...new Set(all.map((r) => r.batch || "—"))];
    $("#blxBody").innerHTML = `
      <div class="lg-head"><div class="lg-find">${ic("search")}<input type="search" id="blxQ" placeholder="Search serial no, batch (QQ13 or QQ-13), product, brand, CTN" autocomplete="off" aria-label="Search the boxes"></div>
        <select id="blxBatch" aria-label="Batch"><option value="">All batches (${allBatches.length})</option>${allBatches.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join("")}</select>
        <button type="button" class="btn" id="blxCsv">${ic("download")} Download</button><button type="button" class="btn primary" id="blxPrint">${ic("print")} Print / PDF</button></div>
      <div class="lg-seg" id="blxChips" role="group" aria-label="Show"></div>
      <div class="lg-log" id="blxView"></div>`;
    if (batch && $("#blxBatch")) $("#blxBatch").value = allBatches.find((b) => keyOf(b) === keyOf(batch)) || "";
    const inScope = () => all.filter((r) => (!batch || keyOf(r.batch || "—") === keyOf(batch)) && (!q || q.split(/\s+/).every((w) => r.hay.includes(w))));
    const shown = () => inScope().filter((r) => filter === "all" || (filter === "avail" ? isAvail(r) : r.k === filter));
    const batchesOf = (rows) => { const m = new Map(); for (const r of rows) { const b = r.batch || "—"; if (!m.has(b)) m.set(b, []); m.get(b).push(r); } return [...m.entries()]; };
    const cnt = (rows, f) => rows.filter(f).length, pcs = (rows) => rows.reduce((s, r) => s + num(r.qty), 0);
    const line = (r) => `<div class="lg-row k-${r.k}"><i class="lg-dot" aria-hidden="true"></i><b class="mono lg-sn">${esc(r.serial_no)}</b>
      <span class="lg-prod">${esc([r.product, r.brand && r.brand !== "-" ? r.brand : ""].filter(Boolean).join(" · ") || "—")}</span>
      <span class="lg-pcs">${qtyText(r.qty)} pcs</span><span class="lg-st">${BL_ST[r.k][1]}</span>
      <span class="lg-ref">${r.k === "sold" ? esc(r.invoice || "") : r.order ? `<a href="#custorder/${esc(r.order.id)}">${esc(r.order.order_no)}</a>` : ""}</span></div>`;
    const LIMIT = 120;
    let more = false;
    const draw = () => {
      const scope = inScope(), rows = shown();
      // 3.99.190: one clean bar with the counts. 3.99.195: AVAILABLE only; ALL, ON ORDER and SOLD come with "More"
      const segs = [["avail", "AVAILABLE", cnt(scope, isAvail)], ["all", "ALL", scope.length], ["order", "ON ORDER", cnt(scope, (r) => r.k === "order")], ["sold", "SOLD", cnt(scope, (r) => r.k === "sold")]];
      const open = moreF || filter !== "avail";
      $("#blxChips").className = `lg-seg${open ? "" : " min"}`;
      $("#blxChips").innerHTML = (open ? segs : segs.slice(0, 1)).map(([k, l, n]) => `<button type="button" class="c-${k}${filter === k ? " on" : ""}" data-f="${k}" aria-pressed="${filter === k}"><small>${l}</small><b>${qtyText(n)}</b></button>`).join("")
        + (open ? "" : `<button type="button" class="lg-more-btn" id="blxMoreF" aria-label="More: all, on order and sold"><b>⋯</b><small>MORE</small></button>`);
      $$("#blxChips button[data-f]").forEach((b) => (b.onclick = () => { filter = b.dataset.f; more = false; draw(); }));
      if ($("#blxMoreF")) $("#blxMoreF").onclick = () => { moreF = true; draw(); };
      const v = $("#blxView");
      if (!rows.length) { v.innerHTML = `<div class="empty">${all.length ? "No box matches." : "No box in the box database yet."}</div>`; return; }
      const part = more ? rows : rows.slice(0, LIMIT);
      v.innerHTML = batchesOf(part).map(([b, list]) => {
        const full = rows.filter((r) => (r.batch || "—") === b);
        const av = cnt(full, isAvail);
        return `<div class="lg-batch"><b>BATCH ${esc(b)}</b><span class="${av ? "av" : "none"}">AVAILABLE ${qtyText(av)} BOX${av === 1 ? "" : "ES"}</span></div>${list.map(line).join("")}`;
      }).join("") + (rows.length > part.length ? `<div class="lg-more"><span>Showing ${qtyText(part.length)} of ${qtyText(rows.length)} boxes</span><button type="button" class="btn small" id="blxMore">Show All ${qtyText(rows.length)}</button></div>` : "");
      if ($("#blxMore")) $("#blxMore").onclick = () => { more = true; draw(); };
    };
    let tm = null;
    $("#blxQ").oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => { q = e.target.value.trim().split(/\s+/).map(keyOf).filter(Boolean).join(" "); more = false; draw(); }, 120); };
    $("#blxBatch").onchange = (e) => { batch = e.target.value; more = false; draw(); };
    const label = (r) => BL_ST[r.k][1];
    $("#blxCsv").onclick = () => {
      const rows = shown(), cell = (v) => { const t = String(v ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
      const lines = [["Batch", "Serial No", "Product", "Brand", "Code", "CTN", "Pcs", "Ship Date", "Status", "Invoice", "Date Sold", "Order No"],
        ...rows.map((r) => [r.batch || "", r.serial_no, r.product || "", r.brand || "", r.style || "", r.ctn || "", num(r.qty), r.ship_date || "", label(r), r.invoice, r.soldOn, r.order?.order_no || ""])];
      const blob = new Blob(["﻿" + lines.map((l) => l.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `Box-List${batch ? "-" + keyOf(batch) : ""}-${isoToday()}.csv`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    };
    // the same simple list on A4 (the preview has Print and Download PDF)
    $("#blxPrint").onclick = () => {
      const rows = shown(), F = { all: "All boxes", avail: "Available boxes", order: "Boxes on order", sold: "Sold boxes" }[filter];
      const sums = batchesOf(rows).map(([b, list]) => [b, `SOLD ${cnt(list, (r) => r.k === "sold")} · AVAILABLE ${cnt(list, isAvail)} · TOTAL ${list.length} BOXES`]);
      E.openPreview(`Box List${batch ? " " + batch : ""}`, E.listingPages({ title: batch ? `BOX LIST · BATCH ${batch}` : "BOX LIST", range: `${esc(F)} · ${esc(mdy(isoToday()))}${q ? ` · Search: ${esc(q)}` : ""}`, logo: true, perPage: 32,
        cols: [{ label: "Batch", get: (r) => r.batch || "" }, { label: "Serial No", get: (r) => r.serial_no }, { label: "Product", get: (r) => [r.product, r.brand && r.brand !== "-" ? r.brand : ""].filter(Boolean).join(" · ") },
          { label: "CTN", get: (r) => r.ctn || "" }, { label: "Pcs", num: true, get: (r) => qtyText(r.qty) }, { label: "Status", get: label }, { label: "Invoice / Order", get: (r) => (r.k === "sold" ? r.invoice : r.order?.order_no || "") }],
        rows, summary: { title: "BY BATCH", cols: ["Batch", "Boxes"], rows: sums, total: ["TOTAL", `SOLD ${cnt(rows, (r) => r.k === "sold")} · AVAILABLE ${cnt(rows, isAvail)} · TOTAL ${rows.length} BOXES`] } }));
    };
    draw();
    E.setRecords(`Boxes: ${all.length}`);
  };

  V.custorders = async () => {
    E.shell("custorders", "Customer Orders", `${E.eoTabs("custorders")}<div id="coBody">${busy()}</div>`);
    if (!E.hasModule("eooffice") || !E.isStaff()) { location.hash = "eooffice"; return; }
    const here = E.stillHere();
    const { data, error } = await E.allRows(() => sb.from("customer_orders").select("*, customers(first_name,middle_name, last_name, account_no)")
      .order("created_at", { ascending: false }).order("id"));
    if (!here() || !$("#coBody")) return;
    if (error) { $("#coBody").innerHTML = notSet(error) ? needUpdate : `<div class="empty">${esc(error.message)}</div>`; return; }
    const rows = data || [], count = (st) => rows.filter((o) => st.includes(o.status)).length;
    const conf = rows.filter((o) => o.status === "approved").map((o) => o.id);
    if (conf.length) { // 3.88: the status shows where the order is (SORTING, OUT FOR DELIVERY …)
      const { data: tr } = await sb.from("order_tracking").select("order_id, step, at").in("order_id", conf.slice(0, 300)).order("at");
      const by = new Map(); (tr || []).forEach((t) => by.set(t.order_id, [t]));
      rows.forEach((o) => { if (by.has(o.id)) o._trk = by.get(o.id); });
      if (!here() || !$("#coBody")) return;
    }
    const m = isoToday().slice(0, 7), doneM = rows.filter((o) => o.status === "completed" && String(o.order_date).slice(0, 7) === m);
    // 3.42: every order (newest first); the months with orders to open one month; the search finds in every order
    const months = [...new Set(rows.map((o) => String(o.order_date || "").slice(0, 7)).filter(Boolean))].sort().reverse();
    const mLabel = (k) => E.monthText ? E.monthText(k) : k;
    let month = "";
    $("#coBody").innerHTML = `
      <div class="co-top-search"><input type="search" id="coFind" class="co-find" placeholder="Search every order: order no, customer, account no, batch no" aria-label="Search orders" autocomplete="off">
        <button type="button" class="btn" id="coScan">${ic("scan")} Scan</button><a class="btn" href="#soldboxes">${ic("box")} Sold Boxes</a></div>
      <div class="tiles co-tiles">
        <div class="tile ${count(["pending"]) ? "warn" : ""}"><span class="tile-ic">${ic("clock")}</span><div class="k">Waiting for Approval</div><div class="v">${count(["pending"])}</div></div>
        <div class="tile"><span class="tile-ic">${ic("box")}</span><div class="k">Confirmed · To Deliver</div><div class="v">${count(["approved"])}</div></div>
        <div class="tile ok"><span class="tile-ic">${ic("check")}</span><div class="k">Completed This Month (₱)</div><div class="v">${peso(doneM.reduce((s, o) => s + num(o.total_amount), 0))}</div><small>${doneM.length} order(s)</small></div>
      </div>
      <div class="co-months" id="coMonths"><button type="button" data-m="" class="on">All Orders <small>${rows.length}</small></button>${months.map((k) => `<button type="button" data-m="${k}">${esc(mLabel(k))} <small>${rows.filter((o) => String(o.order_date).startsWith(k)).length}</small></button>`).join("")}</div>
      <div id="coGrid"></div>`;
    const hay = rows.map((o) => [o.order_no, custName(o), o.customers?.account_no, o.reference, STATUS[o.status]?.[1], TRACK[lastTrack(o)?.step] || ""].join(" ").toLowerCase());
    const cols = [{ label: "Order No", get: (o) => o.order_no }, { label: "Date", get: (o) => mdy(o.order_date) }, { label: "Customer", html: (o) => `<b>${esc(custName(o))}</b><br><small class="mono">${esc(o.customers?.account_no || "")}</small>` },
      { label: "Batch No", get: (o) => o.reference || "" }, { label: "Boxes", num: true, get: (o) => qtyText(o.total_boxes) }, { label: "Pcs", num: true, get: (o) => qtyText(o.total_pcs) }, { label: "Amount (₱)", num: true, get: (o) => peso(o.total_amount) },
      { label: "Status", html: stPill }];
    const paint = () => {
      const w = $("#coFind").value.trim().toLowerCase();
      // a search looks in every month; a month shows its orders
      const shown = rows.filter((o, i) => (w ? hay[i].includes(w) : !month || String(o.order_date).startsWith(month)));
      $("#coGrid").innerHTML = (w ? `<p class="muted">${shown.length} order(s) match “${esc(w)}” (every month)</p>` : month ? `<h3 class="sec">${esc(mLabel(month))} · ${shown.length} order(s)</h3>` : "")
        + E.grid({ cols, rows: shown, onRow: true, empty: w ? "No order matches that." : "No orders here." });
      E.bindGrid($("#coGrid"), shown, (o) => (location.hash = "custorder/" + o.id));
    };
    $$("#coMonths button").forEach((b) => (b.onclick = () => { month = b.dataset.m; $("#coFind").value = ""; $$("#coMonths button").forEach((x) => x.classList.toggle("on", x === b)); paint(); }));
    $("#coFind").oninput = paint;
    $("#coScan").onclick = () => E.scanDialog((text) => E.openScanned(text));
    paint();
    E.setRecords(`Customer orders: ${rows.length}`);
  };

  // ======================================================================
  // New / Edit Order
  // ======================================================================
  V.newcustorder = async (custId) => {
    if (!canW()) { location.hash = "custorders"; return; }
    const here = E.stillHere();
    const c = custId ? await E.getCustomer(custId) : null;
    if (here()) orderForm(null, c);
  };
  V.editcustorder = async (id) => {
    E.shell("editcustorder", "Edit Customer Order", busy());
    const here = E.stillHere();
    const { data: o, error } = await sb.from("customer_orders").select("*, customers(*)").eq("id", id).maybeSingle();
    if (!here()) return;
    if (error && notSet(error)) { $("#main").innerHTML = needUpdate; return; }
    if (!o) { $("#main").innerHTML = `<div class="empty">Order not found.</div>`; return; }
    if (!canEdit(o)) { location.hash = "custorder/" + id; return; }
    orderForm(o, o.customers);
  };
  const canEdit = (o) => canW() && (isAdmin() ? fixable(o) : o.status === "pending" && o.created_by === meId());

  function orderForm(o, preset) {
    const terms0 = o?.payment_terms === "CASH ON DELIVERY" ? "COD" : o?.payment_terms || ""; // 3.84
    const known = !terms0 || E.TERMS.includes(terms0);
    E.shell(o ? "editcustorder" : "newcustorder", o ? `Edit ${o.order_no}` : "New Customer Order", `
      <form class="window" id="coForm" novalidate><div class="wtitle">${o ? `Customer Order ${esc(o.order_no)}` : "Customer Order"}</div><div class="wbody">
        ${o?.status === "completed" ? `<div class="banner warn">This order is COMPLETED. Saving it changes its invoice too (boxes, pcs, amount, terms, date). The customer stays the same.</div>` : ""}
        <fieldset class="opt of-step"><legend><i>1</i> Customer</legend><div id="coCust"></div></fieldset>
        <fieldset class="opt of-step"><legend><i>2</i> Boxes</legend>
          <p class="of-say">Scan · Type</p>
          <div class="fields wide of-price"><label for="cfAllPrice">Price for all boxes (optional)</label><input type="number" id="cfAllPrice" min="0" step="0.01" inputmode="decimal" placeholder="e.g. 40.00"></div>
          <div class="btnrow"><button type="button" class="btn" id="cfSuggest">${ic("check")} Use the Suggested Prices</button></div>
          <div class="btnrow cf-scan"><button type="button" class="btn primary" id="cfScan">${ic("scan")} Scan Boxes</button>
            <label class="btn" for="cfPhoto">${ic("image")} Box Label Photo</label><input type="file" id="cfPhoto" accept="image/*" multiple hidden>
            <span class="cf-type"><input type="text" id="cfSer" maxlength="60" placeholder="or type a serial no, e.g. U20261238" aria-label="Box serial no"><button type="button" class="btn" id="cfAdd">${ic("plus")} Add</button></span></div>
          <div id="cfList"></div></fieldset>
        <fieldset class="opt of-step"><legend><i>3</i> Order lines and price</legend>
          <p class="of-say">Check the boxes, pcs and product. Type the <b>price</b> of each line.</p><div id="coLines"></div></fieldset>
        <fieldset class="opt of-step"><legend><i>4</i> Terms of payment</legend>
          <div class="fields wide">
            <label for="coTerms">Terms of Payment</label><select id="coTerms"><option value="">— Choose the terms —</option>${E.TERMS.map((x) => `<option ${x === terms0 ? "selected" : ""}>${x}</option>`).join("")}<option value="OTHER" ${known ? "" : "selected"}>OTHER (type the terms)</option></select>
            <label for="coTermsX" class="cotx" ${known ? "hidden" : ""}>Other Terms</label><input type="text" id="coTermsX" class="cotx" maxlength="60" value="${known ? "" : esc(terms0)}" ${known ? "hidden" : ""}>
          </div>
          <details class="of-more" ${o?.reference || o?.due_date || o?.note ? "open" : ""}><summary>More details (date, batch no, due date, note)</summary>
            <div class="fields wide">
              <label for="coDate">Date</label><input type="date" id="coDate" value="${esc(o?.order_date || isoToday())}">
              <label for="coRef">Batch No</label><input type="text" id="coRef" maxlength="60" value="${esc(o?.reference || "")}" placeholder="e.g. SS-13">
              <label for="coDue">Due Date</label><input type="date" id="coDue" value="${esc(o?.due_date || "")}">
              <label for="coNote">Note</label><input type="text" id="coNote" maxlength="500" value="${esc(o?.note || "")}">
              ${o ? `<span>Order No</span><small><b class="mono">${esc(o.order_no)}</b></small>` : ""}
            </div></details></fieldset>
        ${o ? "" : `<div id="coInsOffer"></div>`}
      </div><div class="wfoot"><button type="button" class="btn" id="coCancel">Cancel</button><button type="submit" class="btn primary">${o ? "Save" : isAdmin() ? "Save Order" : "Save and Send to EMON HASAN"}</button></div></form>`);
    let cust = preset && preset.status === "active" ? preset : null;
    E.customerPicker($("#coCust"), { statuses: ["active"], onPick: (c) => { cust = c; }, preset: cust || undefined });
    if (preset && !cust) toast(`${fullName(preset)}'s account is ${String(preset.status).toUpperCase()}: an order is made only for an ACTIVE account.`, true);
    const ed = linesEditor($("#coLines"), o?.lines || [], o?.extra_columns || []);
    // 3.99.32: the last price used for each code (the newest orders first), and the price for all boxes
    const LAST_PRICE = new Map();
    sb.from("customer_orders").select("lines").neq("status", "cancelled").order("created_at", { ascending: false }).limit(300).then(({ data }) => {
      for (const r of data || []) for (const l of r.lines || []) { const k = String(l.code || "").toUpperCase(); if (k && num(l.price) > 0 && !LAST_PRICE.has(k)) LAST_PRICE.set(k, num(l.price)); }
    }, () => {});
    // 3.99.56: the suggested price of a box: the average price (by pcs) of the boxes of the same product + brand in the sheet,
    // else of the same product, else the last price of the same code
    const SUG = new Map();
    E.allRows(() => sb.from("box_stock").select("product, brand, qty, price").gt("price", 0)).then(({ data }) => {
      const add = (k, b) => { const x = SUG.get(k) || { a: 0, q: 0 }; const q = num(b.qty) || 1; x.a += num(b.price) * q; x.q += q; SUG.set(k, x); };
      for (const b of data || []) { const p = String(b.product || "").toUpperCase(), br = String(b.brand || "").toUpperCase(); if (p) { add(p + "|" + br, b); add(p + "|*", b); } }
    }, () => {});
    const suggestOf = (b) => {
      const p = String(b.product || "").toUpperCase(), br = String(b.brand || "").toUpperCase(), x = SUG.get(p + "|" + br) || SUG.get(p + "|*");
      return x && x.q ? Math.round((x.a / x.q) * 100) / 100 : LAST_PRICE.get(String(b.style || "").toUpperCase()) || 0;
    };
    $("#cfSuggest").onclick = () => { const n = ed.useHints(); toast(n ? `${n} suggested price${n === 1 ? "" : "s"} written.` : "No box line is waiting for a price.", !n); };
    $("#cfAllPrice").onchange = () => ed.fillPrice(num($("#cfAllPrice").value));
    // a box line removed by its × also comes off the scanned list
    $("#coLines").addEventListener("lineoff", (e) => { const i = picked.findIndex((b) => b.serial_no === e.detail); if (i >= 0) { picked.splice(i, 1); listBoxes(); } });
    // 3.40: boxes scanned (or typed) on the form: each fills the lines from the box database and goes on the order when saved
    const picked = [];
    const listBoxes = () => {
      const pcs = picked.reduce((t, b) => t + num(b.qty), 0);
      $("#cfList").innerHTML = picked.length ? `<p class="cf-sum"><b>${boxesText(picked.length)}</b> scanned · ${qtyText(pcs)} pcs</p>${E.grid({ cols: [{ label: "#", get: (b) => String(picked.indexOf(b) + 1) },
        { label: "Serial No", html: (b) => `<b class="mono">${esc(b.serial_no)}</b>` }, { label: "Product", get: (b) => b.product || "" }, { label: "Brand", get: (b) => b.brand || "" }, { label: "CTN", get: (b) => b.ctn || "" },
        { label: "Code", get: (b) => b.style || "" }, { label: "Pcs", num: true, get: (b) => qtyText(b.qty) }, { label: "Batch", get: (b) => b.batch || "" },
        { label: "", html: (b) => `<button type="button" class="btn small danger" data-cfx="${esc(b.serial_no)}" aria-label="Remove box ${esc(b.serial_no)}">×</button>` }], rows: picked })}` : "";
      $$("[data-cfx]").forEach((x) => (x.onclick = () => { const i = picked.findIndex((b) => b.serial_no === x.dataset.cfx); if (i < 0) return; ed.addBox(picked[i], -1); picked.splice(i, 1); listBoxes(); }));
    };
    const scanBox = async (raw) => {
      const ser = String(raw || "").trim().toUpperCase().replace(/\s+/g, " ").slice(0, 60);
      if (!ser) return "✖ No serial no in that code.";
      if (picked.some((b) => b.serial_no === ser)) return `✖ Box ${ser} is scanned already.`;
      const [st, on] = await Promise.all([sb.from("box_stock").select("*").eq("serial_no", ser).maybeSingle(),
        sb.from("customer_order_boxes").select("order_id, customer_orders(order_no, status)").eq("serial_no", ser)]);
      if (st.error) return `✖ ${/box_stock|schema cache/i.test(st.error.message || "") ? "The box database needs the database update RUN_050_BOXES_AND_099.sql." : st.error.message}`;
      if (!st.data) return `✖ Box ${ser} is not in the box database (the Google Sheet). ${isAdmin() ? "Press Read Sheet on the EVA Records page." : "EMON HASAN reads the sheet on the EVA AI page."}`;
      const other = (on.data || []).find((x) => x.customer_orders && x.customer_orders.status !== "cancelled" && x.order_id !== o?.id);
      if (other) return `✖ Box ${ser} is on order ${other.customer_orders.order_no} already.`;
      const b = st.data;
      // 3.99.56: the box's price: the sheet's (column H), else the price for all boxes; otherwise only a SUGGESTED price
      const price = num(b.price) || num($("#cfAllPrice").value);
      if (!ed.addBox(b, 1, price, suggestOf(b))) return `✖ The order has up to ${MAX_LINES} lines.`;
      picked.push(b); listBoxes(); // (3.99.32: the batch no is not filled in by itself)
      return `✔ Box ${ser}: ${[b.product, b.brand && b.brand !== "-" ? b.brand : "", b.qty ? `${qtyText(b.qty)} pcs` : "", b.batch].filter(Boolean).join(" · ")} · ${boxesText(picked.length)}`;
    };
    $("#cfScan").onclick = () => E.scanDialog((text) => scanBox(readLabel(text).serial_no), {
      title: "Scan Boxes — Customer Order", hint: "Point the camera at the QR or PDF417 code of each box label. Each box fills the order lines; press Close when done.", keep: true });
    const typed = async () => { const r = await scanBox($("#cfSer").value); toast(r.slice(2), r.startsWith("✖")); if (r.startsWith("✔")) $("#cfSer").value = ""; $("#cfSer").focus(); };
    $("#cfAdd").onclick = typed;
    $("#cfSer").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); typed(); } };
    $("#cfPhoto").onchange = async (e) => {
      const files = Array.from(e.target.files); e.target.value = "";
      const notes = [];
      for (const f of files) { try { notes.push(await scanBox(readLabel(await E.decodeImageFile(f)).serial_no)); } catch (err) { notes.push(`✖ ${f.name}: ${err.message}`); } }
      const bad = notes.filter((n) => n.startsWith("✖"));
      if (notes.length) toast(bad.length ? bad.map((n) => n.slice(2)).join(" ") : notes[notes.length - 1].slice(2), !!bad.length);
    };
    const terms = () => ($("#coTerms").value === "OTHER" ? $("#coTermsX").value.trim().replace(/\s+/g, " ").toUpperCase() : $("#coTerms").value);
    // 3.60: the terms (or the date) chosen fill the due date by themselves (it can still be changed by hand)
    const fillDue = () => { const d = E.termsDue($("#coDate").value, $("#coTerms").value); if (d) $("#coDue").value = d; };
    $("#coTerms").onchange = () => { $$(".cotx").forEach((x) => (x.hidden = $("#coTerms").value !== "OTHER")); fillDue(); };
    $("#coDate").addEventListener("change", () => { if ($("#coTerms").value) fillDue(); });
    if (!$("#coDue").value) fillDue();
    $("#coCancel").onclick = () => history.back();
    // 3.72: ADD COVERAGE below the items (new orders): the premium follows the lines; saved, the insurance is made and its payment opens
    let insOn = false;
    if (!o && E.insOffer) E.insOffer($("#coInsOffer"), () => ed.read().lines, (v) => (insOn = v));
    $("#coForm").onsubmit = async (e) => {
      e.preventDefault();
      if (!cust) return toast("Choose the customer (an ACTIVE account).", true);
      const { lines, cols } = ed.read();
      if (!lines.length) return toast("Add at least one line.", true);
      const bad = lines.findIndex((l) => !l.product || !(l.qty > 0));
      if (bad >= 0) return toast(`Line ${bad + 1}: write the product, and the boxes and pcs (or the quantity).`, true);
      E.setBusy(e.target, true, "Saving");
      const p_data = { customer_id: cust.id, order_date: $("#coDate").value || null, due_date: $("#coDue").value || null,
        reference: $("#coRef").value, payment_terms: terms(), address: o?.address || "", note: $("#coNote").value, extra_columns: cols, lines };
      const { data: row, error } = picked.length ? await sb.rpc("save_order_with_boxes", { p_id: o?.id || null, p_data, p_boxes: picked.map((b) => b.serial_no) })
        : await sb.rpc("save_customer_order", { p_id: o?.id || null, p_data });
      if (error) { E.setBusy(e.target, false); return fail(error, /save_order_with_boxes/.test(error.message || "") && notSet(error) ? "Run the database update 052_order_scan.sql first" : notSet(error) ? "Run the database update RUN_041_TO_046.sql first" : o?.status === "completed" && /cannot be changed/.test(error.message || "") ? "Run the database update 062_edit_completed_order.sql first" : "Could not save the order"); }
      const withB = picked.length ? ` with ${boxesText(picked.length)}` : "";
      toast(o ? `Saved${withB}.${o.status === "completed" ? " The invoice was changed too." : ""}` : row.status === "approved" ? `Order ${row.order_no} saved and approved${withB}.` : `Order ${row.order_no} saved and sent to EMON HASAN${withB}.`);
      if (insOn && !o) {
        const r = await sb.rpc("request_insurance", { p_order: row.id });
        if (!r.error) { toast(`Order ${row.order_no} saved with COVERAGE ${r.data.ins_no}: pay by the QR code, then submit the proof.`); location.hash = "insurance/" + r.data.id; return; }
        toast(`Order saved, but the coverage could not be added: ${r.error.message}`, true);
      }
      location.hash = "custorder/" + row.id;
    };
  }

  // The lines of the form: QUANTITY = BOXES × PCS by itself (typed when there are no boxes or pcs), AMOUNT = QUANTITY × PRICE;
  // + Add Line, + Add Column (up to 4 columns of the order's own; × takes one off).
  function linesEditor(box, lines, cols0) {
    let cols = [...cols0];
    const val = (v) => (v == null || v === "" || v === 0 ? "" : esc(v));
    const lineRow = (l = {}) => `<tr class="co-line" data-serial="${esc(l.serial || "")}">
      <td class="co-n"></td>
      <td><input type="number" class="cQ" min="0" step="1" inputmode="numeric" aria-label="Quantity" value="${val(l.qty)}"></td>
      <td><input type="number" class="cB" min="0" step="1" inputmode="numeric" aria-label="Boxes" value="${val(l.boxes)}"></td>
      <td><input type="text" class="cC" maxlength="30" aria-label="Code" value="${val(l.code)}"></td>
      <td><input type="number" class="cP" min="0" step="1" inputmode="numeric" aria-label="Pcs per box" value="${val(l.pcs)}"></td>
      <td><input type="text" class="cL" maxlength="40" aria-label="Lot No" value="${val(l.lot)}"></td>
      <td><input type="text" class="cN" maxlength="120" aria-label="Product" value="${val(l.product)}"><small class="co-ser">${l.serial ? "BOX " + esc(l.serial) : ""}</small></td>
      ${cols.map((c) => `<td><input type="text" class="cX" data-c="${esc(c)}" maxlength="60" aria-label="${esc(c)}" value="${val(l.extra?.[c])}"></td>`).join("")}
      <td><input type="number" class="cR" min="0" step="0.01" inputmode="decimal" aria-label="Price" value="${val(l.price)}"></td>
      <td class="num cA">0.00</td>
      <td><button type="button" class="btn small cDel" aria-label="Remove line">×</button></td></tr>`;
    const draw = (ls) => {
      box.innerHTML = `<div class="grid-wrap co-wrap"><table class="grid co-lines edit"><thead><tr><th>#</th><th class="num">Total Pcs</th><th class="num">Boxes</th><th>Code</th><th class="num">Pcs / Box</th><th>Lot No.</th><th>Product *</th>
          ${cols.map((c, i) => `<th>${esc(c)} <button type="button" class="co-xcol" data-xc="${i}" aria-label="Remove the column ${esc(c)}" title="Remove the column">×</button></th>`).join("")}<th class="num">Price (₱)</th><th class="num">Amount (₱)</th><th></th></tr></thead>
        <tbody>${(ls.length ? ls : [{}]).map(lineRow).join("")}</tbody>
        <tfoot><tr><td></td><td class="num co-tq">0</td><td class="num co-tb">0</td><td colspan="${4 + cols.length}"><b>TOTAL AMOUNT</b></td><td></td><td class="num co-ta">0.00</td><td></td></tr></tfoot></table></div>
        <div class="btnrow"><button type="button" class="btn small co-add">${ic("plus")} Add Line</button><button type="button" class="btn small co-addc">${ic("plus")} Add Column</button>
          <small class="muted">Max ${MAX_LINES} lines · ${MAX_COLS} columns</small></div>
        <div class="summary-box co-words"></div>`;
      bind(); sum();
    };
    const read1 = (tr) => {
      const b = num($(".cB", tr).value), p = num($(".cP", tr).value);
      const q = b > 0 && p > 0 ? b * p : num($(".cQ", tr).value);
      return { qty: q, boxes: b, code: $(".cC", tr).value.trim(), pcs: p, lot: $(".cL", tr).value.trim(), product: $(".cN", tr).value.trim(), price: num($(".cR", tr).value),
        extra: Object.fromEntries($$(".cX", tr).map((x) => [x.dataset.c, x.value.trim()])), ...(tr.dataset.serial ? { serial: tr.dataset.serial } : {}) };
    };
    const blank = (l) => !l.product && !l.code && !l.qty && !l.boxes && !l.pcs;
    const all = () => $$(".co-line", box).map(read1);
    const sum = () => {
      let tq = 0, tb = 0, ta = 0;
      $$(".co-line", box).forEach((tr, i) => {
        const l = read1(tr), auto = l.boxes > 0 && l.pcs > 0, q = $(".cQ", tr);
        $(".co-n", tr).textContent = i + 1;
        q.readOnly = auto; q.classList.toggle("auto", auto);
        if (auto) q.value = l.qty;
        $(".cA", tr).textContent = peso(l.qty * l.price);
        tq += l.qty; tb += l.boxes; ta += l.qty * l.price;
      });
      $(".co-tq", box).textContent = qtyText(tq); $(".co-tb", box).textContent = qtyText(tb); $(".co-ta", box).textContent = peso(ta);
      $(".co-words", box).textContent = `${boxesText(tb)} · ${qtyText(tq)} PCS · ${E.words(ta)}`;
      $(".co-add", box).disabled = $$(".co-line", box).length >= MAX_LINES;
      $(".co-addc", box).disabled = cols.length >= MAX_COLS;
    };
    const bind = () => {
      $$(".co-line", box).forEach((tr) => {
        $$("input", tr).forEach((x) => (x.oninput = sum));
        $(".cDel", tr).onclick = () => { const s0 = tr.dataset.serial; if ($$(".co-line", box).length > 1) tr.remove(); else { $$("input", tr).forEach((x) => (x.value = "")); tr.dataset.serial = ""; $(".co-ser", tr).textContent = ""; } if (s0) box.dispatchEvent(new CustomEvent("lineoff", { detail: s0 })); sum(); };
      });
      $$(".co-xcol", box).forEach((b) => (b.onclick = () => { const ls = all(); cols.splice(Number(b.dataset.xc), 1); draw(ls); }));
      $(".co-add", box).onclick = () => { if ($$(".co-line", box).length >= MAX_LINES) return; $("tbody", box).insertAdjacentHTML("beforeend", lineRow({})); bind(); sum(); $(".co-line:last-child .cB", box).focus(); };
      $(".co-addc", box).onclick = () => addColumn((name) => { const ls = all(); cols.push(name); draw(ls); });
    };
    draw(lines);
    // d = 1: the box goes on its line; d = -1: it comes off (an empty line goes); false when there is no room for a new line
    // 3.99.32: each box is its own line (with its serial no and its price); d = -1 takes its line off; false when there is no room
    const addBox = (b, d = 1, price = 0, hint = 0) => {
      const ser = String(b.serial_no || "").toUpperCase();
      if (d < 0) {
        const tr = $$(".co-line", box).find((r) => r.dataset.serial === ser);
        if (tr) { if ($$(".co-line", box).length > 1) tr.remove(); else { $$("input", tr).forEach((x) => (x.value = "")); tr.dataset.serial = ""; $(".co-ser", tr).textContent = ""; } }
        sum(); return true;
      }
      let row = $$(".co-line", box).find((r) => !r.dataset.serial && blank(read1(r)));
      if (!row) {
        if ($$(".co-line", box).length >= MAX_LINES) return false;
        $("tbody", box).insertAdjacentHTML("beforeend", lineRow({})); bind(); row = $(".co-line:last-child", box);
      }
      row.dataset.serial = ser; $(".co-ser", row).textContent = "BOX " + ser;
      $(".cB", row).value = 1; $(".cC", row).value = String(b.style || "").toUpperCase(); $(".cP", row).value = num(b.qty) || ""; $(".cL", row).value = String(b.batch || "").toUpperCase();
      $(".cN", row).value = [b.product, b.brand && b.brand !== "-" ? b.brand : ""].filter(Boolean).join(" · ").toUpperCase();
      $(".cR", row).value = price > 0 ? price : "";
      $(".cR", row).placeholder = !(price > 0) && hint > 0 ? `≈ ${hint.toFixed(2)}` : ""; $(".cR", row).dataset.hint = hint > 0 ? hint : "";
      $(".cR", row).title = hint > 0 ? `Suggested price ₱ ${hint.toFixed(2)} (from your past prices)` : "";
      sum(); return true;
    };
    // 3.99.56: the suggested prices written in the box lines that have no price yet
    const useHints = () => { let n = 0; box.querySelectorAll(".co-line .cR").forEach((x) => { if (!num(x.value) && num(x.dataset.hint) > 0) { x.value = x.dataset.hint; n++; } }); sum(); return n; };
    // the price for every box line that has none yet
    const fillPrice = (price) => { if (!(price > 0)) return; $$(".co-line", box).forEach((r) => { if (r.dataset.serial && !num($(".cR", r).value)) $(".cR", r).value = price; }); sum(); };
    return { read: () => ({ lines: all().filter((l) => !blank(l)), cols }), addBox, fillPrice, useHints };
  }
  // the name of a new column (in capitals, once, not a column the order has already)
  function addColumn(done) {
    const m = E.modal("Add Column", `<div class="fields wide"><label for="acName">Column Name</label><input type="text" id="acName" maxlength="20" placeholder="e.g. COLOR, SIZE, STYLE"></div>`,
      `<button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" data-ok>Add Column</button>`);
    const go = () => {
      const n = $("#acName", m.el).value.trim().replace(/\s+/g, " ").toUpperCase();
      if (!n) return toast("Write the column name.", true);
      if (["QUANTITY", "QTY", "BOXES", "BOX", "CODE", "PCS", "LOT", "LOT NO", "LOT NO.", "PRODUCT", "PRICE", "AMOUNT"].includes(n) || $$(".co-lines thead th").some((th) => th.firstChild?.textContent.trim().toUpperCase() === n)) return toast(`The order has a ${n} column already.`, true);
      m.close(); done(n);
    };
    $("[data-x]", m.el).onclick = m.close;
    $("[data-ok]", m.el).onclick = go;
    $("#acName", m.el).onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } };
    $("#acName", m.el).focus();
  }

  // ======================================================================
  // The page of an order: details, lines, boxes, the Director's decision, delivery, invoice, prints
  // ======================================================================
  // id: the order's id, or its number (OR-202610-0001: from an invoice or a scanned order; 3.38.1: CO- before, both are found)
  V.custorder = async (id) => {
    E.shell("custorder", "Customer Order", busy());
    const here = E.stillHere(), m = /^(?:CO|OR|PO)-(\d{6}-\d+)$/i.exec(id || ""), nos = m ? [`PO-${m[1]}`, `OR-${m[1]}`, `CO-${m[1]}`] : null;
    const boxesOf = (oid) => sb.from("customer_order_boxes").select("*").eq("order_id", oid).order("created_at").order("id");
    const [{ data: o, error }, bx0] = await Promise.all([
      (nos ? sb.from("customer_orders").select("*, customers(*)").in("order_no", nos) : sb.from("customer_orders").select("*, customers(*)").eq("id", id)).maybeSingle(), nos ? null : boxesOf(id)]);
    if (!here()) return;
    if (error && notSet(error)) { $("#main").innerHTML = needUpdate; return; }
    if (!o) { $("#main").innerHTML = `<div class="empty">Order not found. <a href="#custorders">All orders</a></div>`; return; }
    const bx = bx0 || (await boxesOf(o.id));
    const [inv, urls, dl, trk] = await Promise.all([
      o.invoice_id ? sb.from("invoice_balances").select("*").eq("id", o.invoice_id).maybeSingle().then((r) => r.data, () => null) : null,
      o.delivery_photos?.length ? E.signedMap(o.delivery_photos) : new Map(),
      sb.rpc("co_delivered", { p_order: o.id }).then((r) => (r.error ? null : r.data), () => null), // 3.56: what is charged as delivered
      sb.from("order_tracking").select("*").eq("order_id", o.id).order("at").then((r) => (r.error ? null : r.data || []), () => null)]); // 3.88
    o._asg = await sb.from("order_assignees").select("*").eq("order_id", o.id).order("assigned_at").then((r) => (r.error ? null : r.data || []), () => null); // 3.99.233
    if (!here()) return;
    o._dl = dl; o._trk = trk || []; o._trkOn = trk !== null;
    draw(o, bx.data || [], inv, urls);
  };

  // 3.98: THE TRACKING like a courier's: what happened, the newest on top (green), each line with its date and time on the
  // left. events: [{ at, t, lines: [html], cls }]; next: what comes next (a grey line on top).
  const tlWhen = (at) => {
    const d = new Date(/^\d{4}-\d\d-\d\d$/.test(String(at)) ? at + "T00:00:00+08:00" : at);
    if (isNaN(d)) return ["", ""];
    return [d.toLocaleDateString("en-GB", { timeZone: "Asia/Manila", day: "numeric", month: "short" }).toUpperCase(),
      /^\d{4}-\d\d-\d\d$/.test(String(at)) ? "" : d.toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" })];
  };
  function timelineHtml(events, next = "") {
    const rows = events.filter((e) => e.at).map((e, i) => ({ ...e, i })).sort((a, b) => new Date(a.at) - new Date(b.at) || a.i - b.i).reverse();
    return `<ol class="tl">${next ? `<li class="tl-next"><div class="tl-when"><small>NEXT</small></div><span class="tl-dot"></span><div class="tl-what"><b>${esc(next)}</b></div></li>` : ""}${rows.map((e, i) => {
      const [d, t] = tlWhen(e.at);
      return `<li class="${i ? "" : "tl-now"}${e.cls ? " " + e.cls : ""}"><div class="tl-when"><b>${esc(d)}</b><small>${esc(t)}</small></div><span class="tl-dot"></span>
        <div class="tl-what"><b>${esc(e.t)}</b>${(e.lines || []).filter(Boolean).map((l) => `<span>${l}</span>`).join("")}</div></li>`;
    }).join("")}</ol>`;
  }
  // the tracking of an order: ORDER CREATED, CONFIRMED, BOX SERIALS ADDED, SORTING, then DELIVERED with the car plate no and
  // the proof of delivery photo. goBtn: the Complete Delivery button of the order paper, when the order has one.
  function trackingHtml(o, inv, w, boxes = [], goBtn = "") {
    const ev = [], add = (at, t, lines = [], cls = "") => { if (at) ev.push({ at, t, lines, cls }); };
    const by = (n) => (n ? `by ${esc(n)}` : "");
    add(o.created_at || o.order_date, "Order created", [by(o.created_by_name)]);
    add(o.approved_at, "Order confirmed", [`Approved by ${esc(o.approved_by_name || "EMON HASAN")}`]);
    const ser = boxes.filter((b) => b.serial_no), boxAt = ser.reduce((m, b) => (!m || String(b.created_at) > String(m) ? b.created_at : m), null);
    add(boxAt, "Box serials added", [`${ser.length} of ${qtyText(o.total_boxes)} box(es)`]);
    const trk = o._trk || [];
    for (const r of trk) add(r.at, TRACK_SAY[r.step] || String(r.step || "").toUpperCase(), [r.employee_name ? `Delivery person: ${esc(r.employee_name)}` : "", by(r.by_name), r.note ? esc(r.note) : ""]);
    const photos = (o.delivery_photos || []).length, waiting = o.status === "approved" && !!o.delivery_request_at, done = o.status === "completed";
    const sameTime = done && o.delivered_at && Math.abs(new Date(o.completed_at) - new Date(o.delivered_at)) < 120000;
    add(o.delivered_at || o.delivery_request_at, waiting ? "Delivery submitted" : "Order has been delivered", [
      photos ? `<button type="button" class="tl-link" data-pod>View Proof of Delivery</button>` : "", o.plate_no ? `Plate No: <b class="nw">${esc(o.plate_no)}</b>` : "", o.vehicle_type ? `Car: <b class="nw">${esc(o.vehicle_type)}</b>` : "",
      waiting ? "Waiting for EMON HASAN's approval" : "", by(done ? o.completed_by_name : o.delivery_request_by), sameTime && inv ? `Invoice ${esc(inv.invoice_no)} made and billed` : ""]);
    if (done && !sameTime) add(o.completed_at, "Order completed", [inv ? `Invoice ${esc(inv.invoice_no)} made and billed` : "", by(o.completed_by_name)]);
    if (o.status === "cancelled") add(o.cancelled_at || o.updated_at || o.created_at, "Order cancelled", [by(o.cancelled_by_name), o.cancel_note ? esc(o.cancel_note) : ""], "tl-bad");
    const open = o.status === "approved" && !o.delivery_request_at, sorted = trk.some((t) => t.step === "sorting");
    const next = o.status === "pending" ? "Waiting for EMON HASAN's approval" : waiting ? "EMON HASAN approves the delivery"
      : !open ? "" : !ser.length ? "Add the box serials" : !sorted ? "Mark as sorting" : "Complete the delivery (car plate no and proof of delivery photo are optional)";
    const asg = o._asg || [], canAsg = o._asg !== null && canW() && (o.status === "pending" || open);
    const asgBtn = canAsg ? `<button type="button" class="btn small" data-asg>${ic("user")} ${asg.length ? "Delivery By" : "Assign Delivery"}</button>` : "";
    const asgLine = asg.length ? `<div class="trk-asg">${ic("user")} <b>DELIVERY BY</b> ${asg.map((a) => `<span>${esc(a.full_name)}${a.employee_no ? ` · <i class="mono">${esc(a.employee_no)}</i>` : ""}</span>`).join("")}</div>` : "";
    const btns = asgBtn + (!(open && w) ? "" : `${!ser.length ? `<button type="button" class="btn primary small" data-trk-go="1">${ic("box")} Add Box Serials</button>` : ""}
        ${!sorted && o._trkOn ? `<button type="button" class="btn ${ser.length ? "primary" : ""} small" data-trk="sorting">${ic("next")} Mark as Sorting</button>` : ""}
        ${ser.length && (sorted || !o._trkOn) ? goBtn || `<button type="button" class="btn ok small" data-trk-go="2">${ic("check")} Complete Delivery</button>` : ""}`);
    return `<section class="trk"><div class="trk-head"><b>${ic("box")} TRACKING</b><span class="grow"></span>${btns}</div>${asgLine}${timelineHtml(ev, next)}</section>`;
  }
  // 3.99.233: who delivers the order: tick employees (the Manila office first). Only they can mark it delivered.
  async function assignDialog(o, done) {
    const { data: ppl, error } = await sb.rpc("delivery_people");
    if (error) return fail(error, /delivery_people|PGRST202|schema cache/.test(error.message || "") ? "Run the database update 140_order_delivery_assign.sql first" : "Could not load the employees");
    const on = new Set((o._asg || []).map((a) => a.employee_id));
    const row = (p) => `<label class="asg-row"><input type="checkbox" value="${esc(p.id)}" ${on.has(p.id) ? "checked" : ""}><span><b>${esc(String(p.full_name || "").toUpperCase())}</b>
      <small>${[p.employee_no, p.position, p.work_location].filter(Boolean).map(esc).join(" · ")}${p.has_login ? "" : " · NO PORTAL LOGIN"}</small></span></label>`;
    const m = E.modal(`Delivery By · ${o.order_no}`, `<input type="search" class="asg-q" placeholder="Search name or EOID" aria-label="Search employees">
      <div class="asg-list">${(ppl || []).map(row).join("") || `<div class="empty">No active employees.</div>`}</div>`,
      `<button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" data-ok>${ic("check")} Save</button>`);
    $(".asg-q", m.el).oninput = (e) => { const q = e.target.value.trim().toLowerCase(); $$(".asg-row", m.el).forEach((r) => (r.hidden = q && !r.textContent.toLowerCase().includes(q))); };
    $("[data-x]", m.el).onclick = m.close;
    $("[data-ok]", m.el).onclick = async (e) => {
      E.setBusy(e.currentTarget, true);
      const ids = $$(".asg-row input:checked", m.el).map((x) => x.value);
      const { error: er } = await sb.rpc("order_assign", { p_order: o.id, p_employees: ids });
      if (er) { E.setBusy(e.currentTarget, false); return fail(er, "Could not save"); }
      m.close(); toast(ids.length ? `${o.order_no}: ${ids.length} delivery employee(s). They were told.` : `${o.order_no}: no delivery employee.`); done();
    };
  }
  // a tracking step pressed
  async function trackStep(o, k) {
    const { error } = await sb.rpc("order_track", { p_order: o.id, p_step: k, p_employee: null, p_note: null });
    if (error) { fail(error, /order_track|schema cache|PGRST202/.test(error.message || "") ? "Run the database update 090_order_tracking.sql first" : "Could not update the tracking"); return false; }
    toast(`${o.order_no}: ${TRACK[k]}.`);
    return true;
  }
  // 3.98: View Proof of Delivery: the photos, the car plate no, when and by whom
  function showPod(o, urls) {
    const pics = (o.delivery_photos || []).map((p) => urls.get(p) || "").filter(Boolean);
    const m = E.modal(`Proof of Delivery — ${o.order_no}`, `<div class="pgrid2 qc-head">${E.cell("Delivered", o.delivered_at ? E.dateTime(o.delivered_at) : "")}${E.cell("License Plate Number", o.plate_no || "")}
        ${E.cell(o.status === "completed" ? "Completed By" : "Submitted By", o.completed_by_name || o.delivery_request_by || "")}${E.cell("Type of Car", o.vehicle_type || "")}${o.delivery_note ? E.cell("Note", o.delivery_note) : ""}</div>
      <div class="pod-pics">${pics.map((u, i) => `<button type="button" class="co-ph" data-ph="${esc(u)}" aria-label="Open photo ${i + 1}"><img src="${esc(u)}" alt="Proof of delivery photo ${i + 1}"></button>`).join("") || `<div class="empty small">No photo.</div>`}</div>`,
      `<button type="button" class="btn" data-x>Close</button>`, { wide: true });
    $("[data-x]", m.el).onclick = m.close;
    $$("[data-ph]", m.el).forEach((b) => (b.onclick = () => E.lightbox(b.dataset.ph)));
  }
  // the car of the delivery: its plate no and its type (3.99.3), both optional; saving them (the order page and the
  // Complete Delivery page). A server without 097 saves the plate no only.
  const noPlate = (e) => e?.code === "PGRST202" || /set_order_plate|delivery_plate|set_order_car|delivery_car|schema cache/.test(e?.message || "");
  const CAR_TYPES = ["MOTORCYCLE", "TRICYCLE", "CAR", "SUV", "VAN", "L300", "PICK-UP TRUCK", "CLOSED VAN", "TRUCK", "PICK UP BY CUSTOMER"];
  const CAR_LIST = `<datalist id="carTypes">${CAR_TYPES.map((t) => `<option value="${t}"></option>`).join("")}</datalist>`;
  const plateField = (p, plate, type) => `<h4 class="co-h4">Car of the Delivery <small>(optional)</small></h4>
    <div class="plate-row"><label class="plate-in"><small>CAR PLATE NO</small><input type="text" id="${p}Plate" maxlength="30" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="e.g. NBC 1234" value="${esc(plate || "")}"></label>
      <label class="plate-in"><small>TYPE OF CAR</small><input type="text" id="${p}Type" maxlength="40" autocapitalize="characters" autocomplete="off" list="carTypes" placeholder="e.g. VAN, TRUCK" value="${esc(type || "")}"></label>${CAR_LIST}
      <button type="button" class="btn primary" id="${p}PlateSave">${ic("check")} ${plate || type ? "Change" : "Save"}</button>${plate || type ? `<span class="plate-ok">${ic("check")} SAVED</span>` : ""}</div>`;
  // 3.99.148: Complete Delivery saves the car typed (no need to press Save first). false: it could not be saved.
  async function carFirst(p, plate0, type0, save, saveOld) {
    if (!$(`#${p}Plate`)) return true;
    const plate = $(`#${p}Plate`).value.trim(), type = $(`#${p}Type`).value.trim();
    if ((!plate && !type) || (plate.toUpperCase() === String(plate0 || "").toUpperCase() && type.toUpperCase() === String(type0 || "").toUpperCase())) return true;
    let { error } = await save(plate, type);
    if (error && noPlate(error) && plate) ({ error } = await saveOld(plate));
    if (error) { fail(error, "Could not save the car plate no / type of car"); return false; }
    return true;
  }
  async function savePlate(e, p, save, saveOld, reload) {
    const plate = $(`#${p}Plate`).value.trim(), type = $(`#${p}Type`).value.trim(), btn = e.currentTarget;
    if (!plate && !type) return toast("Write the car plate no or the type of car.", true);
    btn.disabled = true;
    let { error } = await save(plate, type);
    if (error && noPlate(error) && plate) { // the server has not 097 yet: the plate no is saved, the type waits
      ({ error } = await saveOld(plate));
      if (!error) { toast("Car plate no saved. Run the database update 097_order_car_type.sql to save the type of car too.", true); return reload(); }
    }
    if (error) { btn.disabled = false; return fail(error, noPlate(error) ? "Run the database update 097_order_car_type.sql first" : "Could not save the car"); }
    toast("Car saved."); reload();
  }

  // 3.39: the page of an order in the style of a profile: the head (order no, status, customer, its numbers, the QR code of the
  // order paper), the 3 steps, the amount, the buttons, and tabs: the lines, the boxes, the delivery, the invoice
  // 3.99.30: THE GUIDE of an order: the steps (1 Order made, 2 Approved, 3 Boxes added, 4 Sorting, 5 Delivered) with the one
  // that is done ticked, and under them what to do NOW with one big button. go: the Complete Delivery button of the paper.
  function guideHtml(o, boxes, inv, w, go = "") {
    const ser = boxes.filter((b) => b.serial_no).length, total = num(o.total_boxes), sorted = (o._trk || []).some((t) => t.step === "sorting");
    const done = o.status === "completed", cancelled = o.status === "cancelled", ok = o.status === "approved" || done, waiting = o.status === "approved" && !!o.delivery_request_at;
    const steps = [["Order made", true], ["Approved", ok], ["Boxes added", done || ser > 0], ...(o._trkOn ? [["Sorting", done || sorted]] : []), ["Delivered", done]];
    steps.forEach((x, i) => { if (i && !steps[i - 1][1]) x[1] = false; }); // one after the other: a step is done only after the ones before it
    const at = cancelled ? -1 : steps.findIndex((x) => !x[1]);
    const bar = `<ol class="og-steps">${steps.map(([t, d], i) => `<li class="${d ? "done" : i === at ? "on" : ""}"><span>${d ? "✔" : i + 1}</span>${esc(t)}</li>`).join("")}</ol>`;
    const big = (attrs, label, cls = "primary", icon = "check") => `<button type="button" class="btn ${cls} big og-go" ${attrs}>${ic(icon)} ${esc(label)}</button>`;
    const more = ser && ser < total && !waiting && w ? `<button type="button" class="btn og-more" data-trk-go="1">${ic("box")} Add More (${ser} of ${qtyText(total)})</button>` : "";
    let n = at + 1, title, say, btn = "";
    if (cancelled) { n = "✖"; title = "Cancelled"; say = o.cancel_note ? esc(o.cancel_note) : ""; }
    else if (done) { n = "✔"; title = "Finished"; say = `Delivered${o.delivered_at ? " " + esc(mdy(o.delivered_at)) : ""}`;
      btn = inv && E.canOpen("invoice") ? `<a class="btn primary big og-go" href="#invoice/${inv.id}">${ic("doc")} Open Invoice</a>` : ""; }
    else if (o.status === "pending") {
      if (isAdmin()) { title = "Approve Order"; say = "Check lines"; btn = big('data-og="#coApprove"', "Approve Order", "ok") + `<button type="button" class="btn og-more" data-og="#coCancelO">Cancel Order</button>`; }
      else { title = "Waiting"; say = "Approval · EMON HASAN"; }
    } else if (waiting) {
      if (isAdmin()) { title = "Approve Delivery"; say = `Sent by ${esc(o.delivery_request_by || "order paper")}`; btn = big('data-og="#coDvOk"', "Approve Delivery", "ok") + `<button type="button" class="btn og-more" data-og="#coDvNo">Send Back</button>`; }
      else { title = "Waiting"; say = "Delivery approval · EMON HASAN"; }
    } else if (!w) { title = steps[at][0]; say = "Office"; }
    else if (!ser) { title = "Add Boxes"; say = `<b>0 of ${qtyText(total)}</b> Added · Scan / Type`; btn = big('data-trk-go="1"', "Add Boxes", "primary", "box"); }
    else if (o._trkOn && !sorted) { title = "Sorting"; say = `<b>${ser} of ${qtyText(total)}</b> Added`; btn = big('data-trk="sorting"', "Mark as Sorting", "primary", "next") + more; }
    else { title = "Delivery"; say = "Customer received";
      btn = (go || big('data-trk-go="2"', "Complete Delivery", "ok")) + more; }
    return `<section class="og${done ? " og-done" : cancelled ? " og-bad" : ""}">${bar}
      <div class="og-now"><div class="og-txt"><b>${esc(title)}</b><p>${say}</p></div><div class="og-btns">${btn}</div></div></section>`; // 3.99.211: small, button at the side
  }

  function draw(o, boxes, inv, urls) {
    const c = o.customers || {}, cols = o.extra_columns || [], w = canW();
    const sumPcs = boxes.reduce((s, b) => s + num(b.pcs), 0);
    const deliverNow = !!o.delivery_code && o.status === "approved"; // the paper's Complete Delivery page (048)
    $(".band h1") && ($(".band h1").textContent = `Customer Order › ${o.order_no}`); E.setTrx(o.id);
    const banner = o.status === "pending" ? `<div class="banner warn">${ic("clock")} WAITING FOR APPROVAL — EMON HASAN approves the order. Then it is CONFIRMED and the delivery can start.</div>`
      : o.status === "cancelled" ? `<div class="banner closed">CANCELLED${o.cancelled_by_name ? ` by ${esc(o.cancelled_by_name)}` : ""}${o.cancelled_at ? ` on ${esc(mdy(o.cancelled_at))}` : ""}${o.cancel_note ? ` — ${esc(o.cancel_note)}` : ""}</div>`
      : o.status === "approved" && o.delivery_request_at ? `<div class="banner warn">${ic("clock")} DELIVERY SUBMITTED — ${esc(o.delivery_request_by || "ORDER PAPER")} · ${esc(E.dateTime(o.delivery_request_at))} · Waiting approval</div>`
      : ""; // 3.99.1: no COMPLETED line here: the tracking shows the delivery and the invoice
    const head = `<section class="cust-hero co-hero">
      <div class="ch-pic"><div class="ch-photo co-ic">${ic("box")}</div></div>
      <div class="ch-main">
        <div class="ch-name"><h2>${esc(o.order_no)}</h2>${stPill(o)}<span id="coInsMini"></span></div>
        <div class="ch-sub">${E.canOpen("customer") ? `<a href="#customer/${c.id}"><b>${esc(fullName(c))}</b></a>` : `<b>${esc(fullName(c))}</b>`}${c.account_no ? ` · <span class="mono">${esc(c.account_no)}</span>` : ""}</div>
        <div class="ch-ids">${E.idBox("Date", mdy(o.order_date))}${E.idBox("Batch No", o.reference || "")}${E.idBox("Terms of Payment", o.payment_terms || "")}${E.idBox("Due Date", mdy(dueOf(o)))}${E.idBox("Boxes", qtyText(o.total_boxes))}${E.idBox("Pcs", qtyText(o.total_pcs))}</div>
      </div>
      ${deliverNow ? `<div class="ch-qr"><canvas id="coQr" aria-label="QR code: Complete Delivery"></canvas><small>Verification</small></div>` : ""}
    </section>`;
    const deliverBtn = (cls = "") => `<a class="btn ok ${cls}" href="#${deliveryHash(o.order_no, o.delivery_code)}">${ic("check")} Complete Delivery</a>`;
    const stepper = trackingHtml(o, inv, false, boxes); // 3.99.30: the history only (the buttons are in the guide)
    const guide = guideHtml(o, boxes, inv, w, deliverNow && !o.delivery_request_at ? deliverBtn("big og-go") : "");
    const linesHtml = `<div class="grid-wrap co-wrap"><table class="grid co-lines"><thead><tr><th>#</th><th class="num">Boxes</th><th class="num">Pcs</th><th>Code</th><th>Lot No.</th><th>Product</th>${cols.map((x) => `<th>${esc(x)}</th>`).join("")}<th class="num">Price (₱)</th><th class="num">Amount (₱)</th></tr></thead>
        <tbody>${(o.lines || []).map((l, i) => `<tr><td>${i + 1}</td><td class="num">${l.boxes ? qtyText(l.boxes) : ""}</td><td class="num">${qtyText(l.qty)}</td><td>${esc(l.code || "")}</td><td>${esc(l.lot || "")}</td><td>${esc(l.product)}</td>
          ${cols.map((x) => `<td>${esc(l.extra?.[x] || "")}</td>`).join("")}<td class="num">${peso(l.price)}</td><td class="num">${peso(l.amount)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td></td><td class="num">${qtyText(o.total_boxes)}</td><td class="num">${qtyText(o.total_pcs)}</td><td colspan="${3 + cols.length}"><b>TOTAL AMOUNT</b></td><td></td><td class="num"><b>${peso(o.total_amount)}</b></td></tr></tfoot></table></div>`;
    const delHtml = o.status === "pending" ? `<div class="empty">The delivery starts when the order is CONFIRMED (approved by EMON HASAN).</div>`
      : o.status === "cancelled" ? `<div class="empty">CANCELLED: no delivery.</div>`
      : deliverNow ? `${(o.delivery_photos || []).length ? deliveryHtml(o, urls, false) : ""}${o.delivery_request_at ? "" : `<div class="co-done">${deliverBtn("big")}
          </div>`}`
      : deliveryHtml(o, urls, w);
    const invHtml = inv ? `<div class="pgrid2 qc-head">
          <div class="pcell"><div class="pl">Invoice No</div><div class="pv">${E.canOpen("invoice") ? `<a href="#invoice/${inv.id}"><b>${esc(inv.invoice_no)}</b></a>` : `<b>${esc(inv.invoice_no)}</b>`}</div></div>
          ${E.cell("Invoice Date", mdy(inv.invoice_date))}${E.cell("Terms of Payment", inv.payment_terms || "")}${E.cell("Due Date", mdy(inv.due_date))}${E.cell("Amount (₱)", peso(inv.total_amount), "hl")}${E.cell("Balance (₱)", peso(inv.balance))}
          <div class="pcell co-invstat"><div class="pl">Status</div><div class="pv">${payPill(inv)}</div></div></div>
          <div id="coInvIns"></div>
          ${o._dl?.has_pcs && nBoxes(boxes) ? `<div class="banner ok co-verified">✅ VERIFIED WITH SERIAL NO — the invoice charges the delivery list: ${esc(boxesText(nBoxes(boxes)))} · ${qtyText(o._dl.pcs)} pcs</div>` : ""}` : `<div class="empty small">The invoice is on the customer's account.</div>`;
    const tabs = ["Order Lines", `Boxes (${nBoxes(boxes)})`, "Delivery", ...(o.status === "completed" ? ["Invoice"] : []), "Tracking"];
    void banner; // 3.99.30: the guide says it
    // 3.99.31: no Delivery tab while it would only repeat the guide's Complete Delivery button (or has nothing to show)
    const noDelTab = o.status === "pending" || o.status === "cancelled" || (deliverNow && !o.delivery_request_at && !(o.delivery_photos || []).length);
    // 3.99.233: who delivers it, and the button to choose them, under the guide
    const asgs = o._asg || [], asgOk = o._asg !== null && w && (o.status === "pending" || (o.status === "approved" && !o.delivery_request_at));
    const asgBar = asgs.length || asgOk ? `<div class="trk-asg co-asg">${ic("user")} <b>DELIVERY BY</b> ${asgs.length ? asgs.map((a) => `<span>${esc(a.full_name)}${a.employee_no ? ` · <i class="mono">${esc(a.employee_no)}</i>` : ""}</span>`).join("") : `<em>Not assigned</em>`}
      ${asgOk ? `<button type="button" class="btn small" data-asg>${ic("edit")} ${asgs.length ? "Change" : "Assign"}</button>` : ""}</div>` : "";
    $("#main").innerHTML = `${guide}${asgBar}${head}<div id="coIns"></div><div class="og-old">
      ${isAdmin() && o.status === "approved" && o.delivery_request_at ? `<fieldset class="opt review"><legend>Delivery Approval</legend><p class="muted" style="margin:0 0 8px">${vsText(o.total_boxes, nBoxes(boxes), false)} · ${(o.delivery_photos || []).length} photo(s): see the Boxes and Delivery tabs.</p><div class="btnrow"><button type="button" class="btn ok" id="coDvOk">${ic("check")} Approve Delivery · COMPLETE</button><button type="button" class="btn danger" id="coDvNo">Reject</button></div></fieldset>` : ""}
      ${isAdmin() && o.status === "pending" ? `<fieldset class="opt review"><legend>EMON HASAN's Decision</legend><div class="btnrow"><button type="button" class="btn ok" id="coApprove">${ic("check")} Approve · CONFIRM</button><button type="button" class="btn danger" id="coCancelO">Cancel Order</button></div></fieldset>` : ""}
      </div><div class="due-card co-amt"><div><div class="k">Order Amount</div><div class="v">₱ ${peso(o.total_amount)}</div></div><small>${esc(E.words(o.total_amount))}${o.note ? ` · Note: ${esc(o.note)}` : ""}</small></div>
      <div class="co-trackbar"><button type="button" class="btn ok" id="coTrack">${ic("pin")} Tracking</button></div>
      <div class="actionbar">
        <button type="button" class="btn primary" id="coAll">${ic("download")} Download All Details (PDF)</button>
        ${deliverNow ? deliverBtn() : ""}
        <button type="button" class="btn" id="coPdf">${ic("print")} Print / Download Order</button><button type="button" class="btn" id="coSheet">${ic("print")} Delivery Sheet</button>
        ${canEdit(o) ? `<a class="btn" href="#editcustorder/${o.id}">${ic("edit")} Edit</a>` : ""}
        <span class="grow"></span>
        ${(isAdmin() ? o.status === "approved" : o.status === "pending" && o.created_by === meId()) ? `<button type="button" class="btn danger" id="coCancelO">Cancel Order</button>` : ""}
        ${isAdmin() ? `<button type="button" class="btn danger" id="coDelO">${ic("trash")} Delete</button>` : ""}
      </div>
      <div class="tabs" id="coPfTabs">${tabs.map((x, i) => `<button type="button" class="${i ? "" : "on"}" data-t="${i}"${i === 2 && noDelTab ? " hidden" : ""}>${esc(x)}</button>`).join("")}</div>
      <div class="tabpanes">
        <div data-p="0">${linesHtml}</div>
        <div data-p="1" hidden id="coBoxes">${boxesHtml(o, boxes, sumPcs, w)}</div>
        <div data-p="2" hidden id="coDel">${delHtml}</div>
        ${o.status === "completed" ? `<div data-p="3" hidden>${invHtml}</div>` : ""}
        <div data-p="${tabs.length - 1}" hidden>${stepper}</div>
      </div>`;
    if ($("#coTrack")) $("#coTrack").onclick = () => { const t = $(`#coPfTabs button[data-t="${tabs.length - 1}"]`); t?.click(); t?.scrollIntoView({ behavior: "smooth", block: "start" }); }; // 3.99.195
    $$("#coPfTabs button").forEach((b) => (b.onclick = () => {
      $$("#coPfTabs button").forEach((x) => x.classList.toggle("on", x === b));
      $$(".tabpanes > div").forEach((x) => (x.hidden = x.dataset.p !== b.dataset.t));
    }));
    E.keepTab("#coPfTabs", "order:" + o.id);
    if (deliverNow) E.drawQr($("#coQr"), deliveryUrl(o.order_no, o.delivery_code));
    const reload = () => V.custorder(o.id);
    bindOddPrice(o, reload);
    [["#cbLock", true], ["#cbUnlock", false]].forEach(([sel, lock]) => { if ($(sel)) $(sel).onclick = async (e) => {
      if (!(await E.confirmBox(lock ? `Verify the boxes of <b>${esc(o.order_no)}</b> and lock them?<br><br>After it no box can be added, changed or removed (unlock to fix).` : `Unlock the boxes of <b>${esc(o.order_no)}</b> to fix them?`, { ok: lock ? "Verify & Lock" : "Unlock" }))) return;
      e.target.disabled = true;
      const { error } = await sb.rpc("lock_order_boxes", { p_order: o.id, p_lock: lock });
      if (error) { e.target.disabled = false; return fail(error, /lock_order_boxes/.test(error.message || "") ? "Run the database update RUN_062_TO_067.sql first" : "Could not save"); }
      toast(lock ? `Boxes of ${o.order_no} verified and locked.` : `Boxes of ${o.order_no} unlocked.`); reload();
    }; });
    if ($("#coApprove")) $("#coApprove").onclick = async (e) => {
      if (!(await E.confirmBox(`Approve order <b>${esc(o.order_no)}</b> for <b>${esc(fullName(c))}</b> (₱ ${peso(o.total_amount)}, ${esc(boxesText(o.total_boxes))})? It becomes CONFIRMED and your signature goes on the printed order.`, { ok: "Approve Order" }))) return;
      e.target.disabled = true;
      const { error } = await sb.rpc("decide_customer_order", { p_id: o.id, p_action: "approve", p_note: null });
      if (error) { e.target.disabled = false; return fail(error, "Could not approve"); }
      toast(`Order ${o.order_no} approved: CONFIRMED.`); reload();
    };
    if ($("#coCancelO")) $("#coCancelO").onclick = () => cancelOrder(o, reload);
    // 3.45: a delivery submitted by the order paper (not signed in with EO-Office): the Director approves or rejects it
    const decideDelivery = async (e, action) => {
      const ok = action === "approve"
        ? await E.confirmBox(`${chargeSays(o, boxes)}Approve the delivery of <b>${esc(o.order_no)}</b>?<br><br>The order becomes COMPLETED and the invoice is made and billed to <b>${esc(custName(o))}</b>: <b>₱ ${peso(o._dl?.has_pcs && nBoxes(boxes) ? o._dl.amount : o.total_amount)}</b>.`, { title: "Approve Delivery", ok: "Approve Delivery" })
        : await E.confirmBox(`Reject the delivery submitted for <b>${esc(o.order_no)}</b>? The order stays CONFIRMED and the delivery can be done again.`, { ok: "Reject", danger: true });
      if (!ok) return;
      e.target.disabled = true;
      const { error } = await sb.rpc("decide_delivery", { p_id: o.id, p_action: action });
      if (error) { e.target.disabled = false; return fail(error, "Could not save"); }
      toast(action === "approve" ? `Order ${o.order_no} completed. The invoice was made and billed to ${custName(o)}.` : "Delivery rejected."); reload();
    };
    if ($("#coDvOk")) $("#coDvOk").onclick = (e) => decideDelivery(e, "approve");
    if ($("#coDvNo")) $("#coDvNo").onclick = (e) => decideDelivery(e, "reject");
    if ($("#coDelO")) $("#coDelO").onclick = async () => {
      if (!(await E.confirmBox(`Delete order <b>${esc(o.order_no)}</b> and its ${nBoxes(boxes)} box(es)?${inv ? ` Its invoice <b>${esc(inv.invoice_no)}</b> is deleted too (off the customer's balance).` : ""} This cannot be undone.`, { ok: "Delete", danger: true }))) return;
      const { data: gone, error } = await sb.rpc("delete_customer_order", { p_id: o.id });
      if (error) return fail(error, "Could not delete");
      if (gone?.length) sb.storage.from("records").remove(gone).then(() => {}, () => {});
      toast("Deleted."); location.hash = "custorders";
    };
    $$("[data-trk]").forEach((b) => (b.onclick = async () => { b.disabled = true; if (await trackStep(o, b.dataset.trk)) reload(); else b.disabled = false; })); // 3.88
    $$("[data-asg]").forEach((b) => (b.onclick = () => assignDialog(o, reload))); // 3.99.233
    // 3.98: the next step opens its tab (the boxes, the delivery); View Proof of Delivery shows the photos and the plate no
    $$("[data-trk-go]").forEach((b) => (b.onclick = () => { const t = $(`#coPfTabs [data-t="${b.dataset.trkGo}"]`); if (t) { t.click(); t.scrollIntoView({ block: "center", behavior: "smooth" }); } }));
    $$("[data-pod]").forEach((b) => (b.onclick = () => showPod(o, urls)));
    $$("[data-og]").forEach((b) => (b.onclick = () => $(b.dataset.og)?.click())); // 3.99.30: the guide presses the old button
    $("#coPdf").onclick = async () => { await E.loadSignatures().catch(() => {}); E.openPreview(`Customer Order ${o.order_no}`, orderPages(o, inv), { customerId: o.customer_id }); };
    $("#coSheet").onclick = () => E.openPreview(`Delivery Sheet ${o.order_no}`, sheetPages(o, boxes), { customerId: o.customer_id });
    // 3.38.1: everything in one PDF: the order (with its invoice and delivery), the Delivery Sheet with the boxes, the check photos
    $("#coAll").onclick = async () => { await E.loadSignatures().catch(() => {}); E.openPreview(`Customer Order ${o.order_no} — All Details`, allPages(o, inv, boxes, urls), { customerId: o.customer_id }); };
    bindBoxes(o, boxes, reload);
    if ((o.status === "approved" && w && !deliverNow) || canFixDelivery(o)) bindDelivery(o, boxes, urls, reload);
    E.insOrderStrip?.(o, $("#coIns")); // 3.72: insurance COVERED / EXPIRES, or Add Insurance before delivery
    E.insMini?.($("#coInsMini"), { orderId: o.id, terms: o.payment_terms }); // 3.78.2: the small COVERED badge at the top
    if (E.insForOrder && $("#coInvIns")) E.insForOrder(o.id).then((i) => { if (i && $("#coInvIns")) $("#coInvIns").innerHTML = E.insBox(i); }); // 3.73.4: on the Invoice tab
    $$("[data-ph]").forEach((b) => (b.onclick = () => E.lightbox(b.dataset.ph)));
    E.setRecords(`Customer order: ${o.order_no}`);
  }
  const payPill = (i) => pill(i.pay_status);

  function cancelOrder(o, reload) {
    const m = E.modal(`Cancel ${o.order_no}`, `<p>Cancel this order? Its boxes become free for another order.</p><div class="fields wide"><label for="ccNote">Note</label><input type="text" id="ccNote" maxlength="300" placeholder="Optional: why it is cancelled"></div>`,
      `<button type="button" class="btn" data-x>Back</button><button type="button" class="btn danger" data-ok>Cancel Order</button>`);
    $("[data-x]", m.el).onclick = m.close;
    $("[data-ok]", m.el).onclick = async (e) => {
      e.target.disabled = true;
      const { error } = await sb.rpc("decide_customer_order", { p_id: o.id, p_action: "cancel", p_note: $("#ccNote", m.el).value.trim() || null });
      if (error) { e.target.disabled = false; return fail(error, "Could not cancel"); }
      m.close(); toast(`Order ${o.order_no} cancelled.`); reload();
    };
  }

  // ---------- the boxes (Delivery Sheet) ----------
  // 3.49: the boxes still missing, one row for each CODE + BATCH (lot) of the order's lines, so the warehouse finds them easily.
  // A box added counts for its own code + batch (or the same batch / the same code when the line has only one of them);
  // a row with all its boxes here is not listed. Boxes that match no line are listed as NOT ON THE ORDER.
  function boxCheck(lines, boxes) {
    const up = (v) => String(v || "").trim().toUpperCase();
    const rows = [];
    lines.forEach((l) => {
      const n = num(l.boxes); if (!n) return;
      const code = up(l.code), batch = up(l.lot), name = l.product || "";
      // 3.59: lines with the same code + batch no but another product stay apart (e.g. MIX and TOMMY, both without a code)
      let r = rows.find((x) => x.code === code && x.batch === batch && up(x.name) === up(name));
      if (!r) rows.push(r = { code, batch, name, want: 0, got: 0, qty: 0 });
      r.want += n; r.qty += num(l.qty);
    });
    // how well a box fits a line: the same code + batch no; the batch no or the code (the other one empty); the product.
    // Among equals the line of the same product first - the same rule as the invoice (co_delivered).
    const fit = (x, b) => {
      const code = up(b.code), batch = up(b.batch_no), item = up(b.items), name = up(x.name);
      const same = !!item && item === name, near = !!item && !!name && (item.includes(name) || name.includes(item));
      const rank = x.code === code && x.batch === batch ? 0 : batch && x.batch === batch && (!x.code || !code) ? 1
        : code && x.code === code && (!x.batch || !batch) ? 2 : same ? 3 : near ? 4
        // 3.99.144: the same pcs per box, then the same batch no, then the same code (the same rule as the invoice, 115)
        : num(b.pcs) > 0 && x.want > 0 && x.qty / x.want === num(b.pcs) ? 5 : batch && x.batch === batch ? 6 : code && x.code === code ? 7 : 9;
      return rank * 3 + (same ? 0 : near ? 1 : 2);
    };
    const best = (b, ok) => rows.reduce((p, x) => { if (!ok(x)) return p; const f = fit(x, b); return f < 27 && (!p || f < p.f) ? { x, f } : p; }, null);
    const free = (x) => x.got < x.want;
    const extra = [], left = [];
    let other = 0, over = 0; // boxes of a line with another code / batch no; boxes more than a line ordered (charged at its price)
    // every box to a line that still waits for it, the closest fits first; a box of a full line is MORE than ordered;
    // a box of no line is NOT ORDERED (a wrong box? the Director removes it or adds its price on the order page)
    boxes.filter((b) => b.serial_no).map((b) => ({ b, f: best(b, free)?.f ?? 99 })).sort((p, q) => p.f - q.f).forEach(({ b }) => {
      const m = best(b, free);
      if (m) { m.x.got++; if (m.f >= 9) other++; } else left.push(b);
    });
    left.forEach((b) => {
      const m = best(b, () => true);
      if (m) { m.x.got++; over++; return; }
      const code = up(b.code), batch = up(b.batch_no);
      let e = extra.find((x) => x.code === code && x.batch === batch && x.name === (b.items || "")); if (!e) extra.push(e = { code, batch, name: b.items || "", n: 0, serials: [] }); e.n++; e.serials.push(b.serial_no);
    });
    if (!rows.length && !extra.length) return "";
    const open = rows.filter((r) => r.got < r.want).sort((x, y) => (x.batch + x.code).localeCompare(y.batch + y.code));
    const miss = open.reduce((t, r) => t + r.want - r.got, 0), ext = extra.reduce((t, e) => t + e.n, 0);
    const cell = (v) => (v ? esc(v) : "—");
    // 3.59: each ORDER line still MISSING boxes (what was ordered, how many are here) and each box ADDED that is NOT ORDERED
    const orderRow = (r) => { const ok = r.got >= r.want; return `<tr class="${ok ? "okrow" : "miss"}"><td><span class="bx-tag ord">ORDER</span></td><td class="bx-b">${cell(r.batch)}</td><td class="bx-c">${cell(r.code)}</td>
      <td class="bx-p">${esc(r.name)}</td><td class="bx-n">${qtyText(r.want)}</td><td class="bx-n">${qtyText(r.got)}</td>
      <td><span class="bx-st ${ok ? "ok" : "miss"}">${ok ? `✅${r.got > r.want ? ` +${qtyText(r.got - r.want)}` : ""}` : `❌ MISSING ${qtyText(r.want - r.got)}`}</span></td></tr>`; };
    const addRow = (e) => `<tr class="extra"><td><span class="bx-tag add">ADDED</span></td><td class="bx-b">${cell(e.batch)}</td><td class="bx-c">${cell(e.code)}</td>
      <td class="bx-p">${esc(e.name || "—")}<br><small class="mono">${esc(e.serials.join(", "))}</small></td><td class="bx-n">—</td><td class="bx-n">${qtyText(e.n)}</td>
      <td><span class="bx-st extra">❌ NOT ORDERED</span><br><small>Wrong box? Remove it, or EMON HASAN adds its price.</small></td></tr>`;
    const note = [other ? `${boxesText(other)} with another code / batch no than the order lines` : "", over ? `${boxesText(over)} more than ordered (charged at the line's price)` : ""].filter(Boolean).join(" · ");
    const sum = !miss && !ext ? `<div class="bx-sum ok">✔ Every box of the order is here.${note ? ` <small>(${note})</small>` : ""}</div>`
      : `<div class="bx-sum ${miss ? "miss" : "extra"}">${miss ? `<b>${boxesText(miss)} MISSING</b>` : ""}${miss && ext ? " · " : ""}${ext ? `<b>${boxesText(ext)} NOT ORDERED</b>` : ""}${note ? ` <small>(${note})</small>` : ""}</div>`;
    const body = open.map(orderRow).join("") + extra.map(addRow).join(""); // a line with all its boxes here is not listed (3.49)
    return `<div class="bx-check">${sum}${body ? `<div class="grid-scroll"><table class="bx-table"><thead><tr><th></th><th>BATCH NO</th><th>CODE</th><th>PRODUCT</th><th class="num">ORDER</th><th class="num">HERE</th><th></th></tr></thead><tbody>${body}</tbody></table></div>` : ""}</div>`;
  }
  // 3.59: the same in one line of words - ORDER 41 BOX · SCANNED 41 ✅ (never "41 of 41")
  const vsText = (want, got, done, unit = "BOX") => `ORDER ${qtyText(want)} ${unit} · ${done ? "DELIVERED" : "SCANNED"} ${qtyText(got)} ${num(got) === num(want) ? "✅" : "❌"}`;
  // 3.55: ORDER against DELIVERED (SCANNED while the order is open), boxes and pcs, ✅ when they match, ❌ when not
  const matchMark = (want, got) => (num(got) === num(want) ? `<span class="cm-ok">✅</span>` : `<span class="cm-bad">❌ ${num(got) > num(want) ? "+" : ""}${qtyText(num(got) - num(want))}</span>`);
  // 3.56: the invoice charges the pcs delivered: each box at the price of the order line with its batch no and code
  const amtMark = (want, got) => (Math.abs(num(got) - num(want)) < 0.005 ? `<span class="cm-ok">✅</span>` : `<span class="cm-bad">❌ ${num(got) > num(want) ? "+" : "−"}₱ ${peso(Math.abs(num(got) - num(want)))}</span>`);
  const countMatch = (o, boxes, pcs) => {
    const got = o.status === "completed" ? "DELIVERED" : "SCANNED", dl = o._dl;
    return `<table class="co-match"><thead><tr><th></th><th>ORDER</th><th>${got}</th><th></th></tr></thead><tbody>
      <tr><th>BOX</th><td>${qtyText(o.total_boxes)}</td><td>${nBoxes(boxes)}</td><td>${matchMark(o.total_boxes, nBoxes(boxes))}</td></tr>
      <tr><th>PCS</th><td>${qtyText(o.total_pcs)}</td><td>${qtyText(pcs)}</td><td>${matchMark(o.total_pcs, pcs)}</td></tr>
      ${dl?.has_pcs ? `<tr class="cm-amt"><th>AMOUNT</th><td>₱ ${peso(o.total_amount)}</td><td>₱ ${peso(dl.amount)}</td><td>${amtMark(o.total_amount, dl.amount)}</td></tr>` : ""}</tbody></table>${modifiedNote(o)}${chargeTable(o)}`;
  };
  // 3.74: a completed order is modified as delivered (081): what was first ordered, and the change
  const modifiedNote = (o) => {
    if (o.status !== "completed" || o.ordered_total_amount == null) return "";
    const da = num(o.total_amount) - num(o.ordered_total_amount), dp = num(o.total_pcs) - num(o.ordered_total_pcs ?? o.total_pcs);
    if (Math.abs(da) < 0.005 && !dp) return "";
    const sg = (n) => (n > 0 ? "+" : n < 0 ? "−" : "");
    return `<div class="banner ok co-mod">✏️ <b>ORDER MODIFIED AS DELIVERED</b> — first ordered ${qtyText(o.ordered_total_pcs ?? 0)} pcs · ₱ ${peso(o.ordered_total_amount)} → delivered <b>${qtyText(o.total_pcs)} pcs · ₱ ${peso(o.total_amount)}</b>
      (${dp ? `${sg(dp)}${qtyText(Math.abs(dp))} pcs · ` : ""}${sg(da)}₱ ${peso(Math.abs(da))}). The invoice is charged the same.</div>`;
  };
  const chargeTable = (o) => {
    const dl = o._dl;
    if (!dl?.has_pcs) return "";
    const ls = (dl.lines || []).filter((l) => num(l.ordered) || num(l.delivered)), odd = dl.odd || [];
    const oddHtml = odd.length ? `<div class="co-odd"><div class="cc-h">NOT ORDERED — ${boxesText(odd.reduce((t, g) => t + num(g.boxes), 0))} · ${qtyText(odd.reduce((t, g) => t + num(g.pcs), 0))} pcs not on the order, not charged yet.
        ${isAdmin() ? "Add the price: the items are added to the order and the invoice is charged." : "EMON HASAN adds the price."}</div>
      <div class="grid-scroll"><table class="bx-table cc-table"><thead><tr><th class="num">BOXES</th><th>BATCH NO</th><th>CODE</th><th>ITEMS</th><th class="num">PCS</th>${isAdmin() ? `<th>PRICE (₱)</th><th></th>` : ""}</tr></thead><tbody>
      ${odd.map((g, i) => `<tr data-odd="${i}"><td class="num">${qtyText(g.boxes || g.lines)}</td><td>${esc(g.lot || "—")}</td><td>${esc(g.code || "—")}</td><td>${esc(g.items || "—")}<br><small class="muted">${esc(g.serials || "")}</small></td><td class="num">${qtyText(g.pcs)}</td>
        ${isAdmin() ? `<td><input type="number" class="odd-price" min="0" step="0.01" placeholder="0.00" aria-label="Price"></td><td><button type="button" class="btn small primary odd-add">${ic("check")} Add Price</button></td>` : ""}</tr>`).join("")}</tbody></table></div></div>` : "";
    if (!ls.some((l) => num(l.ordered) !== num(l.delivered)) && !odd.length) return "";
    const done = o.status === "completed", diff = (l) => num(l.delivered) - num(l.ordered);
    const dt = (n) => (n ? `<b class="${n > 0 ? "cm-plus" : "cm-bad"}">${n > 0 ? "+" : ""}${qtyText(n)}</b>` : "✅");
    return `<div class="co-charge"><div class="cc-h">${done ? "CHARGED AS DELIVERED — the invoice" : "WILL BE CHARGED AS SCANNED"}: ₱ ${peso(o.total_amount)} ordered → <b>₱ ${peso(dl.amount)}</b> ${amtMark(o.total_amount, dl.amount)}</div>
      <div class="grid-scroll"><table class="bx-table cc-table"><thead><tr><th>PRODUCT</th><th>BATCH NO</th><th>CODE</th><th class="num">PRICE (₱)</th><th class="num">ORDER PCS</th><th class="num">${done ? "DELIVERED" : "SCANNED"} PCS</th><th class="num">DIFFERENCE</th><th class="num">AMOUNT (₱)</th></tr></thead><tbody>
      ${ls.map((l) => `<tr><td>${esc(l.product || "")}</td><td>${esc(l.lot || "—")}</td><td>${esc(l.code || "—")}</td><td class="num">${peso(l.price)}</td><td class="num">${qtyText(l.ordered)}</td><td class="num">${qtyText(l.delivered)}</td><td class="num">${dt(diff(l))}</td><td class="num">${peso(l.amount)}</td></tr>`).join("")}
      <tr class="cc-tot"><td colspan="4">TOTAL</td><td class="num">${qtyText(o.total_pcs)}</td><td class="num">${qtyText(dl.pcs)}</td><td class="num">${dt(num(dl.pcs) - num(o.total_pcs))}</td><td class="num">${peso(dl.amount)}</td></tr></tbody></table></div>${oddHtml}</div>`;
  };
  // 3.56: the Director adds the price of NOT ORDERED boxes: a line of the order; the invoice follows
  function bindOddPrice(o, reload) {
    $$("#main .odd-add").forEach((b) => (b.onclick = async () => {
      const tr = b.closest("[data-odd]"), g = (o._dl?.odd || [])[Number(tr.dataset.odd)], price = num($(".odd-price", tr).value);
      if (!g) return;
      if (!(price > 0)) return toast("Enter the price.", true);
      if (!(await E.confirmBox(`Add <b>${esc(g.items || "these items")}</b> (${esc(qtyText(g.pcs))} pcs × ₱ ${esc(peso(price))} = <b>₱ ${esc(peso(num(g.pcs) * price))}</b>) to order <b>${esc(o.order_no)}</b>?${o.status === "completed" ? "<br><br>The invoice is charged too." : ""}`, { ok: "Add Price" }))) return;
      b.disabled = true;
      const { error } = await sb.rpc("price_not_ordered", { p_order: o.id, p_code: g.code || "", p_lot: g.lot || "", p_items: g.items || "", p_price: price });
      if (error) { b.disabled = false; return fail(error, /price_not_ordered/.test(error.message || "") ? "Run the database update RUN_062_TO_067.sql first" : "Could not add the price"); }
      toast(`Added to ${o.order_no}: ₱ ${peso(num(g.pcs) * price)}.${o.status === "completed" ? " The invoice was charged." : ""}`);
      reload();
    }));
  }
  // 3.59: the Director verifies the boxes and locks them (no box added, changed or removed) - or unlocks them to fix
  const boxLock = (o, boxes) => o.boxes_verified_at
    ? `<div class="banner ok co-lock">🔒 BOXES VERIFIED &amp; LOCKED by <b>${esc(o.boxes_verified_by_name || "")}</b> · ${esc(E.dateTime(o.boxes_verified_at))}${isAdmin() ? ` <button type="button" class="btn small" id="cbUnlock">Unlock</button>` : ""}</div>`
    : isAdmin() && nBoxes(boxes) ? `<div class="btnrow"><button type="button" class="btn ok" id="cbLock">${ic("check")} Verify &amp; Lock Boxes</button><small class="muted">Locked after</small></div>` : "";
  const chargeSays = (o, boxes) => !nBoxes(boxes)
    ? `<div class="co-warn0">⚠ NO BOX ADDED (0 boxes)<br><small>If you go on, the invoice is the ORDER AMOUNT: ₱ ${peso(o.total_amount)}. Add the boxes first to charge the delivery list.</small></div>`
    : o._dl?.has_pcs ? `<div class="co-ok0">✅ ${esc(boxesText(nBoxes(boxes)))} with serial no: the invoice charges the delivery list — <b>₱ ${peso(o._dl.amount)}</b></div>` : "";
  const boxOpen = (o) => fixable(o) && !o.boxes_verified_at;
  // 3.99.145: ONE clear ORDER CHECK card: boxes, pcs and amount (order → scanned), each line with the pcs to adjust,
  // and the NOT ORDERED boxes (the Director adds their price). Without pcs on the boxes: the old box check.
  function matchView(o, boxes) {
    const dl = o._dl, done = o.status === "completed", got = done ? "DELIVERED" : "SCANNED";
    const ls = (dl.lines || []).filter((l) => num(l.ordered) || num(l.delivered)), odd = dl.odd || [];
    const dPcs = num(dl.pcs) - num(o.total_pcs), dAmt = num(dl.amount) - num(o.total_amount), dBox = nBoxes(boxes) - num(o.total_boxes);
    const sg = (n) => (n > 0 ? "+" : n < 0 ? "−" : "");
    const chip = (n, txt) => (Math.abs(n) < 0.005 ? `<span class="mv-chip ok">✓ MATCH</span>` : `<span class="mv-chip ${n < 0 ? "bad" : "plus"}">${txt}</span>`);
    const tile = (k, a, b, n, txt) => `<div class="mv-tile"><small>${k}</small><div class="mv-ab"><span>${a}</span><i>→</i><b>${b}</b></div>${chip(n, txt)}</div>`;
    const allOk = !odd.length && ls.every((l) => num(l.delivered) === num(l.ordered));
    const st = allOk ? `<span class="mv-st ok">✓ ALL MATCH</span>` : odd.length ? `<span class="mv-st bad">${boxesText(odd.reduce((t, g) => t + num(g.boxes), 0))} NOT ORDERED</span>` : `<span class="mv-st warn">ADJUST PCS</span>`;
    const lineSt = (l) => { const d = num(l.delivered) - num(l.ordered); return !num(l.boxes) && num(l.ordered) ? `<span class="mv-chip bad">MISSING</span>` : d ? `<span class="mv-chip ${d < 0 ? "bad" : "plus"}">${sg(d)}${qtyText(Math.abs(d))} PCS</span>` : `<span class="mv-chip ok">✓</span>`; };
    const nb = (l) => num((o.lines || [])[l.i]?.boxes);
    // 3.99.146: a line corrected from its box (the box is the true record): what was typed before
    const fx = (l) => { const f = (o.lines || [])[l.i]?.fixed; return f ? `<small class="mv-fix">✎ Corrected from the box · was ${esc([f.product, f.lot, f.code ? "CODE " + f.code : ""].filter(Boolean).join(" · "))}</small>` : ""; };
    return `<section class="mv"><div class="mv-head"><b>ORDER CHECK</b><small>Order → ${got.toLowerCase()}</small>${st}</div>
      <div class="mv-tiles">${tile("BOXES", qtyText(o.total_boxes), qtyText(nBoxes(boxes)), dBox, `${sg(dBox)}${qtyText(Math.abs(dBox))}`)}${tile("PCS", qtyText(o.total_pcs), qtyText(dl.pcs), dPcs, `${sg(dPcs)}${qtyText(Math.abs(dPcs))} PCS`)}${tile("AMOUNT", `₱ ${peso(o.total_amount)}`, `₱ ${peso(dl.amount)}`, dAmt, `${sg(dAmt)}₱ ${peso(Math.abs(dAmt))}`)}</div>
      <div class="grid-scroll"><table class="mv-t"><thead><tr><th>PRODUCT</th><th class="num">PRICE</th><th class="num">BOXES</th><th class="num">ORDER PCS</th><th class="num">${got} PCS</th><th>CHECK</th><th class="num">AMOUNT (₱)</th></tr></thead><tbody>
      ${ls.map((l) => `<tr><td><b>${esc(l.product || "")}</b><small>${esc([l.lot, l.code ? "CODE " + l.code : ""].filter(Boolean).join(" · "))}</small>${fx(l)}</td><td class="num">${peso(l.price)}</td><td class="num">${qtyText(l.boxes)} / ${nb(l) ? qtyText(nb(l)) : "—"}</td><td class="num">${qtyText(l.ordered)}</td><td class="num"><b>${qtyText(l.delivered)}</b></td><td>${lineSt(l)}</td><td class="num"><b>${peso(l.amount)}</b></td></tr>`).join("")}</tbody>
      <tfoot><tr><td>TOTAL</td><td></td><td class="num">${qtyText(nBoxes(boxes))} / ${qtyText(o.total_boxes)}</td><td class="num">${qtyText(o.total_pcs)}</td><td class="num">${qtyText(dl.pcs)}</td><td>${dPcs ? `<span class="mv-chip ${dPcs < 0 ? "bad" : "plus"}">${sg(dPcs)}${qtyText(Math.abs(dPcs))} PCS</span>` : ""}</td><td class="num">₱ ${peso(dl.amount)}</td></tr></tfoot></table></div>
      ${odd.length ? `<div class="mv-odd"><div class="mv-odd-h">NOT ORDERED — not charged yet. ${isAdmin() ? "Add the price: it is added to the order and charged." : "EMON HASAN adds the price."}</div>
        ${odd.map((g, i) => `<div class="mv-odd-r" data-odd="${i}"><div><b>${esc(g.items || "—")}</b><small>${esc([g.lot, g.code ? "CODE " + g.code : "", `${qtyText(g.boxes || g.lines)} box`, `${qtyText(g.pcs)} pcs`].filter(Boolean).join(" · "))}</small><small class="mono">${esc(g.serials || "")}</small></div>
          ${isAdmin() ? `<input type="number" class="odd-price" min="0" step="0.01" placeholder="Price ₱" aria-label="Price"><button type="button" class="btn small primary odd-add">${ic("check")} Add Price</button>` : ""}</div>`).join("")}</div>` : ""}
      ${modifiedNote(o)}</section>`;
  }
  function boxesHtml(o, boxes, sumPcs, w) {
    return `${o._dl?.has_pcs ? matchView(o, boxes) : `${countMatch(o, boxes, sumPcs)}${boxCheck(o.lines || [], boxes)}`}${boxLock(o, boxes)}
      ${w && boxOpen(o) ? `<div class="btnrow"><button type="button" class="btn primary" id="cbScan">${ic("scan")} Scan Boxes</button><label class="btn" for="cbPhoto">${ic("image")} Box Label Photo</label><input type="file" id="cbPhoto" accept="image/*" multiple hidden>
        <button type="button" class="btn" id="cbType">📦 Add Box</button></div>
        <div class="box-find"><input type="text" id="cbFind" maxlength="60" placeholder="Serial no, e.g. U20261238" aria-label="Find a box by its serial no" autocomplete="off"><button type="button" class="btn primary" id="cbFindGo">${ic("search")} Find &amp; Add</button></div>
        <div id="cbFound" class="box-found" aria-live="polite">${foundHtml(o.id)}</div>
        <p class="muted" style="margin:0 0 8px">Scan · Type</p>` : ""}
      ${E.grid({ cols: [{ label: "#", get: (b) => boxNo(boxes, b) }, { label: "Serial No", html: serHtml }, { label: "Code", get: (b) => b.code || "" },
        { label: "Batch No", get: (b) => b.batch_no || "" }, { label: "Items", get: (b) => b.items || "" }, { label: "Brand", get: (b) => b.brand || "" }, { label: "CTN", get: (b) => b.ctn || "" },
        { label: "Pcs", num: true, get: (b) => qtyText(b.pcs) }, { label: "Remarks", get: (b) => b.remarks || "" },
        ...(w && boxOpen(o) ? [{ label: "", html: (b) => `<span class="co-bact"><button type="button" class="btn small" data-be="${b.id}" aria-label="Change ${esc(b.serial_no || b.items || "line")}">${ic("edit")}</button><button type="button" class="btn small danger" data-bx="${b.id}" aria-label="Remove ${esc(b.serial_no || b.items || "line")}">×</button></span>` }] : [])],
        rows: boxes, empty: "No boxes yet." })}`;
  }
  // what a box added says: its items, brand and pcs (3.39: filled from the box database when the serial no is there)
  const boxSays = (b) => { const t = [b.items, b.brand, b.pcs ? `${qtyText(b.pcs)} pcs` : ""].filter(Boolean).join(" · "); return t ? `: ${t}` : ""; };
  // 3.41: a box is found in the box database (the Google Sheet) by its serial no before it is added; the last result stays
  // shown under the Find box (the page is drawn again after each box)
  const FOUND = new Map(); // order id → [ok, text]
  const foundHtml = (oid) => { const f = FOUND.get(oid); return f ? `<div class="bf-res ${f[0] ? "ok" : "bad"}">${esc(f[1])}</div>` : ""; };
  const serialOf = (raw) => String(raw || "").trim().toUpperCase().replace(/\s+/g, " ").slice(0, 60);
  async function findBox(ser, rpc) {
    const r = rpc ? await rpc("delivery_find_box", { p_serial: ser }) : await sb.from("box_stock").select("*").eq("serial_no", ser).maybeSingle();
    if (r.error) throw new Error(/delivery_find_box/.test(r.error.message || "") && notSet(r.error) ? "Finding boxes needs the database update 053_box_find.sql." : /box_stock/.test(r.error.message || "") ? "The box database needs the database update RUN_050_BOXES_AND_099.sql." : r.error.message);
    return r.data || null;
  }
  const foundSays = (b) => [b.product, b.brand && b.brand !== "-" ? b.brand : "", b.ctn ? `CTN ${b.ctn}` : "", b.style ? `Code ${b.style}` : "", b.qty ? `${qtyText(b.qty)} pcs` : "", b.batch].filter(Boolean).join(" · ");
  // a serial no (scanned or typed): found in the box database → added with its details; not found → not added
  async function addFound(raw, how, add, rpc, boxes) {
    const ser = serialOf(raw);
    if (!ser) return "✖ No serial no in that code.";
    if (boxes.some((x) => x.serial_no === ser)) return `✔ Box ${ser} is on this order (checked)`;
    let b;
    try { b = await findBox(ser, rpc); } catch (e) { return `✖ ${e.message}`; }
    if (!b) return `✖ Box ${ser} not found · Add Box`;
    const r = await add({ serial_no: ser, code: b.style || "", batch_no: b.batch || "", items: b.product || "", pcs: b.qty || "" }, how);
    const n = (/(ORDER [\d,]+ BOX · (?:SCANNED|DELIVERED) [\d,]+ [✅❌])$/u.exec(r) || [])[1];
    return r.startsWith("✔") && !/checked/.test(r) ? `✔ Found and added: ${ser} · ${foundSays(b)}${n ? ` · ${n}` : ""}` : r;
  }
  // the Find box: Enter or Find & Add; the result stays under it, ready for the next serial no
  function bindFind(pre, oid, run, reload) {
    const input = $(`#${pre}Find`);
    if (!input) return;
    const go = async () => {
      const v = input.value.trim();
      if (!v) return input.focus();
      $(`#${pre}FindGo`).disabled = true;
      const r = await run(v);
      FOUND.set(oid, [r.startsWith("✔"), r.slice(2)]);
      if (r.startsWith("✔")) { await reload(); setTimeout(() => $(`#${pre}Find`)?.focus(), 50); }
      else { $(`#${pre}Found`).innerHTML = foundHtml(oid); $(`#${pre}FindGo`).disabled = false; input.select(); }
    };
    $(`#${pre}FindGo`).onclick = go;
    input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } };
  }
  // A box label read: the serial no (L20260667) and what else the code carries (QTY: 252 PCS, STYLE: 01, ITEMS: …, BATCH …).
  E.readLabel = (text) => readLabel(text); // 3.99.60: the top Scan button reads box stickers too
  function readLabel(text) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    const pick = (re) => (re.exec(t) || [])[1] || "";
    const serial = pick(/\b([A-Z]{1,4}-?\d{6,})\b/i) || (t.length <= 40 ? t : t.split(/[\s|;,]+/)[0]);
    return { serial_no: serial.slice(0, 60).toUpperCase(), pcs: pick(/\b(?:QTY|QUANTITY|PCS)\s*[:=]?\s*(\d{1,6})/i) || pick(/\b(\d{1,6})\s*PCS\b/i),
      code: pick(/\b(?:STYLE|CODE)\s*[:=]?\s*([A-Z0-9-]{1,30})/i), batch_no: pick(/\b(?:BATCH|LOT)\s*(?:NO\.?)?\s*[:=]?\s*([A-Z0-9-]{2,40})/i),
      items: pick(/\bITEMS?\s*[:=]\s*(.{1,120}?)(?=\s+(?:QTY|QUANTITY|STYLE|CODE|CTN|BATCH|LOT)\b|[|;]|$)/i).trim() };
  }
  function bindBoxes(o, boxes, reload) {
    if (!$("#cbScan")) return;
    // what a box takes from the order when its label does not say: the one line of the order, or the box added before
    const fill = (d) => {
      if (!d.serial_no) return d; // 3.46: a line without a serial no keeps only what was typed
      const one = (o.lines || []).length === 1 ? o.lines[0] : null, last = boxes[boxes.length - 1];
      const line = one || (d.code && (o.lines || []).find((l) => l.code === String(d.code).toUpperCase()));
      return { ...d, code: d.code || one?.code || last?.code || "", batch_no: d.batch_no || line?.lot || last?.batch_no || "", items: d.items || line?.product || last?.items || "",
        pcs: d.pcs || line?.pcs || last?.pcs || "" };
    };
    let added = 0;
    const add = async (d, how) => {
      const box = fill(d);
      if (!box.serial_no && how !== "typed") return "✖ No serial no in that code.";
      const { data, error } = await sb.rpc("add_order_box", { p_order: o.id, p_data: { ...box, added_how: how } });
      if (error) return /on this order already/i.test(error.message || "") ? `✔ Box ${box.serial_no} is on this order (checked)` : `✖ ${error.message}`;
      boxes.push(data); added++;
      if (!data.serial_no) return `✔ Added${boxSays(data)} — no serial no: not counted as a box`;
      return `✔ Box ${data.serial_no} added${boxSays(data)} · ${vsText(o.total_boxes, nBoxes(boxes), o.status === "completed")}`;
    };
    const found = (raw, how) => addFound(raw, how, add, null, boxes);
    bindFind("cb", o.id, (v) => found(v, "typed"), reload);
    $("#cbScan").onclick = () => E.scanDialog((text) => found(readLabel(text).serial_no, "scan"), {
      title: `Scan Boxes — ${o.order_no}`, hint: "Scan each box", keep: true,
      onClose: () => { if (added) { toast(`${added} box(es) added.`); reload(); } } });
    $("#cbPhoto").onchange = async (e) => {
      const files = Array.from(e.target.files); e.target.value = "";
      if (!files.length) return;
      const notes = [];
      for (const f of files) {
        try { notes.push(await found(readLabel(await E.decodeImageFile(f)).serial_no, "photo")); }
        catch (err) { notes.push(`✖ ${f.name}: ${err.message}`); }
      }
      const bad = notes.filter((n) => n.startsWith("✖"));
      if (bad.length) toast(bad.map((n) => n.slice(2)).join(" "), true); else toast(`${added} box(es) added.`);
      if (added) reload();
    };
    $("#cbType").onclick = () => boxForm(o, null, async (d) => { const r = await add(d, "typed"); if (r.startsWith("✖")) { toast(r.slice(2), true); return false; } toast(r.slice(2)); reload(); return true; });
    $$("[data-be]").forEach((b) => (b.onclick = () => {
      const x = boxes.find((y) => y.id === b.dataset.be);
      boxForm(o, x, async (d) => {
        const { error } = await sb.rpc("change_order_box", { p_box: x.id, p_data: d });
        if (error) { fail(error, "Could not save the box"); return false; }
        toast("Saved."); reload(); return true;
      });
    }));
    $$("[data-bx]").forEach((b) => (b.onclick = async () => {
      const x = boxes.find((y) => y.id === b.dataset.bx);
      if (!(await E.confirmBox(`Remove ${boxName(x)} from this order?`, { ok: "Remove", danger: true }))) return;
      b.disabled = true;
      const { error } = await sb.rpc("change_order_box", { p_box: x.id, p_data: null });
      if (error) { b.disabled = false; return fail(error, "Could not remove the box"); }
      toast("Box removed."); reload();
    }));
  }
  // Type a box (x null) or change one; save(d) gives true when it is saved.
  function boxForm(o, x, save) {
    const codes = [...new Set((o.lines || []).map((l) => l.code).filter(Boolean))];
    const m = E.modal(x ? (x.serial_no ? `Box ${x.serial_no}` : "Line without serial no") : "📦 Add Box", `<div class="fields wide">
        <label for="bfSer">Serial No</label><input type="text" id="bfSer" maxlength="60" value="${esc(x?.serial_no || "")}" ${x ? "readonly" : ""} placeholder="e.g. L20260667 · empty: not counted as a box">
        <label for="bfCode">Code</label><input type="text" id="bfCode" maxlength="30" list="bfCodes" value="${esc(x?.code || (codes.length === 1 ? codes[0] : ""))}"><datalist id="bfCodes">${codes.map((k) => `<option value="${esc(k)}">`).join("")}</datalist>
        <label for="bfBatch">Batch No</label><input type="text" id="bfBatch" maxlength="40" value="${esc(x?.batch_no || "")}">
        <label for="bfItems">Items</label><input type="text" id="bfItems" maxlength="120" value="${esc(x?.items || "")}">
        <label for="bfPcs">Pcs</label><input type="number" id="bfPcs" min="0" step="1" inputmode="numeric" value="${x ? num(x.pcs) : ""}">
        <label for="bfRem">Remarks</label><input type="text" id="bfRem" maxlength="120" value="${esc(x?.remarks || "")}"></div>
        <p class="muted" id="bfFrom" style="margin:8px 0 0" hidden></p>`,
      `<button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" data-ok>${x ? "Save" : "Add Box"}</button>`);
    if (!x) {
      // a box typed from the line of its code: the batch no, items and pcs of that line
      $("#bfCode", m.el).onchange = () => { const l = (o.lines || []).find((y) => y.code === $("#bfCode", m.el).value.trim().toUpperCase()); if (!l) return;
        if (!$("#bfBatch", m.el).value) $("#bfBatch", m.el).value = l.lot || ""; if (!$("#bfItems", m.el).value) $("#bfItems", m.el).value = l.product || ""; if (!$("#bfPcs", m.el).value && l.pcs) $("#bfPcs", m.el).value = l.pcs; };
      $("#bfCode", m.el).onchange();
      // 3.39: a serial no in the box database (the Google Sheet) fills the box
      if (S.session) $("#bfSer", m.el).onchange = async () => {
        const ser = $("#bfSer", m.el).value.trim().toUpperCase().replace(/\s+/g, " ");
        if (!ser) return;
        const { data: b } = await sb.from("box_stock").select("*").eq("serial_no", ser).maybeSingle().then((r) => r, () => ({ data: null }));
        if (!b || !m.el.isConnected) return;
        if (b.style) $("#bfCode", m.el).value = b.style;
        if (b.batch) $("#bfBatch", m.el).value = b.batch;
        if (b.product) $("#bfItems", m.el).value = b.product;
        if (b.qty) $("#bfPcs", m.el).value = b.qty;
        $("#bfFrom", m.el).hidden = false;
        $("#bfFrom", m.el).textContent = `From the box database: ${[b.product, b.brand && b.brand !== "-" ? b.brand : "", b.ctn ? "CTN " + b.ctn : "", b.batch].filter(Boolean).join(" · ")}`;
      };
    }
    $("[data-x]", m.el).onclick = m.close;
    $("[data-ok]", m.el).onclick = async (e) => {
      const d = { serial_no: $("#bfSer", m.el).value.trim(), code: $("#bfCode", m.el).value.trim(), batch_no: $("#bfBatch", m.el).value.trim(), items: $("#bfItems", m.el).value.trim(),
        pcs: $("#bfPcs", m.el).value, remarks: $("#bfRem", m.el).value.trim() };
      if (!d.serial_no && !d.items && !num(d.pcs)) return toast("Write the serial no, or the items and pcs.", true);
      e.target.disabled = true;
      if (await save(d)) m.close(); else e.target.disabled = false;
    };
    $(x ? "#bfPcs" : "#bfSer", m.el).focus();
  }

  // ---------- delivery: the photos, COMPLETE (3.45: no rider or car details) ----------
  function deliveryHtml(o, urls, w) {
    const pics = (o.delivery_photos || []).map((p) => ({ p, u: urls.get(p) || "" }));
    const edit = o.status === "approved" && w, fix = canFixDelivery(o);
    const photos = `<div class="po-photos co-photos">${pics.map((x, i) => `<div class="po-pic"><button type="button" class="co-ph" data-ph="${esc(x.u)}" aria-label="Open delivery photo ${i + 1}"><img src="${esc(x.u)}" alt="Delivery photo"></button>${edit || fix ? `<button type="button" data-rmph="${esc(x.p)}" aria-label="Remove photo">×</button>` : ""}</div>`).join("")}</div>`;
    // 3.68: a completed delivery is changed only by EMON HASAN and the employee who completed it
    if (!edit) return `<div class="pgrid2 qc-head">${E.cell("Delivered", o.delivered_at ? E.dateTime(o.delivered_at) : "")}${E.cell(o.status === "completed" ? "Completed By" : "Submitted By", o.completed_by_name || o.delivery_request_by || "")}
        ${E.cell("License Plate Number", o.plate_no || "")}${E.cell("Type of Car", o.vehicle_type || "")}${o.delivery_note ? E.cell("Note", o.delivery_note) : ""}${o.delivery_edited_at ? E.cell("Last Edited", `${E.dateTime(o.delivery_edited_at)} · ${o.delivery_edited_by_name || ""}`) : ""}</div>${pics.length ? photos : ""}
      ${fix ? `<div class="btnrow"><button type="button" class="btn" id="dvFix">${ic("edit")} Edit Delivery</button><label class="btn" for="dvPic" ${pics.length >= MAX_PHOTOS ? "hidden" : ""}>${ic("camera")} Add Photo</label><input type="file" id="dvPic" accept="image/*" multiple hidden></div>
` : ""}`;
    return `${plateField("dv", o.plate_no, o.vehicle_type)}<h4 class="co-h4">Proof of Delivery Photo (optional, up to ${MAX_PHOTOS})</h4>${photos}
      <div class="btnrow"><label class="btn" for="dvPic" id="dvPicL" ${pics.length >= MAX_PHOTOS ? "hidden" : ""}>${ic("camera")} Add Photo</label><input type="file" id="dvPic" accept="image/*" multiple hidden></div>
      <div class="co-done"><button type="button" class="btn ok big" id="dvDone">${ic("check")} Complete Delivery</button>
        <small>Plate no · photo optional · invoice ₱ ${peso(o.total_amount)}</small></div>`;
  }
  const canFixDelivery = (o) => o.status === "completed" && (isAdmin() || (!!o.completed_by && o.completed_by === meId()));
  function bindDelivery(o, boxes, urls, reload) {
    const setPhotos = async (list) => {
      const { data: gone, error } = await sb.rpc("set_order_photos", { p_id: o.id, p_photos: list });
      if (error) { fail(error, "Could not save the photos"); return false; }
      if (gone?.length) sb.storage.from("records").remove(gone).then(() => {}, () => {});
      return true;
    };
    $("#dvPic").onchange = async (e) => {
      const files = Array.from(e.target.files); e.target.value = "";
      if (!files.length) return;
      const room = MAX_PHOTOS - (o.delivery_photos || []).length;
      if (files.length > room) toast(`Up to ${MAX_PHOTOS} photos: only ${room} more can be added.`, true);
      toast("Uploading the photo…");
      const paths = [];
      for (const raw of files.slice(0, room)) {
        const f = await E.slimFile(raw, "photo");
        const path = `corder/${o.id}/delivery_${Date.now()}_${rand()}.${E.extOf(f)}`;
        const up = await sb.storage.from("records").upload(path, f, { contentType: f.type || "image/jpeg" });
        if (up.error) { toast("A photo could not be uploaded: " + up.error.message, true); continue; }
        paths.push(path);
      }
      if (paths.length && !(await setPhotos([...(o.delivery_photos || []), ...paths]))) sb.storage.from("records").remove(paths).then(() => {}, () => {});
      reload();
    };
    $$("[data-rmph]").forEach((b) => (b.onclick = async () => {
      if (!(await E.confirmBox("Remove this photo?", { ok: "Remove", danger: true }))) return;
      if (await setPhotos((o.delivery_photos || []).filter((p) => p !== b.dataset.rmph))) reload();
    }));
    if ($("#dvFix")) $("#dvFix").onclick = () => fixDelivery(o, reload);
    if ($("#dvPlateSave")) $("#dvPlateSave").onclick = (e) => savePlate(e, "dv", (plate, type) => sb.rpc("set_order_car", { p_id: o.id, p_plate: plate, p_type: type }), (plate) => sb.rpc("set_order_plate", { p_id: o.id, p_plate: plate }), reload);
    if ($("#dvDone")) $("#dvDone").onclick = async (e) => {
      const short = nBoxes(boxes) !== num(o.total_boxes);
      const msg = `${chargeSays(o, boxes)}Complete the delivery of <b>${esc(o.order_no)}</b>?<br><br>The invoice is made and billed to <b>${esc(custName(o))}</b> by itself${o._dl?.has_pcs && nBoxes(boxes) ? "" : `: <b>₱ ${peso(o.total_amount)}</b>, ${esc(boxesText(o.total_boxes))}, ${qtyText(o.total_pcs)} pcs`}${o.payment_terms ? `, ${esc(o.payment_terms)}` : ""}.`
        + (short ? `<br><br><b>Note:</b> ${nBoxes(boxes)} box(es) were scanned, the order has ${qtyText(o.total_boxes)}.` : "") + "<br><br>This cannot be undone.";
      if (!(await E.confirmBox(msg, { title: "Complete Delivery", ok: "Complete Delivery" }))) return;
      e.target.disabled = true;
      if (!(await carFirst("dv", o.plate_no, o.vehicle_type, (plate, type) => sb.rpc("set_order_car", { p_id: o.id, p_plate: plate, p_type: type }), (plate) => sb.rpc("set_order_plate", { p_id: o.id, p_plate: plate })))) { e.target.disabled = false; return; }
      const { error } = await sb.rpc("complete_customer_order", { p_id: o.id });
      if (error) { e.target.disabled = false; return fail(error, "Could not complete the order"); }
      toast(`Order ${o.order_no} completed. The invoice was made and billed to ${custName(o)}.`); reload();
    };
  }

  function fixDelivery(o, reload) {
    const local = (iso) => { if (!iso) return ""; const d = new Date(new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Manila" })); const z = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };
    const m = E.modal(`Edit Delivery — ${o.order_no}`, `<div class="fields wide">
        <label for="fdAt">Date and Time of Delivery</label><input type="datetime-local" id="fdAt" value="${esc(local(o.delivered_at))}">
        <label for="fdPlate">Car Plate No</label><input type="text" id="fdPlate" maxlength="30" autocapitalize="characters" autocomplete="off" value="${esc(o.plate_no || "")}">
        <label for="fdType">Type of Car</label><input type="text" id="fdType" maxlength="40" autocapitalize="characters" autocomplete="off" list="carTypes" placeholder="e.g. VAN, TRUCK, MOTORCYCLE" value="${esc(o.vehicle_type || "")}">${CAR_LIST}
        <label for="fdNote">Note</label><textarea id="fdNote" rows="2" maxlength="300">${esc(o.delivery_note || "")}</textarea></div>
      <p class="muted">The change is saved with your name and the time.</p>`,
      `<button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" data-ok>${ic("check")} Save</button>`);
    $("[data-x]", m.el).onclick = m.close;
    $("[data-ok]", m.el).onclick = async (e) => {
      const at = $("#fdAt", m.el).value, plate = $("#fdPlate", m.el).value.trim(), btn = e.currentTarget;
      btn.disabled = true;
      const type = $("#fdType", m.el).value.trim();
      if (plate.toUpperCase() !== String(o.plate_no || "") || type.toUpperCase() !== String(o.vehicle_type || "")) {
        const r = await sb.rpc("set_order_car", { p_id: o.id, p_plate: plate, p_type: type });
        if (r.error) { btn.disabled = false; return fail(r.error, noPlate(r.error) ? "Run the database update 097_order_car_type.sql first" : "Could not save the car"); }
      }
      const { error } = await sb.rpc("edit_order_delivery", { p_id: o.id, p_data: { delivered_at: at ? at + ":00+08:00" : "", delivery_note: $("#fdNote", m.el).value.trim() } });
      if (error) { btn.disabled = false; return fail(error, "Could not save the delivery"); }
      m.close(); toast(`Delivery of ${o.order_no} saved.`); reload();
    };
  }

  // ======================================================================
  // Prints: the CUSTOMER ORDER (with the invoice and the delivery when completed) and the DELIVERY SHEET
  // ======================================================================
  // 3.39: the barcode carries the paper's secret code, and the QR code opens its Complete Delivery page (any phone camera)
  const codesHtml = (o, extra = "") => {
    const bar = `<img src="${E.pdf417DataUrl("EMONCO|" + o.order_no + (o.delivery_code ? "|" + o.delivery_code : ""))}" alt="" class="ph-bar"><div class="mono">${esc(o.order_no)}</div>${extra}`;
    return bar;
  };
  // 3.99.28: the QR code (it opens the paper's Complete Delivery page) is at the bottom left, not in the header
  const qrFoot = (o) => (o.delivery_code ? `<div class="doc-qr"><img src="${E.qrDataUrl(deliveryUrl(o.order_no, o.delivery_code))}" alt="QR code: verification"></div>` : "<div></div>");
  const asgCell = (o) => ((o._asg || []).length ? E.cell("Delivery By", o._asg.map((a) => `${a.full_name}${a.employee_no ? ` (${a.employee_no})` : ""}`).join(", "), "span2") : ""); // 3.99.233
  function orderPages(o, inv) {
    const c = o.customers || {}, cols = o.extra_columns || [];
    const sign = o.approved_by ? E.approvedBy(o.approved_by, o.approved_by_name, o.approved_at) : null;
    const done = o.status === "completed";
    const bottom = `<p class="pdecl">${esc(E.words(o.total_amount))} · ${esc(boxesText(o.total_boxes))} · ${qtyText(o.total_pcs)} PCS</p>
      ${done && inv ? E.box("Invoice", `<div class="pgrid2">${E.cell("Invoice No", inv.invoice_no)}${E.cell("Invoice Date", mdy(inv.invoice_date))}${E.cell("Terms of Payment", inv.payment_terms || "")}${E.cell("Due Date", mdy(inv.due_date))}
        ${E.cell("Amount (₱)", peso(inv.total_amount), "hl")}${E.cell("Status", inv.pay_status === "paid" ? "PAID" : inv.pay_status === "partial" ? "PARTIAL" : "UNPAID")}</div>`) : ""}
      ${o.status === "cancelled" ? `<p class="po-warn"><b>CANCELLED</b>${o.cancel_note ? ` — ${esc(o.cancel_note)}` : ""}</p>` : ""}
      <div class="psig one">${qrFoot(o)}${E.sigCol("Authorized Signature", sign)}</div>`; // 3.39: only EMON HASAN's approval signature
    const extraBoxes = done && inv ? 1 : 0;
    return E.pagedDoc({
      head: E.printHead("CUSTOMER ORDER", codesHtml(o, `<div class="co-bigbox">${esc(boxesText(o.total_boxes))}</div>`)), contHead: E.printHead("CUSTOMER ORDER", ""),
      // 3.39: no address on the order (the customer's account says where it goes)
      top: stLine(o) + E.box("Order", `<div class="pgrid2">${E.cell("Customer", fullName(c))}${E.cell("Account No", c.account_no || "")}${E.cell("Order No", o.order_no)}${E.cell("Batch No", o.reference || "")}
        ${E.cell("Date", mdy(o.order_date))}${E.cell("Due Date", mdy(dueOf(o)))}${E.cell("Terms of Payment", o.payment_terms || "")}${E.cell("Note", o.note || "")}${asgCell(o)}</div>`),
      boxTitle: "Order Lines (₱)", thead: `<tr><th class="num">Boxes</th><th class="num">Pcs</th><th>Code</th><th>Lot No.</th><th>Product</th>${cols.map((x) => `<th>${esc(x)}</th>`).join("")}<th class="num">Price</th><th class="num">Amount</th></tr>`,
      rows: o.lines || [], rowHtml: (l) => `<tr><td class="num">${l.boxes ? qtyText(l.boxes) : ""}</td><td class="num">${qtyText(l.qty)}</td><td>${esc(l.code || "")}</td><td>${esc(l.lot || "")}</td><td>${esc(l.product)}</td>
        ${cols.map((x) => `<td>${esc(l.extra?.[x] || "")}</td>`).join("")}<td class="num">${peso(l.price)}</td><td class="num">${peso(l.amount)}</td></tr>`,
      totalRow: `<tr class="ptl-tot"><td class="num">${qtyText(o.total_boxes)}</td><td class="num">${qtyText(o.total_pcs)}</td><td colspan="${3 + cols.length}">TOTAL · ${esc(boxesText(o.total_boxes))} · ${qtyText(o.total_pcs)} PCS</td><td></td><td class="num">${peso(o.total_amount)}</td></tr>`,
      bottom, caps: { single: extraBoxes ? 16 : 20, first: 24, next: 30, last: extraBoxes ? 19 : 23 } }); // 3.88.1: one page for up to 16 lines (with the invoice)
  }
  E._docs = { ...(E._docs || {}), orderPages }; // 3.79: for the print checks

  function sheetPages(o, boxes) {
    const c = o.customers || {}, pcs = boxes.reduce((s, b) => s + num(b.pcs), 0);
    const rows = boxes.length >= 24 ? boxes : [...boxes, ...Array(24 - boxes.length).fill(null)]; // empty lines to write by hand, like the paper sheet
    const line = (k, v) => `<div class="cs-f"><small>${esc(k)}</small><b>${v ? esc(v) : "&nbsp;"}</b></div>`;
    return E.pagedDoc({
      head: E.printHead("DELIVERY SHEET", codesHtml(o)), contHead: E.printHead("DELIVERY SHEET", ""),
      top: E.box("Customer", `<div class="pgrid2">${E.cell("Customer", fullName(c))}${E.cell("Account No", c.account_no || "")}${E.cell("Order No", o.order_no)}${E.cell("Batch No", o.reference || "")}${asgCell(o)}</div>`),
      boxTitle: "Boxes", thead: `<tr><th>#</th><th>Serial No.</th><th>Code</th><th>Batch No.</th><th>Items</th><th>Brand</th><th>CTN</th><th class="num">Pcs</th><th>Remarks</th></tr>`,
      rows, rowHtml: (b, i) => b ? `<tr><td>${i + 1}</td><td class="mono">${b.serial_no ? esc(b.serial_no) : "-"}</td><td>${esc(b.code || "")}</td><td>${esc(b.batch_no || "")}</td><td>${esc(b.items || "")}</td><td>${esc(b.brand || "")}</td><td>${esc(b.ctn || "")}</td><td class="num">${qtyText(b.pcs)}</td><td>${esc(b.remarks || "")}</td></tr>`
        : `<tr class="cs-empty"><td>${i + 1}</td>${"<td></td>".repeat(8)}</tr>`,
      // 3.39: no boxes scanned yet: the total is written by hand with the lines; one TOTAL BOXES below (the order's)
      totalRow: boxes.length ? `<tr class="ptl-tot"><td colspan="7">TOTAL · ${esc(boxesText(nBoxes(boxes)))}</td><td class="num">${qtyText(pcs)}</td><td></td></tr>` : `<tr class="ptl-tot"><td colspan="7">TOTAL</td><td></td><td></td></tr>`,
      bottom: `<div class="doc-qr-row">${qrFoot(o)}<div class="cs-foot">${line("Assign By", o.created_by_name || "")}${line("Total Boxes", qtyText(o.total_boxes))}${line("Notes", o.delivery_note || o.note || "")}${line("Date", o.delivered_at ? mdy(o.delivered_at) : "")}${line("Time", o.delivered_at ? new Date(o.delivered_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "")}
        ${line("Order No", o.order_no)}<div class="cs-f cs-w2"><small>Verified By</small><b>&nbsp;</b></div></div></div>`,
      caps: { single: 24, first: 28, next: 34, last: 22 } });
  }

  // 3.41: the order's status, under the title of a print
  const ST_PRINT = { pending: "CREATE ORDER (WAITING FOR APPROVAL)", approved: "CONFIRMED", completed: "COMPLETED", cancelled: "CANCELLED" };
  const stLine = (o) => `<p class="co-stline">STATUS: <b>${esc(ST_PRINT[o.status] || String(o.status || "").toUpperCase())}</b></p>`;
  // 3.41 Download All Details: everything of the order in one PDF, on as few pages as it takes (1 page for a small order):
  // the order and its lines, every box (no empty lines), the invoice, the delivery, the photos and the approval signature
  function allPages(o, inv, boxes, urls) {
    const c = o.customers || {}, cols = o.extra_columns || [], done = o.status === "completed";
    const sign = o.approved_by ? E.approvedBy(o.approved_by, o.approved_by_name, o.approved_at) : null;
    const pics = (o.delivery_photos || []).map((x) => urls.get(x)).filter(Boolean);
    const lines = o.lines || [];
    const top = `${stLine(o)}${E.box("Order", `<div class="pgrid2">${E.cell("Customer", fullName(c))}${E.cell("Account No", c.account_no || "")}${E.cell("Order No", o.order_no)}${E.cell("Batch No", o.reference || "")}
        ${E.cell("Date", mdy(o.order_date))}${E.cell("Due Date", mdy(dueOf(o)))}${E.cell("Terms of Payment", o.payment_terms || "")}${E.cell("Note", o.note || "")}</div>`)}
      ${E.box("Order Lines (₱)", `<table class="ptl ad-t"><thead><tr><th class="num">Boxes</th><th class="num">Pcs</th><th>Code</th><th>Lot No.</th><th>Product</th>${cols.map((x) => `<th>${esc(x)}</th>`).join("")}<th class="num">Price</th><th class="num">Amount</th></tr></thead><tbody>
        ${lines.map((l) => `<tr><td class="num">${l.boxes ? qtyText(l.boxes) : ""}</td><td class="num">${qtyText(l.qty)}</td><td>${esc(l.code || "")}</td><td>${esc(l.lot || "")}</td><td>${esc(l.product)}</td>${cols.map((x) => `<td>${esc(l.extra?.[x] || "")}</td>`).join("")}<td class="num">${peso(l.price)}</td><td class="num">${peso(l.amount)}</td></tr>`).join("")}
        <tr class="ptl-tot"><td class="num">${qtyText(o.total_boxes)}</td><td class="num">${qtyText(o.total_pcs)}</td><td colspan="${4 + cols.length}">TOTAL · ${esc(E.words(o.total_amount))}</td><td class="num">${peso(o.total_amount)}</td></tr></tbody></table>`)}`;
    const bottom = `${done && inv ? E.box("Invoice", `<div class="prow3">${E.cell("Invoice No", inv.invoice_no)}${E.cell("Invoice Date", mdy(inv.invoice_date))}${E.cell("Due Date", mdy(inv.due_date))}</div>
        <div class="prow3">${E.cell("Amount (₱)", peso(inv.total_amount))}${E.cell("Terms of Payment", inv.payment_terms || "")}${E.cell("Status", inv.pay_status === "paid" ? "PAID" : inv.pay_status === "partial" ? "PARTIAL" : "UNPAID")}</div>`) : ""}
      ${o.delivered_at ? E.box(done ? "Done Delivery" : "Delivery", `<div class="prow3">${E.cell("Date and Time", E.dateTime(o.delivered_at))}${E.cell(done ? "Completed By" : "Submitted By", o.completed_by_name || o.delivery_request_by || "")}${E.cell("License Plate Number", [o.plate_no, o.vehicle_type].filter(Boolean).join(" · "))}</div>${o.delivery_note ? E.cell("Note", o.delivery_note) : ""}`) : ""}
      ${pics.length ? E.box("Delivery Photos", `<div class="ad-pics">${pics.map((u) => `<img src="${esc(u)}" alt="Delivery photo">`).join("")}</div>`) : ""}
      ${o.status === "cancelled" ? `<p class="po-warn"><b>CANCELLED</b>${o.cancel_note ? ` — ${esc(o.cancel_note)}` : ""}</p>` : ""}
      <div class="psig one">${qrFoot(o)}${E.sigCol("Authorized Signature", sign)}</div>`;
    // how many box lines go on a page: what the order, its lines and the end take is left out
    const used = 9 + lines.length + (done && inv ? 4 : 0) + (o.delivered_at ? 3 : 0) + (pics.length ? 7 : 0);
    const rows = boxes.length ? boxes : [null];
    return E.pagedDoc({
      head: E.printHead("CUSTOMER ORDER — ALL DETAILS", codesHtml(o, `<div class="co-bigbox">${esc(boxesText(o.total_boxes))}</div>`)), contHead: E.printHead("CUSTOMER ORDER — ALL DETAILS", ""),
      top, boxTitle: `Boxes (${vsText(o.total_boxes, nBoxes(boxes), o.status === "completed")})`,
      thead: `<tr><th>#</th><th>Serial No.</th><th>Code</th><th>Batch No.</th><th>Items</th><th>Brand</th><th>CTN</th><th class="num">Pcs</th></tr>`,
      rows, rowHtml: (b, i) => b ? `<tr class="ad-r"><td>${i + 1}</td><td class="mono">${b.serial_no ? esc(b.serial_no) : "-"}</td><td>${esc(b.code || "")}</td><td>${esc(b.batch_no || "")}</td><td>${esc(b.items || "")}</td><td>${esc(b.brand || "")}</td><td>${esc(b.ctn || "")}</td><td class="num">${qtyText(b.pcs)}</td></tr>`
        : `<tr class="ad-r"><td colspan="8">No boxes yet.</td></tr>`,
      totalRow: boxes.length ? `<tr class="ptl-tot"><td colspan="7">TOTAL · ${esc(boxesText(nBoxes(boxes)))}</td><td class="num">${qtyText(boxes.reduce((t, b) => t + num(b.pcs), 0))}</td></tr>` : "",
      bottom, caps: { single: Math.max(4, 40 - used), first: Math.max(8, 46 - 9 - lines.length), next: 52, last: Math.max(6, 50 - used + 9 + lines.length) } });
  }

  // ======================================================================
  // 3.39 COMPLETE DELIVERY by the order paper: #delivery/<order no>/<secret code> (the barcode or the QR code of the printed
  // order). Whoever holds the paper — signed in or not — does the delivery in 3 steps: 1 the boxes (scanned one after another,
  // read from a label photo, or typed), 2 the photos of the delivery, 3 COMPLETE DELIVERY (the invoice is made by itself).
  // 3.45: no rider or car details; not signed in with EO-Office, COMPLETE DELIVERY is SUBMITTED and the Director approves it. No prices.
  // ======================================================================
  // what a scanned order paper opens: its barcode (EMONCO|OR-…|code) or its QR code (…#delivery/OR-…/code); "" for anything else
  const deliveryHashOf = (text) => {
    const t = String(text || "").trim();
    const u = /#(delivery\/[^/\s]+\/[0-9a-f]{6,40})\b/i.exec(t);
    if (u) return u[1];
    const m = /^EMONCO\|((?:CO|OR|PO)-\d{6}-\d+)\|([0-9a-f]{6,40})$/i.exec(t);
    return m ? deliveryHash(m[1].toUpperCase(), m[2].toLowerCase()) : "";
  };
  V.delivery = async (no, code) => {
    const inside = !!(S.session && S.profile?.status === "active");
    const body = `<div id="pdBody">${busy("Opening the order")}</div>`;
    if (inside) E.shell("delivery", "Complete Delivery", body); else E.miniShell("Complete Delivery", body, { home: "#verify" });
    const here = E.stillHere();
    const args = { p_no: String(no || "").toUpperCase(), p_code: String(code || "").toLowerCase() };
    const { data: d, error } = await sb.rpc("delivery_order", args);
    if (!here() || !$("#pdBody")) return;
    if (error) { $("#pdBody").innerHTML = `<div class="empty">${notSet(error) ? "The Complete Delivery page needs the database update <b>048_delivery_paper.sql</b>." : esc(error.message)}</div>`; return; }
    const photos = d.delivery_photos || [];
    const urls = photos.length && d.status === "approved" ? await E.signedMap(photos).catch(() => new Map()) : new Map();
    if (!here() || !$("#pdBody")) return;
    paintDelivery(d, args, urls, inside);
  };
  function paintDelivery(d, args, urls, inside) {
    const boxes = d.boxes || [], photos = d.delivery_photos || [], lines = d.lines || [], pcs = boxes.reduce((s, b) => s + num(b.pcs), 0);
    const reload = () => V.delivery(args.p_no, args.p_code);
    const rpc = (fn, extra = {}) => sb.rpc(fn, { ...args, ...extra });
    const orderLink = inside && E.canOpen("custorder") ? `<a class="btn" href="#custorder/${d.id}">${ic("doc")} Open the Order</a>` : "";
    const head = `<section class="cust-hero co-hero pd-head">
      <div class="ch-pic"><div class="ch-photo co-ic">${ic("box")}</div></div>
      <div class="ch-main"><div class="ch-name"><h2>${esc(d.order_no)}</h2>${stPill(d)}</div>
        <div class="ch-sub"><b>${esc(d.customer)}</b>${d.account_no ? ` · <span class="mono">${esc(d.account_no)}</span>` : ""}</div>
        <div class="ch-ids">${E.idBox("Batch No", d.reference || "")}${E.idBox("Boxes", vsText(d.total_boxes, nBoxes(boxes), d.status === "completed"))}${E.idBox("Pcs", vsText(d.total_pcs, pcs, d.status === "completed", "PCS"))}</div></div>
    </section>`;
    if (d.status !== "approved") { // completed, waiting or cancelled: what was done; nothing to change
      $("#pdBody").innerHTML = `${head}<div class="banner ${d.status === "completed" ? "ok" : d.status === "cancelled" ? "closed" : "warn"}">${d.status === "completed" ? "✔ COMPLETED — " : ""}${esc(d.state)}</div>
        ${d.status === "completed" ? `<div class="pgrid2 qc-head">${E.cell("Date and Time", d.delivered_at ? E.dateTime(d.delivered_at) : "")}${E.cell("Completed By", d.completed_by_name || "")}${d.plate_no ? E.cell("License Plate Number", d.plate_no) : ""}${d.vehicle_type ? E.cell("Type of Car", d.vehicle_type) : ""}${E.cell("Boxes", String(nBoxes(boxes)))}${E.cell("Photos", String(photos.length))}</div>` : ""}
        <div class="btnrow">${orderLink}</div>`;
      return;
    }
    if (d.request_at && !d.can_complete) { // 3.45: submitted: EMON HASAN approves it
      $("#pdBody").innerHTML = `${head}<div class="banner warn">${ic("clock")} DELIVERY SUBMITTED — ${esc(E.dateTime(d.request_at))}. It waits for EMON HASAN's approval: approved, the order is COMPLETED.</div>
        <div class="pgrid2 qc-head">${E.cell("Submitted By", d.request_by || "")}${d.plate_no ? E.cell("License Plate Number", d.plate_no) : ""}${d.vehicle_type ? E.cell("Type of Car", d.vehicle_type) : ""}${E.cell("Boxes", vsText(d.total_boxes, nBoxes(boxes), d.status === "completed"))}${E.cell("Pcs", vsText(d.total_pcs, pcs, d.status === "completed", "PCS"))}${E.cell("Photos", String(photos.length))}</div>
        <div class="btnrow">${orderLink}</div>`;
      return;
    }
    const submitOnly = d.can_complete === false; // not signed in with EO-Office: EMON HASAN approves the delivery
    // 3.98: the car plate no (optional; a server without 095 has no box for it)
    const needPlate = "plate_no" in d;
    const tick = (on, label) => `<li class="${on ? "ok" : ""}">${on ? "✔" : "○"} ${esc(label)}</li>`;
    $("#pdBody").innerHTML = `${head}
      <div class="banner">${ic("box")} CONFIRMED — ready for delivery. Do the steps below.</div>
      <section class="pd-step"><h3><span class="pd-n">1</span> Boxes <small>${vsText(d.total_boxes, nBoxes(boxes), false)} · ${vsText(d.total_pcs, pcs, false, "PCS")}</small></h3>
        ${boxCheck(lines, boxes)}
        <div class="btnrow"><button type="button" class="btn primary" id="pdScan">${ic("scan")} Scan Boxes</button><label class="btn" for="pdLabel">${ic("image")} Box Label Photo</label><input type="file" id="pdLabel" accept="image/*" multiple hidden>
          <button type="button" class="btn" id="pdType">📦 Add Box</button></div>
        <div class="box-find"><input type="text" id="pdFind" maxlength="60" placeholder="Serial no, e.g. U20261238" aria-label="Find a box by its serial no" autocomplete="off"><button type="button" class="btn primary" id="pdFindGo">${ic("search")} Find &amp; Add</button></div>
        <div id="pdFound" class="box-found" aria-live="polite">${foundHtml(d.id)}</div>
        ${E.grid({ cols: [{ label: "#", get: (b) => boxNo(boxes, b) }, { label: "Serial No", html: serHtml }, { label: "Code", get: (b) => b.code || "" },
          { label: "Items", get: (b) => b.items || "" }, { label: "Brand", get: (b) => b.brand || "" }, { label: "Pcs", num: true, get: (b) => qtyText(b.pcs) },
          { label: "", html: (b) => `<button type="button" class="btn small danger" data-pdx="${b.id}" aria-label="Remove ${esc(b.serial_no || b.items || "line")}">×</button>` }], rows: boxes, empty: "No boxes yet: scan the QR or PDF417 code on each box label." })}
      </section>
      <section class="pd-step"><h3><span class="pd-n">2</span> ${needPlate ? "Car and Proof of Delivery" : "Delivery Photos"}</h3>
        ${needPlate ? plateField("pd", d.plate_no, d.vehicle_type) : ""}<h4 class="co-h4">Proof of Delivery Photo (optional, up to ${MAX_PHOTOS})</h4>
        <div class="po-photos co-photos">${photos.map((x, i) => `<div class="po-pic"><button type="button" class="co-ph" data-ph="${esc(urls.get(x) || "")}" aria-label="Open photo ${i + 1}"><img src="${esc(urls.get(x) || "")}" alt="Delivery photo"></button><button type="button" data-pdrm="${esc(x)}" aria-label="Remove photo">×</button></div>`).join("")}</div>
        <div class="btnrow"><label class="btn" for="pdPic" ${photos.length >= MAX_PHOTOS ? "hidden" : ""}>${ic("camera")} Add Photo</label><input type="file" id="pdPic" accept="image/*" multiple hidden></div>
      </section>
      <section class="pd-step"><h3><span class="pd-n">3</span> Complete Delivery</h3>
        <ul class="pd-check">${tick(nBoxes(boxes) > 0, `Boxes: ${vsText(d.total_boxes, nBoxes(boxes), false)}`)}${needPlate ? tick(!!d.plate_no, d.plate_no ? `Car plate no: ${d.plate_no}${d.vehicle_type ? " · " + d.vehicle_type : ""}` : "Car plate no and type of car (optional)") : ""}${tick(photos.length > 0, photos.length ? `Proof of delivery: ${photos.length} photo(s)` : "Proof of delivery photo (optional)")}</ul>
        <div class="co-done"><button type="button" class="btn ok big" id="pdDone">${ic("check")} ${submitOnly ? "Submit Delivery for Approval" : "Complete Delivery"}</button><small>${submitOnly
          ? "Not signed in · needs approval"
          : "Invoice made by itself"}</small></div>
        ${submitOnly && !S.session ? `<div class="banner warn pd-signin">${ic("key")} <b>Invoice now:</b> sign in first
          <div class="btnrow"><button type="button" class="btn primary" id="pdSignIn">${ic("user")} Sign In to Complete Now</button></div></div>` : ""}
      </section>
      <div class="btnrow">${orderLink}</div>`;
    // step 1: the boxes (what a label does not say comes from the order's line of that code, or the box before)
    let added = 0;
    const fill = (x) => {
      if (!x.serial_no) return x; // 3.46: a line without a serial no keeps only what was typed
      const one = lines.length === 1 ? lines[0] : null, last = boxes[boxes.length - 1];
      const line = one || (x.code && lines.find((l) => String(l.code || "").toUpperCase() === String(x.code).toUpperCase()));
      return { ...x, code: x.code || one?.code || last?.code || "", batch_no: x.batch_no || line?.lot || last?.batch_no || "", items: x.items || line?.product || last?.items || "", pcs: x.pcs || line?.pcs || last?.pcs || "" };
    };
    const add = async (x, how) => {
      const b = fill(x);
      if (!b.serial_no && how !== "typed") return "✖ No serial no in that code.";
      const { data, error } = await rpc("delivery_add_box", { p_data: { ...b, added_how: how } });
      if (error) return /on this order already/i.test(error.message || "") ? `✔ Box ${b.serial_no} is on this order (checked)` : `✖ ${error.message}`;
      boxes.push(data); added++;
      if (!data.serial_no) return `✔ Added${boxSays(data)} — no serial no: not counted as a box`;
      return `✔ Box ${data.serial_no} added${boxSays(data)} · ${vsText(d.total_boxes, nBoxes(boxes), false)}`;
    };
    const found = (raw, how) => addFound(raw, how, add, rpc, boxes);
    bindFind("pd", d.id, (v) => found(v, "typed"), reload);
    $("#pdScan").onclick = () => E.scanDialog((text) => found(readLabel(text).serial_no, "scan"), {
      title: `Scan Boxes — ${d.order_no}`, hint: "Scan each box", keep: true,
      onClose: () => { if (added) { toast(`${added} box(es) added.`); reload(); } } });
    $("#pdLabel").onchange = async (e) => {
      const files = Array.from(e.target.files); e.target.value = "";
      if (!files.length) return;
      const notes = [];
      for (const f of files) {
        try { notes.push(await found(readLabel(await E.decodeImageFile(f)).serial_no, "photo")); }
        catch (err) { notes.push(`✖ ${f.name}: ${err.message}`); }
      }
      const bad = notes.filter((n) => n.startsWith("✖"));
      if (bad.length) toast(bad.map((n) => n.slice(2)).join(" "), true); else toast(`${added} box(es) added.`);
      if (added) reload();
    };
    $("#pdType").onclick = () => boxForm({ lines }, null, async (x) => { const r = await add(x, "typed"); if (r.startsWith("✖")) { toast(r.slice(2), true); return false; } toast(r.slice(2)); reload(); return true; });
    $$("[data-pdx]").forEach((b) => (b.onclick = async () => {
      const x = boxes.find((y) => y.id === b.dataset.pdx);
      if (!(await E.confirmBox(`Remove ${boxName(x)} from this order?`, { ok: "Remove", danger: true }))) return;
      b.disabled = true;
      const { error } = await rpc("delivery_remove_box", { p_box: x.id });
      if (error) { b.disabled = false; return fail(error, "Could not remove the box"); }
      toast("Box removed."); reload();
    }));
    // step 2: the photos
    const setPhotos = async (list) => {
      const { data: gone, error } = await rpc("delivery_photos", { p_photos: list });
      if (error) { fail(error, "Could not save the photos"); return false; }
      if (gone?.length) sb.storage.from("records").remove(gone).then(() => {}, () => {});
      return true;
    };
    $("#pdPic").onchange = async (e) => {
      const files = Array.from(e.target.files); e.target.value = "";
      if (!files.length) return;
      const room = MAX_PHOTOS - photos.length;
      if (files.length > room) toast(`Up to ${MAX_PHOTOS} photos: only ${room} more can be added.`, true);
      toast("Uploading the photo…");
      const paths = [];
      for (const raw of files.slice(0, room)) {
        const f = await E.slimFile(raw, "photo");
        const path = `corder/${d.id}/delivery_${Date.now()}_${rand()}.${E.extOf(f)}`;
        const up = await sb.storage.from("records").upload(path, f, { contentType: f.type || "image/jpeg" });
        if (up.error) { toast("A photo could not be uploaded: " + up.error.message, true); continue; }
        paths.push(path);
      }
      if (paths.length && !(await setPhotos([...photos, ...paths]))) sb.storage.from("records").remove(paths).then(() => {}, () => {});
      reload();
    };
    $$("[data-pdrm]").forEach((b) => (b.onclick = async () => {
      if (!(await E.confirmBox("Remove this photo?", { ok: "Remove", danger: true }))) return;
      if (await setPhotos(photos.filter((x) => x !== b.dataset.pdrm))) reload();
    }));
    // step 3: COMPLETE DELIVERY
    if ($("#pdPlateSave")) $("#pdPlateSave").onclick = (e) => savePlate(e, "pd", (plate, type) => rpc("delivery_car", { p_plate: plate, p_type: type }), (plate) => rpc("delivery_plate", { p_plate: plate }), reload);
    $("#pdDone").onclick = async (e) => {
      const short = nBoxes(boxes) !== num(d.total_boxes);
      // 3.59: no box - the invoice is the ORDER AMOUNT; with boxes (serial no) it charges the boxes delivered
      const amt = inside && !nBoxes(boxes) ? await sb.from("customer_orders").select("total_amount").eq("id", d.id).maybeSingle().then((r) => r.data?.total_amount, () => null) : null;
      const msg = (nBoxes(boxes) ? `<div class="co-ok0">✅ ${esc(boxesText(nBoxes(boxes)))} with serial no: the invoice charges the boxes delivered.</div>`
        : `<div class="co-warn0">⚠ NO BOX ADDED (0 boxes)<br><small>If you go on, the invoice is the ORDER AMOUNT${amt != null ? `: ₱ ${peso(amt)}` : ""}. Scan the boxes first to charge the delivery list.</small></div>`)
        + `Complete the delivery of <b>${esc(d.order_no)}</b> for <b>${esc(d.customer)}</b>?`
        + (short ? `<br><br><b>Note:</b> ${nBoxes(boxes)} box(es) were scanned, the order has ${qtyText(d.total_boxes)}.` : "")
        + (submitOnly ? "<br><br>The delivery is SUBMITTED and waits for EMON HASAN's approval." : "<br><br>The order becomes COMPLETED and the invoice is made. This cannot be undone.");
      const title = submitOnly ? "Submit Delivery" : "Complete Delivery";
      if (!(await E.confirmBox(msg, { title, ok: title }))) return;
      e.target.disabled = true;
      if (!(await carFirst("pd", d.plate_no, d.vehicle_type, (plate, type) => rpc("delivery_car", { p_plate: plate, p_type: type }), (plate) => rpc("delivery_plate", { p_plate: plate })))) { e.target.disabled = false; return; }
      const { data: res, error } = await rpc("delivery_complete");
      if (error) { e.target.disabled = false; return fail(error, "Could not complete the delivery"); }
      if (res === "submitted") { toast(`Order ${d.order_no}: delivery SUBMITTED. EMON HASAN approves it. Thank you!`); reload(); return; }
      toast(`Order ${d.order_no}: COMPLETED. Thank you!`);
      if (inside && E.canOpen("custorder")) location.hash = "custorder/" + d.id; else reload();
    };
    $$("[data-ph]").forEach((b) => (b.onclick = () => E.lightbox(b.dataset.ph)));
    // 3.74.1: sign in and come back to this page (the hash stays): signed in with EO-Office, COMPLETE makes the invoice at once
    if ($("#pdSignIn")) $("#pdSignIn").onclick = () => (E.renderLogin ? E.renderLogin() : (location.hash = "dashboard"));
  }

  // A customer's orders (on the customer's profile)
  async function ordersOf(custId) {
    const { data, error } = await sb.from("customer_orders").select("id, order_no, order_date, status, total_boxes, total_amount").eq("customer_id", custId).order("created_at", { ascending: false }).limit(200);
    return error ? null : data || [];
  }
  function ordersHtml(rows, custId) {
    return `${canW() ? `<div class="btnrow"><a class="btn primary" href="#newcustorder/${custId}">${ic("plus")} New Customer Order</a></div>` : ""}
      ${E.grid({ cols: [{ label: "Order No", get: (o) => o.order_no }, { label: "Date", get: (o) => mdy(o.order_date) }, { label: "Boxes", num: true, get: (o) => qtyText(o.total_boxes) },
        { label: "Amount (₱)", num: true, get: (o) => peso(o.total_amount) }, { label: "Status", html: stPill }], rows, onRow: true, empty: "No customer orders yet." })}`;
  }

  Object.assign(E, { customerOrdersOf: ordersOf, customerOrdersHtml: ordersHtml, deliveryHashOf, orderTimeline: timelineHtml });
})();
