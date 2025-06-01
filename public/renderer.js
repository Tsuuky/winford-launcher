const { ipcRenderer } = require('electron');
const { getCurrentWindow } = require('@electron/remote');
const win = getCurrentWindow();

document.getElementById('min-btn').onclick = () => win.minimize();
document.getElementById('close-btn').onclick = () => win.close();

document.getElementById('launch-btn').onclick = () => {
  const pseudo = document.getElementById('pseudo').value || "WinfordUser";
  document.getElementById('log').innerText = "[INFO] Préparation du lancement...\n";
  ipcRenderer.send('launch-minecraft', { pseudo, msauth: false });
};

document.getElementById('ms-login-btn').onclick = () => {
  document.getElementById('log').innerText = "[INFO] Authentification Microsoft...\n";
  ipcRenderer.send('login-microsoft');
};

ipcRenderer.on('log', (event, msg) => {
  const log = document.getElementById('log');
  log.innerText += msg + "\n";
  log.scrollTop = log.scrollHeight;
});

ipcRenderer.on('launch-minecraft', (event, params) => {
  ipcRenderer.send('launch-minecraft', params);
});
