#!/usr/bin/env python3
"""
Витягує пункти методик із Word-файлу «Додатки.docx» і збирає їх у JSON-файли
каталогу methods/. Тексти пунктів беруться з документа дослівно — так виключені
помилки ручного перенабору.

Запуск:  python3 tools/build_methods.py <шлях-до-Додатки.docx>
"""
import json
import re
import sys
from pathlib import Path

import docx

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "methods"

LIKERT_5_FREQ = ["Ніколи", "Рідко", "Іноді", "Часто", "Дуже часто"]
LIKERT_5_AGREE = [
    "Цілком не погоджуюся",
    "Певною мірою не погоджуюся",
    "Важко сказати",
    "Певною мірою погоджуюся",
    "Цілком погоджуюся",
]
LIKERT_6_BSQ = ["Ніколи", "Рідко", "Інколи", "Часто", "Дуже часто", "Завжди"]
LIKERT_4_STAI = ["Ні, це не так", "Мабуть, так", "Вірно", "Цілком вірно"]


def clean(text: str) -> str:
    text = text.replace("\n", " ").strip()
    text = re.sub(r"^\d+\*?\.\s*", "", text)   # прибрати «12.» / «4*.»
    text = re.sub(r"\s+", " ", text)
    return text


def extract_debq(doc) -> list:
    """Пункти DEBQ — нумеровані абзаци між інструкцією та блоком «Ключ»."""
    items, started = [], False
    for p in doc.paragraphs:
        t = p.text.strip()
        if t.startswith("1. Якщо ви набрали вагу"):
            started = True
        if not started:
            continue
        if t.startswith("Відповіді на питання оцінюються"):
            break
        m = re.match(r"^(\d+)\.\s+(.*\S)", t)
        if m and int(m.group(1)) == len(items) + 1:
            items.append(clean(m.group(2)))
    return items


def extract_table_items(table, first_col=0, skip_rows=2) -> list:
    return [clean(r.cells[first_col].text) for r in table.rows[skip_rows:]]


def write(name: str, payload: dict) -> None:
    OUT.mkdir(exist_ok=True)
    path = OUT / f"{name}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  {path.relative_to(ROOT)}: {len(payload['items'])} пунктів")


