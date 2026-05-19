// file:// opens have an empty hostname — treat them as localhost too.
const API_BASE = (
  window.location.hostname === "localhost"  ||
  window.location.hostname === "127.0.0.1" ||
  window.location.hostname === ""
) ? "http://localhost:8000" : window.location.origin;

// ── DOM refs ────────────────────────────────────
const dropzone        = document.getElementById("dropzone");
const fileInput       = document.getElementById("fileInput");
const fileInfo        = document.getElementById("fileInfo");
const fileName        = document.getElementById("fileName");
const fileSize        = document.getElementById("fileSize");
const clearFileBtn    = document.getElementById("clearFile");
const recordBtn       = document.getElementById("recordBtn");
const recordBtnText   = document.getElementById("recordBtnText");
const recordTimer     = document.getElementById("recordTimer");
const transcribeBtn   = document.getElementById("transcribeBtn");
const transcribeBtnTx = document.getElementById("transcribeBtnText");
const progressContainer = document.getElementById("progressContainer");
const progressText    = document.getElementById("progressText");
const resultCard      = document.getElementById("resultCard");
const resultMeta      = document.getElementById("resultMeta");
const resultText      = document.getElementById("resultText");
const copyBtn         = document.getElementById("copyBtn");
const downloadBtn     = document.getElementById("downloadBtn");
const errorCard       = document.getElementById("errorCard");
const errorText       = document.getElementById("errorText");
const errorDismiss    = document.getElementById("errorDismiss");
const logCard         = document.getElementById("logCard");
const logBody         = document.getElementById("logBody");
const logBadge        = document.getElementById("logBadge");
const youtubeInput    = document.getElementById("youtubeInput");
const youtubeBtn      = document.getElementById("youtubeBtn");

// ── State ───────────────────────────────────────
let selectedFile = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordSeconds = 0;
let timerInterval = null;
let downloadId = null;

// ── File Selection ──────────────────────────────
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) setFile(fileInput.files[0]);
});

dropzone.addEventListener("click", () => fileInput.click());

// Prevent the label's click from bubbling to the dropzone and triggering a second open
document.querySelector('label[for="fileInput"]').addEventListener("click", (e) => e.stopPropagation());

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag-over");
});

dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));

dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag-over");
  const f = e.dataTransfer.files[0];
  if (f) setFile(f);
});

function setFile(f) {
  selectedFile = f;
  fileName.textContent = f.name;
  fileSize.textContent = formatBytes(f.size);
  fileInfo.hidden = false;
  transcribeBtn.disabled = false;
  hideError();
  hideResult();
}

clearFileBtn.addEventListener("click", () => {
  selectedFile = null;
  fileInput.value = "";
  fileInfo.hidden = true;
  transcribeBtn.disabled = true;
  hideResult();
});

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

// ── Recording ───────────────────────────────────
recordBtn.addEventListener("click", async () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    stopRecording();
  } else {
    await startRecording();
  }
});

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
      const ext = mediaRecorder.mimeType.includes("ogg") ? "ogg" : "webm";
      const file = new File([blob], `recording.${ext}`, { type: mediaRecorder.mimeType });
      setFile(file);
      stream.getTracks().forEach(t => t.stop());
    };

    mediaRecorder.start(100);
    recordBtn.classList.add("recording");
    recordBtnText.textContent = "Stop Recording";
    recordSeconds = 0;
    recordTimer.hidden = false;
    updateTimerDisplay();
    timerInterval = setInterval(() => {
      recordSeconds++;
      updateTimerDisplay();
    }, 1000);
  } catch (err) {
    showError("Microphone access denied or unavailable: " + err.message);
  }
}

function stopRecording() {
  mediaRecorder.stop();
  clearInterval(timerInterval);
  recordBtn.classList.remove("recording");
  recordBtnText.textContent = "Start Recording";
  recordTimer.hidden = true;
}

function updateTimerDisplay() {
  const m = String(Math.floor(recordSeconds / 60)).padStart(2, "0");
  const s = String(recordSeconds % 60).padStart(2, "0");
  recordTimer.textContent = `${m}:${s}`;
}

function getSupportedMimeType() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || "";
}

