// The only renderer↔main surface. Two transports, one rule each:
//  - commands: contextBridge invoke wrappers (typed, promise-based)
//  - main→renderer pushes (incl. MessagePorts): window.postMessage re-posts.
//    Ports can't cross the contextBridge, and IPC listeners must register at
//    module top level — lazy registration drops early messages.

import { contextBridge, ipcRenderer, webUtils } from 'electron';

ipcRenderer.on('session:port', (event, meta) => {
  window.postMessage({ type: 'eg-session-port', meta }, '*', event.ports as unknown as MessagePort[]);
});

for (const channel of ['fleet:update']) {
  ipcRenderer.on(channel, (_e, payload) => {
    window.postMessage({ type: 'eg-event', channel, payload }, '*');
  });
}

contextBridge.exposeInMainWorld('greenhouse', {
  fleet: {
    snapshot: () => ipcRenderer.invoke('fleet:snapshot'),
    refresh: () => ipcRenderer.invoke('fleet:refresh'),
  },
  evolution: {
    start: (name: string) => ipcRenderer.invoke('evolution:start', name),
    stop: (name: string) => ipcRenderer.invoke('evolution:stop', name),
  },
  adhoc: {
    start: (name: string) => ipcRenderer.invoke('adhoc:start', name),
    stop: (name: string) => ipcRenderer.invoke('adhoc:stop', name),
  },
  tools: {
    start: (key: string) => ipcRenderer.invoke('tools:start', key),
    stop: (key: string) => ipcRenderer.invoke('tools:stop', key),
  },
  backtests: {
    summary: (runDate?: string) => ipcRenderer.invoke('backtests:summary', runDate),
    equity: (runDate: string, algorithm: string, period: string) =>
      ipcRenderer.invoke('backtests:equity', runDate, algorithm, period),
  },
  workspace: {
    equity: (name: string, candidateId: string) =>
      ipcRenderer.invoke('workspace:equity', name, candidateId),
  },
  session: {
    attach: (name: string, cols: number, rows: number) =>
      ipcRenderer.invoke('session:attach', name, cols, rows),
    detach: (name: string) => ipcRenderer.invoke('session:detach', name),
    scroll: (name: string, dir: 'up' | 'down', lines: number) =>
      ipcRenderer.invoke('session:scroll', name, dir, lines),
  },
  prefs: {
    get: () => ipcRenderer.invoke('prefs:get'),
    set: (patch: unknown) => ipcRenderer.invoke('prefs:set', patch),
  },
  // Absolute path of a dragged-in File. Electron 32+ removed File.path; webUtils
  // is the supported replacement and must be called from the preload.
  pathForFile: (file: File) => webUtils.getPathForFile(file),
});
