const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const isDev = require("electron-is-dev");
const { runTransform } = require("./processing");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// File dialogs
ipcMain.handle("select-file", async (_, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: options?.filters || []
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle("select-multiple-files", async (_, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    filters: options?.filters || []
  });
  if (result.canceled || !result.filePaths.length) return [];
  return result.filePaths;
});

ipcMain.handle("select-output-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// Run transformation
ipcMain.handle("run-transform", async (_, payload) => {
  const { mappingPath, loanFilePaths, billingPath, collectionMonth, payoutday, outputDir } = payload;
  try {
    await runTransform(
      {
        mappingPath,
        loanFilePaths,
        billingPath,
        collectionMonth,
        payoutday,
        outputDir
      },
      (event) => {
        // progress callback
        if (mainWindow) {
          mainWindow.webContents.send("transform-progress", event);
        }
      }
    );
    return { success: true };
  } catch (err) {
    console.error(err);
    return { success: false, error: err.message || "Unknown error" };
  }
});
