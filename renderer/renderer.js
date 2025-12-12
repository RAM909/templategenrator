const mappingLabel = document.getElementById("mappingPathLabel");
const billingLabel = document.getElementById("billingPathLabel");
const loanFilesList = document.getElementById("loanFilesList");
const outputLabel = document.getElementById("outputDirLabel");
const logDiv = document.getElementById("log");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");
const progressStatus = document.getElementById("progressStatus");

let mappingPath = null;
let billingPath = null;
let loanFilePaths = [];
let outputDir = null;
let currentProgress = 0;

function appendLog(msg) {
  const time = new Date().toLocaleTimeString();
  logDiv.textContent += `[${time}] ${msg}\n`;
  logDiv.scrollTop = logDiv.scrollHeight;
}

function animateProgress(targetValue, status = null) {
  const step = Math.abs(targetValue - currentProgress) / 20; // 20 animation steps
  const increment = targetValue > currentProgress ? step : -step;
  
  const animate = () => {
    if ((increment > 0 && currentProgress < targetValue) || 
        (increment < 0 && currentProgress > targetValue)) {
      currentProgress += increment;
      currentProgress = Math.max(0, Math.min(100, currentProgress));
      
      progressFill.style.width = `${currentProgress}%`;
      progressText.textContent = `${Math.round(currentProgress)}%`;
      
      requestAnimationFrame(animate);
    } else {
      currentProgress = targetValue;
      progressFill.style.width = `${currentProgress}%`;
      progressText.textContent = `${Math.round(currentProgress)}%`;
      
      if (status) {
        progressStatus.textContent = status;
      }
    }
  };
  
  animate();
}

function setProgress(value, status = null) {
  animateProgress(value, status);
}

document.getElementById("btnSelectMapping").addEventListener("click", async () => {
  const file = await window.api.selectFile([
    { name: "Excel", extensions: ["xlsx", "xls"] }
  ]);
  if (file) {
    mappingPath = file;
    mappingLabel.textContent = file;
    appendLog("Deal mapping file selected");
  }
});

// Individual loan file selection
document.addEventListener('click', async (event) => {
  if (event.target.classList.contains('loan-file-btn')) {
    const fileIndex = parseInt(event.target.closest('[data-file-index]').dataset.fileIndex);
    
    const file = await window.api.selectFile([
      { name: "Excel", extensions: ["xlsx", "xls"] }
    ]);
    
    if (file) {
      // Get sheet type from data attribute
      const container = event.target.closest('[data-file-index]');
      const sheetType = container.dataset.sheetType;
      
      // Update the array
      loanFilePaths[fileIndex] = file;
      
      // Update the UI
      const label = container.querySelector('.loan-file-label');
      const removeBtn = container.querySelector('.loan-remove-btn');
      
      label.textContent = file.split('\\').pop() || file.split('/').pop(); // Show just filename
      removeBtn.classList.remove('hidden');
      
      // Show next slot if available
      showNextLoanFileSlot(fileIndex);
      
      appendLog(`Loan file selected: ${file} [${sheetType}]`);
    }
  }
  
  if (event.target.classList.contains('loan-remove-btn')) {
    const fileIndex = parseInt(event.target.closest('[data-file-index]').dataset.fileIndex);
    
    // Remove from array
    loanFilePaths[fileIndex] = null;
    
    // Update UI
    const container = event.target.closest('[data-file-index]');
    const label = container.querySelector('.loan-file-label');
    const removeBtn = container.querySelector('.loan-remove-btn');
    
    label.textContent = 'None selected';
    removeBtn.classList.add('hidden');
    
    // Hide unused slots
    updateLoanFileSlotsVisibility();
    
    appendLog(`Loan file ${fileIndex + 1} removed`);
  }
});

document.getElementById("btnSelectBilling").addEventListener("click", async () => {
  const file = await window.api.selectFile([
    { name: "Excel", extensions: ["xlsx", "xls"] }
  ]);
  if (file) {
    billingPath = file;
    billingLabel.textContent = file;
    appendLog("Billing units file selected");
  }
});

