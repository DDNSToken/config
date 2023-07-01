/*
#  DDNSToken
#  preload.js
#
#  Copyright © 2023 Certchip Corp. All rights reserved.
#  Created by GYUYOUNG KANG on 2023/04/15.
#
*/

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld( "api", {
      send: (channel, data) => {
          let validChannels = ["toMain"]; // IPC채널들 추가
          if (validChannels.includes(channel)) {
              ipcRenderer.send(channel, data);
          }
      },
      receive: (channel, func) => {
          let validChannels = ["fromMain"]; // IPC채널들 추가
          if (validChannels.includes(channel)) {
              ipcRenderer.on(channel, (event, ...args) => func(...args));
          }
      }
  }
);