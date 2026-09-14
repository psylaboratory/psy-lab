/*
 * Підрахунок балів за методиками.
 * Чисті функції без звертань до DOM — щоб їх можна було прогнати тестами (див. tests/).
 *
 * Підтримувані способи підрахунку (method.scoring.method):
 *   "sum"    — сума балів за пунктами шкали (з урахуванням реверсивних)
 *   "mean"   — сума, поділена на кількість пунктів шкали
 *   "linear" — Σ(plus) − Σ(minus) + constant   (формула STAI)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Scoring = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Реверсивний перерахунок: 1↔max, 2↔max−1 тощо. */
  function reverseValue(method, value) {
    const vals = method.response.values;
    return Math.min.apply(null, vals) + Math.max.apply(null, vals) - value;
  }

  /** Бал за пунктом з урахуванням реверсивного кодування. Повертає null, якщо пункт не заповнено. */
  function itemScore(method, itemId, answers) {
    const raw = answers[itemId];
    if (raw === undefined || raw === null || raw === '') return null;
    const value = Number(raw);
    if (Number.isNaN(value)) return null;
    return (method.reverse || []).indexOf(itemId) !== -1 ? reverseValue(method, value) : value;
  }

  function sumItems(method, itemIds, answers) {
    let total = 0;
    const missing = [];
    itemIds.forEach(function (id) {
      const v = itemScore(method, id, answers);
      if (v === null) missing.push(id);
      else total += v;
    });
    return { total: total, missing: missing };
  }

  function interpret(scale, value) {
    const rules = scale.interpretation || [];
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      const okMin = r.min === undefined || value >= r.min;
      const okMax = r.max === undefined || value <= r.max;
      if (okMin && okMax) return r.label;
    }
    return null;
  }

  /** Підрахунок однієї шкали. */
  function scoreScale(method, scale, answers) {
    const mode = method.scoring.method;
    let value, missing, itemIds;

    if (mode === 'linear') {
      const plus = scale.plus.map(function (n) { return 'q' + n; });
      const minus = scale.minus.map(function (n) { return 'q' + n; });
      itemIds = plus.concat(minus);
      const a = sumItems(method, plus, answers);
      const b = sumItems(method, minus, answers);
      missing = a.missing.concat(b.missing);
      value = a.total - b.total + scale.constant;
    } else {
      itemIds = scale.items;
      const s = sumItems(method, itemIds, answers);
      missing = s.missing;
      value = mode === 'mean' ? s.total / itemIds.length : s.total;
    }

    const decimals = method.scoring.round;
    if (decimals !== undefined) value = Number(value.toFixed(decimals));

    return {
      id: scale.id,
      title: scale.title,
      description: scale.description || null,
      value: value,
      range: scale.range || null,
      label: interpret(scale, value),
      itemCount: itemIds.length,
      missing: missing,
      complete: missing.length === 0
    };
  }

  /** Підрахунок усіх шкал методики. */
  function scoreMethod(method, answers) {
    return {
      id: method.id,
      title: method.title,
      subtitle: method.subtitle || null,
      scales: method.scoring.scales.map(function (s) { return scoreScale(method, s, answers); })
    };
  }

  /** Похідні показники анкети (наразі — ІМТ). */
  function computeDerived(demographics) {
    const out = {};
    const h = Number(demographics.height_cm);
    const w = Number(demographics.weight_cm);
    if (h > 0 && w > 0) out.bmi = Number((w / Math.pow(h / 100, 2)).toFixed(1));
    return out;
  }

  /**
   * Плаский запис для Google Sheets: службові поля, анкета, сирі відповіді, обчислені бали.
   * Порядок ключів стабільний — від нього залежить порядок колонок у таблиці.
   */
  function buildRecord(state, methods, scoringVersion) {
    const rec = {
      timestamp: new Date().toISOString(),
      session_id: state.sessionId,
      scoring_version: scoringVersion,
      duration_sec: Math.round((Date.now() - state.startedAt) / 1000),
      user_agent_mobile: /Mobi|Android/i.test(navigator.userAgent) ? 1 : 0
    };

    Object.keys(state.demographics).forEach(function (k) {
      const v = state.demographics[k];
      rec['d_' + k] = Array.isArray(v) ? v.join('; ') : v;
    });
    const derived = computeDerived(state.demographics);
    Object.keys(derived).forEach(function (k) { rec['d_' + k] = derived[k]; });

    methods.forEach(function (m) {
      const answers = state.answers[m.id] || {};
      m.items.forEach(function (it) {
        rec[m.id + '_' + it.id] = answers[it.id] !== undefined ? answers[it.id] : '';
      });
      scoreMethod(m, answers).scales.forEach(function (s) {
        rec[m.id + '_' + s.id + '_score'] = s.complete ? s.value : '';
      });
    });

    return rec;
  }

  return {
    reverseValue: reverseValue,
    itemScore: itemScore,
    interpret: interpret,
    scoreScale: scoreScale,
    scoreMethod: scoreMethod,
    computeDerived: computeDerived,
    buildRecord: buildRecord
  };
}));
