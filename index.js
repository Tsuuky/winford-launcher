const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { Client, Authenticator } = require('minecraft-launcher-core');
const { Auth } = require("msmc");
const { autoUpdater } = require('electron-updater');
require('@electron/remote/main').initialize();

function createWindow () {
  const win = new BrowserWindow({
    width: 1200,
    height: 650,
    resizable: false,
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      webSecurity: false
    }
  });
  require('@electron/remote/main').enable(win.webContents);
  win.loadFile('public/index.html');
}

const getRootDir = () => {
  // Stocke tout dans le dossier utilisateur dédié Electron
  return path.join(app.getPath('userData'), '.winford');
};

const getModsDir = () => path.join(getRootDir(), 'mods');
const getForgeDir = () => path.join(getRootDir(), 'forge');

async function ensureDir(dir) {
  try { await fsp.mkdir(dir, { recursive: true }); } catch {}
}

async function installModsFromAPI(event) {
  const modsDir = getModsDir();
  // 1. Récupère la liste des mods depuis l'API
  const res = await fetch('http://164.132.203.136:5100/mods');
  if (!res.ok) {
    event.sender.send('log', "[ERREUR] Impossible de récupérer la liste des mods !");
    return false;
  }
  const mods = await res.json();

  // 2. S'il n'y a AUCUN mod à installer, supprime le dossier mods s'il existe, n'en crée pas
  if (!Array.isArray(mods) || !mods.filter(m => m && typeof m.filename === "string" && m.filename.length > 0).length) {
    event.sender.send('log', "[INFO] Aucun mod à installer (liste vide).");
    if (fs.existsSync(modsDir)) {
      try {
        await fsp.rm(modsDir, { recursive: true, force: true });
        event.sender.send('log', "[DEBUG] Dossier mods supprimé car liste vide.");
      } catch {}
    }
    event.sender.send('log', `[DEBUG] mods/ n'existe pas.`);
    event.sender.send('log', `[INFO] Mods synchronisés avec l'API !`);
    return true;
  }

  await ensureDir(modsDir);

  // Nettoie tous les fichiers non .jar ou au nom douteux
  const files = await fsp.readdir(modsDir);
  for (const f of files) {
    if (!f.endsWith('.jar')) {
      try {
        await fsp.unlink(path.join(modsDir, f));
        event.sender.send('log', `[INFO] Fichier supprimé (non .jar): ${f}`);
      } catch {}
    } else if (!/^[a-zA-Z0-9._\-]+\.jar$/.test(f)) {
      try {
        await fsp.unlink(path.join(modsDir, f));
        event.sender.send('log', `[INFO] Fichier supprimé (nom invalide): ${f}`);
      } catch {}
    }
  }

  // Télécharge chaque mod absent ou à mettre à jour
  const modsToInstall = mods.filter(m => m && typeof m.filename === "string" && m.filename.length > 0);
  event.sender.send('log', `[INFO] ${modsToInstall.length} mods à installer.`);
  for (const mod of modsToInstall) {
    let fileName = mod.filename.replace(/[^a-zA-Z0-9._\-]/g, '_');
    if (!fileName.endsWith('.jar')) fileName += '.jar';
    const modPath = path.join(modsDir, fileName);

    let needDownload = false;
    try { await fsp.access(modPath); }
    catch { needDownload = true; }
    if (!needDownload) {
      event.sender.send('log', `[OK] ${fileName} déjà présent`);
      continue;
    }
    event.sender.send('log', `[→] Téléchargement ${fileName}...`);
    const modRes = await fetch(`http://localhost:5100/mods/${encodeURIComponent(mod.filename)}`);
    if (!modRes.ok) {
      event.sender.send('log', `[ERREUR] ${fileName} : téléchargement impossible`);
      continue;
    }
    await new Promise((resolve, reject) => {
      const fileStream = fs.createWriteStream(modPath);
      modRes.body.pipe(fileStream);
      modRes.body.on("error", reject);
      fileStream.on("finish", resolve);
    });
    event.sender.send('log', `[OK] ${fileName} installé`);
  }

  // Supprime les mods non listés dans l'API
  const wanted = new Set(
    modsToInstall.map(m => m.filename.replace(/[^a-zA-Z0-9._\-]/g, '_'))
  );
  const current = (await fsp.readdir(modsDir)).filter(f => f.endsWith('.jar'));
  for (const modFile of current) {
    if (!wanted.has(modFile)) {
      event.sender.send('log', `[i] Suppression du mod obsolète ${modFile}`);
      try { await fsp.unlink(path.join(modsDir, modFile)); } catch {}
    }
  }

  // Log du contenu final du dossier mods
  if (fs.existsSync(modsDir)) {
    const modsFiles = await fsp.readdir(modsDir);
    event.sender.send('log', `[DEBUG] mods/ contient : ${modsFiles.join(', ')}`);
  } else {
    event.sender.send('log', `[DEBUG] mods/ n'existe pas.`);
  }

  event.sender.send('log', `[INFO] Mods synchronisés avec l'API !`);
  return true;
}

