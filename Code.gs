/**
 * Darjeeling Primes — Cab bill database
 *
 * Setup
 * 1. Create a Google Sheet (any name).
 * 2. Extensions → Apps Script, replace the default code with this file, save.
 * 3. Deploy → New deployment → Select type: Web app.
 * 4. Execute as: Me
 * 5. Who has access: Anyone
 * 6. Deploy, authorize, then copy the Web app URL ending in /exec
 * 7. Paste that URL into the bill generator → Settings → Save connection.
 *
 * A "Bills" tab is created automatically on first use.
 */

var SHEET_NAME = 'Bills';
// Leave blank if Apps Script was opened from Extensions inside the Google Sheet.
// If the script is standalone, paste the ID from the sheet URL:
// https://docs.google.com/spreadsheets/d/THIS_PART/edit
var SPREADSHEET_ID = '';
var HEADERS = [
  'BillNo', 'BookingDate', 'GuestName', 'Contact', 'PickupDate', 'DropDate',
  'Heads', 'CabType', 'Itinerary', 'Total', 'Advance', 'Balance', 'UpdatedAt'
];

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'list';
    if (action === 'ping') return out({ ok: true, message: 'Darjeeling Primes connected' });
    if (action === 'list') return out({ ok: true, bills: listBills() });
    if (action === 'next') return out({ ok: true, billNo: nextBillNo() });
    if (action === 'save') return out(saveBill(JSON.parse(e.parameter.bill || '{}')));
    if (action === 'delete') return out(deleteBill(e.parameter.billNo));
    return out({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.action === 'ping') return out({ ok: true, message: 'Darjeeling Primes connected' });
    if (body.action === 'save') return out(saveBill(body.bill || {}));
    if (body.action === 'delete') return out(deleteBill(body.billNo));
    return out({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function out(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSpreadsheet_() {
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('This script is not attached to a sheet. Open Apps Script from Extensions inside the Google Sheet, or paste the spreadsheet ID into SPREADSHEET_ID.');
  }
  return ss;
}

function getSheet_() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#111111')
      .setFontColor('#f5c400');
    sh.setColumnWidth(1, 120);
    sh.setColumnWidth(3, 180);
    sh.setColumnWidth(9, 280);
  }
  return sh;
}

function listBills() {
  var sh = getSheet_();
  var values = sh.getDataRange().getValues();
  var bills = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (!r[0]) continue;
    bills.push({
      billNo: String(r[0]),
      bookingDate: cellText_(r[1]),
      guestName: String(r[2] || ''),
      contact: String(r[3] || ''),
      pickupDate: cellText_(r[4]),
      dropDate: cellText_(r[5]),
      heads: Number(r[6] || 0),
      cabType: String(r[7] || ''),
      itinerary: String(r[8] || ''),
      total: Number(r[9] || 0),
      advance: Number(r[10] || 0),
      balance: Number(r[11] || 0),
      updatedAt: cellText_(r[12])
    });
  }
  bills.sort(function (a, b) {
    return String(b.billNo).localeCompare(String(a.billNo));
  });
  return bills;
}

function cellText_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value || '');
}

function nextBillNo() {
  var bills = listBills();
  var max = 0;
  for (var i = 0; i < bills.length; i++) {
    var n = parseInt(String(bills[i].billNo).replace(/\D/g, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return 'DP-' + pad4_(max + 1);
}

function pad4_(n) {
  var s = String(n);
  while (s.length < 4) s = '0' + s;
  return s;
}

function saveBill(bill) {
  if (!bill || !bill.billNo) return { ok: false, error: 'Missing bill number' };
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = getSheet_();
    var values = sh.getDataRange().getValues();
    var row = [
      String(bill.billNo),
      String(bill.bookingDate || ''),
      String(bill.guestName || ''),
      String(bill.contact || ''),
      String(bill.pickupDate || ''),
      String(bill.dropDate || ''),
      Number(bill.heads || 0),
      String(bill.cabType || ''),
      String(bill.itinerary || ''),
      Number(bill.total || 0),
      Number(bill.advance || 0),
      Number(bill.balance || 0),
      new Date().toISOString()
    ];
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]) === String(bill.billNo)) {
        sh.getRange(i + 1, 1, 1, row.length).setValues([row]);
        return { ok: true, billNo: bill.billNo, updated: true };
      }
    }
    sh.appendRow(row);
    return { ok: true, billNo: bill.billNo, updated: false };
  } finally {
    lock.releaseLock();
  }
}

function deleteBill(billNo) {
  if (!billNo) return { ok: false, error: 'Missing bill number' };
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = getSheet_();
    var values = sh.getDataRange().getValues();
    for (var i = values.length - 1; i >= 1; i--) {
      if (String(values[i][0]) === String(billNo)) {
        sh.deleteRow(i + 1);
        return { ok: true, billNo: billNo };
      }
    }
    return { ok: false, error: 'Bill not found' };
  } finally {
    lock.releaseLock();
  }
}
