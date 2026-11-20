/*
  saved-highlights.js
  -------------------
  Shared by Reading (passage.html) and Writing (writing-entry.html).

  1. applySavedHighlights(container, passageId)
     Every word/phrase SAVED from a passage (a Vocab Bank word or a
     grammar note — not just looked up) is highlighted yellow wherever the
     passage text is shown, so you can see which bits you didn't know.
     Tapping a highlight shows just its English meaning in a small bubble
     above it; tapping again hides it. Works on any element that shows
     the passage text (the Reading reader, or a passage opened as a
     reference tab in Writing).

  2. toggleWordPopup(anchorEl, text)
     The bubble itself — also used by Writing's red corrected words.
*/

let wordPopupEl = null;
let wordPopupAnchor = null;

function hideWordPopup() {
  if (wordPopupEl) wordPopupEl.hidden = true;
  wordPopupAnchor = null;
}

function positionWordPopup() {
  if (!wordPopupEl || !wordPopupAnchor || wordPopupEl.hidden) return;
  const rect = wordPopupAnchor.getBoundingClientRect();
  const popRect = wordPopupEl.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - popRect.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8));
  let top = rect.top - popRect.height - 8;
  if (top < 8) top = rect.bottom + 8; // no room above — show below instead
  wordPopupEl.style.left = `${left}px`;
  wordPopupEl.style.top = `${top}px`;
}

function toggleWordPopup(anchorEl, text) {
  if (!anchorEl || !text) return;
  if (wordPopupAnchor === anchorEl && wordPopupEl && !wordPopupEl.hidden) {
    hideWordPopup();
    return;
  }
  if (!wordPopupEl) {
    wordPopupEl = document.createElement("div");
    wordPopupEl.className = "word-popup";
    wordPopupEl.hidden = true;
    document.body.appendChild(wordPopupEl);
    window.addEventListener("scroll", positionWordPopup, true);
    window.addEventListener("resize", positionWordPopup);
    document.addEventListener("click", (e) => {
      if (!wordPopupAnchor) return;
      if (wordPopupAnchor.contains(e.target) || wordPopupEl.contains(e.target)) return;
      if (e.target.closest && e.target.closest(".saved-unknown")) return;
      hideWordPopup();
    });
  }
  wordPopupEl.textContent = text;
  wordPopupEl.hidden = false;
  wordPopupAnchor = anchorEl;
  positionWordPopup();
}

// Items saved from a passage: [{ excerpt, meaning }], longest first so a
// saved phrase wins over a single word inside it.
function getSavedItemsForPassage(passageId) {
  if (!passageId || typeof Storage === "undefined") return [];
  const items = [];
  Storage.getWords()
    .filter((w) => w.sourcePassageId === passageId)
    .forEach((w) => items.push({ excerpt: (w.sourceExcerpt || w.targetLang || "").trim(), meaning: w.english || "" }));
  if (Storage.getGrammarNotes) {
    Storage.getGrammarNotes()
      .filter((n) => n.sourcePassageId === passageId)
      .forEach((n) => items.push({ excerpt: (n.sentence || "").trim(), meaning: n.translation || "" }));
  }
  return items.filter((i) => i.excerpt).sort((a, b) => b.excerpt.length - a.excerpt.length);
}

function clearSavedHighlights(container) {
  container.querySelectorAll("mark.saved-unknown").forEach((mark) => {
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

// Wraps the characters [start, end) of `root`'s text in <mark>s — one per
// text node touched, so it works even when the phrase crosses the
// per-word/per-kanji spans the Reading reader uses.
function wrapTextRange(root, start, end, group, meaning) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const pieces = [];
  let pos = 0;
  let node;
  while ((node = walker.nextNode())) {
    const len = node.textContent.length;
    const s = Math.max(start, pos);
    const e = Math.min(end, pos + len);
    if (s < e && !(node.parentNode.closest && node.parentNode.closest("mark.saved-unknown"))) {
      pieces.push({ node, s: s - pos, e: e - pos });
    }
    pos += len;
    if (pos >= end) break;
  }
  pieces.forEach(({ node: textNode, s, e }) => {
    let target = textNode;
    if (s > 0) target = target.splitText(s);
    if (e - s < target.textContent.length) target.splitText(e - s);
    if (!target.textContent.trim()) return;
    const mark = document.createElement("mark");
    mark.className = "saved-unknown";
    mark.dataset.group = group;
    mark.dataset.meaning = meaning;
    target.parentNode.insertBefore(mark, target);
    mark.appendChild(target);
  });
}

function applySavedHighlights(container, passageId) {
  if (!container) return;
  clearSavedHighlights(container);
  const items = getSavedItemsForPassage(passageId);
  if (!items.length) return;

  const blocks = container.querySelectorAll("p").length ? Array.from(container.querySelectorAll("p")) : [container];
  let groupCounter = 0;
  items.forEach((item) => {
    const needle = item.excerpt.toLowerCase();
    blocks.forEach((block) => {
      const hay = block.textContent.toLowerCase();
      let from = 0;
      let idx;
      while ((idx = hay.indexOf(needle, from)) !== -1) {
        const before = idx > 0 ? hay[idx - 1] : " ";
        const after = hay[idx + needle.length] || " ";
        // Whole words only for spaced languages (so "es" doesn't light up
        // inside "este"); Japanese has no spaces, so anything goes there.
        const isCjk = /[぀-ヿ㐀-鿿]/.test(needle);
        if (isCjk || (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after))) {
          wrapTextRange(block, idx, idx + needle.length, `g${groupCounter++}`, item.meaning);
        }
        from = idx + needle.length;
      }
    });
  });

  if (!container.dataset.savedHighlightWired) {
    container.dataset.savedHighlightWired = "true";
    // Capture phase, so tapping a highlight shows its meaning instead of
    // running the normal click-to-look-up on the word underneath.
    container.addEventListener(
      "click",
      (e) => {
        const mark = e.target.closest && e.target.closest("mark.saved-unknown");
        if (!mark || !container.contains(mark)) return;
        e.stopPropagation();
        e.preventDefault();
        const first = container.querySelector(`mark.saved-unknown[data-group="${mark.dataset.group}"]`) || mark;
        toggleWordPopup(first, mark.dataset.meaning || "(no meaning saved)");
      },
      true
    );
  }
}

window.applySavedHighlights = applySavedHighlights;
window.toggleWordPopup = toggleWordPopup;
window.hideWordPopup = hideWordPopup;
