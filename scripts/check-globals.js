#!/usr/bin/env node
/*
  check-globals.js
  ----------------
  Guards against the exact bug that once blanked every Vocab Bank theme
  list: this app loads its JS as plain <script src="..."> tags, not ES
  modules, and classic scripts all share ONE global scope. That means
  a top-level `const`/`let`/`var`/`function NAME` in one .js file can
  silently collide with the same name declared in a completely
  different .js file, as long as both are ever loaded together on the
  same page. When that happens it's not a warning -- it's a
  SyntaxError ("Identifier 'X' has already been declared") that fails
  the WHOLE second script to parse, so every function, click handler,
  and render in that file just stops existing, with no visible error
  unless someone happens to open devtools.

  This script scans every top-level *.html page, looks at exactly
  which local js/*.js files it loads together (in order), and checks
  whether any two of them declare the same top-level identifier. It's
  a plain Node script with no dependencies (matching the rest of this
  project) -- run it with:

      node scripts/check-globals.js

  before pushing any change that adds a new top-level `const`/`let`/
  `var`/`function` to a .js file, or after adding a brand-new .js file
  to any page. A clean run prints "No collisions found." and exits 0;
  a real collision prints exactly which two files, which identifier,
  and which page(s) it breaks, and exits 1.

  This is deliberately a regex-based heuristic, not a real JS parser --
  good enough for this codebase's very consistent style (every
  existing top-level declaration starts at column 0, with no leading
  indentation), and simple enough to have no dependencies of its own.
  It does not (and doesn't need to) understand scoping inside
  functions/blocks -- only column-0 lines count as "top-level" here,
  which is exactly what actually collides between scripts.
*/

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function listHtmlPages() {
  return fs
    .readdirSync(ROOT)
    .filter((f) => f.endsWith(".html"))
    .filter((f) => fs.statSync(path.join(ROOT, f)).isFile());
}

// Pulls the ordered list of local js/*.js <script src> files a page
// loads -- ignores external/CDN scripts (anything with a protocol) and
// inline <script> blocks, since those aren't part of the shared global
// script scope in the way local files loaded on the same page are.
function scriptsForPage(htmlFile) {
  const html = fs.readFileSync(path.join(ROOT, htmlFile), "utf8");
  const srcs = [];
  const re = /<script\s+[^>]*src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const src = m[1];
    if (/^https?:\/\//i.test(src)) continue;
    if (!src.endsWith(".js")) continue;
    srcs.push(src.replace(/^\.?\//, ""));
  }
  return srcs;
}

// Column-0 (non-indented) top-level declarations only -- see file
// header for why that's the right heuristic here.
function topLevelIdentifiers(jsFile) {
  const full = path.join(ROOT, jsFile);
  if (!fs.existsSync(full)) return { identifiers: new Map(), missing: true };
  const src = fs.readFileSync(full, "utf8");
  const lines = src.split("\n");
  const identifiers = new Map(); // name -> 1-based line number (first occurrence)

  const declRe = /^(?:const|let|var)\s+(.+?)\s*(?:=|;|$)/;
  const fnRe = /^function\s+([A-Za-z_$][\w$]*)\s*\(/;
  const classRe = /^class\s+([A-Za-z_$][\w$]*)\b/;

  lines.forEach((line, idx) => {
    if (/^\s/.test(line)) return; // indented -- not top-level
    const fnMatch = fnRe.exec(line);
    if (fnMatch) {
      if (!identifiers.has(fnMatch[1])) identifiers.set(fnMatch[1], idx + 1);
      return;
    }
    const classMatch = classRe.exec(line);
    if (classMatch) {
      if (!identifiers.has(classMatch[1])) identifiers.set(classMatch[1], idx + 1);
      return;
    }
    const declMatch = declRe.exec(line);
    if (declMatch) {
      // Handles "const a = 1, b = 2;" as well as the common single-name case.
      declMatch[1]
        .split(",")
        .map((part) => part.trim().split("=")[0].trim())
        .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name))
        .forEach((name) => {
          if (!identifiers.has(name)) identifiers.set(name, idx + 1);
        });
    }
  });

  return { identifiers, missing: false };
}

function main() {
  const pages = listHtmlPages();
  const idCache = new Map(); // jsFile -> { identifiers, missing }
  const getIds = (jsFile) => {
    if (!idCache.has(jsFile)) idCache.set(jsFile, topLevelIdentifiers(jsFile));
    return idCache.get(jsFile);
  };

  // collisionKey "fileA|fileB|identifier" -> Set of pages it breaks on
  const collisions = new Map();

  pages.forEach((page) => {
    const scripts = scriptsForPage(page).filter((s) => getIds(s).missing === false);
    for (let i = 0; i < scripts.length; i++) {
      for (let j = i + 1; j < scripts.length; j++) {
        const a = scripts[i];
        const b = scripts[j];
        if (a === b) continue;
        const idsA = getIds(a).identifiers;
        const idsB = getIds(b).identifiers;
        idsA.forEach((lineA, name) => {
          if (idsB.has(name)) {
            const key = [a, b].sort().join("|") + "|" + name;
            if (!collisions.has(key)) collisions.set(key, new Set());
            collisions.get(key).add(page);
          }
        });
      }
    }
  });

  if (collisions.size === 0) {
    console.log(`OK: no top-level identifier collisions found across ${pages.length} pages.`);
    process.exit(0);
  }

  console.error(`Found ${collisions.size} top-level identifier collision(s):\n`);
  collisions.forEach((pagesSet, key) => {
    const [a, b, name] = key.split("|");
    const idsA = getIds(a).identifiers;
    const idsB = getIds(b).identifiers;
    console.error(
      `  "${name}" declared in both ${a}:${idsA.get(name)} and ${b}:${idsB.get(name)}\n` +
        `    breaks: ${[...pagesSet].join(", ")}\n`
    );
  });
  console.error("Rename one of the two so they don't share a name at the top level.");
  process.exit(1);
}

main();
