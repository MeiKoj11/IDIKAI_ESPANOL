/*
  class-notebook-textbook.js
  --------------------------
  The "Textbook" side panel of the Class Notebook: open a PDF from the
  Storage Locker beside your notes, flip through it, and tie a notebook
  page to a textbook page ("Book p. 41") so you can jump straight back.

  How the pieces fit:
  - PDFs are the Storage Locker's uploaded files (items with a fileKey
    ending in .pdf, see personal-hub.js). They're fetched through
    /api/storage-locker-file-data -- a same-origin stream of the bytes --
    because the Locker's normal download link redirects to a different
    (R2) address that the browser wouldn't let pdf.js read.
  - pdf.js (loaded by class-notebook.html as the global `pdfjsLib`) draws
    one page at a time onto a <canvas>.
  - Where you were in each book is saved on its Locker item
    (lastPage / lastOpenedAt). Which textbook page a notebook page goes
    with is saved on the notebook page itself as bookLink: { itemId, page }.
  - class-notebook-app.js owns the notebook; this file only calls its
    setNotebookTextbookMode() / getCurrentNotebookPageInfo(), and it
    exposes window.refreshNotebookBookTags() for the notebook to call
    whenever a different page comes to the front.
*/

const TEXTBOOK_WORKER_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const TEXTBOOK_ZOOM_STEPS = [0.6, 0.8, 1, 1.25, 1.5, 2, 2.5, 3];

let textbookItem = null; // the Locker item currently open
let textbookDoc = null; // the loaded pdf.js document
let textbookPage = 1;
let textbookZoomIndex = 2; // 1x = fit to the panel's width
let textbookRenderToken = 0;
let textbookSaveTimeout = null;

document.addEventListener("DOMContentLoaded", () => {
  const panel = document.getElementById("textbook-panel");
  if (!panel) return; // not this page

  if (typeof pdfjsLib !== "undefined") {
    pdfjsLib.GlobalWorkerOptions.workerSrc = TEXTBOOK_WORKER_SRC;
  }

  const on = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", fn);
  };
  on("notebook-textbook-btn", toggleTextbookPanel);
  on("textbook-close-btn", closeTextbookPanel);
  on("textbook-change-btn", openTextbookPicker);
  on("textbook-prev-btn", () => goToTextbookPage(textbookPage - 1));
  on("textbook-next-btn", () => goToTextbookPage(textbookPage + 1));
  on("textbook-zoom-in-btn", () => changeTextbookZoom(1));
  on("textbook-zoom-out-btn", () => changeTextbookZoom(-1));
  on("textbook-link-btn", toggleTextbookLink);
  on("notebook-left-booktag", () => openFromBookTag("left"));
  on("notebook-right-booktag", () => openFromBookTag("right"));

  const pageInput = document.getElementById("textbook-page-input");
  if (pageInput) {
    pageInput.addEventListener("change", () => {
      const n = parseInt(pageInput.value, 10);
      if (isNaN(n)) pageInput.value = String(textbookPage);
      else goToTextbookPage(n);
    });
  }

  // The picker is a plain modal; clicking the dark backdrop closes it.
  const picker = document.getElementById("textbook-picker");
  if (picker) picker.addEventListener("click", closeTextbookPicker);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && picker && !picker.hidden) closeTextbookPicker();
  });

  // Re-draw at the new width when the window (and so the panel) resizes.
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (textbookDoc) renderTextbookPage();
    }, 200);
  });
  window.addEventListener("pagehide", saveTextbookProgressNow);

  window.refreshNotebookBookTags = refreshNotebookBookTags;
  refreshNotebookBookTags();
});

// ---- Panel open / close ----

function isTextbookPanelOpen() {
  const panel = document.getElementById("textbook-panel");
  return !!panel && !panel.hidden;
}

function toggleTextbookPanel() {
  if (isTextbookPanelOpen()) closeTextbookPanel();
  else openTextbookPanel();
}

