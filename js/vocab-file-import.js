/*
  vocab-file-import.js
  --------------------
  Adds an "Upload screenshot / photo / PDF" button under a vocab-list
  paste box (add-vocab.html's bulk import, add-random-vocab.html). Each
  chosen file is transcribed by the server (/extract-text, purpose
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

  const wrap = document.createElement("div");
  wrap.className = "vocab-file-import";

  const input = document.createElement("input");
  input.type = "file";
  input.accept = VOCAB_FILE_TYPES.join(",");
  input.multiple = true;
  input.hidden = true;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "vocab-file-import-btn";
  btn.textContent = "Upload screenshot / photo / PDF";
  btn.dataset.immersionKey = "uploadVocabFileButton";

  const status = document.createElement("p");
  status.className = "hint";
  status.hidden = true;

  const setStatus = (msg) => {
    status.hidden = !msg;
    status.textContent = msg || "";
  };

  btn.addEventListener("click", () => input.click());

  input.addEventListener("change", async () => {
    const files = Array.from(input.files || []);
    input.value = "";
    if (!files.length) return;

    btn.disabled = true;
    let added = 0;
    const problems = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setStatus(`Reading ${file.name} (${i + 1} of ${files.length})...`);
      if (!VOCAB_FILE_TYPES.includes(file.type)) {
        problems.push(`${file.name}: use a PNG, JPG, GIF, WEBP or PDF (iPhone HEIC photos: take a screenshot of it instead).`);
        continue;
      }
      if (file.size > VOCAB_FILE_MAX_BYTES) {
        problems.push(`${file.name}: too large (max 10MB) — try cropping it or splitting the PDF.`);
        continue;
      }
      try {
        const base64 = await vocabFileToBase64(file);
        const { text, error } = await Translate.extractTextFromImage(base64, file.type, "list");
        if (!text) {
          problems.push(`${file.name}: ${error || "no text found."}`);
          continue;
        }
        textarea.value = textarea.value.trim() ? textarea.value.trimEnd() + "\n" + text : text;
        added++;
      } catch (e) {
        problems.push(`${file.name}: ${e.message}`);
      }
    }

    btn.disabled = false;
    const done = added
      ? `Added text from ${added} file(s) to the box above — check it, then click "Extract flashcards".`
      : "";
    setStatus([done].concat(problems).filter(Boolean).join(" "));
  });

  wrap.appendChild(btn);
  wrap.appendChild(input);
  wrap.appendChild(status);
  textarea.insertAdjacentElement("afterend", wrap);
}

document.addEventListener("DOMContentLoaded", () => {
  attachVocabFileImport("bulk-import-text");
  attachVocabFileImport("random-vocab-text");
});
