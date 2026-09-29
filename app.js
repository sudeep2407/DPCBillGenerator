const STORAGE_KEY = "dp_bills_v1";
const URL_KEY = "dp_script_url";
const CABS = ["Hatchback", "Sedan", "Sumo", "Bolero", "Innova", "Innova Crysta", "Ertiga"];

const state = {
  bills: [],
  scriptUrl: localStorage.getItem(URL_KEY) || "",
  editing: false,
  deleteTarget: null,
  current: null
};

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

function todayISO() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

function isoToDMY(iso) {
  if (!iso) return "—";
  const parts = String(iso).split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function inr(value) {
  const n = Number(value || 0);
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function pad4(n) {
  return String(n).padStart(4, "0");
}

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}

function saveLocal(bills) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bills));
}

function nextLocalNo(bills) {
  const max = bills.reduce((m, b) => {
    const n = parseInt(String(b.billNo || "").replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `DP-${pad4(max + 1)}`;
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2800);
}

function setBusy(on, message) {
  $("loadingText").textContent = message || "Updating Google Sheet…";
  $("loading").classList.toggle("open", on);
  $("saveBtn").disabled = on;
}

function setStatus(live, text) {
  $("syncStatus").classList.toggle("live", live);
  $("syncLabel").textContent = text;
}

async function readJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error("Google Sheet did not return bill data. Check the Web app URL."); }
}

