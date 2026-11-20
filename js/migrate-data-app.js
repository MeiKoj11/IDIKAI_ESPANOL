/*
  migrate-data-app.js
  --------------------
  One-time bridge from "data trapped in this one browser's
  localStorage" to "data attached to your account." Snapshots every
  key this browser has ever saved under localStorage (not just a
  hardcoded list — anything the app ever wrote) and hands it to
  /api/import, which only fills in keys the account doesn't already
  have a value for. Not linked from the app's normal navigation —
  visit it directly, once, on the browser/computer that has your
  existing data.
*/

document.addEventListener("DOMContentLoaded", () => {
  fetch("/api/me").then((res) => {
    if (res.status === 401) {
      window.location.href = "login.html?return=" + encodeURIComponent(window.location.pathname);
    }
  });

  const statusEl = document.getElementById("migrate-status");
  const btn = document.getElementById("migrate-btn");

  btn.addEventListener("click", () => {
    btn.disabled = true;
    statusEl.textContent = "Reading this browser's saved data…";

    const snapshot = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const raw = localStorage.getItem(key);
      try {
        snapshot[key] = JSON.parse(raw);
      } catch (e) {
        snapshot[key] = raw; // not JSON — keep the raw string as-is
      }
    }

    const keyCount = Object.keys(snapshot).length;
    if (keyCount === 0) {
      statusEl.textContent = "This browser doesn't have any saved data to import.";
      btn.disabled = false;
      return;
    }

    statusEl.textContent = `Found ${keyCount} saved item(s) in this browser. Uploading…`;

    fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: snapshot }),
    })
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        btn.disabled = false;
        if (!ok) {
          statusEl.textContent = `Something went wrong: ${body.error || "unknown error"}.`;
          return;
        }
        statusEl.textContent = `Done — imported ${body.imported} item(s). ${body.skipped} were skipped because your account already had a value for them.`;
      })
      .catch(() => {
        btn.disabled = false;
        statusEl.textContent = "Could not reach the server. Check your connection and try again.";
      });
  });

  // Import from an /api/export JSON file (e.g. moving data from the main
  // Idikai site to this one). The export is already the exact
  // { key: value } shape /api/import expects.
  const fileInput = document.getElementById("import-file");
  const fileBtn = document.getElementById("import-file-btn");
  const fileStatus = document.getElementById("import-file-status");
  const overwriteBox = document.getElementById("import-overwrite");

  fileBtn.addEventListener("click", () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      fileStatus.textContent = "Choose your export file first.";
      return;
    }
    fileBtn.disabled = true;
    fileStatus.textContent = "Reading file…";
    file.text()
      .then((text) => {
        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          throw new Error("That file isn't a valid Idikai export.");
        }
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          throw new Error("That file isn't a valid Idikai export.");
        }
        fileStatus.textContent = `Uploading ${Object.keys(data).length} item(s)…`;
        return fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data, overwrite: overwriteBox.checked }),
        }).then((res) => res.json().then((body) => ({ ok: res.ok, body })));
      })
      .then(({ ok, body }) => {
        fileBtn.disabled = false;
        if (!ok) {
          fileStatus.textContent = `Something went wrong: ${body.error || "unknown error"}.`;
          return;
        }
        fileStatus.textContent = `Done — imported ${body.imported} item(s)` +
          (body.skipped ? `, skipped ${body.skipped} the account already had.` : ".") +
          " Close any other Idikai tabs, then reload the app to see your data.";
      })
      .catch((err) => {
        fileBtn.disabled = false;
        fileStatus.textContent = err.message || "Could not reach the server. Check your connection and try again.";
      });
  });
});
