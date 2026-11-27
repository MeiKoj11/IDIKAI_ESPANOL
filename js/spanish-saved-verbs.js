/*
  spanish-saved-verbs.js
  -----------------------
  On the verb test pages: asks the server's verb dictionary for the forms
  of any saved verb that isn't already among the common ones. Synchronous
  on purpose, like storage.js's own load, so the verb pool is complete
  before the page builds it. If it fails, the tests still run with the
  common verbs.
*/
(function () {
  const missing = Array.from(new Set(
    Storage.getVerbWords("es")
      .map((w) => (w.targetLang || "").trim().toLowerCase())
      .filter((v) => /(ar|er|ir|ír)(se)?$/.test(v) && !/\s/.test(v) && !SpanishConjugator.findVerb(v))
  ));
  for (let i = 0; i < missing.length; i += 100) {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", `/api/verbs?lang=es&v=${encodeURIComponent(missing.slice(i, i + 100).join(","))}`, false);
      xhr.send();
      if (xhr.status !== 200) break;
      const verbs = JSON.parse(xhr.responseText).verbs || {};
      Object.keys(verbs).forEach((v) => SpanishConjugator.addDictionaryVerb(v, verbs[v]));
    } catch (e) {
      console.warn("Could not load your saved verbs from the dictionary:", e);
      break;
    }
  }
})();
