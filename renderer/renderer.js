const mappingLabel = document.getElementById("mappingPathLabel");
const billingLabel = document.getElementById("billingPathLabel");
const loanFilesList = document.getElementById("loanFilesList");
const outputLabel = document.getElementById("outputDirLabel");
const logDiv = document.getElementById("log");
const progressFill = document.getElementById("progressFill");

let mappingPath = null;
let billingPath = null;
let loanFilePaths = [];
let outputDir = null;

function appendLog(msg) {
  const time = new Date().toLocaleTimeString();
  logDiv.textContent += `[${time}] ${msg}\n`;
  logDiv.scrollTop = logDiv.scrollHeight;
}

function setProgress(value) {
  progressFill.style.width = `${value}%`;
}

document.getElementById("btnSelectMapping").addEventListener("click", async () => {
  const file = await window.api.selectFile([
    { name: "Excel", extensions: ["xlsx", "xls"] }
  ]);
  if (file) {
    mappingPath = file;
    mappingLabel.textContent = file;
  }
});

document.getElementById("btnSelectLoanFiles").addEventListener("click", async () => {
  const files = await window.api.selectMultipleFiles([
    { name: "Excel", extensions: ["xlsx", "xls"] }
  ]);
  if (files && files.length) {
    loanFilePaths = files.slice(0, 7);
    loanFilesList.textContent = loanFilePaths.join("\n");
  }
});

document.getElementById("btnSelectBilling").addEventListener("click", async () => {
  const file = await window.api.selectFile([
    { name: "Excel", extensions: ["xlsx", "xls"] }
  ]);
  if (file) {
    billingPath = file;
    billingLabel.textContent = file;
  }
});

document.getElementById("btnSelectOutput").addEventListener("click", async () => {
  const folder = await window.api.selectOutputFolder();
  if (folder) {
    outputDir = folder;
    outputLabel.textContent = folder;
  }
});

document.getElementById("btnRun").addEventListener("click", async () => {
  logDiv.textContent = "";
  setProgress(0);

  if (!loanFilePaths.length && !billingPath) {
    appendLog("Please select at least loan files or a billing units file.");
    return;
  }

  if (!outputDir) {
    appendLog("Please select an output folder.");
    return;
  }

  const collectionMonth = document.getElementById("collectionMonth").value.trim();
  const payoutDayStr = document.getElementById("payoutDay").value.trim();
  const payoutday = Number(payoutDayStr) || 1;

  appendLog("Starting transformation...");

  const payload = {
    mappingPath,
    loanFilePaths,
    billingPath,
    collectionMonth,
    payoutday,
    outputDir
  };

  const result = await window.api.runTransform(payload);
  if (!result.success) {
    appendLog("Error: " + result.error);
    setProgress(0);
  } else {
    appendLog("Processing completed successfully.");
  }
});

window.api.onProgress((event) => {
  if (!event) return;
  if (event.type === "log") {
    appendLog(event.message);
  } else if (event.type === "progress") {
    setProgress(event.value || 0);
  }
});
