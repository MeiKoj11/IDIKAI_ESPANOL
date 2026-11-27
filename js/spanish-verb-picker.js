/*
  spanish-verb-picker.js
  -----------------------
  The "which verbs?" section shared by the Spanish conjugation test and
  sentence test: where they come from (common verbs, your saved verbs, or
  both), which kind (regular, irregular, or both), and optionally single
  verbs unticked from the result.

  "Irregular" is judged on the whole verb: any tense that departs from
  the ordinary pattern, stem changes included.
*/

(function (root) {
  // The pool for a set of choices, with no page involved.
  // choices = { common, saved, themeIds: Set, regular, irregular }
  function buildPool(choices, savedWords) {
    const pool = [];
    const byName = new Map();
    const add = (verb) => {
      if (byName.has(verb.infinitive)) return byName.get(verb.infinitive);
      const copy = Object.assign({}, verb, { irregular: root.SpanishConjugator.isIrregular(verb) });
      byName.set(verb.infinitive, copy);
      pool.push(copy);
      return copy;
    };
    if (choices.common) root.SpanishConjugator.VERBS.forEach(add);
    if (choices.saved) {
      const words = savedWords.filter((w) => choices.themeIds.has(w.themeId));
      root.SpanishConjugator.verbsForSavedWords(words).forEach((verb) => {
        add(verb).fromVocab = true;
      });
    }
    return pool.filter((v) => (v.irregular ? choices.irregular : choices.regular));
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // A labelled tick box. `key` is the immersion translation key, if any.
  function checkbox(text, checked, key) {
    const label = el("label", "tenses-test-checkbox");
    const input = el("input");
    input.type = "checkbox";
    input.checked = checked;
    const span = el("span", "", text);
    if (key) span.dataset.immersionKey = key;
    label.append(input, span);
    return { label, input };
  }

  function groupHeading(text, key) {
    const p = el("p", "tenses-test-group-heading", text);
    p.dataset.immersionKey = key;
    return p;
  }

  function mount(container) {
    const savedWords = Storage.getVerbWords("es");
    const themes = Storage.getThemes()
      .filter((t) => t.language === "es")
      .map((t) => ({
        theme: t,
        count: root.SpanishConjugator.verbsForSavedWords(savedWords.filter((w) => w.themeId === t.id)).length,
      }))
      .filter((t) => t.count);
    const hasSaved = themes.length > 0;

    // Verbs the learner has unticked one by one; kept while other choices change.
    const excluded = new Set();

    container.innerHTML = "";

    container.appendChild(groupHeading("Verbs from", "verbsFromLabel"));
    const sources = el("div", "tenses-test-checkboxes-inline");
    const common = checkbox("Most commonly used verbs", true, "commonVerbsCheckbox");
    const saved = checkbox("My saved verbs", hasSaved, "mySavedVerbsCheckbox");
    saved.input.disabled = !hasSaved;
    sources.append(common.label, saved.label);
    container.appendChild(sources);

    const themeWrap = el("div", "verb-picker-themes");
    const themeBoxes = themes.map(({ theme, count }) => {
      const box = checkbox(`${theme.name} (${count})`, true);
      box.input.value = theme.id;
      themeWrap.appendChild(box.label);
      return box.input;
    });
    container.appendChild(themeWrap);

    if (!hasSaved) {
      const hint = el("p", "hint", "No saved verbs yet. Verbs you save in Vocab or Reading will show up here.");
      hint.dataset.immersionKey = "noSavedVerbsHint";
      container.appendChild(hint);
    }

    container.appendChild(groupHeading("Type", "verbTypeLabel"));
    const types = el("div", "tenses-test-checkboxes-inline");
    const regular = checkbox("Regular", true, "regularVerbsCheckbox");
    const irregular = checkbox("Irregular", true, "irregularVerbsCheckbox");
    types.append(regular.label, irregular.label);
    container.appendChild(types);

    const count = el("p", "verb-picker-count");
    count.setAttribute("aria-live", "polite");
    container.appendChild(count);

    const details = el("details", "verb-picker-details");
    const summary = el("summary", "", "Choose individual verbs");
    summary.dataset.immersionKey = "chooseIndividualVerbs";
    const buttons = el("div", "verb-picker-buttons");
    const list = el("div", "tenses-test-verb-checkboxes");
    [["Select all", "selectAllButton", true], ["Clear", "clearButton", false]].forEach(([text, key, on]) => {
      const btn = el("button", "secondary tiny", text);
      btn.type = "button";
      btn.dataset.immersionKey = key;
      btn.addEventListener("click", () => {
        pool().forEach((v) => (on ? excluded.delete(v.infinitive) : excluded.add(v.infinitive)));
        render();
      });
      buttons.appendChild(btn);
    });
    details.append(summary, buttons, list);
    container.appendChild(details);

    function pool() {
      return buildPool(
        {
          common: common.input.checked,
          saved: saved.input.checked,
          themeIds: new Set(themeBoxes.filter((i) => i.checked).map((i) => i.value)),
          regular: regular.input.checked,
          irregular: irregular.input.checked,
        },
        savedWords
      );
    }

    const selected = () => pool().filter((v) => !excluded.has(v.infinitive));

    function showCount() {
      const n = selected().length;
      count.textContent = n ? `Verbs selected: ${n}` : "No verbs selected. Tick a source and a type.";
      count.dataset.immersionKey = n ? "verbsSelectedCount" : "noVerbsSelected";
      count.dataset.immersionVars = JSON.stringify({ n });
      if (typeof retranslateImmersionElement === "function") retranslateImmersionElement(count);
    }

    function render() {
      themeWrap.hidden = !saved.input.checked;
      list.innerHTML = "";
      pool()
        .sort((a, b) => a.infinitive.localeCompare(b.infinitive, "es"))
        .forEach((verb) => {
          const box = checkbox(`${verb.infinitive} (${verb.english || "?"})${verb.fromVocab ? " ★" : ""}`, !excluded.has(verb.infinitive));
          box.input.addEventListener("change", (e) => {
            e.stopPropagation(); // only the count changes; keep the list where it is
            if (box.input.checked) excluded.delete(verb.infinitive);
            else excluded.add(verb.infinitive);
            showCount();
          });
          list.appendChild(box.label);
        });
      showCount();
    }

    [common.input, saved.input, regular.input, irregular.input, ...themeBoxes].forEach((input) =>
      input.addEventListener("change", render)
    );
    render();

    return { verbs: selected };
  }

  const SpanishVerbPicker = { mount, buildPool };
  if (typeof module !== "undefined" && module.exports) module.exports = SpanishVerbPicker;
  else root.SpanishVerbPicker = SpanishVerbPicker;
})(typeof window !== "undefined" ? window : globalThis);