function openTextbookPanel(skipAutoLoad) {
  const panel = document.getElementById("textbook-panel");
  panel.hidden = false;
  document.body.classList.add("textbook-open");
  const btn = document.getElementById("notebook-textbook-btn");
  if (btn) {
    btn.classList.add("active");
    btn.setAttribute("aria-pressed", "true");
  }
  flushClassNotebookSaves();
  setNotebookTextbookMode(true);

  if (textbookItem || skipAutoLoad) return;
  // Reopen whichever book was used last; otherwise ask which one.
  const items = getTextbookPdfItems();
  const lastUsed = items.slice().sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0))[0];
  if (lastUsed && lastUsed.lastOpenedAt) loadTextbook(lastUsed);
  else openTextbookPicker();
}

function closeTextbookPanel() {
  const panel = document.getElementById("textbook-panel");
  if (!panel) return;
  saveTextbookProgressNow();
  panel.hidden = true;
  document.body.classList.remove("textbook-open");
  const btn = document.getElementById("notebook-textbook-btn");
  if (btn) {
    btn.classList.remove("active");
    btn.setAttribute("aria-pressed", "false");
  }
  setNotebookTextbookMode(false);
}

// ---- Choosing a book (from the Storage Locker) ----

function getTextbookPdfItems() {
  return Storage.getStorageLockerItems(classNotebookLang).filter(
    (i) => i.fileKey && /\.pdf$/i.test(i.fileKey)
  );
}

function openTextbookPicker() {
  const picker = document.getElementById("textbook-picker");
  if (!picker) return;
  picker.innerHTML = "";

  const box = document.createElement("div");
  box.className = "notebook-link-modal-box textbook-picker-box";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Open a textbook");
  box.addEventListener("click", (e) => e.stopPropagation());

  const heading = document.createElement("h2");
  heading.textContent = "Open a textbook";
  box.appendChild(heading);

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "PDFs from your Storage Locker. It opens beside your notes.";
  box.appendChild(hint);

  const items = getTextbookPdfItems()
    .slice()
    .sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0) || (b.createdAt || 0) - (a.createdAt || 0));

  const list = document.createElement("div");
  list.className = "link-option-list textbook-picker-list";
  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "No PDFs in your Storage Locker yet. Upload one there first, then come back.";
    list.appendChild(empty);
  }
  items.forEach((item, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "link-option textbook-picker-row";
    const title = document.createElement("strong");
    title.textContent = item.title || item.fileName || "Untitled PDF";
    const sub = document.createElement("span");
    sub.className = "textbook-picker-sub";
    sub.textContent = item.lastPage ? `You were on p. ${item.lastPage}` : "Not opened yet";
    btn.appendChild(title);
    btn.appendChild(sub);
    if (index === 0 && item.lastOpenedAt) {
      const badge = document.createElement("span");
      badge.className = "textbook-picker-badge";
      badge.textContent = "Last used";
      btn.appendChild(badge);
    }
    btn.addEventListener("click", () => {
      closeTextbookPicker();
      loadTextbook(item);
    });
    list.appendChild(btn);
  });
  box.appendChild(list);

  const actions = document.createElement("div");
  actions.className = "link-modal-actions";
  const lockerBtn = document.createElement("button");
  lockerBtn.type = "button";
  lockerBtn.className = "secondary";
  lockerBtn.textContent = "Open Storage Locker";
  lockerBtn.addEventListener("click", () => {
    window.open(`personal-hub.html?lang=${classNotebookLang}`, "_blank", "noopener");
  });
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", closeTextbookPicker);
  actions.appendChild(lockerBtn);
  actions.appendChild(cancelBtn);
  box.appendChild(actions);

  picker.appendChild(box);
  picker.hidden = false;
}

function closeTextbookPicker() {
  const picker = document.getElementById("textbook-picker");
  if (!picker) return;
  picker.hidden = true;
  picker.innerHTML = "";
}

// ---- Loading and drawing ----

