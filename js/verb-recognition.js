/*
  verb-recognition.js
  --------------------
  Makes sure a saved Spanish verb always remembers its infinitive, however
  it was saved. storage.js calls checkLater() for every word added through
  addWordIfNotDuplicate; words saved before this existed are checked once
  when a page loads.

  What gets stored on the word:
    partOfSpeech "verb", infinitive, infinitiveEnglish, verbType,
    verbCheck: "yes" (verb) | "no" (learner said no) | "none" (not a verb).
  No verbCheck yet = still to be looked at, or waiting for an answer.

  When it's clear, nothing is asked. When it isn't ("como" can be "I eat"
  or "like"), a small card asks. A form like "comí" also offers to save
  "comer" as its own flashcard -- optional.
*/

(function (root) {
  const PRONOUNS = /^(yo|tú|él|ella|usted|nosotros|nosotras|vosotros|vosotras|ellos|ellas|ustedes) (?=\S)/;

  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[¡!¿?.,;:"“”]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(PRONOUNS, "");
  }

  // Reading saves the infinitive as "comer (to eat)"; split the two.
  function parseHint(text) {
    const match = String(text || "").match(/^([^(]*)(?:\((.*)\))?\s*$/);
    return {
      infinitive: normalize(match ? match[1] : text),
      english: match && match[2] ? match[2].trim() : "",
    };
  }

  // The whole judgement, with no page or network involved. `found` is the
  // dictionary's answer for the word: { isInfinitive, infinitives }.
  function decide(word, found) {
    const form = normalize(word.targetLang);
    const hint = parseHint(word.infinitive);
    const english = String(word.english || "").trim().toLowerCase();
    if (hint.infinitive) return { kind: "verb", infinitive: hint.infinitive };

    const saysVerb = word.partOfSpeech === "verb" || /^to \S/.test(english);
    const soundsVerb = saysVerb || /^(i|you|he|she|it|we|they)\b/.test(english);
    const soundsNoun = !saysVerb && /^(a|an|the) /.test(english);

    if (found.isInfinitive) {
      if (soundsVerb) return { kind: "verb", infinitive: form };
      return soundsNoun ? { kind: "none" } : { kind: "ask", options: [form] };
    }
    if (found.infinitives.length) {
      if (soundsVerb && found.infinitives.length === 1) return { kind: "verb", infinitive: found.infinitives[0] };
      return soundsNoun ? { kind: "none" } : { kind: "ask", options: found.infinitives };
    }
    // Not in the dictionary, but plainly saved as a verb in its infinitive.
    if (saysVerb && /^\S+(ar|er|ir|ír)(se)?$/.test(form)) return { kind: "verb", infinitive: form };
    return { kind: "none" };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { normalize, parseHint, decide };
    return;
  }

  // ---- Looking words up and saving the result ----

  function spanishWords() {
    const themeIds = new Set(Storage.getThemes().filter((t) => (t.language || "es") === "es").map((t) => t.id));
    return Storage.getWords().filter((w) => themeIds.has(w.themeId));
  }

  const findWord = (id) => spanishWords().find((w) => w.id === id) || null;

  async function identify(forms) {
    const results = {};
    for (let i = 0; i < forms.length; i += 200) {
      const res = await fetch("/api/verbs/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: "es", words: forms.slice(i, i + 200) }),
      });
      if (!res.ok) throw new Error(`verb lookup failed (${res.status})`);
      Object.assign(results, (await res.json()).results);
    }
    return results;
  }

  // English for an infinitive: what we already know, else the app's lookup.
  async function meaningOf(word, infinitive) {
    const hint = parseHint(word.infinitive);
    if (hint.infinitive === infinitive && hint.english) return hint.english;
    if (normalize(word.targetLang) === infinitive) return word.english;
    const common = (root.SpanishCommonVerbs || []).find((v) => v[0] === infinitive);
    if (common) return common[1];
    const curated = root.SpanishVerbData && root.SpanishVerbData.VERBS.find((v) => v.infinitive === infinitive);
    if (curated) return curated.english;
    if (typeof Translate === "undefined") return "";
    try {
      const result = await Translate.lookupTranslation(infinitive, "es", "en");
      // The backup translator is too rough to build test questions from
      // ("ponerse" -> "get"); leave it blank so the learner can type it.
      if (!result || result.source === "mymemory") return "";
      return result.translation || "";
    } catch (e) {
      return "";
    }
  }

  async function verbUpdates(word, infinitive) {
    // A fresh lookup tells us whether the infinitive itself is irregular.
    let irregular = false;
    try {
      const found = (await identify([infinitive]))[infinitive];
      irregular = !!(found && found.irregular);
    } catch (e) {
      // the ending below is still a fair label
    }
    const ending = infinitive.replace(/se$/, "").slice(-2).replace("í", "i");
    return {
      partOfSpeech: "verb",
      infinitive,
      infinitiveEnglish: await meaningOf(word, infinitive),
      verbType: irregular ? "irregular" : ["ar", "er", "ir"].includes(ending) ? ending : "irregular",
      verbCheck: "yes",
    };
  }

  const hasOwnCard = (infinitive) => spanishWords().some((w) => normalize(w.targetLang) === infinitive);

  // Checks words that haven't been looked at. `fresh` = just saved by the
  // learner, so ask or offer straight away; otherwise stay quiet and only
  // collect the unclear ones.
  async function check(words, fresh) {
    if (!words.length) return [];
    const forms = new Set();
    words.forEach((w) => forms.add(normalize(w.targetLang)));
    const found = await identify(Array.from(forms).filter((f) => f && f.length <= 60));
    const updates = {};
    const unclear = [];
    const verbs = [];
    words.forEach((word) => {
      const result = found[normalize(word.targetLang)] || { isInfinitive: false, infinitives: [] };
      const verdict = decide(word, result);
      if (verdict.kind === "none") updates[word.id] = { verbCheck: "none" };
      else if (verdict.kind === "ask") unclear.push({ id: word.id, options: verdict.options });
      else verbs.push({ word, infinitive: verdict.infinitive });
    });
    if (Object.keys(updates).length) Storage.updateWords(updates);
    if (fresh) unclear.forEach(showQuestion);
    // Saved one at a time: each may wait on a lookup, and leaving the page
    // part-way shouldn't lose the ones already done.
    for (const { word, infinitive } of verbs) {
      Storage.updateWords({ [word.id]: await verbUpdates(word, infinitive) });
      if (fresh) showCardOffer(word.id);
    }
    return unclear;
  }

  let queued = [];
  function checkLater(wordId) {
    queued.push(wordId);
    if (queued.length > 1) return; // a batch save: one lookup for all of them
    setTimeout(() => {
      const ids = new Set(queued);
      queued = [];
      const words = spanishWords().filter((w) => ids.has(w.id) && !w.verbCheck);
      // If the lookup fails, the words stay unchecked and are retried on a later page.
      check(words, true).catch((e) => console.warn("Verb check postponed:", e));
    }, 50);
  }

  // ---- The card in the corner ----

  function panelList() {
    let panel = document.getElementById("verb-panel");
    if (!panel) {
      panel = document.createElement("aside");
      panel.id = "verb-panel";
      panel.className = "verb-panel";
      panel.setAttribute("aria-live", "polite");
      const close = button("×", "verb-panel-close", () => panel.remove());
      close.setAttribute("aria-label", "Close");
      const list = document.createElement("div");
      list.className = "verb-panel-list";
      panel.append(close, list);
      document.body.appendChild(panel);
    }
    return panel.querySelector(".verb-panel-list");
  }

  function button(label, className, onClick) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = className;
    el.textContent = label;
    el.addEventListener("click", onClick);
    return el;
  }

  function panelItem(text) {
    const item = document.createElement("div");
    item.className = "verb-panel-item";
    const p = document.createElement("p");
    p.textContent = text;
    const actions = document.createElement("div");
    actions.className = "verb-panel-actions";
    item.append(p, actions);
    panelList().appendChild(item);
    return { item, actions };
  }

  function dismiss(item) {
    item.remove();
    const panel = document.getElementById("verb-panel");
    if (panel && !panel.querySelector(".verb-panel-item")) panel.remove();
  }

  function showQuestion({ id, options }) {
    const word = findWord(id);
    if (!word) return;
    const { item, actions } = panelItem(`Is “${word.targetLang}” (${word.english}) a verb?`);
    options.forEach((infinitive) => {
      actions.appendChild(button(`Yes, ${infinitive}`, "verb-panel-btn", async () => {
        item.querySelectorAll("button").forEach((b) => { b.disabled = true; });
        const current = findWord(id);
        if (current) {
          Storage.updateWords({ [id]: await verbUpdates(current, infinitive) });
          showCardOffer(id);
        }
        dismiss(item);
      }));
    });
    actions.appendChild(button("Not a verb", "verb-panel-btn verb-panel-btn-quiet", () => {
      Storage.updateWords({ [id]: { verbCheck: "no" } });
      dismiss(item);
    }));
  }

  // Only for a form ("comí") whose infinitive isn't a card yet.
  function showCardOffer(id) {
    const word = findWord(id);
    if (!word || !word.infinitive || normalize(word.targetLang) === word.infinitive || hasOwnCard(word.infinitive)) return;
    const { item, actions } = panelItem(`“${word.targetLang}” is from the verb ${word.infinitive}. It's remembered for your verb tests.`);
    const meaning = document.createElement("input");
    meaning.type = "text";
    meaning.className = "verb-panel-input";
    meaning.value = word.infinitiveEnglish || "";
    meaning.placeholder = `English for ${word.infinitive}`;
    meaning.setAttribute("aria-label", `English meaning of ${word.infinitive}`);
    item.insertBefore(meaning, actions);
    actions.appendChild(button(`Save ${word.infinitive} as its own card`, "verb-panel-btn", () => {
      const english = meaning.value.trim();
      if (!english) { meaning.focus(); return; }
      Storage.updateWords({ [id]: { infinitiveEnglish: english } });
      if (!hasOwnCard(word.infinitive)) {
        Storage.addWordIfNotDuplicate(word.themeId, {
          english,
          targetLang: word.infinitive,
          furigana: "",
          notes: "",
          partOfSpeech: "verb",
          infinitive: word.infinitive,
          infinitiveEnglish: english,
          verbType: word.verbType,
          verbCheck: "yes",
        });
        // Vocab pages redraw their list if they're showing it.
        if (typeof renderWordList === "function" && document.getElementById("word-list")) renderWordList();
      }
      dismiss(item);
    }));
    actions.appendChild(button("No thanks", "verb-panel-btn verb-panel-btn-quiet", () => {
      const english = meaning.value.trim();
      if (english) Storage.updateWords({ [id]: { infinitiveEnglish: english } });
      dismiss(item);
    }));
  }

  // ---- Words saved before this existed ----

  const LATER_KEY = "idikai.verbReviewLater";
  const REVIEW_PAGES = /\/(vocab|theme|add-vocab|spanish-conjugation-test|spanish-sentence-test)(\.html)?$/;

  async function checkOlderWords() {
    // Also retried: verbs whose English couldn't be looked up last time.
    const waiting = (w) => !w.verbCheck || (w.verbCheck === "yes" && !w.infinitiveEnglish && normalize(w.targetLang) !== w.infinitive);
    const unclear = await check(spanishWords().filter(waiting), false);
    if (!unclear.length || !REVIEW_PAGES.test(window.location.pathname)) return;
    try { if (window.sessionStorage.getItem(LATER_KEY)) return; } catch (e) { /* ask anyway */ }
    const count = unclear.length === 1 ? "1 saved word" : `${unclear.length} saved words`;
    const { item, actions } = panelItem(`${count} might be a verb. Check now?`);
    actions.appendChild(button("Review", "verb-panel-btn", () => {
      dismiss(item);
      unclear.forEach(showQuestion);
    }));
    actions.appendChild(button("Later", "verb-panel-btn verb-panel-btn-quiet", () => {
      try { window.sessionStorage.setItem(LATER_KEY, "1"); } catch (e) { /* nothing to remember it in */ }
      dismiss(item);
    }));
  }

  document.addEventListener("DOMContentLoaded", () => {
    checkOlderWords().catch((e) => console.warn("Verb check postponed:", e));
  });

  root.VerbRecognition = { checkLater };
})(typeof window !== "undefined" ? window : globalThis);
