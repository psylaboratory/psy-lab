/*
 * Psy_Lab — рушій опитування.
 *
 * Порядок роботи:
 *   початок → анкета → методики (посторінково) → підрахунок у браузері →
 *   показ результатів → фонове надсилання в Google Sheets.
 *
 * Підрахунок виконується ДО надсилання, тому респондент бачить свій результат
 * навіть тоді, коли мережа підвела і дані не дійшли до таблиці.
 */
(function () {
  'use strict';

  const CFG = window.PSYLAB_CONFIG;
  const STORAGE_KEY = 'psylab.progress.v1';
  const $ = (id) => document.getElementById(id);

  let methods = [];
  let demographics = null;
  let steps = [];
  let stepIndex = 0;
  let warnedOnStep = false;

  const state = {
    sessionId: null,
    startedAt: Date.now(),
    demographics: {},
    answers: {}
  };

  /* ============================================================ утиліти */

  function newSessionId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'sid-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        sessionId: state.sessionId, startedAt: state.startedAt,
        demographics: state.demographics, answers: state.answers,
        stepIndex: stepIndex, version: CFG.scoringVersion
      }));
    } catch (e) { /* приватний режим браузера — просто працюємо без збереження */ }
  }

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      return d && d.version === CFG.scoringVersion ? d : null;
    } catch (e) { return null; }
  }

  function clearProgress() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* нічого */ }
  }

  function show(screenId) {
    ['screen-intro', 'screen-demographics', 'screen-method', 'screen-results']
      .forEach((id) => { $(id).hidden = (id !== screenId); });
    window.scrollTo({ top: 0, behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
  }

  function itemNumber(itemId) { return itemId.replace(/^q/, ''); }

  /* ======================================================= крок за кроком */

  function buildSteps() {
    const list = [{ type: 'demographics' }];
    methods.forEach(function (m, mi) {
      const blocks = m.blocks || [{ id: null, title: null, instruction: m.instruction }];
      blocks.forEach(function (b) {
        const items = b.id ? m.items.filter(function (i) { return i.block === b.id; }) : m.items;
        for (let i = 0; i < items.length; i += CFG.itemsPerPage) {
          list.push({
            type: 'items',
            method: m,
            methodIndex: mi,
            block: b,
            items: items.slice(i, i + CFG.itemsPerPage),
            from: i + 1,
            to: Math.min(i + CFG.itemsPerPage, items.length),
            blockTotal: items.length
          });
        }
      });
    });
    return list;
  }

  function updateProgress() {
    const pct = Math.round((stepIndex / steps.length) * 100);
    $('progress-bar').style.width = pct + '%';
    $('progress-label').textContent = 'Крок ' + Math.min(stepIndex + 1, steps.length) + ' з ' + steps.length;
  }

  function goTo(index) {
    stepIndex = Math.max(0, Math.min(index, steps.length));
    warnedOnStep = false;
    saveProgress();
    updateProgress();

    if (stepIndex >= steps.length) { finish(); return; }
    const step = steps[stepIndex];
    if (step.type === 'demographics') { renderDemographics(); show('screen-demographics'); }
    else { renderItems(step); show('screen-method'); }
  }

  /* ============================================================== анкета */

  function renderDemographics() {
    // Інструкція навмисно не дублюється тут — вона показана на вступному екрані.
    const root = $('demo-fields');
    if (root.dataset.rendered) return;
    root.dataset.rendered = '1';
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
    root.style.gap = '1.5rem';

    demographics.sections.forEach(function (section) {
      const panel = document.createElement('div');
      panel.className = 'panel';

      const title = document.createElement('p');
      title.className = 'panel__title';
      title.textContent = section.title;
      panel.appendChild(title);

      if (section.note) {
        const note = document.createElement('p');
        note.className = 'lede';
        note.style.fontSize = '0.9rem';
        note.textContent = section.note;
        panel.appendChild(note);
      }

      section.fields.forEach(function (f) { panel.appendChild(renderField(f)); });
      root.appendChild(panel);
    });
  }

  function renderField(f) {
    const wrap = document.createElement('div');
    wrap.className = 'field';

    const label = document.createElement('label');
    label.className = 'field__label';
    label.setAttribute('for', 'f-' + f.id);
    label.textContent = f.label + ' ';
    if (!f.required) {
      const opt = document.createElement('span');
      opt.className = 'opt';
      opt.textContent = '(необов’язково)';
      label.appendChild(opt);
    }
    wrap.appendChild(label);

    if (f.type === 'number' || f.type === 'text') {
      const input = document.createElement('input');
      input.type = f.type;
      input.id = 'f-' + f.id;
      if (f.min !== undefined) input.min = f.min;
      if (f.max !== undefined) input.max = f.max;
      if (f.step) input.step = f.step;
      input.value = state.demographics[f.id] !== undefined ? state.demographics[f.id] : '';
      input.addEventListener('input', function () {
        state.demographics[f.id] = input.value === '' ? undefined : Number(input.value);
        if (input.value === '') delete state.demographics[f.id];
        saveProgress();
      });
      wrap.appendChild(input);
      return wrap;
    }

    const list = document.createElement('div');
    list.className = 'choice-list';
    list.id = 'f-' + f.id;

    f.options.forEach(function (optText, i) {
      const row = document.createElement('label');
      row.className = 'choice';
      const input = document.createElement('input');
      input.type = f.type === 'checkbox' ? 'checkbox' : 'radio';
      input.name = 'f-' + f.id;
      input.value = optText;

      const current = state.demographics[f.id];
      if (f.type === 'checkbox') input.checked = Array.isArray(current) && current.indexOf(optText) !== -1;
      else input.checked = current === optText;

      input.addEventListener('change', function () {
        if (f.type === 'checkbox') {
          let vals = Array.isArray(state.demographics[f.id]) ? state.demographics[f.id].slice() : [];
          const exclusive = f.exclusive || [];
          if (input.checked) {
            if (exclusive.indexOf(optText) !== -1) vals = [optText];
            else vals = vals.filter(function (v) { return exclusive.indexOf(v) === -1; }).concat([optText]);
          } else {
            vals = vals.filter(function (v) { return v !== optText; });
          }
          state.demographics[f.id] = vals;
          // синхронізувати вигляд після взаємовиключних варіантів
          list.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
            cb.checked = vals.indexOf(cb.value) !== -1;
          });
        } else {
          state.demographics[f.id] = optText;
        }
        saveProgress();
      });

      const span = document.createElement('span');
      span.textContent = optText;
      row.appendChild(input);
      row.appendChild(span);
      list.appendChild(row);
    });

    if (f.other) {
      const row = document.createElement('label');
      row.className = 'choice';
      const span = document.createElement('span');
      span.style.flex = '1';
      span.textContent = 'Інше: ';
      const input = document.createElement('input');
      input.type = 'text';
      input.style.marginTop = '0.35rem';
      input.value = state.demographics[f.id + '_other'] || '';
      input.addEventListener('input', function () {
        state.demographics[f.id + '_other'] = input.value;
        saveProgress();
      });
      span.appendChild(input);
      row.appendChild(span);
      list.appendChild(row);
    }

    wrap.appendChild(list);
    return wrap;
  }

  function demographicsValid() {
    const missing = [];
    demographics.sections.forEach(function (s) {
      s.fields.forEach(function (f) {
        if (!f.required) return;
        const v = state.demographics[f.id];
        if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) missing.push(f.label);
      });
    });
    return missing;
  }

  /* ========================================================= пункти методик */

  function renderItems(step) {
    const m = step.method;
    // Скісна риска, а не «з»: у верхньому регістрі «З» не відрізнити від цифри 3.
    $('method-eyebrow').textContent = 'Методика ' + (step.methodIndex + 1) + ' / ' + methods.length;
    $('method-title').textContent = step.block && step.block.title ? step.block.title : m.title;
    $('method-subtitle').textContent = m.subtitle || '';
    $('method-instruction').innerHTML = (step.block && step.block.instruction) || m.instruction;

    const root = $('method-items');
    root.textContent = '';
    const answers = state.answers[m.id] || (state.answers[m.id] = {});

    step.items.forEach(function (item) {
      const card = document.createElement('div');
      card.className = 'item';
      card.dataset.itemId = item.id;

      const num = document.createElement('div');
      num.className = 'item__num';
      num.textContent = itemNumber(item.id) + '.';

      const text = document.createElement('div');
      text.className = 'item__text';
      text.textContent = item.text;

      const opts = document.createElement('div');
      opts.className = 'item__options';
      opts.setAttribute('role', 'group');
      opts.setAttribute('aria-label', item.text);

      m.response.labels.forEach(function (labelText, i) {
        const value = m.response.values[i];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'opt-btn';
        btn.id = m.id + '-' + item.id + '-' + value;
        btn.setAttribute('aria-pressed', answers[item.id] === value ? 'true' : 'false');

        const lab = document.createElement('span');
        lab.textContent = labelText;
        const val = document.createElement('span');
        val.className = 'opt-btn__value';
        val.textContent = value;
        btn.appendChild(lab);
        btn.appendChild(val);

        btn.addEventListener('click', function () {
          answers[item.id] = value;
          opts.querySelectorAll('.opt-btn').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
          btn.setAttribute('aria-pressed', 'true');
          card.classList.remove('item--unanswered');
          saveProgress();
          updateItemStatus(step);
        });

        opts.appendChild(btn);
      });

      card.appendChild(num);
      card.appendChild(text);
      card.appendChild(opts);
      root.appendChild(card);
    });

    $('btn-method-back').style.visibility = stepIndex === 0 ? 'hidden' : 'visible';
    $('btn-method-next').textContent = stepIndex === steps.length - 1 ? 'Завершити' : 'Далі';
    updateItemStatus(step);
  }

  function unansweredOnStep(step) {
    const answers = state.answers[step.method.id] || {};
    return step.items.filter(function (i) { return answers[i.id] === undefined; });
  }

  function updateItemStatus(step) {
    const left = unansweredOnStep(step).length;
    const el = $('method-status');
    el.classList.remove('pager__status--warn');
    el.textContent = left === 0
      ? 'Твердження ' + step.from + '–' + step.to + ' з ' + step.blockTotal
      : 'Без відповіді: ' + left;
    if (left) el.classList.add('pager__status--warn');
  }

  /* ========================================================== результати */

  function levelOf(index, total) {
    if (total <= 1) return 1;
    if (index === 0) return 0;
    if (index === total - 1) return 2;
    return 1;
  }

  function scaleRange(method, scale) {
    if (scale.range) return scale.range;
    const vals = method.response.values;
    return [Math.min.apply(null, vals), Math.max.apply(null, vals)];
  }

  function buildMeter(method, scaleSpec, result) {
    const range = scaleRange(method, scaleSpec);
    const lo = range[0], hi = range[1];
    const meter = document.createElement('div');
    meter.className = 'meter';

    const track = document.createElement('div');
    track.className = 'meter__track';
    const rules = scaleSpec.interpretation || [];
    if (rules.length) {
      let cursor = lo;
      rules.forEach(function (r, i) {
        const end = (i === rules.length - 1 || r.max === undefined) ? hi : r.max;
        const band = document.createElement('div');
        band.className = 'meter__band';
        band.dataset.level = levelOf(i, rules.length);
        band.style.width = Math.max(0, ((end - cursor) / (hi - lo)) * 100) + '%';
        track.appendChild(band);
        cursor = end;
      });
    }
    meter.appendChild(track);

    const pin = document.createElement('div');
    pin.className = 'meter__pin';
    const pct = Math.max(0, Math.min(100, ((result.value - lo) / (hi - lo)) * 100));
    pin.style.left = pct + '%';
    pin.title = String(result.value);
    meter.appendChild(pin);

    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '0.2rem';
    wrap.appendChild(meter);

    const ends = document.createElement('div');
    ends.className = 'meter__ends';
    const a = document.createElement('span'); a.textContent = lo;
    const b = document.createElement('span'); b.textContent = hi;
    ends.appendChild(a); ends.appendChild(b);
    wrap.appendChild(ends);
    return wrap;
  }

  function renderResults() {
    const root = $('results-body');
    root.textContent = '';

    const started = new Date(state.startedAt);
    const mins = Math.max(1, Math.round((Date.now() - state.startedAt) / 60000));
    $('results-meta').textContent =
      'Пройдено ' + started.toLocaleDateString('uk-UA') + ' · тривалість ' + mins + ' хв · номер сесії ' + state.sessionId.slice(0, 8);

    methods.forEach(function (m) {
      const scored = window.Scoring.scoreMethod(m, state.answers[m.id] || {});
      const box = document.createElement('section');
      box.className = 'result-method';

      const head = document.createElement('div');
      head.className = 'result-method__head';
      const h2 = document.createElement('h2');
      h2.textContent = m.title;
      const sub = document.createElement('div');
      sub.className = 'result-method__sub';
      sub.textContent = m.subtitle || '';
      head.appendChild(h2);
      head.appendChild(sub);
      box.appendChild(head);

      scored.scales.forEach(function (res, idx) {
        const spec = m.scoring.scales[idx];
        const row = document.createElement('div');
        row.className = 'scale';

        const top = document.createElement('div');
        top.className = 'scale__top';
        const name = document.createElement('div');
        name.className = 'scale__name';
        name.textContent = res.title;
        const value = document.createElement('div');
        value.className = 'scale__value';
        value.textContent = res.complete ? res.value : '—';
        top.appendChild(name);
        top.appendChild(value);
        row.appendChild(top);

        if (res.description) {
          const d = document.createElement('div');
          d.className = 'scale__desc';
          d.textContent = res.description;
          row.appendChild(d);
        }

        if (res.complete) {
          row.appendChild(buildMeter(m, spec, res));
          if (res.label) {
            const rules = spec.interpretation || [];
            let lvl = 1;
            rules.forEach(function (r, i) {
              if (r.label === res.label) lvl = levelOf(i, rules.length);
            });
            const lab = document.createElement('div');
            lab.className = 'scale__label';
            lab.dataset.level = lvl;
            lab.textContent = res.label;
            row.appendChild(lab);
          }
        } else {
          const warn = document.createElement('div');
          warn.className = 'scale__desc';
          warn.textContent = 'Бал не обчислено: без відповіді залишилось тверджень — ' + res.missing.length + '.';
          row.appendChild(warn);
        }

        box.appendChild(row);
      });

      root.appendChild(box);
    });
  }

  /* =========================================================== надсилання */

  function submit(record, attempt) {
    attempt = attempt || 1;
    const status = $('save-status');

    if (!CFG.appsScriptUrl) {
      status.textContent = 'Демонстраційний режим: адресу для збереження не налаштовано, дані не надсилались.';
      return;
    }

    status.textContent = 'Надсилання відповідей…';
    fetch(CFG.appsScriptUrl, {
      method: 'POST',
      // text/plain робить запит «простим» — браузер не шле preflight OPTIONS,
      // який Apps Script не вміє обробляти.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(record),
      redirect: 'follow'
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function () {
      status.textContent = 'Відповіді збережено. Дякуємо за участь.';
      clearProgress();
    }).catch(function () {
      if (attempt < CFG.submitRetries) {
        status.textContent = 'Спроба надіслати відповіді ще раз (' + (attempt + 1) + ')…';
        setTimeout(function () { submit(record, attempt + 1); }, attempt * 2000);
      } else {
        status.textContent = 'Не вдалося надіслати відповіді — імовірно, через мережу. ' +
          'Ваші результати на екрані повні, їх можна зберегти у PDF.';
      }
    });
  }

  function finish() {
    show('screen-results');
    $('progress-bar').style.width = '100%';
    $('progress-label').textContent = 'Завершено';
    renderResults();
    submit(window.Scoring.buildRecord(state, methods, CFG.scoringVersion));
  }

  /* ====================================================== збереження копії */

  function downloadHtml() {
    const results = $('screen-results').cloneNode(true);
    results.querySelectorAll('.no-print').forEach(function (n) { n.remove(); });
    results.removeAttribute('hidden');

    const css = [
      'body{font-family:Georgia,serif;max-width:40rem;margin:2rem auto;padding:0 1.25rem;color:#17211f;background:#fff;line-height:1.6}',
      'h1{font-size:1.5rem}h2{font-size:1.15rem;margin:0}',
      '.scale{padding:.8rem 0;border-bottom:1px dotted #dce2df;display:flex;flex-direction:column;gap:.4rem}',
      '.scale__top{display:flex;justify-content:space-between;align-items:baseline;gap:1rem}',
      '.scale__value{font-family:monospace;font-size:1.4rem}',
      '.scale__desc,.result-method__sub{color:#5b6a67;font-size:.9rem}',
      '.scale__label{font-weight:600}',
      '.disclaimer{border:1px solid #c3ccc8;border-left:3px solid #9b6f26;padding:1rem;margin:1.5rem 0}',
      '.meter,.meter__ends{display:none}',
      '.result-method{margin-bottom:1.75rem}',
      '.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:.72rem;color:#1f5f5b}'
    ].join('');

    const doc = '<!DOCTYPE html><html lang="uk"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>Результати проходження — ' + state.sessionId.slice(0, 8) + '</title>' +
      '<style>' + css + '</style></head><body>' + results.innerHTML + '</body></html>';

    const blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rezultaty-' + state.sessionId.slice(0, 8) + '.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ================================================================ запуск */

  function bindStart() {
    $('btn-start').addEventListener('click', function () {
      state.sessionId = state.sessionId || newSessionId();
      state.startedAt = Date.now();
      goTo(0);
    });
  }

  function bindNav() {
    $('btn-demo-next').addEventListener('click', function () {
      const missing = demographicsValid();
      if (missing.length) {
        $('demo-status').textContent = 'Заповніть обов’язкові поля: ' + missing.join(', ');
        $('demo-status').classList.add('pager__status--warn');
        return;
      }
      goTo(stepIndex + 1);
    });

    $('btn-method-back').addEventListener('click', function () { goTo(stepIndex - 1); });

    $('btn-method-next').addEventListener('click', function () {
      const step = steps[stepIndex];
      const left = unansweredOnStep(step);
      if (left.length && !warnedOnStep) {
        warnedOnStep = true;
        left.forEach(function (i) {
          const card = document.querySelector('.item[data-item-id="' + i.id + '"]');
          if (card) card.classList.add('item--unanswered');
        });
        const el = $('method-status');
        el.classList.add('pager__status--warn');
        el.textContent = 'Без відповіді: ' + left.length + '. Натисніть «Далі» ще раз, щоб пропустити.';
        return;
      }
      goTo(stepIndex + 1);
    });

    $('btn-print').addEventListener('click', function () { window.print(); });
    $('btn-download-html').addEventListener('click', downloadHtml);
  }

  function offerResume() {
    const saved = loadProgress();
    if (!saved || !saved.stepIndex) return false;
    const panel = document.createElement('div');
    panel.className = 'panel panel--quiet';
    panel.innerHTML =
      '<p class="panel__title">Незавершене проходження</p>' +
      '<p class="lede">Схоже, Ви вже починали це опитування на цьому пристрої. ' +
      'Відповіді збереглися лише у Вашому браузері й нікуди не надсилались.</p>';
    const actions = document.createElement('div');
    actions.className = 'actions';

    const cont = document.createElement('button');
    cont.className = 'btn';
    cont.textContent = 'Продовжити з місця зупинки';
    cont.addEventListener('click', function () {
      state.sessionId = saved.sessionId;
      state.startedAt = saved.startedAt;
      state.demographics = saved.demographics || {};
      state.answers = saved.answers || {};
      goTo(saved.stepIndex);
    });

    const fresh = document.createElement('button');
    fresh.className = 'btn btn--ghost';
    fresh.textContent = 'Почати заново';
    fresh.addEventListener('click', function () {
      clearProgress();
      panel.remove();
    });

    actions.appendChild(cont);
    actions.appendChild(fresh);
    panel.appendChild(actions);
    $('screen-intro').prepend(panel);
    return true;
  }

  function fail(message) {
    document.querySelector('main').innerHTML =
      '<section class="screen"><div class="prose"><h1>Не вдалося завантажити опитувальники</h1>' +
      '<p class="lede">' + message + '</p></div></section>';
  }

  function init() {
    state.sessionId = newSessionId();
    $('footer-version').textContent = 'версія ключів ' + CFG.scoringVersion;

    const files = ['demographics'].concat(CFG.methods);
    Promise.all(files.map(function (n) {
      return fetch('methods/' + n + '.json').then(function (r) {
        if (!r.ok) throw new Error(n);
        return r.json();
      });
    })).then(function (loaded) {
      demographics = loaded[0];
      methods = loaded.slice(1);
      steps = buildSteps();
      bindStart();
      bindNav();
      offerResume();
      updateProgress();
      $('progress-label').textContent = 'Перед початком';
    }).catch(function () {
      fail('Перевірте, що сайт відкрито через веб-сервер, а не як локальний файл: ' +
           'браузер не дозволяє читати JSON-файли з file://. Для локальної перевірки ' +
           'запустіть у теці проєкту python3 -m http.server і відкрийте localhost:8000.');
    });
  }

  document.addEventListener('DOMContentLoaded', init);
}());
