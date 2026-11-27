/*
  build-spanish-verbs.js
  -----------------------
  Builds server/verbs/es.json, the Spanish verb dictionary the tests use.
  Forms come from the conjugate-esp rule engine; a verb is kept only if a
  second source agrees on it: UniMorph, the app's hand-checked list, or
  (for fully regular verbs) the plain -ar/-er/-ir pattern.
*/
const fs = require("fs");
// Usage: node scripts/build-spanish-verbs.js <folder holding the downloads>
// The folder needs: npm/node_modules/@jirimracek/conjugate-esp (v2.3.6,
// MIT), unimorph/spa (github.com/unimorph/spa, CC BY-SA 3.0).
const path = require("path");
const S = path.resolve(process.argv[2] || ".");
const ROOT = path.join(__dirname, "..");
global.window = global;
require(ROOT + "/js/spanish-verb-data.js");
const App = require(ROOT + "/js/spanish-conjugator.js");
const { Conjugator } = require(S + "/npm/node_modules/@jirimracek/conjugate-esp");
const defs = require(S + "/npm/node_modules/@jirimracek/conjugate-esp/dist/data/definitions.json");
const c = new Conjugator("2010");

const TAGS = {
  present: "V;IND;PRS", preterite: "V;IND;PST;PFV", imperfect: "V;IND;PST;IPFV", future: "V;IND;FUT",
  conditional: "V;COND", subjPresent: "V;SBJV;PRS", subjImperfect: "V;SBJV;PST;LGSPEC1",
  subjImperfectSe: "V;SBJV;PST;LGSPEC2", subjFuture: "V;SBJV;FUT",
};
const SRC = {
  present: ["Indicativo", "Presente"], preterite: ["Indicativo", "PreteritoIndefinido"],
  imperfect: ["Indicativo", "PreteritoImperfecto"], future: ["Indicativo", "FuturoImperfecto"],
  conditional: ["Indicativo", "CondicionalSimple"], subjPresent: ["Subjuntivo", "Presente"],
  subjImperfect: ["Subjuntivo", "PreteritoImperfectoRa"], subjImperfectSe: ["Subjuntivo", "PreteritoImperfectoSe"],
  subjFuture: ["Subjuntivo", "FuturoImperfecto"],
};
const PERSONS = [["1;SG"], ["2;SG;INFM", "2;SG"], ["3;SG"], ["1;PL"], ["2;PL", "2;PL;INFM"], ["3;PL"]];

const uni = new Map();
for (const line of fs.readFileSync(S + "/unimorph/spa", "utf8").split("\n")) {
  const [lemma, form, tag] = line.split("\t");
  if (!tag || tag[0] !== "V" || /ACC|DAT/.test(tag)) continue;
  let m = uni.get(lemma);
  if (!m) uni.set(lemma, (m = new Map()));
  if (!m.has(tag)) m.set(tag, new Set());
  m.get(tag).add(form.normalize("NFC"));
}

function convert(r, reflexive, formal) {
  const t = r.conjugation;
  const forms = {};
  for (const [k, [mood, sub]] of Object.entries(SRC)) forms[k] = t[mood][sub].slice();
  // usted / ustedes commands are the present subjunctive.
  const aff = t.Imperativo.Afirmativo.slice();
  const neg = t.Imperativo.Negativo.slice();
  const subj = forms.subjPresent;
  [2, 5].forEach((i) => {
    if (subj[i] === "-") return;
    if (!reflexive) {
      if (aff[i] === "-") aff[i] = subj[i];
      if (neg[i] === "-") neg[i] = "no " + subj[i];
    } else if (neg[i] === "-") neg[i] = "no " + subj[i];
  });
  forms.imperativeAffirmative = aff;
  forms.imperativeNegative = neg;
  // Reflexive usted / ustedes commands ("levántese") come from the formal
  // table, which lists them in the second and fifth places.
  if (reflexive && formal) {
    aff[2] = formal.Imperativo.Afirmativo[1];
    aff[5] = formal.Imperativo.Afirmativo[4];
  }
  // "ir": use "vamos" (let's go), matching the app's hand-checked list.
  if (r.info.model === "ir" && aff[3] === "vayamos") aff[3] = "vamos";
  forms.participle = t.Impersonal.Participio;
  forms.gerund = t.Impersonal.Gerundio;
  // Where two spellings are both accepted ("descrito/descripto") keep the first.
  for (const k of Object.keys(forms)) {
    const first = (f) => f.split("/")[0];
    forms[k] = Array.isArray(forms[k]) ? forms[k].map(first) : first(forms[k]);
  }
  return forms;
}

const strip = (f) => f.replace(/^(me|te|se|nos|os) /, "");

