/*
  vocab-file-import.js
  --------------------
  Makes a vocab-list paste box (add-vocab.html's bulk import,
  add-random-vocab.html) a drag-and-drop target. Each dropped image/PDF
  is transcribed by the server (/extract-text, purpose
  "list") and the text is appended to the textarea, so the learner can
  check it before clicking the existing "Extract flashcards" button.
*/

const VOCAB_FILE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"];
const VOCAB_FILE_MAX_BYTES = 10 * 1024 * 1024; // stays under the server's 15MB base64 body cap

function vocabFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });
}

function attachVocabFileImport(textareaId) {
  const textarea = document.getElementById(textareaId);
  if (!textarea || textarea.dataset.fileImportAttached) return;
  textarea.dataset.fileImportAttached = "1";

  const hint = document.createElement("p");
  hint.className = "hint vocab-file-drop-hint";
  hint.textContent = "Or drag a screenshot, photo, PDF or text file onto the box.";
  hint.dataset.immersionKey = "dropVocabFileHint";

  const status = document.createElement("p");
  status.className = "hint";
  status.hidden = true;

  const setStatus = (msg) => {
    status.hidden = !msg;
    status.textContent = msg || "";
  };

  const appendText = (text) => {
    textarea.value = textarea.value.trim() ? textarea.value.trimEnd() + "\n" + text : text;
  };

  async function handleFiles(files) {
    if (!files.length) return;
    textarea.classList.add("vocab-file-busy");
    let added = 0;
    const problems = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setStatus(`Reading ${file.name} (${i + 1} of ${files.length})...`);
      try {
        // Plain-text files (.txt, .csv, ...) are read straight in — no AI needed.
        if (file.type.startsWith("text/") || /\.(txt|csv|tsv|md)$/i.test(file.name)) {
          const text = (await file.text()).trim();
          if (text) { appendText(text); added++; } else problems.push(`${file.name}: file is empty.`);
          continue;
        }
        if (!VOCAB_FILE_TYPES.includes(file.type)) {
          problems.push(`${file.name}: can't read this file type — use a screenshot, photo (PNG/JPG), PDF or text file. For Word files, save as PDF first; for iPhone HEIC photos, take a screenshot.`);
          continue;
        }
        if (file.size > VOCAB_FILE_MAX_BYTES) {
          problems.push(`${file.name}: too large (max 10MB) — try cropping it or splitting the PDF.`);
          continue;
        }
        const base64 = await vocabFileToBase64(file);
        const { text, error } = await Translate.extractTextFromImage(base64, file.type, "list");
        if (!text) {
          problems.push(`${file.name}: ${error || "no text found."}`);
          continue;
        }
        appendText(text);
        added++;
      } catch (e) {
        problems.push(`${file.name}: ${e.message}`);
      }
    }

    textarea.classList.remove("vocab-file-busy");
    const done = added
      ? `Added text from ${added} file(s) — check it, then click "Extract flashcards".`
      : "";
    setStatus([done].concat(problems).filter(Boolean).join(" "));
  }

  // Drag-and-drop onto the paste box itself.
  let dragDepth = 0;
  textarea.addEventListener("dragenter", (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    dragDepth++;
    textarea.classList.add("vocab-file-dragover");
  });
  textarea.addEventListener("dragover", (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  textarea.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) textarea.classList.remove("vocab-file-dragover");
  });
  textarea.addEventListener("drop", (e) => {
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (!files.length) return; // dropped plain text — let the browser insert it
    e.preventDefault();
    dragDepth = 0;
    textarea.classList.remove("vocab-file-dragover");
    handleFiles(files);
  });

  textarea.insertAdjacentElement("afterend", status);
  textarea.insertAdjacentElement("afterend", hint);
}

document.addEventListener("DOMContentLoaded", () => {
  attachVocabFileImport("bulk-import-text");
  attachVocabFileImport("random-vocab-text");
});
