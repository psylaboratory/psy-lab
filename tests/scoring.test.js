/*
 * Контрольні приклади для логіки підрахунку.
 * Запуск:  node tests/scoring.test.js
 */
const fs = require('fs');
const path = require('path');
const S = require('../js/scoring.js');

const ROOT = path.join(__dirname, '..');
const load = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'methods', n + '.json'), 'utf8'));

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}\n      очікувано: ${JSON.stringify(expected)}\n      отримано:  ${JSON.stringify(actual)}`); }
}
const fill = (method, value) => {
  const a = {};
  method.items.forEach((it) => { a[it.id] = value; });
  return a;
};
const scale = (method, answers, id) =>
  S.scoreMethod(method, answers).scales.find((s) => s.id === id);

// ------------------------------------------------------------------ TAS-20
console.log('\nTAS-20');
{
  const m = load('tas20');
  // Усі «1»: 15 прямих пунктів дають по 1, 5 реверсивних — по 5 → 15 + 25 = 40
  check('усі «1» → загальний 40', scale(m, fill(m, 1), 'total').value, 40);
  check('усі «5» → загальний 80', scale(m, fill(m, 5), 'total').value, 80);
  check('усі «3» → загальний 60', scale(m, fill(m, 3), 'total').value, 60);
  check('усі «3» → межовий рівень', scale(m, fill(m, 3), 'total').label, 'Межовий (проміжний) рівень');
  check('усі «5» → високий рівень', scale(m, fill(m, 5), 'total').label, 'Високий рівень алекситимії');
  // Субшкали при всіх «1»: DIF 7×1, DDF 4×1+1×5, EOT 4×1+4×5
  const a1 = fill(m, 1);
  check('усі «1» → DIF 7', scale(m, a1, 'dif').value, 7);
  check('усі «1» → DDF 9', scale(m, a1, 'ddf').value, 9);
  check('усі «1» → EOT 24', scale(m, a1, 'eot').value, 24);
  check('сума субшкал = загальний бал',
    scale(m, a1, 'dif').value + scale(m, a1, 'ddf').value + scale(m, a1, 'eot').value,
    scale(m, a1, 'total').value);
  // Реверсивний пункт кодується дзеркально
  const a = fill(m, 3); a.q4 = 1;
  check('реверсивний q4=1 додає 5 балів', scale(m, a, 'total').value, 62);
  // Пропущений пункт
  const gap = fill(m, 3); delete gap.q7;
  check('пропущений пункт → шкала неповна', scale(m, gap, 'total').complete, false);
}

// -------------------------------------------------------------------- STAI
console.log('\nSTAI');
{
  const m = load('stai');
  const st = m.scoring.scales.find((s) => s.id === 'state');
  const tr = m.scoring.scales.find((s) => s.id === 'trait');
  const mk = (spec, plusVal, minusVal) => {
    const a = {};
    spec.plus.forEach((n) => { a['q' + n] = plusVal; });
    spec.minus.forEach((n) => { a['q' + n] = minusVal; });
    return a;
  };
  check('реактивна: максимум = 80', scale(m, mk(st, 4, 1), 'state').value, 80);
  check('реактивна: мінімум = 20', scale(m, mk(st, 1, 4), 'state').value, 20);
  check('особистісна: максимум = 80', scale(m, mk(tr, 4, 1), 'trait').value, 80);
  check('особистісна: мінімум = 20', scale(m, mk(tr, 1, 4), 'trait').value, 20);
  check('реактивна: однакові відповіді → 50', scale(m, fill(m, 2), 'state').value, 50);
  check('реактивна: максимум → високий рівень', scale(m, mk(st, 4, 1), 'state').label, 'Високий рівень тривожності');
  check('реактивна: мінімум → низький рівень', scale(m, mk(st, 1, 4), 'state').label, 'Низький рівень тривожності');
  check('шкали не перетинаються за пунктами',
    st.plus.concat(st.minus).filter((n) => tr.plus.concat(tr.minus).includes(n)).length, 0);
  check('реактивна охоплює пункти 1–20',
    st.plus.concat(st.minus).sort((x, y) => x - y),
    Array.from({ length: 20 }, (_, i) => i + 1));
  check('особистісна охоплює пункти 21–40',
    tr.plus.concat(tr.minus).sort((x, y) => x - y),
    Array.from({ length: 20 }, (_, i) => i + 21));
}

// -------------------------------------------------------------------- DEBQ
console.log('\nDEBQ');
{
  const m = load('debq');
  check('усі «3» → обмежувальна 3', scale(m, fill(m, 3), 'restrained').value, 3);
  check('усі «3» → емоціогенна 3', scale(m, fill(m, 3), 'emotional').value, 3);
  check('усі «3» → екстернальна 3', scale(m, fill(m, 3), 'external').value, 3);
  // q31 реверсивний і належить до екстернальної шкали: (9×1 + 5) / 10 = 1.4
  check('усі «1» → екстернальна 1.4', scale(m, fill(m, 1), 'external').value, 1.4);
  check('усі «1» → обмежувальна 1', scale(m, fill(m, 1), 'restrained').value, 1);
  check('кількість пунктів у шкалах 10/13/10', [
    scale(m, fill(m, 3), 'restrained').itemCount,
    scale(m, fill(m, 3), 'emotional').itemCount,
    scale(m, fill(m, 3), 'external').itemCount
  ], [10, 13, 10]);
  const all = m.scoring.scales.reduce((acc, s) => acc.concat(s.items), []);
  check('кожен пункт належить рівно одній шкалі', all.length, 33);
  check('пункти шкал не дублюються', new Set(all).size, 33);
}

// ------------------------------------------------------------------ BSQ-34
console.log('\nBSQ-34');
{
  const m = load('bsq34');
  check('усі «1» → 34 бали (мінімум)', scale(m, fill(m, 1), 'total').value, 34);
  check('усі «6» → 204 бали (максимум)', scale(m, fill(m, 6), 'total').value, 204);
  check('мінімум → занепокоєння відсутнє', scale(m, fill(m, 1), 'total').label, 'Занепокоєння формою тіла відсутнє');
  check('максимум → виражене занепокоєння', scale(m, fill(m, 6), 'total').label, 'Виражене занепокоєння формою тіла');
  check('немає реверсивних пунктів', m.reverse.length, 0);
}

// -------------------------------------------------------------------- Похідні
console.log('\nПохідні показники');
{
  check('ІМТ для 170 см / 65 кг', S.computeDerived({ height_cm: 170, weight_cm: 65 }).bmi, 22.5);
  check('ІМТ без зросту не рахується', S.computeDerived({ weight_cm: 65 }).bmi, undefined);
}

// ------------------------------------------------------ Цілісність JSON-файлів
console.log('\nЦілісність описів методик');
['debq', 'bsq34', 'tas20', 'stai'].forEach((name) => {
  const m = load(name);
  const ids = m.items.map((i) => i.id);
  check(`${name}: id пунктів унікальні`, new Set(ids).size, ids.length);
  check(`${name}: реверсивні пункти існують`,
    (m.reverse || []).filter((r) => !ids.includes(r)).length, 0);
  check(`${name}: усі тексти пунктів непорожні`,
    m.items.filter((i) => !i.text || i.text.length < 5).length, 0);
});

console.log(`\nПідсумок: ${passed} пройдено, ${failed} провалено\n`);
process.exit(failed ? 1 : 0);
