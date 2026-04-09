"use strict";

// Guard against double-injection
if (window.__AUTO_LCR_TT__) {
  chrome.runtime.sendMessage({
    type: "ACTIONS_DONE",
    results: [{ action: "guard", skipped: true }],
  });
} else {
  window.__AUTO_LCR_TT__ = true;

  // ─── Selectors (update here if TikTok changes their DOM) ──────────────────
  const SELECTORS = {
    // data-e2e is language-independent — aria-label varies per locale
    likeBtn: 'button:has([data-e2e="like-icon"])',
    likeBtnActive: 'button[aria-pressed="true"]:has([data-e2e="like-icon"])',

    // Comment panel trigger — button wrapping data-e2e="comment-icon" span
    commentBtn: 'button:has([data-e2e="comment-icon"])',

    // DraftEditor contenteditable inside comment-text container
    commentInput: '[data-e2e="comment-text"] [contenteditable="true"]',

    // Post button — starts disabled, enables after text entered
    commentPost: 'button[data-e2e="comment-post"]',

    // Repost — click share first, then pick repost from popup
    shareBtn: 'button[aria-label*="Share video"]',
    repostOption: '[data-e2e="share-repost"]',

    // Login wall
    loginIndicator: 'form[action*="login"], [data-e2e="login-modal"]',
  };

  // ─── Utilities ──────────────────────────────────────────────────────────────

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function waitForEl(selector, timeoutMs = 7000) {
    return new Promise((resolve, reject) => {
      const check = () => document.querySelector(selector);
      const found = check();
      if (found) return resolve(found);

      const obs = new MutationObserver(() => {
        const el = check();
        if (el) {
          obs.disconnect();
          clearInterval(poll);
          resolve(el);
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });

      // Polling fallback — catches elements if TikTok re-renders and observer misses it
      const poll = setInterval(() => {
        const el = check();
        if (el) {
          obs.disconnect();
          clearInterval(poll);
          resolve(el);
        }
      }, 500);

      setTimeout(() => {
        obs.disconnect();
        clearInterval(poll);
        reject(new Error(`Timeout: ${selector}`));
      }, timeoutMs);
    });
  }

  // Wait for a button to lose its disabled attribute
  function waitForEnabled(selector, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const check = () => {
        const el = document.querySelector(selector);
        return el && !el.disabled ? el : null;
      };
      const found = check();
      if (found) return resolve(found);
      const obs = new MutationObserver(() => {
        const el = check();
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });
      obs.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["disabled"],
      });
      setTimeout(() => {
        obs.disconnect();
        reject(new Error("Post button never enabled"));
      }, timeoutMs);
    });
  }

  // React fiber direct call — bypasses isTrusted checks
  function reactClick(el) {
    const fiberKey = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
    if (!fiberKey) return false;
    let fiber = el[fiberKey];
    while (fiber) {
      const props = fiber.memoizedProps || fiber.pendingProps;
      if (props && typeof props.onClick === "function") {
        props.onClick({
          type: "click",
          target: el,
          currentTarget: el,
          bubbles: true,
          cancelable: true,
          preventDefault: () => {},
          stopPropagation: () => {},
          nativeEvent: new MouseEvent("click"),
        });
        return true;
      }
      fiber = fiber.return;
    }
    return false;
  }

  function triggerClick(el) {
    el.scrollIntoView({ block: "center" });
    if (!reactClick(el)) {
      const opts = { bubbles: true, cancelable: true, view: window };
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));
    }
  }

  // ─── Actions ────────────────────────────────────────────────────────────────

  async function likePost() {
    if (document.querySelector(SELECTORS.likeBtnActive)) {
      return { action: "like", skipped: true };
    }
    const btn = await waitForEl(SELECTORS.likeBtn);
    triggerClick(btn);
    await sleep(800);
    return { action: "like", skipped: false };
  }

  async function postComment(text) {
    // Open comment panel
    let input = document.querySelector(SELECTORS.commentInput);
    if (!input) {
      const btn = document.querySelector(SELECTORS.commentBtn);
      if (btn) {
        triggerClick(btn);
        await sleep(800);
      }
    }

    // Wait for DraftEditor contenteditable
    input = await waitForEl(SELECTORS.commentInput);

    // DraftEditor ignores execCommand — use paste event instead,
    // which triggers DraftEditor's built-in paste handler and updates internal state
    triggerClick(input);
    await sleep(200);
    input.focus();

    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    input.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
    await sleep(400);

    // Wait for Post button to become enabled (disabled attr is removed after text input)
    const postBtn = await waitForEnabled(SELECTORS.commentPost);
    triggerClick(postBtn);
    await sleep(1000);
    return { action: "comment", skipped: false };
  }

  async function repostPost() {
    // Open share popup
    const shareBtn = document.querySelector(SELECTORS.shareBtn);
    if (!shareBtn) throw new Error("Share button not found");
    triggerClick(shareBtn);

    // Wait for repost option in popup
    const repostEl = await waitForEl(SELECTORS.repostOption);

    // If already reposted the label text changes — skip
    const label = repostEl.querySelector("p")?.textContent.trim() ?? "";
    if (/remove/i.test(label)) {
      // Close popup with Escape and skip
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await sleep(300);
      return { action: "repost", skipped: true };
    }

    triggerClick(repostEl);
    await sleep(800);
    return { action: "repost", skipped: false };
  }

  // ─── Main entry ─────────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "PING") {
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === "PREPARE_SCREENSHOT") {
      const scrollY = Number.isFinite(message.scrollY)
        ? Math.max(0, message.scrollY)
        : 240;
      window.scrollTo({ top: scrollY, behavior: "smooth" });
      setTimeout(
        () => sendResponse({ ok: true, scrollY: window.scrollY }),
        900,
      );
      return true;
    }
    if (message.type !== "RUN_ACTIONS") return false;

    const { comment } = message;
    const results = [];

    (async () => {
      if (document.querySelector(SELECTORS.loginIndicator)) {
        throw new Error("not logged in");
      }

      // Wait for post to fully render using data-e2e (language-independent)
      await waitForEl('[data-e2e="like-icon"]', 15000);

      const randomDelay = () => sleep(1000 + Math.random() * 2000);

      results.push(await likePost());
      await randomDelay();
      results.push(await postComment(comment));
      await randomDelay();
      results.push(await repostPost());

      chrome.runtime.sendMessage({ type: "ACTIONS_DONE", results });
    })().catch((err) => {
      chrome.runtime.sendMessage({ type: "ACTIONS_ERROR", error: err.message });
    });

    return false;
  });
}