document.getElementById("btnSelectOutput").addEventListener("click", async () => {
  const folder = await window.api.selectOutputFolder();
  if (folder) {
    outputDir = folder;
    outputLabel.textContent = folder;
    appendLog("Output folder selected");
  }
});

// Add this event listener for the open folder button
document.getElementById("btnOpenFolder").addEventListener("click", async () => {
  if (outputDir) {
    await window.api.openFolder(outputDir);
    appendLog("Opened output folder in file explorer");
  }
});

document.getElementById("btnRun").addEventListener("click", async () => {
  logDiv.textContent = "";
  setProgress(0, "Initializing...");
  
  // Hide open folder button during processing
  document.getElementById("btnOpenFolder").classList.add("hidden");

  if (!loanFilePaths.length && !billingPath) {
    appendLog("Please select at least loan files or a billing units file.");
    setProgress(0, "Ready to process");
    return;
  }

  if (!outputDir) {
    appendLog("Please select an output folder.");
    setProgress(0, "Ready to process");
    return;
  }

  const collectionMonth = document.getElementById("collectionMonth").value.trim();
  const payoutDayStr = document.getElementById("payoutDay").value.trim();
  const payoutday = Number(payoutDayStr) || 1;

  appendLog("Starting transformation...");

  // Create file-to-sheetType mapping from uploaded files
  const fileSheetMapping = [];
  for (let i = 0; i < 7; i++) {
    if (loanFilePaths[i]) {
      const container = document.querySelector(`[data-file-index="${i}"]`);
      const sheetType = container.dataset.sheetType;
      fileSheetMapping.push({
        filePath: loanFilePaths[i],
        sheetType: sheetType
      });
    }
  }

  const payload = {
    mappingPath,
    loanFilePaths: fileSheetMapping,
    billingPath,
    collectionMonth,
    payoutday,
    outputDir
  };

  const result = await window.api.runTransform(payload);
  if (!result.success) {
    appendLog("Error: " + result.error);
    setProgress(0, "Error occurred");
    // Keep button hidden on error
    document.getElementById("btnOpenFolder").classList.add("hidden");
  } else {
    appendLog("Processing completed successfully.");
    appendLog("Click 'Open Output Folder' to view generated files.");
    // Show open folder button after successful completion
    document.getElementById("btnOpenFolder").classList.remove("hidden");
  }
});

window.api.onProgress((event) => {
  if (!event) return;
  if (event.type === "log") {
    appendLog(event.message);
  } else if (event.type === "progress") {
    const value = event.value || 0;
    const status = event.status || "Processing...";
    setProgress(value, status);
  }
});

function showNextLoanFileSlot(currentIndex) {
  const nextIndex = currentIndex + 1;
  if (nextIndex < 7) {
    const nextSlot = document.querySelector(`[data-file-index="${nextIndex}"]`);
    if (nextSlot && nextSlot.classList.contains('hidden')) {
      nextSlot.classList.remove('hidden');
    }
  }
}

function updateLoanFileSlotsVisibility() {
  // Clean up array by removing null values
  loanFilePaths = loanFilePaths.filter(file => file !== null);
  
  // Show slots based on current files + 1 empty slot
  const slotsToShow = Math.min(loanFilePaths.length + 1, 7);
  
  for (let i = 0; i < 7; i++) {
    const slot = document.querySelector(`[data-file-index="${i}"]`);
    if (i < slotsToShow) {
      slot.classList.remove('hidden');
    } else {
      slot.classList.add('hidden');
      // Clear the slot
      const label = slot.querySelector('.loan-file-label');
      const removeBtn = slot.querySelector('.loan-remove-btn');
      label.textContent = 'None selected';
      removeBtn.classList.add('hidden');
    }
  }
}

// // In your main process file where you define the API
// openFolder: (folderPath) => {
//   const { shell } = require('electron');
//   return shell.openPath(folderPath);
// }
