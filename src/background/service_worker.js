'use strict';

// Pending action promises: tabId -> { resolve, reject }
const pendingActions = new Map();

// ─── Popup window management ──────────────────────────────────────────────────

let popupWindowId = null;

chrome.windows.onRemoved.addListener((id) => {
  if (id === popupWindowId) popupWindowId = null;
});

chrome.action.onClicked.addListener(async () => {
  if (popupWindowId !== null) {
    try {
      await chrome.windows.update(popupWindowId, { focused: true });
      return;
    } catch {
      popupWindowId = null; // Window was already closed
    }
  }
  const win = await chrome.windows.create({
    url:     chrome.runtime.getURL('src/popup/popup.html'),
    type:    'popup',
    width:   460,
    height:  720,
    focused: true,
  });
  popupWindowId = win.id;
});

// Whether a stop was requested
let stopRequested = false;

// Automation state — persisted to session storage so popup can reload mid-run
let automationLog = [];
let isRunning = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getPlatform(url) {
  if (/instagram\.com/.test(url)) return 'instagram';
  if (/tiktok\.com/.test(url))   return 'tiktok';
  return null;
}

function normalizeUrl(url) {
  // Instagram /reel/ and /reels/ use a different layout — /p/ handles both
  return url.replace(/instagram\.com\/reels?\//i, 'instagram.com/p/');
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    let settleTimer = null;

    const globalTimeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(settleTimer);
      reject(new Error('Tab load timeout'));
    }, 30_000);

    function settle() {
      clearTimeout(globalTimeout);
      chrome.tabs.onUpdated.removeListener(listener);
      // Extra delay for SPA JS to initialise after final navigation
      setTimeout(resolve, 1500);
    }

    function listener(id, changeInfo) {
      if (id !== tabId) return;
      if (changeInfo.status === 'loading') {
        // Redirect started — cancel pending settle, wait for next complete
        clearTimeout(settleTimer);
      } else if (changeInfo.status === 'complete') {
        // Debounce: resolve only if no new navigation starts within 2s
        clearTimeout(settleTimer);
        settleTimer = setTimeout(settle, 2000);
      }
    }

    // Register listener FIRST, then check current status to close the race window
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete') {
        settleTimer = setTimeout(settle, 2000);
      }
    }).catch(() => {});
  });
}

function waitForTabActive(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.update(tabId, { active: true }, () => {
      // Give the browser a moment to actually bring the tab to front
      setTimeout(resolve, 600);
    });
  });
}

function sendAndWait(tabId, message, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingActions.delete(tabId);
      reject(new Error('Content script response timeout'));
    }, timeoutMs);

    pendingActions.set(tabId, {
      resolve: (data) => { clearTimeout(timer); resolve(data); },
      reject:  (err)  => { clearTimeout(timer); reject(err); },
    });

    chrome.tabs.sendMessage(tabId, message).catch((err) => {
      pendingActions.delete(tabId);
      clearTimeout(timer);
      reject(err);
    });
  });
}

// Ping content script until it responds — handles SPA loading delays and redirects.
// Content scripts are registered in manifest so browser re-injects on every navigation.
async function waitForContentScript(tabId, maxRetries = 20, intervalMs = 500) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      return; // Content script responded
    } catch {
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }
  throw new Error('Content script not ready after retries');
}

function notifyPopup(payload) {
  const entry = { ...payload, _ts: Date.now() };
  automationLog.push(entry);
  chrome.storage.session.set({ automationLog, isRunning }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'PROGRESS', ...entry }).catch(() => {
    // Popup might be closed — ignore
  });
}

// ─── Main message listener ────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'START_AUTOMATION') {
    stopRequested = false;
    automationLog = [];
    isRunning = true;
    chrome.storage.session.set({ automationLog: [], isRunning: true }).catch(() => {});
    runAutomation(message.urls, message.commentPool);
    return false;
  }

  if (message.type === 'STOP_AUTOMATION') {
    stopRequested = true;
    return false;
  }

  // Content script callbacks
  if (message.type === 'ACTIONS_DONE' || message.type === 'ACTIONS_ERROR') {
    const tabId = sender.tab?.id;
    if (tabId != null && pendingActions.has(tabId)) {
      const { resolve, reject } = pendingActions.get(tabId);
      pendingActions.delete(tabId);
      if (message.type === 'ACTIONS_DONE') resolve(message.results);
      else reject(new Error(message.error || 'Unknown content script error'));
    }
    return false;
  }
});

// ─── Automation loop ──────────────────────────────────────────────────────────

async function runAutomation(urls, commentPool) {
  // MV3 service workers are killed after ~30s idle. Keep alive with periodic Chrome API calls.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 25_000);

  let processed = 0;
  const failedUrls = [];

  try {
  for (let url of urls) {
    url = normalizeUrl(url);

    if (stopRequested) {
      notifyPopup({ event: 'stopped' });
      return;
    }

    const platform = getPlatform(url);

    if (!platform) {
      notifyPopup({ event: 'url_skip', url, detail: 'unsupported URL — skipped' });
      continue;
    }

    notifyPopup({ event: 'url_start', url });

    let tab;
    try {
      // 1. Open tab — must be active so TikTok/Instagram fully render
      tab = await chrome.tabs.create({ url, active: true });

      // 2. Wait for page load
      await waitForTabLoad(tab.id);

      // 3. Ping until manifest-injected content script is ready (handles SPA re-renders)
      await waitForContentScript(tab.id);

      // 4. Pick random comment and execute actions
      const comment = randomFrom(commentPool);
      const results = await sendAndWait(tab.id, { type: 'RUN_ACTIONS', comment });

      // 5. Report each action result
      for (const result of results) {
        if (result.action === 'like') {
          notifyPopup(result.skipped
            ? { event: 'like_skipped', url }
            : { event: 'like_done', url });
        } else if (result.action === 'comment') {
          notifyPopup({ event: 'comment_done', url, detail: comment });
        } else if (result.action === 'repost') {
          notifyPopup({ event: 'repost_done', url });
        } else if (result.error) {
          notifyPopup({ event: 'url_error', url, detail: `${result.action}: ${result.error}` });
        }
      }

      // Actions done — count this URL regardless of screenshot outcome
      processed++;

      // 6. Wait, focus tab, and screenshot
      await new Promise(r => setTimeout(r, 3000));
      await waitForTabActive(tab.id);
      // Use tab.windowId — service workers have no associated window
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });

      // 7. Save screenshot
      const timestamp = Date.now();
      const hostname  = new URL(url).hostname.replace('www.', '');
      await chrome.downloads.download({
        url:      dataUrl,
        filename: `auto-lcr-screenshots/screenshot-${hostname}-${timestamp}.png`,
        saveAs:   false,
      });
      notifyPopup({ event: 'screenshot_done', url });
    } catch (err) {
      failedUrls.push(url);
      notifyPopup({ event: 'url_error', url, detail: err.message });
    } finally {
      if (tab?.id) {
        chrome.tabs.remove(tab.id).catch(() => {});
      }
    }

    // Random delay between URLs before opening the next one
    if (!stopRequested) {
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
    }
  }

  notifyPopup({ event: 'done', detail: processed, failedUrls });
  } finally {
    clearInterval(keepAlive);
    isRunning = false;
    chrome.storage.session.set({ isRunning: false }).catch(() => {});
  }
}