def main(src: str) -> None:
    doc = docx.Document(src)

    debq_items = extract_debq(doc)
    bsq_items = extract_table_items(doc.tables[0], first_col=1)
    tas_items = extract_table_items(doc.tables[1], first_col=0)
    stai_s = extract_table_items(doc.tables[3], first_col=0)
    stai_t = extract_table_items(doc.tables[4], first_col=0)

    assert len(debq_items) == 33, f"DEBQ: очікувалось 33 пункти, знайдено {len(debq_items)}"
    assert len(bsq_items) == 34, f"BSQ: очікувалось 34 пункти, знайдено {len(bsq_items)}"
    assert len(tas_items) == 20, f"TAS: очікувалось 20 пунктів, знайдено {len(tas_items)}"
    assert len(stai_s) == 20 and len(stai_t) == 20, "STAI: очікувалось 20 + 20 пунктів"

    # ------------------------------------------------------------------ DEBQ
    write("debq", {
        "id": "debq",
        "version": "1.0.0",
        "title": "Голландський опитувальник харчової поведінки",
        "subtitle": "Dutch Eating Behavior Questionnaire, DEBQ",
        "source": "van Strien T. et al., 1986. Україномовна версія за матеріалами дослідження.",
        "instruction": "Перед Вами ряд питань, що стосуються поведінки, пов'язаної з прийомом їжі. "
                       "Дайте відповідь на них одним із п'яти можливих варіантів.",
        "response": {"labels": LIKERT_5_FREQ, "values": [1, 2, 3, 4, 5]},
        "items": [{"id": f"q{i+1}", "text": t} for i, t in enumerate(debq_items)],
        "reverse": ["q31"],
        "scoring": {
            "method": "mean",
            "round": 2,
            "scales": [
                {"id": "restrained", "title": "Обмежувальна харчова поведінка",
                 "items": [f"q{i}" for i in range(1, 11)],
                 "description": "Свідоме обмеження їжі задля контролю ваги."},
                {"id": "emotional", "title": "Емоціогенна харчова поведінка",
                 "items": [f"q{i}" for i in range(11, 24)],
                 "description": "Схильність їсти у відповідь на емоційний стан, а не на голод."},
                {"id": "external", "title": "Екстернальна харчова поведінка",
                 "items": [f"q{i}" for i in range(24, 34)],
                 "description": "Реакція на зовнішні харчові стимули — вигляд, запах, приклад інших."},
            ],
        },
        "note_for_researcher": "Прив'язка шкал до пунктів відповідає оригінальній методиці "
                              "van Strien (1986): 1–10 обмежувальна, 11–23 емоціогенна, 24–33 екстернальна.",
    })

    # ----------------------------------------------------------------- BSQ-34
    write("bsq34", {
        "id": "bsq34",
        "version": "1.0.0",
        "title": "Опитувальник оцінки власного тіла",
        "subtitle": "Body Shape Questionnaire, BSQ-34",
        "source": "Cooper P. J. et al., 1987. Україномовна версія за матеріалами дослідження.",
        "instruction": "Нас цікавить, як Ви почувались через свою зовнішність впродовж ОСТАННІХ ЧОТИРЬОХ ТИЖНІВ. "
                       "Будь ласка, уважно прочитайте кожне твердження та оберіть відповідний варіант. "
                       "Будь ласка, дайте відповідь на ВСІ запитання.",
        "response": {"labels": LIKERT_6_BSQ, "values": [1, 2, 3, 4, 5, 6]},
        "items": [{"id": f"q{i+1}", "text": t} for i, t in enumerate(bsq_items)],
        "reverse": [],
        "scoring": {
            "method": "sum",
            "scales": [{
                "id": "total", "title": "Загальний показник BSQ-34",
                "items": [f"q{i}" for i in range(1, 35)],
                "range": [34, 204],
                "description": "Чим вищий бал, тим негативніше сприйняття форми власного тіла.",
                "interpretation": [
                    {"max": 79, "label": "Занепокоєння формою тіла відсутнє"},
                    {"min": 80, "max": 110, "label": "Легке занепокоєння формою тіла"},
                    {"min": 111, "max": 140, "label": "Помірне занепокоєння формою тіла"},
                    {"min": 141, "label": "Виражене занепокоєння формою тіла"},
                ],
            }],
        },
        "note_for_researcher": "Межі інтерпретації наведені за Cooper et al. (1987) — звірте "
                               "з тими, що використовуються у Вашій роботі. Теоретичний діапазон 34–204.",
    })

    # ----------------------------------------------------------------- TAS-20
    write("tas20", {
        "id": "tas20",
        "version": "1.0.0",
        "title": "Торонтська шкала алекситимії",
        "subtitle": "Toronto Alexithymia Scale, TAS-20",
        "source": "Bagby R. M., Parker J. D. A., Taylor G. J., 1994. Україномовна версія за матеріалами дослідження.",
        "instruction": "Послуговуючись наведеною нижче шкалою, зазначте, наскільки Ви погоджуєтеся "
                       "чи не погоджуєтеся з переліченими твердженнями.",
        "response": {"labels": LIKERT_5_AGREE, "values": [1, 2, 3, 4, 5]},
        "items": [{"id": f"q{i+1}", "text": t} for i, t in enumerate(tas_items)],
        "reverse": ["q4", "q5", "q10", "q18", "q19"],
        "scoring": {
            "method": "sum",
            "scales": [
                {"id": "total", "title": "Загальний показник алекситимії",
                 "items": [f"q{i}" for i in range(1, 21)],
                 "range": [20, 100],
                 "interpretation": [
                     {"max": 51, "label": "Низький рівень алекситимії"},
                     {"min": 52, "max": 60, "label": "Межовий (проміжний) рівень"},
                     {"min": 61, "label": "Високий рівень алекситимії"},
                 ]},
                {"id": "dif", "title": "F1 (DIF) — труднощі ідентифікації почуттів",
                 "items": ["q1", "q3", "q6", "q7", "q9", "q13", "q14"], "range": [7, 35]},
                {"id": "ddf", "title": "F2 (DDF) — труднощі опису почуттів",
                 "items": ["q2", "q4", "q11", "q12", "q17"], "range": [5, 25]},
                {"id": "eot", "title": "F3 (EOT) — зовнішньоорієнтоване мислення",
                 "items": ["q5", "q8", "q10", "q15", "q16", "q18", "q19", "q20"], "range": [8, 40]},
            ],
        },
    })

    # ------------------------------------------------------------------ STAI
    stai_items = ([{"id": f"q{i+1}", "text": t, "block": "state"} for i, t in enumerate(stai_s)] +
                  [{"id": f"q{i+21}", "text": t, "block": "trait"} for i, t in enumerate(stai_t)])
    write("stai", {
        "id": "stai",
        "version": "1.0.0",
        "title": "Шкала оцінки рівня реактивної та особистісної тривожності",
        "subtitle": "State-Trait Anxiety Inventory, STAI",
        "source": "Spielberger C. D.; адаптація Ю. Л. Ханіна. Україномовна версія за матеріалами дослідження.",
        "instruction": "Прочитайте уважно кожне з тверджень і оберіть варіант відповіді. "
                       "Над твердженнями довго не замислюйтесь — правильних чи неправильних відповідей немає.",
        "blocks": [
            {"id": "state", "title": "Шкала самооцінки реактивної тривожності",
             "instruction": "Оберіть варіант залежно від того, як Ви себе почуваєте <strong>в даний момент</strong>."},
            {"id": "trait", "title": "Шкала самооцінки особистісної тривожності",
             "instruction": "Оберіть варіант залежно від того, як Ви себе почуваєте <strong>звичайно</strong>."},
        ],
        "response": {"labels": LIKERT_4_STAI, "values": [1, 2, 3, 4]},
        "items": stai_items,
        "reverse": [],
        "scoring": {
            "method": "linear",
            "scales": [
                {"id": "state", "title": "Реактивна (ситуативна) тривожність",
                 "plus": [3, 4, 6, 7, 9, 12, 13, 14, 17, 18],
                 "minus": [1, 2, 5, 8, 10, 11, 15, 16, 19, 20],
                 "constant": 50, "range": [20, 80],
                 "interpretation": [
                     {"max": 30, "label": "Низький рівень тривожності"},
                     {"min": 31, "max": 45, "label": "Помірний рівень тривожності"},
                     {"min": 46, "label": "Високий рівень тривожності"},
                 ]},
                {"id": "trait", "title": "Особистісна тривожність",
                 "plus": [22, 23, 24, 25, 28, 29, 31, 32, 34, 35, 37, 38, 40],
                 "minus": [21, 26, 27, 30, 33, 36, 39],
                 "constant": 35, "range": [20, 80],
                 "interpretation": [
                     {"max": 30, "label": "Низький рівень тривожності"},
                     {"min": 31, "max": 45, "label": "Помірний рівень тривожності"},
                     {"min": 46, "label": "Високий рівень тривожності"},
                 ]},
            ],
        },
    })

    print("\nГотово. JSON-файли методик оновлено.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Використання: python3 tools/build_methods.py <шлях-до-Додатки.docx>")
    main(sys.argv[1])