// Counts cells compared and lists those where UniMorph has different forms.
function check(forms, u, reflexive) {
  let compared = 0;
  const diffs = [];
  const test = (cell, ours, set) => {
    if (!set || ours === "-" || !ours) return;
    compared++;
    if (!ours.split("/").some((f) => set.has(reflexive ? strip(f) : f))) diffs.push([cell, ours, [...set].join("/")]);
  };
  for (const [k, tag] of Object.entries(TAGS)) {
    PERSONS.forEach((alts, i) => {
      const set = alts.map((a) => u.get(`${tag};${a}`)).find(Boolean);
      test(`${k}.${i}`, forms[k][i], set);
    });
  }
  test("participle", forms.participle, u.get("V;V.PTCP;PST;MASC;SG"));
  if (!reflexive) test("gerund", forms.gerund, u.get("V;V.CVB;PRS"));
  return { compared, diffs };
}

const SIMPLE = Object.keys(TAGS).concat("imperativeAffirmative", "imperativeNegative");
const PRON = ["me", "te", "se", "nos", "os", "se"];

// What the verb would look like if it followed the ordinary -ar/-er/-ir
// pattern (the app's own rules, with no exceptions). Returns the tenses
// where the real verb differs.
function irregularTenses(base, forms, reflexive) {
  const type = base.slice(-2).replace("í", "i");
  const plain = { infinitive: base, type };
  return SIMPLE.filter((t) =>
    App.PERSON_KEYS.some((p, i) => {
      let real = forms[t][i];
      if (real === "-") return false;
      if (reflexive) {
        if (t.startsWith("imperative")) return false;
        real = strip(real);
      }
      const regular = App.conjugate(plain, t, p);
      return !!regular && regular !== real;
    })
  ).concat(forms.participle === base.slice(0, -2) + (type === "ar" ? "ado" : "ido") ? [] : ["participle"]);
}

// Same cells in the app's hand-checked list.
function matchesAppList(inf, forms) {
  const verb = App.VERBS.find((v) => v.infinitive === inf);
  return !!verb && SIMPLE.every((t) =>
    App.PERSON_KEYS.every((p, i) => {
      const ours = App.conjugate(verb, t, p);
      // Two accepted variants differ: "he" (haber) and "vayamos" (ir).
      if (t === "imperativeAffirmative" && ((inf === "haber" && p === "tu") || (inf === "ir" && p === "nosotros"))) return true;
      return !ours || forms[t][i] === "-" || forms[t][i] === ours;
    })
  );
}

const dictionary = {};
const pending = []; // no direct second source; checked against other verbs below
const stats = { total: 0, unimorph: 0, appList: 0, regularPattern: 0, viaRelatedVerb: 0, disagreed: 0, uncheckable: 0 };
const disagreed = [];
for (const inf of Object.keys(defs).sort()) {
  stats.total++;
  const reflexive = /[aeiíá]rse$/.test(inf);
  const base = reflexive ? inf.slice(0, -2) : inf;
  const u = uni.get(base) || uni.get(inf);
  let results;
  try { results = c.conjugateSync(inf, "castellano"); } catch (e) { stats.uncheckable++; continue; }
  if (typeof results === "string" || !results.length) { stats.uncheckable++; continue; }
  const tried = results.map((r) => {
    let formal = null;
    if (reflexive) {
      const all = c.conjugateSync(inf, "formal");
      const same = Array.isArray(all) && all.find((f) => f.info.model === r.info.model);
      formal = same ? same.conjugation : null;
    }
    const forms = convert(r, reflexive, formal);
    return { forms, r, ...(u ? check(forms, u, reflexive) : { compared: 0, diffs: [] }) };
  }).sort((a, b) => a.diffs.length - b.diffs.length || b.compared - a.compared);
  const best = tried[0];
  const odd = irregularTenses(base, best.forms, reflexive);
  let source = null;
  if (matchesAppList(inf, best.forms)) source = "appList";
  else if (best.diffs.length) { stats.disagreed++; disagreed.push(inf); continue; }
  else if (best.compared >= (best.r.info.defective ? 10 : 40)) source = "unimorph";
  else if (!reflexive && !odd.length && !best.r.info.defective) source = "regularPattern";
  const entry = { forms: best.forms, irregular: odd.length > 0 };
  if (!source) { pending.push({ inf, base, reflexive, entry }); continue; }
  stats[source]++;
  dictionary[inf] = entry;
}