function setTextbookStatus(text) {
  const el = document.getElementById("textbook-status");
  if (!el) return;
  el.textContent = text || "";
  el.hidden = !text;
}

// Returns a promise that resolves once the book is open on `page`
// (or the page it was last left on).
function loadTextbook(item, page) {
  saveTextbookProgressNow();
  if (typeof pdfjsLib === "undefined") {
    setTextbookStatus("The PDF viewer couldn't load. Check your internet connection and reload the page.");
    return Promise.resolve();
  }
  textbookItem = item;
  textbookDoc = null;
  const title = document.getElementById("textbook-title");
  if (title) title.textContent = item.title || item.fileName || "Textbook";
  const canvas = document.getElementById("textbook-canvas");
  if (canvas) canvas.hidden = true;
  setTextbookStatus("Loading your textbook…");
  updateTextbookControls();

  const url = `/api/storage-locker-file-data?key=${encodeURIComponent(item.fileKey)}`;
  return pdfjsLib
    .getDocument({ url })
    .promise.then((doc) => {
      if (textbookItem !== item) return; // switched books while loading
      textbookDoc = doc;
      textbookPage = clampTextbookPage(page || item.lastPage || 1);
      Storage.updateStorageLockerItem(item.id, { lastOpenedAt: Date.now() });
      setTextbookStatus("");
      return renderTextbookPage();
    })
    .catch((err) => {
      console.error(err);
      if (textbookItem !== item) return;
      setTextbookStatus("Couldn't open that PDF. It may have been removed from your Storage Locker.");
    });
}

function clampTextbookPage(n) {
  const total = textbookDoc ? textbookDoc.numPages : 1;
  return Math.max(1, Math.min(total, n));
}

function renderTextbookPage() {
  if (!textbookDoc) return Promise.resolve();
  const token = ++textbookRenderToken;
  const pageNum = textbookPage;
  updateTextbookControls();
  return textbookDoc.getPage(pageNum).then((page) => {
    if (token !== textbookRenderToken) return; // a newer render took over
    const view = document.getElementById("textbook-view");
    const canvas = document.getElementById("textbook-canvas");
    const available = Math.max(200, (view ? view.clientWidth : 480) - 32);
    const base = page.getViewport({ scale: 1 });
    const cssScale = (available / base.width) * TEXTBOOK_ZOOM_STEPS[textbookZoomIndex];
    const ratio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: cssScale * ratio });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
    canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
    canvas.hidden = false;
    return page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise.catch(() => {});
  });
}

function goToTextbookPage(n) {
  if (!textbookDoc) return;
  const target = clampTextbookPage(n);
  const input = document.getElementById("textbook-page-input");
  if (target === textbookPage) {
    if (input) input.value = String(textbookPage);
    return;
  }
  textbookPage = target;
  const view = document.getElementById("textbook-view");
  if (view) view.scrollTop = 0;
  scheduleTextbookProgressSave();
  renderTextbookPage();
}

function changeTextbookZoom(delta) {
  const next = Math.max(0, Math.min(TEXTBOOK_ZOOM_STEPS.length - 1, textbookZoomIndex + delta));
  if (next === textbookZoomIndex) return;
  textbookZoomIndex = next;
  renderTextbookPage();
}

function updateTextbookControls() {
  const input = document.getElementById("textbook-page-input");
  const total = document.getElementById("textbook-page-total");
  if (input) input.value = String(textbookPage);
  if (total) total.textContent = textbookDoc ? `of ${textbookDoc.numPages}` : "of –";
  const prev = document.getElementById("textbook-prev-btn");
  const next = document.getElementById("textbook-next-btn");
  if (prev) prev.disabled = !textbookDoc || textbookPage <= 1;
  if (next) next.disabled = !textbookDoc || textbookPage >= textbookDoc.numPages;
  refreshNotebookBookTags();
}

