const element = (id) => document.getElementById(id);

function adminPasscode() {
  return element("adminPasscode").value.trim();
}

function adminHeaders(extra = {}) {
  return { "X-Admin-Passcode": adminPasscode(), ...extra };
}

function message(id, text, kind = "") {
  const target = element(id);
  target.textContent = text;
  target.className = `message ${kind}`.trim();
}

async function responseError(response, fallback) {
  const body = await response.json().catch(() => ({}));
  return body.error || fallback;
}

async function loadStatus() {
  message("statusMessage", "");
  if (!adminPasscode()) {
    message("statusMessage", "Enter the administrator passcode.", "error");
    return null;
  }
  element("statusButton").disabled = true;
  try {
    const response = await fetch("/admin/status", { headers: adminHeaders() });
    if (!response.ok) {
      message("statusMessage", await responseError(response, "Could not load status."), "error");
      hideStatus();
      return null;
    }
    const status = await response.json();
    sessionStorage.setItem("adminPasscode", adminPasscode());
    element("itemCount").textContent = String(status.item_count);
    element("participantCount").textContent = String(status.participant_count);
    element("responseCount").textContent = String(status.response_count);
    element("statusGrid").classList.remove("hidden");
    const mode = status.compatibility_mode === "legacy-email-v1" ? "legacy-compatible" : "generic";
    message(
      "statusMessage",
      status.ready
        ? `${status.title} (${status.study_id}); ${mode} export.`
        : "No study bundle has been uploaded.",
      status.ready ? "success" : "error",
    );
    return status;
  } catch {
    message("statusMessage", "Could not connect to the app.", "error");
    hideStatus();
    return null;
  } finally {
    element("statusButton").disabled = false;
  }
}

function hideStatus() {
  element("statusGrid").classList.add("hidden");
}

async function uploadBundle() {
  message("uploadMessage", "");
  const file = element("bundleFile").files[0];
  if (!adminPasscode()) {
    message("uploadMessage", "Enter the administrator passcode first.", "error");
    return;
  }
  if (!file) {
    message("uploadMessage", "Choose a study bundle JSON file.", "error");
    return;
  }

  element("uploadButton").disabled = true;
  try {
    const response = await fetch("/admin/upload-study", {
      method: "POST",
      headers: adminHeaders({
        "Content-Type": "application/json",
        "X-Confirm-Study-Replacement": element("replaceConfirmation").checked
          ? "replace-study"
          : "",
      }),
      body: await file.text(),
    });
    if (!response.ok) {
      message("uploadMessage", await responseError(response, "Upload failed."), "error");
      return;
    }
    const result = await response.json();
    sessionStorage.setItem("adminPasscode", adminPasscode());
    message(
      "uploadMessage",
      `Uploaded ${result.count} items for ${result.title}.`,
      "success",
    );
    await loadStatus();
  } catch {
    message("uploadMessage", "Upload failed. Check your connection and try again.", "error");
  } finally {
    element("uploadButton").disabled = false;
  }
}

async function download(path, filename) {
  message("downloadMessage", "");
  if (!adminPasscode()) {
    message("downloadMessage", "Enter the administrator passcode first.", "error");
    return;
  }

  try {
    const response = await fetch(path, { headers: adminHeaders() });
    if (!response.ok) {
      message("downloadMessage", await responseError(response, "Download failed."), "error");
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    sessionStorage.setItem("adminPasscode", adminPasscode());
    message("downloadMessage", `Downloaded ${filename}.`, "success");
  } catch {
    message("downloadMessage", "Download failed. Check your connection and try again.", "error");
  }
}

element("statusButton").addEventListener("click", loadStatus);
element("uploadButton").addEventListener("click", uploadBundle);
element("downloadCsvButton").addEventListener("click", () =>
  download("/admin/responses.csv", "responses.csv"),
);
element("downloadJsonButton").addEventListener("click", () =>
  download("/admin/responses.json", "responses-backup.json"),
);

const savedPasscode = sessionStorage.getItem("adminPasscode");
if (savedPasscode) element("adminPasscode").value = savedPasscode;
