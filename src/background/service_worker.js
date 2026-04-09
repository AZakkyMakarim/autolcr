"use strict";

// Pending action promises: tabId -> { resolve, reject }
const pendingActions = new Map();

const DESKTOP_VIEWPORT = { width: 1366, height: 900 };
const TIKTOK_MOBILE_VIEWPORT = { width: 430, height: 900 };
const INSTAGRAM_IPHONE12PRO_VIEWPORT = { width: 390, height: 844 };
const INSTAGRAM_CAPTURE_WINDOW = { width: 430, height: 930 };
const INSTAGRAM_SCROLL_Y = 420;
const INSTAGRAM_IPHONE12PRO_DPR = 3;
const INSTAGRAM_IPHONE12PRO_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

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
    url: chrome.runtime.getURL("src/popup/popup.html"),
    type: "popup",
    width: 460,
    height: 720,
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
  if (/instagram\.com/.test(url)) return "instagram";
  if (/tiktok\.com/.test(url)) return "tiktok";
  return null;
}

function normalizeUrl(url) {
  // Instagram /reel/ and /reels/ use a different layout — /p/ handles both
  return url.replace(/instagram\.com\/reels?\//i, "instagram.com/p/");
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    let settleTimer = null;

    const globalTimeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(settleTimer);
      reject(new Error("Tab load timeout"));
    }, 30_000);

    function settle() {
      clearTimeout(globalTimeout);
      chrome.tabs.onUpdated.removeListener(listener);
      // Extra delay for SPA JS to initialise after final navigation
      setTimeout(resolve, 1500);
    }

    function listener(id, changeInfo) {
      if (id !== tabId) return;
      if (changeInfo.status === "loading") {
        // Redirect started — cancel pending settle, wait for next complete
        clearTimeout(settleTimer);
      } else if (changeInfo.status === "complete") {
        // Debounce: resolve only if no new navigation starts within 2s
        clearTimeout(settleTimer);
        settleTimer = setTimeout(settle, 2000);
      }
    }

    // Register listener FIRST, then check current status to close the race window
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === "complete") {
          settleTimer = setTimeout(settle, 2000);
        }
      })
      .catch(() => {});
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function debuggerTarget(tabId) {
  return { tabId };
}

async function attachDebugger(tabId) {
  await chrome.debugger.attach(debuggerTarget(tabId), "1.3");
}

async function detachDebugger(tabId) {
  try {
    await chrome.debugger.detach(debuggerTarget(tabId));
  } catch {
    // Tab might already be closed or debugger already detached.
  }
}

async function sendDebuggerCommand(tabId, method, params = {}) {
  await chrome.debugger.sendCommand(debuggerTarget(tabId), method, params);
}

async function enableInstagramIphone12ProEmulation(tabId) {
  try {
    await attachDebugger(tabId);
  } catch (err) {
    throw new Error(
      `Failed to attach debugger for Instagram emulation: ${err.message}`,
    );
  }

  try {
    await sendDebuggerCommand(tabId, "Emulation.setDeviceMetricsOverride", {
      width: INSTAGRAM_IPHONE12PRO_VIEWPORT.width,
      height: INSTAGRAM_IPHONE12PRO_VIEWPORT.height,
      deviceScaleFactor: INSTAGRAM_IPHONE12PRO_DPR,
      mobile: true,
      screenWidth: INSTAGRAM_IPHONE12PRO_VIEWPORT.width,
      screenHeight: INSTAGRAM_IPHONE12PRO_VIEWPORT.height,
      positionX: 0,
      positionY: 0,
      scale: 1,
    });

    await sendDebuggerCommand(tabId, "Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 5,
    });

    await sendDebuggerCommand(tabId, "Emulation.setUserAgentOverride", {
      userAgent: INSTAGRAM_IPHONE12PRO_UA,
      platform: "iPhone",
    });
    await sleep(600);
  } catch (err) {
    await detachDebugger(tabId);
    throw new Error(
      `Failed to apply iPhone 12 Pro emulation on Instagram: ${err.message}`,
    );
  }
}

async function setWindowViewport(windowId, size) {
  await chrome.windows.update(windowId, {
    state: "normal",
    width: size.width,
    height: size.height,
    focused: true,
  });
  // Let layout settle after resize so controls are in their final position.
  await sleep(1000);
}

