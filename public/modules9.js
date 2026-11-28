/* EMON OVERRUNS E-PORTAL — 3.21 Employee ID Card.
   The card is CR80 size (54 × 85.6 mm), front and back. Copy-resistant printing: fine-line guilloche waves, a security
   rosette behind the photo, microtext lines, a ghost photo and a dot background
   that may show COPY on a photocopy. The front carries a PDF417 barcode of the employee no (it opens Verify a Record).
   The back carries the emergency contact, a QR with the private card code (the employee signs in by scanning it and
   typing the password of the portal account, 3.28) and the signature of the Director who issued the card over the company name, address and email.
   Here: the card itself, the Director's ID Card tab (print / download, new card), the card in My Profile
   and the check of a scanned card. 3.23: on the screen the card shows DRAFT ONLY; the print is clean. The sign-in with the card is on the sign-in page (app.js). */
(function () {
  "use strict";
  const E = window.EO;
  const { sb, C, esc, mdy, $, isAdmin, toast, fail, ic, busy, fullName } = E;
  const W = 54, H = 85.6;
  // 3.99.243: the company stamp of the card: the round EMON OVERRUNS logo stamp (navy ink, the yellow shirt), clear background
  const rStamp = (cls) => `<span class="${cls} idc-rs" aria-hidden="true"><img src="brand/seal-stamp.png" alt=""></span>`;

  const STAMP = "brand/stamp.png"; // the company stamp (round seal, see-through), on the photo corner and by EMON HASAN's signature
  let uid = 0;

  // ---------- the security background (SVG in mm) ----------
  const n2 = (x) => x.toFixed(2);
  // fine sine lines across the card; two families of different colours cross each other
  function waves(color, y0, y1, lines, amp, len, phase, width = 0.07) {
    let d = "";
    for (let i = 0; i < lines; i++) {
      const base = y0 + ((y1 - y0) * i) / Math.max(1, lines - 1), ph = phase + i * 0.42;
      for (let x = -1, first = true; x <= W + 1; x += 0.8, first = false) d += `${first ? "M" : "L"}${n2(x)} ${n2(base + amp * Math.sin((x / len) * 2 * Math.PI + ph))}`;
    }
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
  }
  // a rosette: closed curves r = R + a·sin(kθ + φ), turned a little each
  function rosette(cx, cy, R, a, k, curves, color, width = 0.06) {
    let d = "";
    for (let j = 0; j < curves; j++) {
      const ph = (j * 2 * Math.PI) / curves;
      for (let s = 0; s <= 180; s++) {
        const t = (s / 180) * 2 * Math.PI, r = R + a * Math.sin(k * t + ph);
        d += `${s ? "L" : "M"}${n2(cx + r * Math.cos(t))} ${n2(cy + r * Math.sin(t))}`;
      }
      d += "Z";
    }
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
  }
  // The background tint is made of fine dots; inside the word COPY the dots are bigger and fewer, with the same tone.
  // A copier keeps the big dots and drops the fine ones, so COPY may appear on a photocopy.
  function copyTint(k, color) {
    const words = [];
    for (let y = 12; y < H; y += 17) for (let x = -6 + ((y / 17) % 2) * 13; x < W; x += 26) words.push(`<text x="${x}" y="${y}">COPY</text>`);
    const txt = `<g font-family="Arial, sans-serif" font-weight="900" font-size="9" transform="rotate(-28 27 43)">${words.join("")}</g>`;
    return `<defs>
        <pattern id="pf${k}" width="0.32" height="0.32" patternUnits="userSpaceOnUse"><circle cx="0.16" cy="0.16" r="0.085" fill="${color}"/></pattern>
        <pattern id="pc${k}" width="0.64" height="0.64" patternUnits="userSpaceOnUse"><circle cx="0.32" cy="0.32" r="0.17" fill="${color}"/></pattern>
        <mask id="mw${k}"><rect width="${W}" height="${H}" fill="#000"/><g fill="#fff">${txt}</g></mask>
        <mask id="mb${k}"><rect width="${W}" height="${H}" fill="#fff"/><g fill="#000">${txt}</g></mask>
        <linearGradient id="rb${k}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e3f1ff"/><stop offset=".45" stop-color="#fdf3ff"/><stop offset=".75" stop-color="#fffbe8"/><stop offset="1" stop-color="#e8fff4"/></linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#rb${k})"/>
      <rect width="${W}" height="${H}" fill="url(#pf${k})" mask="url(#mb${k})" opacity=".55"/>
      <rect width="${W}" height="${H}" fill="url(#pc${k})" mask="url(#mw${k})" opacity=".55"/>`;
  }
  const MICRO = "EMON OVERRUNS · "; // 3.23: tiny company name in the blue foot (anti-copy microtext)
  const micro = (n) => esc(MICRO.repeat(n));
  const bg = (k, front) => `<svg class="idc-bg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      ${copyTint(k, "#b9c9e6")}
      ${waves("#8fb0e6", 20, 82, 16, 1.6, 19, 0.3)}${waves("#e3a3c8", 22, 84, 14, 1.2, 13, 2.1, 0.06)}
      ${front ? rosette(27, 32.8, 15.5, 2.3, 9, 14, "#7fa2e0") + rosette(27, 32.8, 11.2, 1.3, 13, 10, "#d9a441", 0.05) : rosette(27, 43, 20, 2, 11, 12, "#9fbbe9")}
      ${edgeWave("#c9a227")}
    </svg>`;
  const band = (k) => `<svg class="idc-bandbg" viewBox="0 0 ${W} 15" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="bd${k}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a2463"/><stop offset=".6" stop-color="#1f4fa3"/><stop offset="1" stop-color="#2f6fd6"/></linearGradient></defs>
      <rect width="${W}" height="15" fill="url(#bd${k})"/>
      <g opacity=".22">${waves("#ffffff", 1, 14, 8, 0.9, 11, 0.8, 0.06)}</g></svg>`;

  // 3.99.122: a wavy gold guilloche line round the card (1.3 mm in), and a microtext frame round the photo
  function edgeWave(color, inset = 1.3, amp = 0.35, step = 2.6) {
    const pts = [], x0 = inset, y0 = inset, x1 = W - inset, y1 = H - inset;
    const run = (ax, ay, bx, by, nx, ny) => { const len = Math.hypot(bx - ax, by - ay), n = Math.max(2, Math.round(len / 0.5));
      for (let i = 0; i <= n; i++) { const t = i / n, w = amp * Math.sin((t * len / step) * 2 * Math.PI); pts.push(`${n2(ax + (bx - ax) * t + nx * w)} ${n2(ay + (by - ay) * t + ny * w)}`); } };
    run(x0, y0, x1, y0, 0, 1); run(x1, y0, x1, y1, -1, 0); run(x1, y1, x0, y1, 0, -1); run(x0, y1, x0, y0, 1, 0);
    return `<path d="M${pts.join("L")}Z" fill="none" stroke="${color}" stroke-width=".12"/><path d="M${pts.join("L")}Z" fill="none" stroke="#1f4fa3" stroke-width=".05" transform="translate(.35 .35)" opacity=".7"/>`;
  }
  function photoFrame(k, words) {
    // each side its own line of whole words (never cut at a corner)
    const w = 26.8, h = 30.8, p = 0.55, unit = words.join(" · "), uw = unit.length * 0.37 + 1.1;
    const side = (id, d, len) => { const n = Math.max(1, Math.floor((len + 1.1) / uw)); const t = Array(n).fill(unit).join(" · ");
      return `<path id="${id}" d="${d}"/><text font-family="Arial, sans-serif" font-size=".8" font-weight="700" fill="#15396f"><textPath href="#${id}" textLength="${n2(len)}" lengthAdjust="spacing">${esc(t)}</textPath></text>`; };
    const lx = w - 2 * p - 2.4, ly = h - 2 * p - 2.4;
    return `<svg class="idc-pframe" viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <rect x=".12" y=".12" width="${w - .24}" height="${h - .24}" rx="1.4" fill="#fff" stroke="#c9a227" stroke-width=".18"/>
      ${side(`pft${k}`, `M${p + 1.2} ${p + .65}H${w - p - 1.2}`, lx)}${side(`pfb${k}`, `M${p + 1.2} ${h - p - .05}H${w - p - 1.2}`, lx)}
      ${side(`pfr${k}`, `M${w - p - .65} ${p + 1.2}V${h - p - 1.2}`, ly)}${side(`pfl${k}`, `M${p + .65} ${h - p - 1.2}V${p + 1.2}`, ly)}</svg>`;
  }

  // ---------- the card ----------
  const nameSize = (n) => (n.length <= 16 ? 3.8 : n.length <= 22 ? 3.2 : n.length <= 30 ? 2.7 : 2.3);
  const val = (v) => (v ? esc(v) : "&nbsp;");
  // d: { em, card, photo, holderSig, dirSig, blood, appNo, qr }  (qr: a picture; empty on the screen)
  function front(d) {
    const k = ++uid, name = fullName(d.em).toUpperCase();
    return `<div class="idc-face idc-front">${bg(k, true)}
      <div class="idc-top">${band(k)}${E.logoHtml("idc-logo")}<div class="idc-co"><b>${esc(C.company.name)}</b><small>EMPLOYEE IDENTIFICATION CARD</small></div></div>
      <div class="idc-gold"></div>
      ${photoFrame(k, [C.company.name, d.em.employee_no])}
      <div class="idc-photo">${d.photo ? `<img class="idc-pic" src="${esc(d.photo)}" alt="">` : `<span>PHOTO</span>`}</div>
      ${d.photo ? `<div class="idc-ghost"><img src="${esc(d.photo)}" alt=""><span>${esc(`${d.em.employee_no} `.repeat(14))}</span></div>` : ""}
      <div class="idc-name" style="font-size:${nameSize(name)}mm">${esc(name)}</div>
      <div class="idc-pos"><span>${esc((d.em.position || "EMPLOYEE").toUpperCase())}</span></div>
      <div class="idc-rows"><div><small>EMPLOYEE ID NO</small><b>${esc(d.em.employee_no)}</b></div>
        <div><small>VALID UNTIL</small><b>${esc(mdy(d.card.valid_until))}</b></div></div>
      <div class="idc-bar"><img src="${esc(E.pdf417DataUrl("EMONEMP|" + d.em.employee_no))}" alt="PDF417 barcode ${esc(d.em.employee_no)}"></div>
      <div class="idc-hsig">${d.holderSig ? `<img src="${esc(d.holderSig)}" alt="">` : ""}<i></i><small>HOLDER'S SIGNATURE</small></div>
      <div class="idc-foot"><span class="idc-micro">${micro(8)}</span><b>${esc(d.card.card_no)}</b></div>
    </div>`;
  }
  function back(d) {
    const k = ++uid, em = d.em, site = String(C.company.website || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
    const row = (l, v, cls = "") => `<div class="idc-er ${cls}"><small>${l}</small><b>${val(v)}</b></div>`;
    return `<div class="idc-face idc-back">${bg(k, false)}
      <div class="idc-bhead">${band(k)}<span>IN CASE OF EMERGENCY, PLEASE NOTIFY</span></div><div class="idc-gold b"></div>
      <div class="idc-emg">${row("NAME", em.emergency_name)}${row("CONTACT NO", em.emergency_phone)}${row("ADDRESS", em.emergency_address, "two")}</div>
      <div class="idc-qrrow"><div class="idc-qr">${d.qr ? `<img src="${esc(d.qr)}" alt="QR code">` : `<span>${ic("key")}<br>QR CODE<br>ON THE<br>PRINTED CARD</span>`}</div>
        <div class="idc-qrtxt"><b class="idc-scan">SCAN TO SIGN IN</b>
          <small>CARD NO</small><b class="mono">${esc(d.card.card_no)}</b><small>ISSUED</small><b>${esc(mdy(d.card.issued_at))}</b>
          <small>VALID UNTIL</small><b>${esc(mdy(d.card.valid_until))}</b>${d.appNo ? `<small>APPLICATION NO</small><b class="mono">${esc(d.appNo)}</b>` : ""}</div></div>
      <div class="idc-sign"><div class="idc-sigpic">${d.dirSig ? `<img src="${esc(d.dirSig)}" alt="">` : ""}</div><i></i>
        ${E.stampHtml ? E.stampHtml(E.stampOf ? E.stampOf(d.card.issued_by, d.dirName || "", d.dirTitle === "REGIONAL DIRECTOR" ? "" : d.dirTitle || "", true) : { name: d.dirName || "", pos: d.dirTitle || "" }) : `<b>${esc(d.dirName || "")}</b><small class="idc-dtitle">${esc(d.dirTitle || "REGIONAL DIRECTOR")}</small>`}</div>
      <p class="idc-note">Property of ${esc(C.company.name)} · not transferable · if found, please return it.<br><b>Verify this card: ${esc(site || "emonoverruns.online")}/verify</b></p>
      <div class="idc-bsec">${d.photo ? `<div class="idc-ghost b2"><img src="${esc(d.photo)}" alt=""><span>${esc(`${em.employee_no} `.repeat(14))}</span></div>` : ""}
        <div class="idc-miniseal">${E.secSeal ? E.secSeal(d.card.card_no, { code: d.seal || "", trx: d.card.id || "", by: E.eoidOf?.(d.card.issued_by) || E.eoidOf?.(E.directorId?.("EMON HASAN")) || "", lines: [fullName(em).toUpperCase(), em.employee_no || "", (em.position || "EMPLOYEE").toUpperCase()].filter(Boolean) }) : ""}</div></div>
      <div class="idc-foot"><span class="idc-micro">${micro(8)}</span><b>${esc(em.employee_no)}</b></div>
    </div>`;
  }
  // The print: front and back side by side on A4, corner marks to cut, a dotted line to fold.
  const sheet = (d) => `<div class="idc-sheet">
      <div class="idc-pair print"><i class="cm tl"></i><i class="cm tr"></i><i class="cm bl"></i><i class="cm br"></i>${front(d)}<div class="idc-fold"></div>${back(d)}</div>
</div>`;

  // Everything the card shows: the photo, the holder's signature, the signature of the Director who issued it, the blood type.
  async function cardData(em, card) {
    const [photo, prof, app, , dirEmp] = await Promise.all([
      em.photo_path ? E.signedUrl(em.photo_path, 3600) : "",
      em.profile_id ? sb.from("profiles").select("signature_path, signature_status").eq("id", em.profile_id).maybeSingle() : { data: null },
      em.job_application_id ? sb.from("job_applications").select("blood_group, application_no").eq("id", em.job_application_id).maybeSingle() : { data: null },
      Promise.all([E.loadSignatures(), card.issued_by ? E.loadSigners?.([card.issued_by]) : null]), // 3.99.240: and the issuer's name, position, EOID
      // 3.99.124: the title of the Director who approved (issued) the card, for its back
      card.issued_by ? sb.from("employees").select("position").eq("profile_id", card.issued_by).maybeSingle().then((r) => r.data, () => null) : null
    ]);
    const sig = prof.data?.signature_status === "approved" ? await E.signaturePic(prof.data.signature_path) : "";
    return { em, card, photo, holderSig: sig, dirSig: E.approvedBy(card.issued_by, card.issued_by_name, card.issued_at)?.pic || "", blood: app.data?.blood_group || em.blood_group || "", appNo: app.data?.application_no || "",
      dirName: String(card.issued_by_name || "").toUpperCase(), dirTitle: String(dirEmp?.position || "REGIONAL DIRECTOR").toUpperCase() };
  }

  // ---------- the Director's ID Card tab on the employee profile ----------
  async function storeIssuedCard(employeeId) {
    const { data: employee, error: empError } = await sb.from("employees").select("*").eq("id", employeeId).single();
    if (empError) throw empError;
    const { data: card, error: cardError } = await sb.from("employee_cards").select("*").eq("employee_id", employeeId).eq("status", "active").single();
    if (cardError) throw cardError;
    const bucket = sb.storage.from("eoid-originals"), path = card.card_no + ".pdf";
    const { data: files, error: listError } = await bucket.list("", { search: path });
    if (listError) throw listError;
    if (files.some(file => file.name === path)) return;
    await E.needLib("bwip");
    const data = await cardData(employee, card);
    if (employee.photo_path && !data.photo) throw new Error("Employee photo unavailable");
    const { data: code, error } = await sb.rpc("employee_card_code", { p_card: card.id });
    if (error || !code) throw error || new Error("Card code unavailable");
    const qr = E.qrDataUrl(code);
    if (!qr) throw new Error("Card QR unavailable");
    const seal = await E.sealCode("idcard", card.card_no);
    const desk = document.createElement("div");
    desk.className = "pv-desk";
    desk.style.cssText = "position:fixed;top:0;left:-320mm;width:210mm;pointer-events:none";
    desk.setAttribute("aria-hidden", "true");
    desk.innerHTML = `<div class="page bare">${sheet({ ...data, seal, qr })}<div class="pg-trx">TRX ID ${esc(card.id.toUpperCase())}</div></div>`;
    document.body.appendChild(desk);
    try {
      await E.documentCards(desk, card.issued_at);
      await Promise.all(Array.from(desk.querySelectorAll("img[src]"), image => image.decode()));
      const file = await E.renderPdf(desk);
      const { error: uploadError } = await bucket.upload(path, file, { contentType: "application/pdf", upsert: false });
      if (uploadError && String(uploadError.statusCode) !== "409" && uploadError.error !== "Duplicate") throw uploadError;
    } finally {
      desk.remove();
    }
  }

  const pendingSaves = new Map();
  const queuePrefix = () => "eoPendingCardPdf:" + E.S.profile.id + ":";
  function saveApprovedCard(employeeId) {
    const key = queuePrefix() + employeeId;
    if (pendingSaves.has(key)) return pendingSaves.get(key);
    try { localStorage.setItem(key, "1"); } catch {}
    const job = storeIssuedCard(employeeId).then(() => {
      try { localStorage.removeItem(key); } catch {}
      return true;
    }).catch(err => {
      const missingBucket = /bucket not found/i.test(err.message || "");
      toast(missingBucket ? "ID card PDF storage is not set up. Run supabase/eoid_original_pdfs.sql, then reopen the dashboard." : "ID card PDF pending: " + (err.message || "Storage unavailable") + ". Reopen the dashboard to retry.", true);
      return false;
    }).finally(() => pendingSaves.delete(key));
    pendingSaves.set(key, job);
    return job;
  }

  async function retryCardPdfs() {
    if (!isAdmin()) return;
    const prefix = queuePrefix();
    let keys;
    try { keys = Object.keys(localStorage).filter(key => key.startsWith(prefix)); } catch { return; }
    for (const key of keys) {
      if (!isAdmin() || prefix !== queuePrefix()) return;
      await saveApprovedCard(key.slice(prefix.length));
    }
  }

  const STATE = { active: "ACTIVE", replaced: "REPLACED", revoked: "ENDED", blocked: "BLOCKED" };
  // 3.99.390: THE ID CARD STEPS (SQL 170): generated → waiting for printing (PHP 150 fee paid) → arrived office → received office
  // (the employee is told to collect it) → collected (signed record uploaded) → active (the Director). Older cards: activate directly.
  const STEPS = [["generated", "GENERATED"], ["waiting_print", "WAITING FOR PRINTING"], ["arrived", "ARRIVED OFFICE"], ["received", "RECEIVED OFFICE"], ["collected", "COLLECTED"], ["active", "ACTIVE"]];
  const stepOf = (c) => c ? (c.stage || (c.activated_at ? "active" : "old")) : "";
  const stepper = (c) => {
    const at = stepOf(c), k = STEPS.findIndex(([v]) => v === at), log = Array.isArray(c.steps) ? c.steps : [];
    if (at === "old") return `<div class="idf-old">${ic("clock")}<div><b>ISSUED BEFORE THE NEW STEPS · NOT ACTIVATED</b><small>The printed card stays as it is. It works again once the Director activates it.</small></div></div>`;
    return `<ol class="idf-steps">${STEPS.map(([v, l], n) => { const e = log.filter((x) => x.step === v).pop();
      return `<li class="${n < k ? "done" : n === k ? (v === "active" ? "done now" : "now") : ""}"><span class="idf-dot">${n < k || v === at && v === "active" ? ic("check") : n + 1}</span><b>${l}</b>${e ? `<small>${esc(mdy(e.at))}${e.by ? ` · ${esc(String(e.by).toUpperCase())}` : ""}</small>` : ""}</li>`; }).join("")}</ol>`;
  };
  // the paper the employee signs when the card is handed over: all the card data, a coded QR, front and back
  async function collectionRecord(em, card, d) {
    const seal = E.sealCode ? await E.sealCode("idcard", card.card_no).catch(() => "") : "";
    const qr = E.qrDataUrl(`EMONIDC|${card.card_no}|${seal || card.id.replace(/-/g, "").slice(0, 16).toUpperCase()}`);
    const nm = fullName(em).toUpperCase(), row = (k, v, mono) => `<tr><th>${k}</th><td${mono ? ' class="mono"' : ""}>${esc(v || "—")}</td></tr>`;
    const page = `<div class="idcol">${E.printHead ? E.printHead("COLLECTION · EMPLOYEE IDENTIFICATION CARD", `<div class="soa-no"><small>CARD NO</small><b class="mono">${esc(card.card_no)}</b><small>${esc(mdy(E.isoToday()).toUpperCase())}</small></div>`) : `<h2>COLLECTION · EMPLOYEE IDENTIFICATION CARD</h2>`}
      <div class="idcol-top"><table class="idcol-t"><tbody>
        ${row("NAME", nm)}${row("EMPLOYEE NO", em.employee_no, 1)}${row("POSITION", String(em.position || "").toUpperCase())}${row("CARD NO", card.card_no, 1)}
        ${row("ISSUED", mdy(card.issued_at).toUpperCase())}${row("VALID UNTIL", mdy(card.valid_until).toUpperCase())}${row("ID CARD FEE", card.fee_cv_id ? "PHP 150.00 · PAID" : "—")}
        ${row("RECEIVED AT OFFICE", card.received_at ? mdy(card.received_at).toUpperCase() : "—")}</tbody></table>
        <div class="idcol-qr">${qr ? `<img src="${qr}" alt="">` : ""}<small>CODED RECORD · SCAN TO VERIFY</small></div></div>
      <div class="idcol-cards">${front(d)}${back(d)}</div>
      <div class="idcol-terms"><h4>IMPORTANT</h4><ol>
        <li>THIS CARD IS THE PROPERTY OF EMON OVERRUNS. IT IS FOR THE NAMED EMPLOYEE ONLY AND MUST NOT BE LENT OR COPIED.</li>
        <li>THE CARD WORKS ONLY AFTER THE DIRECTOR ACTIVATES IT.</li>
        <li>A LOST OR STOLEN CARD MUST BE REPORTED AT ONCE SO IT CAN BE BLOCKED.</li>
        <li>THE CARD IS RETURNED TO THE OFFICE WHEN THE EMPLOYMENT ENDS.</li></ol></div>
      <div class="idcol-sign"><div><div class="sl"></div><b>${esc(nm)}</b><small>I WILL RECEIVE THE CARD</small></div><div><div class="sl"></div><b>RELEASED BY</b><small>EMON OVERRUNS OFFICE</small></div></div></div>`;
    E.openPreview(`ID CARD COLLECTION ${nm} ${card.card_no}`, [page], { trx: card.id });
  }
  async function idCardTab(em, el, reload) {
    if (!isAdmin() || !el) return;
    if (em.approval_status === "pending") { el.innerHTML = `<div class="hint warn">The ID card can be generated after the employee is approved: press <b>Approve Employee</b> at the top of this page.</div>`; return; }
    el.innerHTML = busy("Loading the ID card");
    const [cards, prof] = await Promise.all([sb.from("employee_cards").select("*").eq("employee_id", em.id).order("issued_at", { ascending: false }),
      em.profile_id ? sb.from("profiles").select("signature_status").eq("id", em.profile_id).maybeSingle() : Promise.resolve({ data: null })]);
    if (cards.error) { el.innerHTML = `<div class="hint err">The ID cards could not be loaded. ${/employee_cards/.test(cards.error.message || "") ? "Run the database update <b>032_employee_id.sql</b> first." : esc(cards.error.message)}</div>`; return; }
    const list = cards.data || [], card = list.find((c) => c.status === "active"), at = stepOf(card);
    if (card) saveApprovedCard(em.id);
    await E.needLib("bwip").catch(() => {});
    const d = card ? await cardData(em, card) : null;
    if (!el.isConnected) return;
    const expired = card && card.valid_until < E.isoToday();
    // what Generate New ID needs: a photo, an approved signature, the name and the position
    const need = [[!!em.photo_path, "Photo"], [prof.data?.signature_status === "approved", "Approved signature"], [!!(em.first_name && em.last_name), "Name"], [!!em.position, "Position"]];
    const ready = need.every(([ok]) => ok);
    const pill = !card ? "" : expired ? `<span class="pill rejected">EXPIRED</span>` : at === "active" ? `<span class="pill approved">ACTIVE</span>` : `<span class="pill pending">NOT ACTIVE</span>`;
    const act = (id, label, icon, cls = "") => `<button type="button" class="btn ${cls}" id="${id}">${ic(icon)} ${label}</button>`;
    const stepBtns = !card ? "" : {
      generated: act("idfPrint", "Send to Printing · ₱150 Fee", "send", "primary"),
      waiting_print: act("idfArrived", "Arrived Office", "check", "primary"),
      arrived: act("idfReceived", "Received Office", "check", "primary"),
      received: `${act("idfRecord", "Collection Record", "print")}<label class="btn primary" for="idfUp">${ic("upload")} Upload Signed Record</label><input type="file" id="idfUp" accept="image/*,application/pdf" hidden>`,
      collected: act("idfActivate", "Activate Card", "check", "primary"),
      old: act("idfActivate", "Activate Card", "check", "primary") }[at] || "";
    el.innerHTML = `${card ? stepper(card) : ""}<div class="idc-panel">
        ${card ? `<div class="idc-pair screen">${front(d)}${back(d)}</div>` : `<div class="empty">${em.status === "terminated" ? "No active ID card: the employee is terminated." : "No ID card yet."}</div>`}
        <div class="idc-side">
          ${card ? E.kvTable([
            ["Card No", "", `<b class="mono">${esc(card.card_no)}</b> ${pill}`],
            ["Issued", `${mdy(card.issued_at)}${card.issued_by_name ? ` · by ${card.issued_by_name}` : ""}`],
            ["Valid Until", mdy(card.valid_until)],
            ...(card.fee_cv_id ? [["ID Card Fee", "", `<a href="#collection/${esc(card.fee_cv_id)}">₱ 150.00 · PAID</a>`]] : []),
            ...(card.activated_at ? [["Activated", `${mdy(card.activated_at)}${card.activated_by_name ? ` · by ${card.activated_by_name}` : ""}`]] : []),
            ["Portal Account", "", em.profile_id ? `<span class="pill approved">LINKED</span>` : `<span class="pill pending">NOT LINKED</span>`],
            ["Printed", card.print_count ? `${card.print_count} time${card.print_count === 1 ? "" : "s"} · last ${mdy(card.last_printed_at)}` : "Not printed yet"]]) : ""}
          ${!card && em.status !== "terminated" ? `<ul class="idf-need">${need.map(([ok, l]) => `<li class="${ok ? "ok" : "no"}">${ic(ok ? "check" : "x")} ${l}</li>`).join("")}</ul>` : ""}
          <div class="btnrow">
            ${stepBtns}
            ${card ? act("idcPrint", at === "generated" ? "Print File (ZIP)" : "Print / Download ID Card", "print") : ""}
            ${em.status !== "terminated" ? `<button type="button" class="btn${card ? "" : " primary"}" id="idcNew"${!ready ? " disabled" : ""}>${ic("plus")} Generate New ID</button>` : ""}
            ${card ? `<button type="button" class="btn" id="idcExp">${ic("edit")} Edit Expiration Date</button><button type="button" class="btn danger" id="idcBlock">${ic("x")} Block Card</button>` : ""}
          </div>
        </div></div>
      ${list.length ? `<h4>Card History</h4>${E.grid({ cols: [{ label: "Card No", get: (r) => r.card_no }, { label: "Issued", get: (r) => mdy(r.issued_at) }, { label: "Issued By", get: (r) => r.issued_by_name || "" },
        { label: "Valid Until", get: (r) => mdy(r.valid_until) }, { label: "Step", get: (r) => (r.status !== "active" ? "" : (STEPS.find(([v]) => v === stepOf(r)) || [, "NOT ACTIVATED"])[1]) },
        { label: "Status", get: (r) => STATE[r.status] || r.status.toUpperCase() }, { label: "Ended", get: (r) => (r.ended_at ? mdy(r.ended_at) : "") }], rows: list })}` : ""}`;
    const again = () => idCardTab(em, el, reload);
    const step = async (rpc, args, okText, ask) => {
      if (ask && !(await E.confirmBox(ask, { title: "ID Card" }))) return;
      const { error } = await sb.rpc(rpc, args);
      if (error) return fail(error, /function|schema cache|PGRST202/.test(error.message || "") ? "Run the database update 170 first" : "Could not save this step");
      toast(okText); again();
    };
    if ($("#idfPrint", el)) $("#idfPrint", el).onclick = () => step("card_send_printing", { p_card: card.id }, "Sent to printing. The ₱150 ID card fee is recorded as paid.",
      `Send card <b>${esc(card.card_no)}</b> to printing?<br><br>A Collection Voucher of <b>₱ 150.00</b> (ID card fee) is made at once, <b>PAID</b>, and its date is locked.`);
    if ($("#idfArrived", el)) $("#idfArrived", el).onclick = () => step("card_arrived", { p_card: card.id }, "Card arrived at the office.");
    if ($("#idfReceived", el)) $("#idfReceived", el).onclick = () => step("card_received_office", { p_card: card.id }, `Received. ${esc(fullName(em))} is told to collect the card at the office.`,
      `The office received card <b>${esc(card.card_no)}</b>?<br><br>${esc(fullName(em))} gets a notification: <b>Please collect your Employee ID at the EMON OVERRUNS Office.</b>`);
    if ($("#idfRecord", el)) $("#idfRecord", el).onclick = () => collectionRecord(em, card, d);
    if ($("#idfUp", el)) $("#idfUp", el).onchange = async (e) => {
      const files = Array.from(e.target.files || []); if (!files.length) return;
      const failed = await E.uploadRecords("employee", em.id, "id_collection", files.slice(0, 1));
      if (failed) return toast("The record could not be uploaded.", true);
      const { data: att } = await sb.from("attachments").select("id").eq("owner_type", "employee").eq("owner_id", em.id).eq("kind", "id_collection").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!att) return toast("The record could not be found after upload.", true);
      step("card_collected", { p_card: card.id, p_attachment: att.id }, "Signed record saved. The card can now be activated.");
    };
    if ($("#idfActivate", el)) $("#idfActivate", el).onclick = () => step("activate_employee_card", { p_card: card.id }, `Card ${card.card_no} is ACTIVE.`,
      at === "old" ? `Activate card <b>${esc(card.card_no)}</b> of <b>${esc(fullName(em))}</b>?<br><br>It was issued before the new steps; nothing on the printed card changes.` : `Activate card <b>${esc(card.card_no)}</b>? ${esc(fullName(em))} can use it at once.`);
    if ($("#idcPrint", el)) $("#idcPrint", el).onclick = async () => {
      const { data: code, error } = await sb.rpc("employee_card_code", { p_card: card.id });
      if (error) return fail(error, "Could not print the ID card");
      const seal = E.sealCode ? await E.sealCode("idcard", card.card_no) : ""; // 3.99.123: the card's unique seal no
      E.openPreview(`${fullName(em).toUpperCase()} ${card.card_no}`, [sheet({ ...d, seal, qr: E.qrDataUrl(code) })], { bare: true, trx: card.id }); // 3.99.275: the file is named NAME EOID
      again();
    };
    if ($("#idcBlock", el)) $("#idcBlock", el).onclick = async () => {
      if (!(await E.confirmBox(`Block ID card <b>${esc(card.card_no)}</b> of <b>${esc(fullName(em))}</b>?<br><br>It stops signing in at once and shows <b>BLOCKED</b> when scanned. Then press <b>Generate New ID</b> for a new card.`, { title: "Block Card", ok: "Block Card", danger: true }))) return;
      const { error } = await sb.rpc("block_employee_card", { p_card: card.id });
      if (error) return fail(error, /function|schema cache|PGRST202/.test(error.message || "") ? "Run the database update 111 first" : "Could not block the card");
      toast(`Card ${card.card_no} blocked.`); again();
    };
    if ($("#idcExp", el)) $("#idcExp", el).onclick = () => {
      const m = E.modal("Edit Expiration Date", `<label for="idcExpD">Valid Until</label><input id="idcExpD" type="date" min="${E.isoToday()}" value="${esc(card.valid_until)}">`,
        `<button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" id="idcExpS">${ic("check")} Save</button>`);
      $("[data-x]", m.el).onclick = () => m.close();
      $("#idcExpS", m.el).onclick = async () => {
        const v = $("#idcExpD", m.el).value;
        if (!v) return toast("Choose the date.", true);
        const { error } = await sb.rpc("set_card_expiry", { p_card: card.id, p_date: v });
        if (error) return fail(error, /function|schema cache|PGRST202/.test(error.message || "") ? "Run the database update 111 first" : "Could not change the date");
        m.close(); toast(`Card ${card.card_no} is valid until ${mdy(v)}. Print the card again.`); again();
      };
    };
    if ($("#idcNew", el)) $("#idcNew", el).onclick = async () => {
      if (!ready) return toast(`Needed first: ${need.filter(([ok]) => !ok).map(([, l]) => l).join(", ")}.`, true);
      if (!(await E.confirmBox(card ? `Generate a new ID card for <b>${esc(fullName(em))}</b>?<br><br>Card <b>${esc(card.card_no)}</b> stops working at once. The new card goes through the steps: printing (₱150 fee), office, collection, activation.` : `Generate the ID card for <b>${esc(fullName(em))}</b>?`, { ok: "Generate New ID" }))) return;
      const { data, error } = await sb.rpc("issue_employee_card", { p_employee: em.id });
      if (error) return fail(error, "Could not generate the ID card");
      toast(`ID card ${data.card_no} generated. Next: Send to Printing.`); again();
    };
  }

  // ---------- the employee's ID card in My Profile (3.28: signs in with the card and the account password, no PIN) ----------
  async function cardInfoBox(el, employee) {
    if (!el) return;
    el.innerHTML = `<fieldset class="opt"><legend>My ID Card</legend><div class="own-id-page" aria-live="polite">Loading card…</div></fieldset>`;
    const box = el.querySelector(".own-id-page");
    const { data: card, error } = await sb.rpc("my_id_card");
    if (!box.isConnected) return;
    if (error || !card?.card_no) {
      box.textContent = error ? "Your card could not be loaded." : "No active ID card.";
      return;
    }
    // 3.99.390: the card's step: collect it at the office, or wait for the activation
    const st = card.stage || "active";
    if (st !== "active") el.querySelector("fieldset").insertAdjacentHTML("afterbegin", `<div class="idf-mine ${st === "received" ? "go" : ""}">${ic(st === "received" ? "building" : "clock")}<div><b>${st === "received" ? "Please collect your Employee ID at the EMON OVERRUNS Office." : st === "collected" ? "Your Employee ID is waiting for the Director's activation." : st === "old" ? "Your Employee ID is not activated yet. Ask the Director." : "Your new Employee ID is being prepared."}</b><small>${esc(card.card_no)} · it works once it is ACTIVE</small></div></div>`);
    const name = card.card_no + ".pdf";
    const { data: file } = await sb.storage.from("eoid-originals").download(name);
    if (!box.isConnected) return;
    if (!file) {
      await E.needLib("bwip");
      const details = await cardData(employee, card);
      if (!box.isConnected) return;
      box.innerHTML = `<div class="idc-pair screen">${front(details)}${back(details)}</div><small>Original PDF unavailable.</small>`;
      return;
    }
    const url = URL.createObjectURL(file);
    box.innerHTML = `<div data-card-page></div>`; // 3.99.376: only the card picture (no ZIP / PDF buttons)
    const release = new MutationObserver(() => {
      if (box.isConnected) return;
      release.disconnect();
      URL.revokeObjectURL(url);
    });
    release.observe(document.body, { childList: true, subtree: true });
    const pageBox = box.querySelector("[data-card-page]");
    let task;
    try {
      const renderer = await import("./vendor/pdfjs-4.10.38/pdf.min.mjs");
      renderer.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs-4.10.38/pdf.worker.min.mjs", document.baseURI).href;
      task = renderer.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false });
      const doc = await task.promise;
      if (!box.isConnected) return;
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(1800 / Math.max(base.width, base.height), Math.max(1, pageBox.clientWidth * 2 / base.width)) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "ID card " + card.card_no);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      // 3.99.376: cut the page down to the two card sides (no white page, no crop marks, no TRX line) and show it as a PNG
      const g = canvas.getContext("2d"), W = canvas.width, H = canvas.height, px = g.getImageData(0, 0, W, H).data;
      const ink = (i) => px[i] < 242 || px[i + 1] < 242 || px[i + 2] < 242;
      const rows = new Array(H).fill(0), cols = new Array(W).fill(0);
      for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 2) if (ink((y * W + x) * 4)) { rows[y] += 2; cols[x] += 1; }
      const rMin = W * 0.18, cMin = H * 0.06;
      let y0 = rows.findIndex((n) => n > rMin), y1 = H - 1 - [...rows].reverse().findIndex((n) => n > rMin);
      let x0 = cols.findIndex((n) => n > cMin), x1 = W - 1 - [...cols].reverse().findIndex((n) => n > cMin);
      if (y0 < 0 || x0 < 0 || y1 <= y0 || x1 <= x0) { y0 = 0; x0 = 0; y1 = H - 1; x1 = W - 1; }
      const out = document.createElement("canvas"); out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
      out.getContext("2d").drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
      const img = new Image(); img.className = "own-id-img"; img.alt = "ID card " + card.card_no; img.src = out.toDataURL("image/png");
      pageBox.replaceChildren(img);
    } catch {
      pageBox.textContent = "Your card could not be shown.";
    } finally {
      if (task) await task.destroy();
    }
  }

  // ---------- a scanned card (anyone): who it belongs to and whether it is valid ----------
  async function cardCheck(code) {
    const { data, error } = await sb.rpc("check_employee_card", { p_code: code });
    if (error) return { html: `<div class="vf-bad"><div class="vf-seal">!</div><div class="vf-title">CANNOT CHECK RIGHT NOW</div><div class="vf-sub">${esc(error.message)}</div></div>` };
    if (!data?.found) return { html: `<div class="vf-bad"><div class="vf-seal">✖</div><div class="vf-title">NOT A VALID ID CARD</div><div class="vf-sub">This card is not an ${esc(C.company.name)} employee ID card. It may be fake or damaged.</div></div>` };
    const ok = data.state === "VALID";
    return { data, html: `<div class="${ok ? "vf-ok" : "vf-bad"}"><div class="vf-seal">${ok ? ic("check") : "✖"}</div>
      <div class="vf-title">EMPLOYEE ID CARD · ${esc(data.state)}</div><div class="vf-sub">${ok ? `VERIFIED BY ${esc(C.company.name)}` : data.state === "REPLACED" ? "This card was replaced by a newer card." : data.state === "BLOCKED" ? "This card is BLOCKED (lost or stolen). Do not accept it." : data.state === "EXPIRED" ? "This card has expired." : "This card is no longer valid."}</div>
      <table class="vf-fields"><tbody>${[["Name", data.name], ["Position", data.position], ["Employee No", data.employee_no], ["Card No", data.card_no], ["Issued", mdy(data.issued_at)], ["Valid Until", mdy(data.valid_until)]]
        .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v || "—")}</td></tr>`).join("")}</tbody></table>
      <div class="vf-when">Checked ${esc(E.dateTime(new Date().toISOString()))}</div></div>` };
  }
  // from a scan inside the portal: a window with the result (the code itself is never put in the address bar)
  async function showCardCheck(code) {
    const r = await cardCheck(code);
    const open = r.data?.employee_id && E.canOpen?.("employee");
    const m = E.modal("Employee ID Card", `<div class="vf-card-check">${r.html}</div>`,
      `${open ? `<button type="button" class="btn primary" data-open>${ic("eye")} Open Employee</button>` : ""}<button type="button" class="btn" data-x>Close</button>`);
    $("[data-x]", m.el).onclick = m.close;
    if (open) $("[data-open]", m.el).onclick = () => { m.close(); location.hash = "employee/" + r.data.employee_id; };
  }

  Object.assign(E, { saveApprovedCard, retryCardPdfs, idCardTab, cardInfoBox, cardCheck, showCardCheck, idCardSheet: sheet }); // idCardSheet: for the print checks
})();
