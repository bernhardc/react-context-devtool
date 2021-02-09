/* global chrome */

const DATA_EVENT = "__REACT_CONTEXT_DEVTOOL_GLOBAL_HOOK_DATA_EVENT";
const ACTIVATE_EXTENSTION = "ACTIVATE_EXTENSTION";
const APP_DATA_EVENT = "APP_DATA";
const ADD_APP_DATA_EVENT = "ADD_APP_DATA";
const INIT_DEVPANEL_EVENT = "INIT_DEVPANEL";
const DEVPANEL_DATA_EVENT = "DEVPANEL_DATA";
const INIT_POPUP_EVENT = "INIT_POPUP";
const POPUP_DATA_EVENT = "POPUP_DATA";
const DISPATCH_EVENT = "DISPATCH_EVENT";

const MAX_DATA_SIZE = 5 * 1024 * 1024; // 50MB

const connections = {};
const catchData = {};
const chunkData = {};

chrome.runtime.onConnect.addListener((port) => {
  const panelListener = event => {
    if (
      event.type === DATA_EVENT &&
      event.subType === INIT_DEVPANEL_EVENT
    ) {
      connections[event.tabId] = port;
      sendData("DEVTOOL", event.tabId);
    }

    if (
      event.type === DATA_EVENT &&
      event.subType === DISPATCH_EVENT
    ) {
      sendDataToContent(event);
    }
  };

  port.onMessage.addListener(panelListener);

  port.onDisconnect.addListener(function () {
    port.onMessage.removeListener(panelListener);

    // remove connection object
    const tabs = Object.keys(connections);
    for (let i = 0, len = tabs.length; i < len; i++) {
      if (connections[tabs[i]] == port) {
        delete connections[tabs[i]];
        break;
      }
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (catchData[tabId]) {
    delete catchData[tabId];
  }
});

chrome.runtime.onMessage.addListener((request, sender) => {
  if (request.type === DATA_EVENT && request.subType) {
    if (request.subType === ACTIVATE_EXTENSTION) {
      setAppPopup(true, sender.tab.id);
    } else if (
      request.subType === APP_DATA_EVENT ||
      request.subType === ADD_APP_DATA_EVENT
    ) {
      saveCatchData(request, sender.tab, request.subType);
      sendData("DEVTOOL", sender.tab.id);
      sendData("POPUP", sender.tab.id);
    } else if (request.subType === INIT_POPUP_EVENT) {
      sendData("POPUP", request.tabId);
    } else if (request.subType === DISPATCH_EVENT) {
      sendDataToContent(request);
    }
  }
});

const sendDataToContent = (event) => {
  chrome.tabs.sendMessage(event.tabId, event);
};

const transferTo = (to, tabId, params) => {
  if (to === "DEVTOOL") {
    if (tabId in connections) {
      connections[tabId].postMessage({
        type: DATA_EVENT,
        subType: DEVPANEL_DATA_EVENT,
        ...params
      });
    }
  } else if (to === "POPUP") {
    chrome.runtime.sendMessage({
      type: DATA_EVENT,
      subType: POPUP_DATA_EVENT,
      tabId,
      ...params
    });
  }
}

const sendData = (to, tabId) => {
  const dataToSend = JSON.stringify(catchData[tabId] || {});

  try {
    const params = {
      data: dataToSend,
    };
    transferTo(to, tabId, params);
  } catch (err) {
    if (
      err.message.includes(
        "Message length exceeded maximum allowed length"
      )
    ) {

      const chunkCount = Math.ceil(dataToSend.length / MAX_DATA_SIZE);

      for (let i = 0; i < chunkCount; i++) {
        const params = {
          split: "chunk",
          chunk: i,
          data: dataToSend.slice(i * MAX_DATA_SIZE, (i + 1) * MAX_DATA_SIZE),
        };
        transferTo(to, tabId, params);
      }

      transferTo(to, tabId, {
        split: "end",
      });

    } else {
      console.error(err);
    }
  }
}

const saveCatchData = (request, { id: tabId, title }, subType) => {

  let {
    data,
    split,
  } = request;

  if (!catchData[tabId]) {
    catchData[tabId] = {
      tab: {
        id: tabId,
      },
      useReducer: {},
      context: {},
    };
    chunkData[tabId] = [];
  }

  if (split === "chunk") {
    chunkData[tabId].push(data);
    return;
  }

  if (split === "end") {
    data = chunkData[tabId].join('') || "{}";
    chunkData[tabId] = [];
  }

  catchData[tabId].tab.title = title;

  if (data.context) {
    const cacheContext = catchData[tabId].context;
    Object.keys(data.context).forEach(key => {
      if (data.context[key].valueChanged) {
        if (!cacheContext[key]) {
          cacheContext[key] = {
            oldValue: {},
            newValue: {},
          }
        }

        cacheContext[key].oldValue = cacheContext[key].newValue;
        cacheContext[key].newValue = data.context[key];
      }
    });

    if (subType !== ADD_APP_DATA_EVENT) {
      Object.keys(cacheContext).forEach(key => {
        if (!data.context[key] && cacheContext[key].newValue.remove) {
          delete cacheContext[key];
        }
      });
    }
  }

  if (data.useReducer) {
    const cacheUseReducer = catchData[tabId].useReducer;
    Object.keys(data.useReducer).forEach(key => {
      if (data.useReducer[key].valueChanged) {
        cacheUseReducer[key] = data.useReducer[key];
      }
    });

    Object.keys(cacheUseReducer).forEach(key => {
      if (!data.useReducer[key]) {
        delete cacheUseReducer[key];
      }
    });
  }
};

const setAppPopup = (isActive, tabId) => {
  chrome.browserAction.setIcon({
    tabId,
    path: {
      "16": `assets/icons/icon16${isActive ? "" : "-disabled"}.png`,
      "32": `assets/icons/icon32${isActive ? "" : "-disabled"}.png`,
      "48": `assets/icons/icon48${isActive ? "" : "-disabled"}.png`,
      "128": `assets/icons/icon128${isActive ? "" : "-disabled"}.png`,
    },
  });
  chrome.browserAction.setPopup({
    tabId,
    popup: "popup/popup.html",
  });
};
