// WALI CORE — نافذة البرنامج على Windows
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, protocol, net } = require('electron')
const { pathToFileURL } = require('url')
const path = require('path')
const fs = require('fs')

const isDev = !app.isPackaged && process.env.WALI_DEV === '1'

// بيانات البرنامج (الجلسة ووضع التجربة) على D بدل C
if (process.platform === 'win32' && fs.existsSync('D:\\')) {
  app.setPath('userData', 'D:\\WaliCore\\data')
}

// البرنامج بيتقري من app:// بدل file:// عشان fetch و WebAssembly يشتغلوا
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])
const distDir = path.join(__dirname, '..', 'dist')

let win
function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1200,
    minHeight: 720,
    backgroundColor: '#070708',
    title: 'WALI CORE — والي بلازا',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#070708', symbolColor: '#e4e4e7', height: 56 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  Menu.setApplicationMenu(null)
  win.once('ready-to-show', () => { win.maximize(); win.show() })
  if (isDev) win.loadURL('http://localhost:5173')
  else win.loadURL('app://wali/index.html')

  // أي لينك خارجي يفتح في المتصفح
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.key === 'F12' && isDev) win.webContents.toggleDevTools()
    if (input.key === 'F5') win.webContents.reload()
  })
}

const defaultDir = () => (fs.existsSync('D:\\') ? 'D:\\WaliCore' : app.getPath('documents'))

ipcMain.handle('save-pdf', async (_e, name, bare) => {
  const dir = path.join(defaultDir(), 'PDF')
  fs.mkdirSync(dir, { recursive: true })
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(dir, `${name}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (canceled || !filePath) return null
  const data = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: bare ? { marginType: 'none' } : { marginType: 'custom', top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } })
  fs.writeFileSync(filePath, data)
  shell.openPath(filePath)
  return filePath
})

ipcMain.handle('save-file', async (_e, name, content) => {
  const dir = path.join(defaultDir(), 'Backups')
  fs.mkdirSync(dir, { recursive: true })
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(dir, name),
    filters: [{ name: 'Backup', extensions: ['json'] }],
  })
  if (canceled || !filePath) return null
  fs.writeFileSync(filePath, content, 'utf8')
  return filePath
})

// نسخة تلقائية كل يوم من غير ما نسأل، وبنحتفظ بآخر 30 نسخة بس
const autoDir = () => path.join(defaultDir(), 'Backups', 'auto')
ipcMain.handle('auto-backup', async (_e, name, content) => {
  const dir = autoDir()
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, path.basename(name))
  fs.writeFileSync(file, content, 'utf8')
  const old = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse().slice(30)
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true })
  return file
})
ipcMain.handle('open-backups', async () => {
  fs.mkdirSync(autoDir(), { recursive: true })
  return shell.openPath(autoDir())
})

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html'
    const file = path.normalize(path.join(distDir, rel))
    if (!file.startsWith(distDir)) return new Response('forbidden', { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })
  createWindow()
})
app.on('window-all-closed', () => app.quit())
