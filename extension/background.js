// Sends the page the user is looking at to the Recipe Box app, which runs a small
// server on this computer. The page is read from the open tab, so recipes from
// sites the user is logged in to come through in full.

const APP = "http://127.0.0.1:47811";

function status(text) {
  chrome.runtime.sendMessage({ type: "status", text }).catch(() => {});
}

async function appRunning() {
  try {
    const res = await fetch(`${APP}/ping`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForApp(timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await appRunning()) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

/** Opens the app through its recipebox:// link. Chrome asks the user to allow it the first time. */
async function launchApp(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      window.location.href = "recipebox://open";
    },
  });
}

async function readPage(tabId) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({ url: location.href, html: document.documentElement.outerHTML }),
  });
  return injection.result;
}

async function save(tabId) {
  let page;
  try {
    page = await readPage(tabId);
  } catch {
    return { status: "error", message: "Recipes can't be saved from this page." };
  }
  if (!/^https?:/.test(page.url)) {
    return { status: "error", message: "Open a recipe on a website first." };
  }

  if (!(await appRunning())) {
    status("Opening Recipe Box…");
    await launchApp(tabId).catch(() => {});
    if (!(await waitForApp(30000))) {
      return {
        status: "error",
        code: "not_running",
        message: "Recipe Box isn't open. Open it from your Applications folder, then try again.",
      };
    }
  }

  status("Saving recipe…");
  try {
    const res = await fetch(`${APP}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(page),
    });
    return await res.json();
  } catch {
    return { status: "error", message: "Couldn't reach Recipe Box. Make sure it's open and try again." };
  }
}

function showBadge(result) {
  const ok = result.status === "saved" || result.status === "duplicate";
  chrome.action.setBadgeBackgroundColor({ color: ok ? "#2f6b46" : "#b91c1c" });
  chrome.action.setBadgeText({ text: ok ? "✓" : "!" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "save") return false;
  save(message.tabId).then((result) => {
    showBadge(result);
    sendResponse(result);
  });
  return true; // responding asynchronously
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-recipe",
    title: "Save recipe to Recipe Box",
    contexts: ["page"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "save-recipe" && tab?.id !== undefined) {
    save(tab.id).then(showBadge);
  }
});
