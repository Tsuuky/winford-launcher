const { ipcRenderer } = require('electron');
const { getCurrentWindow } = require('@electron/remote');

document.addEventListener('DOMContentLoaded', () => {
  const win = getCurrentWindow();

  // Boutons fenêtre
  const minBtn = document.getElementById('min-btn');
  const closeBtn = document.getElementById('close-btn');
  if (minBtn) minBtn.onclick = () => win.minimize();
  if (closeBtn) closeBtn.onclick = () => win.close();

  // Bouton lancement (si tu veux une connexion pseudo/offline)
  const launchBtn = document.getElementById('launch-btn');
  if (launchBtn) {
    launchBtn.onclick = () => {
      const pseudoInput = document.getElementById('pseudo');
      const pseudo = pseudoInput ? (pseudoInput.value || "WinfordUser") : "WinfordUser";
      document.getElementById('log').innerText = "[INFO] Préparation du lancement...\n";
      ipcRenderer.send('launch-minecraft', { pseudo, msauth: false });
    };
  }

  // Bouton Microsoft Login
  const msLoginBtn = document.getElementById('ms-login-btn');
  if (msLoginBtn) {
    msLoginBtn.onclick = () => {
      document.getElementById('log').innerText = "[INFO] Authentification Microsoft...\n";
      ipcRenderer.send('login-microsoft');
    };
  }

  // Affichage des logs
  ipcRenderer.on('log', (event, msg) => {
    const log = document.getElementById('log');
    if (log) {
      log.innerText += msg + "\n";
      log.scrollTop = log.scrollHeight;
    }
  });

  // Pour relancer MC avec MS login
  ipcRenderer.on('launch-minecraft', (event, params) => {
    ipcRenderer.send('launch-minecraft', params);
  });
});