// ── Shared polling helper ───────────────────────
async function _pollJob(job_id, progressLabel) {
  showLog();
  let elapsed = 0;
  let lastLogCount = 0;

  while (true) {
    await new Promise(r => setTimeout(r, 3000));
    elapsed += 3;

    const statusRes = await fetch(`${API_BASE}/status/${job_id}`);
    const data = await statusRes.json();

    const lines = data.logs || [];
    if (lines.length > lastLogCount) {
      appendLogs(lines.slice(lastLogCount));
      lastLogCount = lines.length;
    }

    if (data.status === "done") {
      setLogBadge("done");
      hideProgress();
      showResult(data);
      return;
    }

    if (data.status === "error") {
      setLogBadge("error");
      throw new Error(data.error || "Transcription failed on the server.");
    }

    setProgressText(`${progressLabel} (${elapsed}s elapsed)`);
  }
}

// ── File transcription ──────────────────────────
transcribeBtn.addEventListener("click", transcribe);

async function transcribe() {
  if (!selectedFile) return;

  hideError();
  hideResult();
  showProgress("Uploading audio...");
  transcribeBtn.disabled = true;
  transcribeBtnTx.textContent = "Processing...";

  const formData = new FormData();
  formData.append("file", selectedFile);

  try {
    const uploadRes = await fetch(`${API_BASE}/transcribe`, {
      method: "POST",
      body: formData,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({}));
      throw new Error(err.detail || `Upload failed: ${uploadRes.status}`);
    }

    const { job_id } = await uploadRes.json();
    setProgressText("Transcribing Tamil audio with openai/whisper-large-v3 — this may take a minute...");
    await _pollJob(job_id, "Transcribing Tamil audio...");

  } catch (err) {
    hideProgress();
    showError(err.message || "Transcription failed. Is the backend running?");
  } finally {
    transcribeBtn.disabled = false;
    transcribeBtnTx.textContent = "Transcribe Audio";
  }
}

// ── YouTube transcription ───────────────────────
youtubeBtn.addEventListener("click", transcribeYoutube);

async function transcribeYoutube() {
  const url = youtubeInput.value.trim();
  if (!url) return;

  hideError();
  hideResult();
  showProgress("Sending YouTube link to server...");
  youtubeBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/transcribe-youtube`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Request failed: ${res.status}`);
    }

    const { job_id } = await res.json();
    setProgressText("Downloading YouTube audio and transcribing...");
    await _pollJob(job_id, "Downloading & transcribing YouTube audio...");

  } catch (err) {
    hideProgress();
    showError(err.message || "YouTube transcription failed. Is the backend running?");
  } finally {
    youtubeBtn.disabled = false;
  }
}

// ── UI Helpers ──────────────────────────────────
function showProgress(msg) {
  progressText.textContent = msg;
  progressContainer.hidden = false;
}
function setProgressText(msg) { progressText.textContent = msg; }
function hideProgress() { progressContainer.hidden = true; }

function showLog() {
  logBody.innerHTML = "";
  logBadge.textContent = "processing";
  logBadge.className = "log-badge";
  logCard.hidden = false;
}

function appendLogs(lines) {
  lines.forEach(line => {
    const span = document.createElement("span");
    span.className = "log-line " + (line.includes("→") ? "seg" : "info");
    span.textContent = line;
    logBody.appendChild(span);
  });
  logBody.scrollTop = logBody.scrollHeight;
}

function setLogBadge(state) {
  logBadge.textContent = state;
  logBadge.className = "log-badge " + state;
}

function showResult(data) {
  downloadId = data.download_id;

  resultMeta.innerHTML = `
    <span class="meta-tag">Language: <span>${data.language}</span></span>
    <span class="meta-tag">Duration: <span>${data.duration}s</span></span>
  `;
  resultText.textContent = data.text;
  resultCard.hidden = false;
  resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function hideResult() {
  resultCard.hidden = true;
  downloadId = null;
}

function showError(msg) {
  errorText.textContent = msg;
  errorCard.hidden = false;
}

function hideError() { errorCard.hidden = true; }

errorDismiss.addEventListener("click", hideError);

// ── Copy ────────────────────────────────────────
copyBtn.addEventListener("click", async () => {
  const text = resultText.textContent;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const orig = copyBtn.textContent;
    copyBtn.textContent = "✅ Copied!";
    setTimeout(() => { copyBtn.textContent = orig; }, 2000);
  } catch {
    showError("Could not copy text to clipboard.");
  }
});

// ── Download Word ───────────────────────────────
downloadBtn.addEventListener("click", () => {
  if (!downloadId) return;
  const a = document.createElement("a");
  a.href = `${API_BASE}/download/${downloadId}`;
  a.download = "tamil_transcription.docx";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
});