async function prepareMobileScreenshot(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "PREPARE_SCREENSHOT",
      mode: "ACTION_BAR",
      scrollY: INSTAGRAM_SCROLL_Y,
    });
    return response || null;
  } catch {
    // Retry once after waiting for the content script bridge.
    await waitForContentScript(tabId, 10, 300);
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "PREPARE_SCREENSHOT",
      mode: "ACTION_BAR",
      scrollY: INSTAGRAM_SCROLL_Y,
    });
    return response || null;
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function cropScreenshotDataUrl(dataUrl, cropMeta) {
  if (!cropMeta || typeof cropMeta !== "object") return dataUrl;

  const viewportWidth = Number(cropMeta.viewportWidth);
  const left = Number(cropMeta.left);
  const width = Number(cropMeta.width);

  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return dataUrl;
  if (!Number.isFinite(width) || width <= 1) return dataUrl;

  try {
    const srcBlob = await fetch(dataUrl).then((res) => res.blob());
    const bitmap = await createImageBitmap(srcBlob);
    const scaleX = bitmap.width / viewportWidth;

    const cropX = Math.max(0, Math.floor(left * scaleX));
    const cropW = Math.min(
      bitmap.width - cropX,
      Math.max(1, Math.floor(width * scaleX)),
    );

    if (cropW <= 1) return dataUrl;

    const canvas = new OffscreenCanvas(cropW, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;

    ctx.drawImage(
      bitmap,
      cropX,
      0,
      cropW,
      bitmap.height,
      0,
      0,
      cropW,
      bitmap.height,
    );

    const outBlob = await canvas.convertToBlob({ type: "image/png" });
    const outBase64 = arrayBufferToBase64(await outBlob.arrayBuffer());
    return `data:image/png;base64,${outBase64}`;
  } catch {
    return dataUrl;
  }
}

async function refreshForFinalScreenshot(tabId) {
  await chrome.tabs.reload(tabId);
  await waitForTabLoad(tabId);
  await waitForContentScript(tabId);
  await sleep(3000);
}

function getScreenshotViewport(platform) {
  if (platform === "instagram") return INSTAGRAM_IPHONE12PRO_VIEWPORT;
  return TIKTOK_MOBILE_VIEWPORT;
}

function sendAndWait(tabId, message, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingActions.delete(tabId);
      reject(new Error("Content script response timeout"));
    }, timeoutMs);

    pendingActions.set(tabId, {
      resolve: (data) => {
        clearTimeout(timer);
        resolve(data);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
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
      await chrome.tabs.sendMessage(tabId, { type: "PING" });
      return; // Content script responded
    } catch {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw new Error("Content script not ready after retries");
}

function notifyPopup(payload) {
  const entry = { ...payload, _ts: Date.now() };
  automationLog.push(entry);
  chrome.storage.session.set({ automationLog, isRunning }).catch(() => {});
  chrome.runtime.sendMessage({ type: "PROGRESS", ...entry }).catch(() => {
    // Popup might be closed — ignore
  });
}

// ─── Main message listener ────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "START_AUTOMATION") {
    stopRequested = false;
    automationLog = [];
    isRunning = true;
    chrome.storage.session
      .set({ automationLog: [], isRunning: true })
      .catch(() => {});
    runAutomation(message.urls, message.commentPool);
    return false;
  }

  if (message.type === "STOP_AUTOMATION") {
    stopRequested = true;
    return false;
  }

  // Content script callbacks
  if (message.type === "ACTIONS_DONE" || message.type === "ACTIONS_ERROR") {
    const tabId = sender.tab?.id;
    if (tabId != null && pendingActions.has(tabId)) {
      const { resolve, reject } = pendingActions.get(tabId);
      pendingActions.delete(tabId);
      if (message.type === "ACTIONS_DONE") resolve(message.results);
      else reject(new Error(message.error || "Unknown content script error"));
    }
    return false;
  }
});

// ─── Automation loop ──────────────────────────────────────────────────────────

