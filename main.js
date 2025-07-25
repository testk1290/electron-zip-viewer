const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { default: Store } = require('electron-store');
const JSZip = require('jszip');

const store = new Store();

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, 
      nodeIntegration: false, 
    },
  });

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, 'index.html'));
  } else {
    const startUrl = 'http://localhost:3000';
    win.loadURL(startUrl);
    win.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- IPCハンドラ ---
ipcMain.handle('get-store-value', (event, key) => store.get(key));
ipcMain.handle('set-store-value', (event, key, value) => store.set(key, value));

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('scan-folder', async (event, folderPath) => {
  let zipFiles = [];
  async function processDirectory(dirPath) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          await processDirectory(fullPath);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip')) {
          zipFiles.push(fullPath);
        }
      }
    } catch (error) { console.error(`Error reading directory ${dirPath}:`, error); }
  }
  await processDirectory(folderPath);
  return zipFiles;
});

ipcMain.handle('generate-thumbnail', async (event, filePath) => {
  try {
    const fileBuffer = await fs.readFile(filePath);
    const zip = await JSZip.loadAsync(fileBuffer);
    const fileNames = Object.keys(zip.files).sort();

    for (const fileName of fileNames) {
      const zipEntry = zip.files[fileName];
      // macOSのメタデータファイル '._' を除外
      if (path.basename(fileName).startsWith('._')) continue;

      if (/\.(jpe?g|png|gif|webp)$/i.test(zipEntry.name) && !zipEntry.dir) {
        const content = await zipEntry.async('base64');
        let ext = path.extname(fileName).slice(1).toLowerCase();
        if (ext === 'jpg') ext = 'jpeg';
        const mimeType = `image/${ext}`;
        return `data:${mimeType};base64,${content}`;
      }
    }
    return null;
  } catch (error) {
    console.error(`[Error] Thumbnail generation failed for ${filePath}:`, error);
    return null;
  }
});

ipcMain.handle('get-all-images', async (event, filePath) => {
  try {
    const fileBuffer = await fs.readFile(filePath);
    const zip = await JSZip.loadAsync(fileBuffer);
    const imagePromises = [];
    const sortedFiles = Object.keys(zip.files).sort();

    for (const fileName of sortedFiles) {
      const zipEntry = zip.files[fileName];
      // ★★★ こちらにも同じ除外処理が適用されていることを確認 ★★★
      if (path.basename(fileName).startsWith('._')) continue;
      
      if (/\.(jpe?g|png|gif|webp)$/i.test(zipEntry.name) && !zipEntry.dir) {
        const promise = zipEntry.async('base64').then(content => {
          let ext = path.extname(fileName).slice(1).toLowerCase();
          if (ext === 'jpg') ext = 'jpeg';
          const mimeType = `image/${ext}`;
          return `data:${mimeType};base64,${content}`;
        });
        imagePromises.push(promise);
      }
    }
    return Promise.all(imagePromises);
  } catch (error) {
    console.error(`[Error] Failed to get all images for ${filePath}:`, error);
    return [];
  }
});