// Remember where you were in this book (a moment after you stop flipping).
function scheduleTextbookProgressSave() {
  clearTimeout(textbookSaveTimeout);
  textbookSaveTimeout = setTimeout(saveTextbookProgressNow, 800);
}

function saveTextbookProgressNow() {
  clearTimeout(textbookSaveTimeout);
  textbookSaveTimeout = null;
  if (textbookItem && textbookDoc) {
    Storage.updateStorageLockerItem(textbookItem.id, { lastPage: textbookPage });
    textbookItem.lastPage = textbookPage;
  }
}

// ---- Tying a notebook page to a textbook page ----

function getNotebookPageBookLink(pageId) {
  const page = Storage.getClassNotebookPages(classNotebookLang).find((p) => p.id === pageId);
  return page && page.bookLink ? page.bookLink : null;
}

function toggleTextbookLink() {
  if (!textbookItem || !textbookDoc) return;
  const info = getCurrentNotebookPageInfo();
  if (!info.id) return;
  const existing = getNotebookPageBookLink(info.id);
  const sameAsNow = existing && existing.itemId === textbookItem.id && existing.page === textbookPage;
  Storage.updateClassNotebookPageMeta(info.id, {
    bookLink: sameAsNow ? null : { itemId: textbookItem.id, page: textbookPage },
  });
  refreshNotebookBookTags();
}

// The "Book p. N" tags in the notebook page headers, plus the label on the
// panel's link button. Cheap enough to just rebuild from storage each time.
function refreshNotebookBookTags() {
  const pages = Storage.getClassNotebookPages(classNotebookLang);
  const items = Storage.getStorageLockerItems(classNotebookLang);
  [
    { side: "left", id: leftPageId },
    { side: "right", id: rightPageId },
  ].forEach(({ side, id }) => {
    const tag = document.getElementById(`notebook-${side}-booktag`);
    if (!tag) return;
    const page = pages.find((p) => p.id === id);
    const link = page && page.bookLink;
    if (!link) {
      tag.hidden = true;
      tag.textContent = "";
      return;
    }
    const book = items.find((i) => i.id === link.itemId);
    tag.hidden = false;
    tag.textContent = `Book p. ${link.page}`;
    tag.title = book ? `Open "${book.title || book.fileName}" at page ${link.page}` : "That textbook is no longer in your Storage Locker";
    tag.classList.toggle("notebook-book-tag-broken", !book);
  });

  const linkBtn = document.getElementById("textbook-link-btn");
  if (!linkBtn) return;
  if (!textbookItem || !textbookDoc) {
    linkBtn.disabled = true;
    linkBtn.textContent = "Open a book to link a page";
    return;
  }
  const info = getCurrentNotebookPageInfo();
  const existing = info.id ? getNotebookPageBookLink(info.id) : null;
  linkBtn.disabled = false;
  if (existing && existing.itemId === textbookItem.id && existing.page === textbookPage) {
    linkBtn.textContent = `Notebook page ${info.number} is linked to book p. ${textbookPage} (click to remove)`;
    linkBtn.classList.add("is-linked");
  } else {
    linkBtn.textContent = `Link notebook page ${info.number} to book p. ${textbookPage}`;
    linkBtn.classList.remove("is-linked");
  }
}

function openFromBookTag(side) {
  const pageId = side === "right" ? rightPageId : leftPageId;
  const link = getNotebookPageBookLink(pageId);
  if (!link) return;
  const book = Storage.getStorageLockerItems(classNotebookLang).find((i) => i.id === link.itemId);
  if (!book) {
    window.alert("That textbook isn't in your Storage Locker any more.");
    return;
  }
  // Tapping the tag on the page you're looking at should jump to its page.
  if (!isTextbookPanelOpen()) {
    lastFocusedNotebookPage = side;
    openTextbookPanel(true);
  }
  if (textbookItem && textbookItem.id === book.id && textbookDoc) {
    goToTextbookPage(link.page);
  } else {
    loadTextbook(book, link.page);
  }
}
