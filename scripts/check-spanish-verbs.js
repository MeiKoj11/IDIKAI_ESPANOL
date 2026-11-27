/*
  check-spanish-verbs.js
  -----------------------
  The fixed answer sheet for Spanish verb forms: tricky cells whose
  answers are known, checked against the code the tests use. Run after
  any change to verb data:   node scripts/check-spanish-verbs.js

  Each line is: infinitive | tense | person | correct form. Every line is
  checked twice: with the app's own rules, and with the generated
  dictionary (server/verbs/es.json). A few extra lines cover verbs only
  the dictionary knows.
*/

global.window = global;
require("../js/spanish-verb-data.js");
const Conjugator = require("../js/spanish-conjugator.js");

const ANSWERS = `
hablar|present|vosotros|habláis
comer|preterite|ellos|comieron
vivir|present|nosotros|vivimos
ser|present|yo|soy
ser|preterite|el|fue
ser|imperfect|nosotros|éramos
ser|subjPresent|tu|seas
ser|imperativeAffirmative|tu|sé
estar|present|el|está
estar|preterite|yo|estuve
estar|subjPresent|el|esté
ir|present|yo|voy
ir|imperfect|nosotros|íbamos
ir|preterite|ellos|fueron
ir|imperativeAffirmative|tu|ve
ir|imperativeAffirmative|nosotros|vamos
ir|imperativeNegative|nosotros|no vayamos
haber|present|yo|he
haber|subjPresent|yo|haya
dar|present|yo|doy
dar|preterite|yo|di
dar|subjPresent|yo|dé
dar|subjPresent|vosotros|deis
ver|present|vosotros|veis
ver|preterite|yo|vi
ver|preterite|el|vio
ver|presentPerfect|yo|he visto
hacer|preterite|el|hizo
hacer|future|yo|haré
hacer|imperativeAffirmative|tu|haz
tener|present|tu|tienes
tener|preterite|ellos|tuvieron
tener|conditional|yo|tendría
tener|imperativeAffirmative|vosotros|tened
poder|preterite|yo|pude
poder|future|el|podrá
querer|preterite|el|quiso
querer|conditional|nosotros|querríamos
decir|present|yo|digo
decir|preterite|ellos|dijeron
decir|subjImperfect|yo|dijera
decir|imperativeAffirmative|tu|di
decir|presentPerfect|tu|has dicho
venir|preterite|el|vino
venir|imperativeAffirmative|tu|ven
salir|present|yo|salgo
salir|imperativeAffirmative|tu|sal
poner|presentPerfect|el|ha puesto
poner|imperativeAffirmative|tu|pon
traer|preterite|ellos|trajeron
traer|presentPerfect|yo|he traído
saber|present|yo|sé
saber|subjPresent|yo|sepa
conocer|present|yo|conozco
pensar|present|yo|pienso
pensar|present|nosotros|pensamos
pensar|subjPresent|vosotros|penséis
cerrar|imperativeAffirmative|tu|cierra
empezar|preterite|yo|empecé
empezar|subjPresent|el|empiece
entender|present|ellos|entienden
perder|subjPresent|nosotros|perdamos
volver|presentPerfect|yo|he vuelto
volver|imperativeAffirmative|tu|vuelve
encontrar|present|el|encuentra
mostrar|subjPresent|tu|muestres
jugar|present|yo|juego
jugar|preterite|yo|jugué
jugar|subjPresent|nosotros|juguemos
pedir|preterite|el|pidió
pedir|subjPresent|nosotros|pidamos
dormir|preterite|ellos|durmieron
dormir|subjPresent|nosotros|durmamos
dormir|subjImperfect|yo|durmiera
sentir|present|yo|siento
sentir|subjPresent|vosotros|sintáis
seguir|present|yo|sigo
seguir|preterite|el|siguió
seguir|subjPresent|yo|siga
buscar|preterite|yo|busqué
buscar|imperativeNegative|tu|no busques
llegar|subjPresent|yo|llegue
practicar|preterite|yo|practiqué
escribir|presentPerfect|nosotros|hemos escrito
abrir|pluperfect|yo|había abierto
comer|subjImperfect|nosotros|comiéramos
hablar|subjImperfectSe|nosotros|hablásemos
ser|subjImperfect|nosotros|fuéramos
`;

// Verbs outside the app's original hand-picked list.
const DICTIONARY_ONLY = `
leer|preterite|el|leyó
leer|presentPerfect|yo|he leído
conducir|present|yo|conduzco
conducir|preterite|ellos|condujeron
oír|present|tu|oyes
recibir|preterite|yo|recibí
terminar|subjPresent|el|termine
contar|present|yo|cuento
elegir|present|yo|elijo
construir|present|el|construye
caer|present|yo|caigo
romper|presentPerfect|yo|he roto
describir|presentPerfect|yo|he descrito
levantarse|present|yo|me levanto
levantarse|presentPerfect|tu|te has levantado
levantarse|imperativeAffirmative|tu|levántate
levantarse|imperativeNegative|el|no se levante
levantarse|imperativeAffirmative|el|levántese
sentarse|imperativeAffirmative|ellos|siéntense
acostarse|present|nosotros|nos acostamos
tener|imperativeAffirmative|el|tenga
obtener|preterite|yo|obtuve
obtener|imperativeAffirmative|tu|obtén
ponerse|present|yo|me pongo
ponerse|imperativeAffirmative|tu|ponte
hablar|imperativeNegative|ellos|no hablen
`;

const packed = require("../server/verbs/es.json");

let total = 0;
const wrong = [];
function check(label, lines, lookup) {
  lines.trim().split("\n").forEach((line) => {
    const [infinitive, tense, person, expected] = line.split("|");
    const verb = lookup(infinitive);
    const got = verb ? Conjugator.conjugate(verb, tense, person) : "(verb missing)";
    total += 1;
    if (got !== expected) wrong.push(`[${label}] ${infinitive} ${tense} ${person}: got "${got}", should be "${expected}"`);
  });
}

const dictionaryVerb = (v) => packed[v] && Conjugator.verbFromDictionary(v, "", packed[v]);
check("app", ANSWERS, Conjugator.findVerb);
check("dictionary", ANSWERS, dictionaryVerb);
check("dictionary", DICTIONARY_ONLY, dictionaryVerb);

console.log(`${total - wrong.length} of ${total} correct`);
wrong.forEach((w) => console.log("  " + w));
process.exit(wrong.length ? 1 : 0);