async function runAutomation(urls, commentPool) {
  // MV3 service workers are killed after ~30s idle. Keep alive with periodic Chrome API calls.
  const keepAlive = setInterval(
    () => chrome.runtime.getPlatformInfo(() => {}),
    25_000,
  );

  let processed = 0;
  const failedUrls = [];

  try {
    for (let url of urls) {
      url = normalizeUrl(url);

      if (stopRequested) {
        notifyPopup({ event: "stopped" });
        return;
      }

      const platform = getPlatform(url);

      if (!platform) {
        notifyPopup({
          event: "url_skip",
          url,
          detail: "unsupported URL — skipped",
        });
        continue;
      }

      notifyPopup({ event: "url_start", url });

      let tab;
      let debuggerAttached = false;
      let instagramCropMeta = null;
      try {
        // 1. Open tab — must be active so TikTok/Instagram fully render
        tab = await chrome.tabs.create({ url, active: true });

        // 1a. Force desktop viewport for L/C/R actions.
        await setWindowViewport(tab.windowId, DESKTOP_VIEWPORT);

        // 2. Wait for page load
        await waitForTabLoad(tab.id);

        // 3. Ping until manifest-injected content script is ready (handles SPA re-renders)
        await waitForContentScript(tab.id);

        // 4. Pick random comment and execute actions
        const comment = randomFrom(commentPool);
        const results = await sendAndWait(tab.id, {
          type: "RUN_ACTIONS",
          comment,
        });

        // 5. Report each action result
        for (const result of results) {
          if (result.action === "like") {
            notifyPopup(
              result.skipped
                ? { event: "like_skipped", url }
                : { event: "like_done", url },
            );
          } else if (result.action === "comment") {
            notifyPopup({ event: "comment_done", url, detail: comment });
          } else if (result.action === "repost") {
            notifyPopup({ event: "repost_done", url });
          } else if (result.error) {
            notifyPopup({
              event: "url_error",
              url,
              detail: `${result.action}: ${result.error}`,
            });
          }
        }

        // Actions done — count this URL regardless of screenshot outcome
        processed++;

        // 6. Prepare screenshot viewport.
        await sleep(1500);
        await waitForTabActive(tab.id);

        if (platform === "instagram") {
          // Use real mobile emulation (Device Toolbar equivalent) for Instagram.
          // Keep window narrow too, so captureVisibleTab does not include blank side area.
          await setWindowViewport(tab.windowId, INSTAGRAM_CAPTURE_WINDOW);
          await enableInstagramIphone12ProEmulation(tab.id);
          debuggerAttached = true;
        } else {
          await setWindowViewport(
            tab.windowId,
            getScreenshotViewport(platform),
          );
        }

        // 7. Refresh once after mobile state is applied and wait 3s.
        await refreshForFinalScreenshot(tab.id);

        // 8. Scroll only for Instagram so like/comment/repost bar is visible.
        if (platform === "instagram") {
          const prepResult = await prepareMobileScreenshot(tab.id);
          instagramCropMeta = prepResult?.cropMeta || null;
        }

        // Use tab.windowId — service workers have no associated window
        let dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: "png",
        });

        if (platform === "instagram" && instagramCropMeta) {
          dataUrl = await cropScreenshotDataUrl(dataUrl, instagramCropMeta);
        }

        // 9. Save screenshot
        const timestamp = Date.now();
        const hostname = new URL(url).hostname.replace("www.", "");
        await chrome.downloads.download({
          url: dataUrl,
          filename: `auto-lcr-screenshots/screenshot-${hostname}-${timestamp}.png`,
          saveAs: false,
        });
        notifyPopup({ event: "screenshot_done", url });
      } catch (err) {
        failedUrls.push(url);
        notifyPopup({ event: "url_error", url, detail: err.message });
      } finally {
        if (debuggerAttached && tab?.id) {
          await detachDebugger(tab.id);
        }
        if (tab?.id) {
          chrome.tabs.remove(tab.id).catch(() => {});
        }
      }

      // Random delay between URLs before opening the next one
      if (!stopRequested) {
        await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
      }
    }

    notifyPopup({ event: "done", detail: processed, failedUrls });
  } finally {
    clearInterval(keepAlive);
    isRunning = false;
    chrome.storage.session.set({ isRunning: false }).catch(() => {});
  }
}
