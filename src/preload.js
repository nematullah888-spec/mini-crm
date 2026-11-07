'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('crm', {
  state: () => ipcRenderer.invoke('crm:state'),
  saveConfig: cfg => ipcRenderer.invoke('crm:saveConfig', cfg),
  saveText: (defaultName, content) => ipcRenderer.invoke('crm:saveText', { defaultName, content }),
  openDataFolder: () => ipcRenderer.invoke('crm:openDataFolder')
});
