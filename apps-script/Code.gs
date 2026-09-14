/** Psy_Lab — приймач відповідей для Google Sheets. Інструкція з розгортання — у README. */

function doPost(e) {
  var LOCK_TIMEOUT_MS = 30000;
  var lock = LockService.getScriptLock();

  try {
    // Без блокування два одночасні надсилання можуть записатися в один рядок.
    lock.waitLock(LOCK_TIMEOUT_MS);

    if (!e || !e.postData || !e.postData.contents) {
      return json({ ok: false, error: 'empty_body' });
    }

    var record = JSON.parse(e.postData.contents);
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return json({ ok: false, error: 'bad_payload' });
    }

    var sheet = getSheet();
    var header = readHeader(sheet);

    // Нові поля (наприклад, додана методика) дописуються як нові колонки праворуч.
    var incoming = Object.keys(record);
    var added = incoming.filter(function (k) { return header.indexOf(k) === -1; });
    if (added.length) {
      header = header.concat(added);
      sheet.getRange(1, 1, 1, header.length).setValues([header]);
      sheet.setFrozenRows(1);
    }

    var row = header.map(function (key) {
      var v = record[key];
      if (v === undefined || v === null) return '';
      // Рядок з провідним «=», «+», «-» або «@» Sheets сприйме як формулу.
      if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
      return v;
    });

    sheet.appendRow(row);
    return json({ ok: true, row: sheet.getLastRow() });

  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}


/** Перевірка життєздатності: відкрийте URL веб-застосунку у браузері. */
function doGet() {
  try {
    var sheet = getSheet();
    return json({
      ok: true,
      service: 'psylab-collector',
      responses: Math.max(0, sheet.getLastRow() - 1)
    });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}


/** Аркуш, у який пишуться відповіді. Створюється автоматично при першому надсиланні. */
function getSheet() {
  var SHEET_NAME = 'responses';
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) {
    throw new Error('Скрипт не прив’язаний до таблиці. Відкрийте його через ' +
                    'Google Sheets → Розширення → Apps Script, а не як окремий проєкт.');
  }

  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  return sheet;
}


function readHeader(sheet) {
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .filter(function (v) { return v !== '' && v !== null; })
    .map(String);
}


function json(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * Разова перевірка без браузера: запустіть цю функцію з редактора Apps Script
 * (кнопка «Виконати») і подивіться, чи зʼявився тестовий рядок у таблиці.
 * Потім видаліть його вручну.
 */
function testAppend() {
  var fake = {
    postData: {
      contents: JSON.stringify({
        timestamp: new Date().toISOString(),
        session_id: 'TEST-' + Date.now(),
        scoring_version: 'test',
        duration_sec: 0,
        d_age: 30,
        d_sex: 'Жіноча',
        debq_q1: 3,
        debq_restrained_score: 3
      })
    }
  };
  Logger.log(doPost(fake).getContent());
}