// Télécharge le jar forge si besoin (depuis l'API) et retourne son chemin
async function ensureForgeJar(event) {
  const forgeDir = getForgeDir();
  // Récupère infos Forge (version, filename, url)
  const res = await fetch('http://localhost:5100/forge');
  if (!res.ok) {
    event.sender.send('log', "[ERREUR] Impossible de récupérer les infos Forge !");
    return null;
  }
  const info = await res.json();

  await ensureDir(forgeDir);

  const localForgeJar = path.join(forgeDir, info.filename);

  let needDownload = false;
  try { await fsp.access(localForgeJar); }
  catch { needDownload = true; }

  if (!needDownload) {
    event.sender.send('log', `[OK] Forge déjà présent : ${info.filename}`);
    return { forgePath: localForgeJar, minecraftVersion: info.minecraftVersion };
  }

  event.sender.send('log', `[→] Téléchargement Forge (${info.filename})...`);
  const forgeRes = await fetch(info.url);
  if (!forgeRes.ok) {
    event.sender.send('log', `[ERREUR] Impossible de télécharger Forge !`);
    return null;
  }
  await new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(localForgeJar);
    forgeRes.body.pipe(fileStream);
    forgeRes.body.on("error", reject);
    fileStream.on("finish", resolve);
  });
  event.sender.send('log', `[OK] Forge installé !`);
  return { forgePath: localForgeJar, minecraftVersion: info.minecraftVersion };
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  // ========== AUTO-UPDATE ===============
  autoUpdater.logger = require("electron-log");
  autoUpdater.logger.transports.file.level = "info";

  // Si jamais il y a besoin de préciser l'URL, décommente ça :
  autoUpdater.setFeedURL({
    provider: "github",
    owner: "Tsuuky", // <-- change ici si ton repo GitHub a changé !
    repo: "winford-launcher"
  });

  autoUpdater.checkForUpdatesAndNotify();

  autoUpdater.on('update-available', () => {
    dialog.showMessageBox({
      type: "info",
      title: "Mise à jour disponible",
      message: "Une nouvelle version du launcher est disponible. Téléchargement en cours…"
    });
  });

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
      type: "question",
      buttons: ["Redémarrer", "Plus tard"],
      defaultId: 0,
      message: "La mise à jour est prête. Redémarrer maintenant ?",
    }).then(result => {
      if (result.response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', (err) => {
    dialog.showErrorBox("Erreur de mise à jour", err == null ? "unknown" : (err.stack || err).toString());
  });

  // Log du chemin racine utilisé pour debug
  console.log("[DEBUG] Dossier racine Winford utilisé :", getRootDir());
});

ipcMain.on('launch-minecraft', async (event, params) => {
  const rootDir = getRootDir();
  const modsDir = getModsDir();
  const forgeDir = getForgeDir();

  const modsOK = await installModsFromAPI(event);
  if (modsOK === false) {
    event.sender.send('log', "[ERREUR] Lancement annulé : installation des mods impossible.");
    return;
  }

  const forgeInfo = await ensureForgeJar(event);
  if (!forgeInfo) {
    event.sender.send('log', "[ERREUR] Lancement annulé : Forge non disponible.");
    return;
  }

  const launcher = new Client();

  let opts = {
    root: rootDir,
    version: {
      number: forgeInfo.minecraftVersion,
      type: "release"
    },
    memory: {
      max: "2G",
      min: "1G"
    },
    forge: forgeInfo.forgePath
  };

  if (params.msauth && params.msProfile) {
    opts.authorization = params.msProfile;
    event.sender.send('log', `[INFO] Connexion Microsoft : ${params.msProfile.name || params.msProfile.profile?.name}`);
  } else {
    opts.authorization = Authenticator.getAuth(params.pseudo || "WinfordUser");
    event.sender.send('log', `[INFO] Connexion offline : ${params.pseudo}`);
  }

  event.sender.send('log', "[INFO] Lancement de Minecraft...");
  launcher.launch(opts);

  launcher.on('debug', (e) => event.sender.send('log', '[DEBUG] ' + e));
  launcher.on('data', (e) => event.sender.send('log', '[MC] ' + e));
  launcher.on('error', (e) => event.sender.send('log', '[ERROR] ' + e));
});

ipcMain.on('login-microsoft', async (event) => {
  event.sender.send('log', "[INFO] Ouverture de la fenêtre Microsoft...");

  const authManager = new Auth("select_account");
  try {
    const xboxManager = await authManager.launch("electron");
    const token = await xboxManager.getMinecraft();

    event.sender.send('log', `[INFO] Connecté en Microsoft : ${token.profile.name}`);
    event.sender.send('log', "[INFO] Lancement premium...");
    event.sender.send('launch-minecraft', {
      pseudo: token.profile.name,
      msauth: true,
      msProfile: token.mclc()
    });

  } catch (err) {
    event.sender.send('log', "[ERREUR] Auth Microsoft échouée ou annulée.");
    if (err && err.message) event.sender.send('log', `[ERREUR] ${err.message}`);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