function sheetUrl(params) {
  const url = new URL(state.scriptUrl);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

async function sheetGet(action, extra) {
  const res = await fetch(sheetUrl({ action, ...(extra || {}) }));
  return readJson(res);
}

async function sheetWrite(payload) {
  if (payload.action === "save") {
    const data = await sheetGet("save", { bill: JSON.stringify(payload.bill) });
    if (!data.ok) throw new Error(data.error || "Sheet save failed");
    return data;
  }
  if (payload.action === "delete") {
    const data = await sheetGet("delete", { billNo: payload.billNo });
    if (!data.ok) throw new Error(data.error || "Sheet delete failed");
    return data;
  }
  throw new Error("Unknown sheet action");
}

async function refreshBills() {
  if (!state.scriptUrl) {
    state.bills = loadLocal();
    setStatus(false, " Saved on this device");
    renderHistory();
    return;
  }
  try {
    const data = await sheetGet("list");
    if (!data.ok) throw new Error(data.error || "Could not load bills");
    state.bills = data.bills || [];
    saveLocal(state.bills);
    setStatus(true, " Google Sheet connected");
  } catch (err) {
    state.bills = loadLocal();
    setStatus(false, " Sheet offline · local copy");
    toast(err.message || "Could not reach Google Sheet");
  }
  renderHistory();
}

function amountValue(id) {
  const raw = $(id).value;
  if (raw === "") return "";
  return Number(raw);
}

function formBill() {
  const total = amountValue("total");
  const advance = amountValue("advance");
  const totalNum = total === "" ? 0 : Number(total);
  const advanceNum = advance === "" ? 0 : Number(advance);
  return {
    billNo: $("billNo").value.trim(),
    bookingDate: $("bookingDate").value,
    guestName: $("guestName").value.trim(),
    contact: $("contact").value.trim(),
    pickupDate: $("pickupDate").value,
    dropDate: $("dropDate").value,
    heads: Number($("heads").value || 0),
    cabType: $("cabType").value,
    itinerary: $("itinerary").value.trim(),
    total,
    advance,
    balance: totalNum - advanceNum
  };
}

function updateBalance() {
  const bill = formBill();
  $("balanceText").textContent = inr(bill.balance);
  $("balanceText").className = bill.balance > 0 ? "due" : "paid";
  state.current = bill;
  renderBill(bill, $("liveBill"));
}

function fillForm(bill) {
  $("billNo").value = bill.billNo || "";
  $("bookingDate").value = bill.bookingDate || todayISO();
  $("guestName").value = bill.guestName || "";
  $("contact").value = bill.contact || "";
  $("pickupDate").value = bill.pickupDate || "";
  $("dropDate").value = bill.dropDate || "";
  $("heads").value = bill.heads || 1;
  $("cabType").value = CABS.includes(bill.cabType) ? bill.cabType : "Hatchback";
  $("itinerary").value = bill.itinerary || "";
  $("total").value = bill.total ?? "";
  $("advance").value = bill.advance ?? "";
  $("saveBtn").textContent = state.editing ? "Update Bill" : "Generate / Update Bill";
  $("formTitle").textContent = state.editing ? "Edit Bill" : "Create New Bill";
  updateBalance();
}

function startNew() {
  state.editing = false;
  fillForm({
    billNo: nextLocalNo(state.bills),
    bookingDate: todayISO(),
    pickupDate: todayISO(),
    dropDate: "",
    heads: 1,
    cabType: "Hatchback",
    total: "",
    advance: ""
  });
  $("saveBtn").textContent = "Generate / Update Bill";
  $("formTitle").textContent = "Create New Bill";
  showTab("new");
  $("guestName").focus();
}

function validate(bill) {
  if (!String(bill.guestName || "").trim()) return "Enter the guest name.";
  const digits = String(bill.contact || "").replace(/\D/g, "");
  if (digits.length !== 10) return "Enter a 10-digit phone number.";
  if (!bill.pickupDate) return "Enter the pick-up date.";
  if (!bill.dropDate) return "Enter the drop date.";
  if (!bill.cabType) return "Choose a cab type.";
  if (bill.total === "" || bill.total === null || Number.isNaN(Number(bill.total)) || Number(bill.total) < 0) return "Enter the total amount.";
  if (bill.advance === "" || bill.advance === null || Number.isNaN(Number(bill.advance)) || Number(bill.advance) < 0) return "Enter the advance amount.";
  return "";
}

async function saveBill() {
  const bill = formBill();
  const problem = validate(bill);
  if (problem) { toast(problem); return; }
  bill.total = Number(bill.total);
  bill.advance = Number(bill.advance);
  bill.balance = bill.total - bill.advance;

  const local = loadLocal().filter((b) => b.billNo !== bill.billNo);
  local.unshift(bill);
  saveLocal(local);
  state.bills = state.scriptUrl ? state.bills : local;

  if (state.scriptUrl) {
    setBusy(true, "Updating Google Sheet…");
    try {
      await sheetWrite({ action: "save", bill });
      await refreshBills();
      setBusy(false);
      toast(state.editing ? "Bill updated in Google Sheet" : "Bill saved to Google Sheet");
    } catch (err) {
      setBusy(false);
      const cached = loadLocal();
      const idx = cached.findIndex((b) => b.billNo === bill.billNo);
      if (idx >= 0) cached[idx] = bill; else cached.unshift(bill);
      saveLocal(cached);
      state.bills = cached;
      renderHistory();
      toast("Unable to update sheets at the moment. Please try again");
    }
  } else {
    state.bills = loadLocal();
    renderHistory();
    toast("Bill saved on this device");
  }

  state.editing = true;
  state.current = bill;
  $("saveBtn").textContent = "Update Bill";
  renderBill(bill, $("liveBill"));
}

function renderBill(bill, target) {
  if (!target) return;
  const route = esc(bill.itinerary || "—").replace(/\n/g, "<br>");
  target.innerHTML = `
    <div class="bill-top">
      <div>
        <h3>CAB BILL</h3>
        <p>Darjeeling Primes</p>
      </div>
      <div class="bill-no">${esc(bill.billNo || "DP-0000")}<small>${esc(isoToDMY(bill.bookingDate))}</small></div>
    </div>
    <hr class="bill-rule">
    <h4>Guest Details</h4>
    ${row("Guest Name", esc(bill.guestName || "—"))}
    ${row("Contact", esc(bill.contact || "—"))}
    ${row("Pick-up Date", esc(isoToDMY(bill.pickupDate)))}
    ${row("Drop Date", esc(isoToDMY(bill.dropDate)))}
    ${row("No. of Heads", esc(bill.heads || "—"))}
    ${row("Cab Type", esc(bill.cabType || "—"))}
    ${row("Booking Date", esc(isoToDMY(bill.bookingDate)))}
    ${row("Itinerary", route)}
    <h4>Payment Details</h4>
    ${row("Total Amount", esc(inr(bill.total)))}
    ${row("Advance Amount", esc(inr(bill.advance)))}
    <div class="bill-row balance-row"><span>Balance Amount</span><strong class="${Number(bill.balance) > 0 ? "due" : "paid"}">${esc(inr(bill.balance))}</strong></div>
    <div class="thanks">Thank you for choosing Darjeeling Primes.<br>Safe Journey · Happy Journey</div>
    <div class="bill-foot"><span>+91 99327 00831 / 89725 16305</span><span>www.darjeelingprimes.in</span></div>
  `;
}

function row(label, value) {
  return `<div class="bill-row"><span>${label}</span><strong>${value}</strong></div>`;
}

function summaryText(bill) {
  return [
    "DARJEELING PRIMES",
    "Cab & Travel Services",
    `Bill: ${bill.billNo}`,
    `Guest: ${bill.guestName}`,
    `Contact: ${bill.contact}`,
    `Pick-up: ${isoToDMY(bill.pickupDate)}`,
    `Drop: ${isoToDMY(bill.dropDate)}`,
    `Cab: ${bill.cabType} · ${bill.heads} heads`,
    bill.itinerary ? `Route: ${bill.itinerary.replace(/\n/g, ", ")}` : "",
    `Total: ${inr(bill.total)}`,
    `Advance: ${inr(bill.advance)}`,
    `Balance: ${inr(bill.balance)}`,
    "Thank you for choosing Darjeeling Primes.",
    "Safe Journey · Happy Journey"
  ].filter(Boolean).join("\n");
}

function renderHistory() {
  const q = ($("search").value || "").trim().toLowerCase();
  const rows = state.bills.filter((b) => {
    const hay = `${b.billNo} ${b.guestName} ${b.contact} ${b.cabType}`.toLowerCase();
    return !q || hay.includes(q);
  });
  const body = $("historyBody");
  $("emptyState").classList.toggle("hidden", rows.length > 0);
  $("historyTable").classList.toggle("hidden", rows.length === 0);
  body.innerHTML = rows.map((b) => `
    <tr>
      <td data-label="Bill no.">${esc(b.billNo)}</td>
      <td data-label="Guest">${esc(b.guestName)}</td>
      <td data-label="Contact">${esc(b.contact)}</td>
      <td data-label="Pick-up">${esc(isoToDMY(b.pickupDate))}</td>
      <td data-label="Cab">${esc(b.cabType)}</td>
      <td data-label="Total" class="money">${esc(inr(b.total))}</td>
      <td data-label="Balance" class="money ${Number(b.balance) > 0 ? "due" : "paid"}">${esc(inr(b.balance))}</td>
      <td data-label="Actions">
        <div class="row-actions">
          <button class="soft-btn" data-act="view" data-no="${esc(b.billNo)}">View</button>
          <button class="soft-btn" data-act="edit" data-no="${esc(b.billNo)}">Edit</button>
          <button class="danger-btn" data-act="delete" data-no="${esc(b.billNo)}">Delete</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function findBill(billNo) {
  return state.bills.find((b) => b.billNo === billNo);
}

function showTab(name) {
  $("newPanel").classList.toggle("hidden", name !== "new");
  $("historyPanel").classList.toggle("hidden", name !== "history");
  $("tabNew").classList.toggle("active", name === "new");
  $("tabHistory").classList.toggle("active", name === "history");
  if (name === "history") renderHistory();
}

function openModal(id) { $(id).classList.add("open"); }
function closeModal(id) { $(id).classList.remove("open"); }

function pdfMoney(value) {
  return "Rs. " + Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function downloadPdf() {
  const bill = state.current || formBill();
  if (!bill.guestName) { toast("Create a bill first."); return; }
  const JsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!JsPDF) {
    toast("PDF library not loaded. Use Print and choose Save as PDF.");
    printBill();
    return;
  }

  const doc = new JsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  const right = pageW - margin;
  let y = 12;

  doc.setFillColor(17, 17, 17);
  doc.rect(margin, y, pageW - margin * 2, 30, "F");
  doc.setTextColor(245, 196, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("DARJEELING PRIMES", margin + 6, y + 11);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Cab & Travel Services", margin + 6, y + 17);
  doc.setFontSize(9);
  doc.setTextColor(226, 226, 226);
  doc.text("+91 99327 00831 / 89725 16305   ·   www.darjeelingprimes.in", margin + 6, y + 24);

  y = 52;
  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("CAB BILL", margin, y);
  doc.setFontSize(12);
  doc.text(String(bill.billNo || ""), right, y, { align: "right" });
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(111, 107, 100);
  doc.text("Darjeeling Primes", margin, y);
  doc.text(isoToDMY(bill.bookingDate), right, y, { align: "right" });
  y += 4;
  doc.setDrawColor(230, 168, 23);
  doc.setLineWidth(0.9);
  doc.line(margin, y, right, y);
  y += 10;

  const section = (title) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(20, 20, 20);
    doc.text(title, margin, y);
    y += 8;
  };
  const line = (label, value) => {
    const text = String(value || "—");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    const lines = doc.splitTextToSize(text, 95);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(95, 91, 85);
    doc.text(label, margin, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(20, 20, 20);
    doc.text(lines, right, y, { align: "right" });
    y += Math.max(7, lines.length * 5);
    doc.setDrawColor(238, 234, 227);
    doc.setLineWidth(0.2);
    doc.line(margin, y - 2.5, right, y - 2.5);
  };

  section("Guest Details");
  line("Guest Name", bill.guestName);
  line("Contact", bill.contact);
  line("Pick-up Date", isoToDMY(bill.pickupDate));
  line("Drop Date", isoToDMY(bill.dropDate));
  line("No. of Heads", bill.heads);
  line("Cab Type", bill.cabType);
  line("Booking Date", isoToDMY(bill.bookingDate));
  line("Itinerary", (bill.itinerary || "—").replace(/\n/g, ", "));

  y += 4;
  section("Payment Details");
  line("Total Amount", pdfMoney(bill.total));
  line("Advance Amount", pdfMoney(bill.advance));

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(20, 20, 20);
  doc.text("Balance Amount", margin, y + 1);
  doc.setFontSize(14);
  if (Number(bill.balance) > 0) doc.setTextColor(197, 54, 74);
  else doc.setTextColor(31, 122, 69);
  doc.text(pdfMoney(bill.balance), right, y + 1, { align: "right" });

  y += 16;
  doc.setTextColor(122, 118, 111);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Thank you for choosing Darjeeling Primes.", pageW / 2, y, { align: "center" });
  doc.text("Safe Journey  ·  Happy Journey", pageW / 2, y + 6, { align: "center" });

  const safeName = String(bill.guestName).replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
  doc.save(`${bill.billNo}-${safeName || "bill"}.pdf`);
  toast("PDF downloaded");
}

function printBill() {
  const bill = state.current || formBill();
  renderBill(bill, $("printSheet"));
  window.print();
}

function whatsAppBill() {
  const bill = state.current || formBill();
  if (!bill.guestName) { toast("Create a bill first."); return; }
  let phone = String(bill.contact || "").replace(/\D/g, "");
  if (phone.length === 10) phone = "91" + phone;
  const text = encodeURIComponent(summaryText(bill));
  const url = phone.length >= 12 ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
  window.open(url, "_blank", "noopener");
}

async function copySummary() {
  const bill = state.current || formBill();
  try {
    await navigator.clipboard.writeText(summaryText(bill));
    toast("Bill summary copied");
  } catch {
    toast("Could not copy. Select the bill and copy it manually.");
  }
}

function bind() {
  ["total", "advance", "guestName", "contact", "pickupDate", "dropDate", "heads", "cabType", "itinerary", "bookingDate"]
    .forEach((id) => $(id).addEventListener("input", updateBalance));

  $("billForm").addEventListener("submit", (e) => { e.preventDefault(); saveBill(); });
  $("newBillBtn").addEventListener("click", startNew);
  $("tabNew").addEventListener("click", startNew);
  $("tabHistory").addEventListener("click", () => showTab("history"));
  $("search").addEventListener("input", renderHistory);
  $("pdfBtn").addEventListener("click", downloadPdf);
  $("waBtn").addEventListener("click", whatsAppBill);
  $("openSettings").addEventListener("click", () => {
    $("scriptUrl").value = state.scriptUrl;
    openModal("settingsModal");
  });

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.getAttribute("data-close")));
  });
  document.querySelectorAll(".modal-back").forEach((modal) => {
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("open"); });
  });

  $("historyBody").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const bill = findBill(btn.dataset.no);
    if (!bill) return;
    if (btn.dataset.act === "view") {
      state.current = bill;
      renderBill(bill, $("modalBill"));
      openModal("viewModal");
    }
    if (btn.dataset.act === "edit") {
      state.editing = true;
      state.current = bill;
      fillForm(bill);
      showTab("new");
      toast(`Editing ${bill.billNo}`);
    }
    if (btn.dataset.act === "delete") {
      state.deleteTarget = bill.billNo;
      $("deleteText").textContent = `Delete ${bill.billNo} for ${bill.guestName}? This cannot be undone.`;
      openModal("deleteModal");
    }
  });

  $("confirmDelete").addEventListener("click", deleteCurrent);
  $("saveSettings").addEventListener("click", saveSettings);
  $("testSettings").addEventListener("click", testSettings);
  $("modalPdf").addEventListener("click", async () => {
    renderBill(state.current, $("printSheet"));
    await downloadPdf();
  });
  $("modalWa").addEventListener("click", whatsAppBill);
}

async function deleteCurrent() {
  const billNo = state.deleteTarget;
  if (!billNo) return;
  const next = state.bills.filter((b) => b.billNo !== billNo);
  saveLocal(next);
  state.bills = next;
  if (state.scriptUrl) {
    setBusy(true, "Updating Google Sheet…");
    try {
      await sheetWrite({ action: "delete", billNo });
      setBusy(false);
      toast("Bill deleted from Google Sheet");
    } catch {
      setBusy(false);
      toast("Unable to update sheets at the moment. Please try again");
    }
  } else {
    toast("Bill deleted");
  }
  closeModal("deleteModal");
  renderHistory();
  if (state.current && state.current.billNo === billNo) startNew();
}

async function saveSettings() {
  const url = $("scriptUrl").value.trim();
  if (url && !url.includes("/exec")) {
    toast("Use the deployed Web app URL ending in /exec");
    return;
  }
  state.scriptUrl = url;
  if (url) localStorage.setItem(URL_KEY, url);
  else localStorage.removeItem(URL_KEY);
  closeModal("settingsModal");
  await refreshBills();
  toast(url ? "Google Sheet connected" : "Using this device only");
}

async function testSettings() {
  const url = $("scriptUrl").value.trim();
  if (!url) { toast("Paste the Web app URL first."); return; }
  try {
    const join = url.includes("?") ? "&" : "?";
    const res = await fetch(`${url}${join}action=ping`);
    const data = await readJson(res);
    if (!data.ok) throw new Error(data.error || "Ping failed");
    toast("Connection works");
  } catch (err) {
    toast(err.message || "Connection failed");
  }
}

function initCabSelect() {
  $("cabType").innerHTML = CABS.map((cab) => `<option>${cab}</option>`).join("");
}

async function init() {
  initCabSelect();
  bind();
  await refreshBills();
  startNew();
}

init();
