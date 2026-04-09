"use strict";

// Guard against double-injection
if (window.__AUTO_LCR_IG__) {
  chrome.runtime.sendMessage({
    type: "ACTIONS_DONE",
    results: [{ action: "guard", skipped: true }],
  });
} else {
  window.__AUTO_LCR_IG__ = true;

  // ─── Selectors (update here if Instagram changes their DOM) ────────────────
  // NOTE: Instagram uses div[role="button"] wrappers — aria-label lives on the
  // inner SVG, not the wrapper. Use findClickable(svgSelector) to get the
  // actual clickable element.
  const SELECTORS = {
    // height="24" = post action bar; height="16" = comment like — this is the diff
    likeSvg:
      'svg[aria-label="Like"][height="24"], svg[aria-label="Suka"][height="24"]',
    unlikeSvg:
      'svg[aria-label="Unlike"][height="24"], svg[aria-label="Tidak Suka"][height="24"]',

    // Comment icon SVG
    commentSvg: 'svg[aria-label="Comment"], svg[aria-label="Komentar"]',
    commentInput:
      'textarea[aria-label="Add a comment\u2026"], textarea[placeholder*="comment" i], textarea[placeholder*="komentar" i]',
    // commentSubmit is found dynamically by text — see postComment()

    // Repost button — height="24" excludes the h22 corner badge;
    // :not(:has(circle)) excludes the purple circular floating badge (has <circle> inside SVG)
    // Already-reposted state: same aria-label but SVG gains a 3rd path (checkmark)
    repostSvg: 'svg[aria-label="Repost"][height="24"]:not(:has(circle))',
  };

  // Returns the nearest clickable ancestor of an SVG element
  function findClickable(svgSelector) {
    const svg = document.querySelector(svgSelector);
    if (!svg) return null;
    return svg.closest('[role="button"], button, a') || svg.parentElement;
  }

  // Walk up the React fiber tree from el and call the first onClick found.
  // This bypasses isTrusted checks and event delegation entirely.
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
    // React fiber direct call — bypasses isTrusted; falls back to dispatch
    if (!reactClick(el)) {
      const opts = { bubbles: true, cancelable: true, view: window };
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));
    }
  }

  // Waits for a [role="button"] or button matching predicate to appear in the DOM
  function waitForClickable(predicate, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const check = () =>
        [...document.querySelectorAll('[role="button"], button')].find(
          predicate,
        );
      const found = check();
      if (found) return resolve(found);

      const obs = new MutationObserver(() => {
        const el = check();
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        obs.disconnect();
        reject(new Error("Post button not found"));
      }, timeoutMs);
    });
  }

  // ─── Utilities ──────────────────────────────────────────────────────────────

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function waitForEl(selector, timeoutMs = 7000) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);

      const obs = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        obs.disconnect();
        reject(new Error(`Timeout: selector not found — ${selector}`));
      }, timeoutMs);
    });
  }

  function simulateTyping(el, text) {
    el.focus();
    // Use execCommand for React-controlled inputs
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
    document.execCommand("insertText", false, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function dismissBlockingPopups() {
    let closed = 0;

    const closeLabels = ["close", "tutup", "dismiss"];
    const labelTargets = document.querySelectorAll(
      '[role="dialog"] [aria-label], [aria-modal="true"] [aria-label]',
    );
    for (const node of labelTargets) {
      const label = (node.getAttribute("aria-label") || "")
        .trim()
        .toLowerCase();
      if (!closeLabels.some((term) => label.includes(term))) continue;
      const clickable = node.matches("button, [role='button']")
        ? node
        : node.closest("button, [role='button'], a") || node;
      if (!clickable) continue;
      triggerClick(clickable);
      closed++;
      break;
    }

    const closeByText = [
      "Not now",
      "Sekarang tidak",
      "Nanti",
      "Cancel",
      "Batal",
      "Close",
      "Tutup",
    ];
    const textTargets = document.querySelectorAll(
      '[role="dialog"] button, [role="dialog"] [role="button"], [aria-modal="true"] button, [aria-modal="true"] [role="button"]',
    );
    for (const el of textTargets) {
      const text = (el.textContent || "").trim().toLowerCase();
      if (!text) continue;
      if (!closeByText.some((term) => text === term.toLowerCase())) continue;
      triggerClick(el);
      closed++;
      break;
    }

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    return closed;
  }

  function getScreenshotCropMeta() {
    const target =
      document.querySelector("article") ||
      document.querySelector('main[role="main"]') ||
      document.body;
    const rect = target.getBoundingClientRect();
    const left = Math.max(0, Math.floor(rect.left));
    const right = Math.min(window.innerWidth, Math.ceil(rect.right));
    const width = Math.max(1, right - left);

    return {
      left,
      width,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  }

  // ─── Actions ────────────────────────────────────────────────────────────────

  async function likePost() {
    // Check if already liked (SVG switches to "Unlike" when active)
    if (document.querySelector(SELECTORS.unlikeSvg)) {
      return { action: "like", skipped: true };
    }

    const svg = document.querySelector(SELECTORS.likeSvg);
    if (!svg) throw new Error("Like button not found");

    triggerClick(svg);
    await sleep(800);
    return { action: "like", skipped: false };
  }

  async function postComment(text) {
    // Open comment field by clicking the comment icon if textarea not visible
    let input = document.querySelector(SELECTORS.commentInput);
    if (!input) {
      const trigger = findClickable(SELECTORS.commentSvg);
      if (trigger) {
        triggerClick(trigger);
        await sleep(600);
      }
    }

    input = await waitForEl(SELECTORS.commentInput);
    simulateTyping(input, text);
    await sleep(400);

    // Post button is a div[role="button"] that appears only after text is entered,
    // scoped to the same <form> as the textarea
    const form = input.closest("form");
    const submitBtn = await waitForClickable(
      (el) =>
        el.textContent.trim() === "Post" &&
        (!form || el.closest("form") === form),
    );
    triggerClick(submitBtn);
    await sleep(1000);
    return { action: "comment", skipped: false };
  }

  async function repostPost() {
    // Scope to article so related-posts / feed items below don't interfere
    const scope = document.querySelector("article") || document;
    const svg = scope.querySelector(SELECTORS.repostSvg);
    if (!svg) throw new Error("Repost button not found");

    // Already reposted: Instagram adds a 3rd subpath (checkmark) to the single <path> d attribute.
    // Count M/m (moveto) commands — 2 = not reposted, 3 = already reposted.
    const pathD = svg.querySelector("path")?.getAttribute("d") ?? "";
    if ((pathD.match(/[Mm]/g)?.length ?? 0) >= 3) {
      return { action: "repost", skipped: true };
    }

    triggerClick(svg);
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

      (async () => {
        // Close overlays before framing screenshot so action bar is not blocked.
        dismissBlockingPopups();
        await sleep(350);
        dismissBlockingPopups();
        await sleep(250);

        // Prioritize the action bar (like/comment/repost) so screenshot framing is consistent.
        if (message.mode === "ACTION_BAR") {
          const actionTarget =
            findClickable(SELECTORS.likeSvg) ||
            findClickable(SELECTORS.commentSvg) ||
            findClickable(SELECTORS.repostSvg);

          if (actionTarget) {
            actionTarget.scrollIntoView({ block: "end", behavior: "smooth" });
            await sleep(300);
            const desiredY = Math.max(0, window.scrollY - 40);
            window.scrollTo({ top: desiredY, behavior: "smooth" });
          } else {
            window.scrollTo({ top: scrollY, behavior: "smooth" });
          }
        } else {
          window.scrollTo({ top: scrollY, behavior: "smooth" });
        }

        await sleep(900);
        sendResponse({
          ok: true,
          scrollY: window.scrollY,
          cropMeta: getScreenshotCropMeta(),
        });
      })();

      return true;
    }
    if (message.type !== "RUN_ACTIONS") return false;

    const { comment } = message;
    const results = [];

    (async () => {
      // Detect login wall
      if (
        document.querySelector(
          'input[name="username"], [data-testid="royal_login_button"]',
        )
      ) {
        throw new Error("not logged in");
      }

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