// Two more checks, for verbs built on one already verified:
//  - a reflexive verb ("ponerse") must match its plain verb ("poner")
//    once the pronouns are removed;
//  - a compound of a hand-checked verb ("obtener" from "tener") must be
//    that verb with the prefix in front (accents aside: "obtén").
const plainLetters = (f) => f.normalize("NFD").replace(/\u0301/g, "");
const COMMANDS = ["imperativeAffirmative", "imperativeNegative"];
function matchesRelated(forms, other, change, tenses) {
  return tenses.every((t) =>
    App.PERSON_KEYS.every((p, i) => {
      const a = forms[t][i];
      const b = other[t][i];
      return a === "-" || b === "-" || change(a, b, t);
    })
  );
}
// Compounds first, so "obtenerse" can lean on a newly added "obtener".
pending.sort((a, b) => a.reflexive - b.reflexive);
for (const { inf, base, reflexive, entry } of pending) {
  let ok = false;
  if (reflexive) {
    const plain = dictionary[base];
    ok = !!plain && matchesRelated(entry.forms, plain.forms, (a, b) => strip(a) === b,
      SIMPLE.filter((t) => !COMMANDS.includes(t)));
  } else {
    const root = App.VERBS.map((v) => v.infinitive)
      .filter((v) => v.length > 3 && inf !== v && inf.endsWith(v) && dictionary[v])
      .sort((a, b) => b.length - a.length)[0];
    if (root) {
      const prefix = inf.slice(0, -root.length);
      ok = matchesRelated(entry.forms, dictionary[root].forms, (a, b, t) => {
        const expected = t === "imperativeNegative" ? b.replace("no ", `no ${prefix}`) : prefix + b;
        return plainLetters(a) === plainLetters(expected);
      }, SIMPLE);
    }
  }
  if (!ok) { stats.uncheckable++; continue; }
  stats.viaRelatedVerb++;
  dictionary[inf] = entry;
}
// Keep the file in alphabetical order.
Object.keys(dictionary).sort().forEach((k) => { const e = dictionary[k]; delete dictionary[k]; dictionary[k] = e; });
console.log(stats);

// One line of text per verb keeps the file small: 9 tenses x 6, both
// imperatives x 6, participle, then "1" for irregular.
const pack = (e) => SIMPLE.flatMap((t) => e.forms[t]).concat(e.forms.participle, e.irregular ? "1" : "0").join(";");
fs.mkdirSync(ROOT + "/server/verbs", { recursive: true });
fs.writeFileSync(ROOT + "/server/verbs/es.json", "{\n" + Object.keys(dictionary).map((v) => JSON.stringify(v) + ":" + JSON.stringify(pack(dictionary[v]))).join(",\n") + "\n}\n");

// ---- The everyday verbs every test can use without asking the server ----
// Picked from the top of a spoken-Spanish frequency list (FrequencyWords,
// CC BY-SA 4.0), with English meanings written for this app.
const COMMON = "pasar=to pass / happen|dejar=to leave / let|esperar=to wait / hope|llevar=to carry / wear|llamar=to call|creer=to believe|entrar=to enter|usar=to use|tratar=to try / treat|morir=to die|conseguir=to get / achieve|intentar=to try|quedar=to stay / meet up|cambiar=to change|pagar=to pay|ganar=to win / earn|sacar=to take out|mantener=to maintain|preguntar=to ask|oír=to hear|salvar=to save|contar=to count / tell|correr=to run|terminar=to finish|tocar=to touch / play|probar=to try / taste|evitar=to avoid|regresar=to return|proteger=to protect|leer=to read|bailar=to dance|parar=to stop|llorar=to cry|vender=to sell|arreglar=to fix|cenar=to have dinner|volar=to fly|luchar=to fight|cuidar=to take care of|subir=to go up|echar=to throw|parecer=to seem|meter=to put in|coger=to take / catch|confiar=to trust|explicar=to explain|bajar=to go down|bromear=to joke|enviar=to send|recibir=to receive|acabar=to finish|funcionar=to work / function|actuar=to act|conducir=to drive|olvidar=to forget|aceptar=to accept|andar=to walk|manejar=to handle / drive|mover=to move|pesar=to weigh|romper=to break|partir=to leave / split|caer=to fall|limpiar=to clean|recoger=to pick up|preparar=to prepare|recuperar=to recover|tirar=to throw away|comenzar=to begin|suceder=to happen|gritar=to shout|discutir=to argue|necesitar=to need|enseñar=to teach / show|imaginar=to imagine|cortar=to cut|asegurar=to ensure|molestar=to bother|controlar=to control|resolver=to solve|crear=to create|quitar=to remove|descansar=to rest|compartir=to share|presentar=to present / introduce|descubrir=to discover|visitar=to visit|elegir=to choose|revisar=to check|permitir=to allow|amar=to love|respirar=to breathe|responder=to answer|preocupar=to worry|continuar=to continue|deber=to owe / have to|celebrar=to celebrate|esconder=to hide|convertir=to turn into|sobrevivir=to survive|lograr=to manage / achieve|disfrutar=to enjoy|saltar=to jump|utilizar=to use|engañar=to deceive|construir=to build|cumplir=to fulfil / turn (an age)|levantarse=to get up|acostarse=to go to bed|despertarse=to wake up|ducharse=to have a shower|llamarse=to be called|sentarse=to sit down";
const lines = COMMON.split("|").map((pair) => pair.split("=")).filter(([v]) => !App.VERBS.some((a) => a.infinitive === v));
const missing = lines.filter(([v]) => !dictionary[v]).map(([v]) => v);
if (missing.length) console.log("Common verbs left out (not verified):", missing.join(" "));
fs.writeFileSync(ROOT + "/js/spanish-common-verbs.js",
  "// Generated by scripts/build-spanish-verbs.js -- do not edit by hand.\n" +
  "window.SpanishCommonVerbs = [\n" +
  lines.filter(([v]) => dictionary[v]).map(([v, en]) => JSON.stringify([v, en, pack(dictionary[v])]) + ",").join("\n") +
  "\n];\n");
