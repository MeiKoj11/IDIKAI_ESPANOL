/*
  section-links.js
  ----------------
  A small reusable "Linked" bar that attaches links between any two items
  in the app (a Reading passage <-> a Vocab Bank theme, a grammar folder,
  a writing entry...). Links are two-way: linking a passage to a vocab
  theme also shows the passage on that theme's page.

  Usage: initSectionLinks(containerEl, { type, id, language })
    type: "passage" | "vocabTheme" | "grammarTheme" | "writing"
  Data lives in Storage (getSectionLinks / addSectionLink / removeSectionLink).
*/

const SECTION_LINK_TYPES = {
  vocabTheme: {
    label: "Vocab theme",
    list: (lang) => Storage.getThemes().filter((t) => t.language === lang && t.type !== "folder"),
    get: (id) => Storage.getTheme(id),
    name: (t) => t.name,
    href: (t) => `theme.html?id=${encodeURIComponent(t.id)}`,
  },
  passage: {
    label: "Reading passage",
    list: (lang) => Storage.getPassages().filter((p) => p.language === lang),
    get: (id) => Storage.getPassage(id),
    name: (p) => p.title || "Untitled passage",
    href: (p) => `passage.html?id=${encodeURIComponent(p.id)}`,
  },
  grammarTheme: {
    label: "Grammar folder",
    list: (lang) => Storage.getGrammarThemes(lang),
    get: (id) => Storage.getGrammarTheme(id),
    name: (t) => t.name,
    href: (t) => `grammar-theme.html?id=${encodeURIComponent(t.id)}`,
  },
  writing: {
    label: "Writing entry",
    list: (lang) => Storage.getWritingEntries(lang),
    get: (id) => Storage.getWritingEntries().find((e) => e.id === id) || null,
    name: (e) => e.title || (e.date ? `Entry ${e.date}` : "Writing entry"),
    href: (e) => `writing-entry.html?id=${encodeURIComponent(e.id)}`,
  },
};

function initSectionLinks(container, ctx) {
  if (!container || !ctx || !ctx.id || typeof Storage === "undefined" || !Storage.getSectionLinks) return;
  container.classList.add("section-links");
  renderSectionLinks(container, ctx);
}

function renderSectionLinks(container, ctx) {
  container.innerHTML = "";

  const label = document.createElement("span");
  label.className = "section-links-label";
  label.textContent = "Linked:";
  container.appendChild(label);

  Storage.getSectionLinks(ctx.type, ctx.id).forEach((link) => {
    const def = SECTION_LINK_TYPES[link.type];
    const item = def && def.get(link.id);
    if (!item) return;
    const chip = document.createElement("span");
    chip.className = "chip section-link-chip";
    const a = document.createElement("a");
    a.href = def.href(item);
    a.textContent = `${def.label}: ${def.name(item)}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "section-link-remove";
    remove.setAttribute("aria-label", "Remove link");
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      Storage.removeSectionLink(link.linkId);
      renderSectionLinks(container, ctx);
    });
    chip.append(a, remove);
    container.appendChild(chip);
  });

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "section-link-add";
  addBtn.textContent = "+ Link";
  container.appendChild(addBtn);

  const picker = document.createElement("span");
  picker.className = "section-link-picker";
  picker.hidden = true;
  const typeSelect = document.createElement("select");
  Object.keys(SECTION_LINK_TYPES)
    .filter((t) => !(t === ctx.type))
    .forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = SECTION_LINK_TYPES[t].label;
      typeSelect.appendChild(opt);
    });
  const itemSelect = document.createElement("select");
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "section-link-add";
  confirm.textContent = "Add";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "section-link-add";
  cancel.textContent = "Cancel";
  picker.append(typeSelect, itemSelect, confirm, cancel);
  container.appendChild(picker);

  const fillItems = () => {
    const def = SECTION_LINK_TYPES[typeSelect.value];
    const already = new Set(Storage.getSectionLinks(ctx.type, ctx.id).filter((l) => l.type === typeSelect.value).map((l) => l.id));
    itemSelect.innerHTML = "";
    def.list(ctx.language)
      .filter((item) => !already.has(item.id))
      .forEach((item) => {
        const opt = document.createElement("option");
        opt.value = item.id;
        opt.textContent = def.name(item);
        itemSelect.appendChild(opt);
      });
    confirm.disabled = !itemSelect.options.length;
  };
  typeSelect.addEventListener("change", fillItems);

  addBtn.addEventListener("click", () => {
    picker.hidden = false;
    addBtn.hidden = true;
    fillItems();
  });
  cancel.addEventListener("click", () => renderSectionLinks(container, ctx));
  confirm.addEventListener("click", () => {
    if (!itemSelect.value) return;
    Storage.addSectionLink(ctx.type, ctx.id, typeSelect.value, itemSelect.value);
    renderSectionLinks(container, ctx);
  });
}

// The first linked vocab theme for an item — used e.g. to pre-select the
// theme when saving words from a linked passage.
function getFirstLinkedId(type, id, wantedType) {
  if (typeof Storage === "undefined" || !Storage.getSectionLinks) return null;
  const link = Storage.getSectionLinks(type, id).find((l) => l.type === wantedType && SECTION_LINK_TYPES[wantedType].get(l.id));
  return link ? link.id : null;
}

window.initSectionLinks = initSectionLinks;
window.getFirstLinkedId = getFirstLinkedId;
