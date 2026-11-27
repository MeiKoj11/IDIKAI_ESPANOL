/*
  check-verb-recognition.js
  --------------------------
  Checks when a saved word counts as a verb, and when the app asks:
    node scripts/check-verb-recognition.js
*/
const { decide, parseHint } = require("../js/verb-recognition.js");

const found = (infinitives, isInfinitive = false) => ({ infinitives, isInfinitive });
const CASES = [
  ["infinitive with 'to'", { targetLang: "comer", english: "to eat" }, found([], true), "verb:comer"],
  ["infinitive, bare English", { targetLang: "poder", english: "power" }, found([], true), "ask:poder"],
  ["infinitive saved as a noun", { targetLang: "deber", english: "the duty" }, found([], true), "none"],
  ["form with English sentence", { targetLang: "comí", english: "I ate" }, found(["comer"]), "verb:comer"],
  ["ambiguous form", { targetLang: "como", english: "like" }, found(["comer"]), "ask:comer"],
  ["two possible verbs", { targetLang: "fui", english: "I went" }, found(["ir", "ser"]), "ask:ir,ser"],
  ["form saved as a noun", { targetLang: "casa", english: "a house" }, found(["casar"]), "none"],
  ["remembered infinitive wins", { targetLang: "fui", english: "went", infinitive: "ir (to go)" }, found(["ir", "ser"]), "verb:ir"],
  ["unknown verb, plainly a verb", { targetLang: "arrepentirse", english: "to regret" }, found([]), "verb:arrepentirse"],
  ["ordinary word", { targetLang: "mesa", english: "table" }, found([]), "none"],
];

let failed = 0;
CASES.forEach(([name, word, answer, expected]) => {
  const v = decide(word, answer);
  const got = v.kind === "verb" ? `verb:${v.infinitive}` : v.kind === "ask" ? `ask:${v.options}` : "none";
  if (got !== expected) { failed++; console.log(`  ${name}: got ${got}, should be ${expected}`); }
});
const hint = parseHint("comer (to eat)");
if (hint.infinitive !== "comer" || hint.english !== "to eat") { failed++; console.log("  hint not split", hint); }
console.log(`${CASES.length + 1 - failed} of ${CASES.length + 1} correct`);
process.exit(failed ? 1 : 0);
