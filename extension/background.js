// Sends the page the user is looking at to the Recipe Box app, which runs a small
// server on this computer. The page is read from the open tab, so recipes from
// sites the user is logged in to come through in full.
//
// On an NYT Cooking recipe box page it can also save the whole list: it pages
// through the list in a background tab, then fetches each recipe from that tab
// (with the user's login) and sends it to the app, a couple of seconds apart.

const APP = "http://127.0.0.1:47811";
const NYT_LIST = /^https:\/\/cooking\.nytimes\.com\/recipe-box(\/|\?|#|$)/;
const PAUSE_MS = 2000;
/** This many failures in a row means something is wrong with every page, not one. */
const MAX_FAILURES_IN_A_ROW = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    await sleep(800);
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

async function ensureApp(tabId) {
  if (await appRunning()) return true;
  status("Opening Recipe Box…");
  await launchApp(tabId).catch(() => {});
  return waitForApp(30000);
}

const NOT_RUNNING = {
  status: "error",
  code: "not_running",
  message: "Recipe Box isn't open. Open it from your Applications folder, then try again.",
};

async function postJson(path, body) {
  const res = await fetch(`${APP}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
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
  if (!(await ensureApp(tabId))) return NOT_RUNNING;

  status("Saving recipe…");
  try {
    return await postJson("/import", page);
  } catch {
    return { status: "error", message: "Couldn't reach Recipe Box. Make sure it's open and try again." };
  }
}

function showBadge(ok) {
  chrome.action.setBadgeBackgroundColor({ color: ok ? "#2f6b46" : "#b91c1c" });
  chrome.action.setBadgeText({ text: ok ? "✓" : "!" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000);
}

const savedOk = (result) => result.status === "saved" || result.status === "duplicate";

// ---------------------------------------------------------------------------
// Saving a whole list

/**
 * The list being saved, or the last one. It's kept in session storage so the popup
 * can show it after being closed and reopened, and so a run cut short (Chrome can
 * stop an extension's background work) reads as stopped instead of running forever.
 */
let job = null;
let stopRequested = false;
const jobLoaded = chrome.storage.session.get("job").then(({ job: saved }) => {
  if (saved && isRunning(saved)) {
    Object.assign(saved, {
      state: "stopped",
      message: "Chrome stopped it partway. Open the list and save it again to pick up where it left off.",
    });
  }
  job ??= saved ?? null;
});

function isRunning(j) {
  return j?.state === "finding" || j?.state === "saving";
}

function setJob(patch) {
  job = { ...job, ...patch };
  chrome.storage.session.set({ job }).catch(() => {});
  chrome.runtime.sendMessage({ type: "job", job }).catch(() => {});
  if (isRunning(job)) {
    const percent = job.total ? Math.floor((100 * (job.saved + job.failed.length)) / job.total) : 0;
    chrome.action.setBadgeBackgroundColor({ color: "#6a7934" });
    chrome.action.setBadgeText({ text: job.state === "saving" ? `${percent}%` : "…" });
  }
}

/** What the open tab's list is called and how many recipes it holds, if it's a recipe box page. */
async function inspectList(tab) {
  if (!NYT_LIST.test(tab.url ?? "")) return null;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        title: document.querySelector("h2")?.textContent.trim() || "your recipe box",
        count: parseInt(document.querySelector('[class*="recipesCountText"]')?.textContent.replace(/\D/g, "") ?? "", 10) || null,
      }),
    });
    return { url: tab.url, ...injection.result };
  } catch {
    return null;
  }
}

/** Every recipe link on a list page, plus how many pages the list has. */
function readListPage() {
  const recipes = [
    ...new Set(
      [...document.querySelectorAll('a[href*="/recipes/"]')]
        .map((a) => a.href.split(/[?#]/)[0])
        .filter((href) => /^https:\/\/cooking\.nytimes\.com\/recipes\/\d+/.test(href)),
    ),
  ];
  const pages = Math.max(1, ...[...document.querySelectorAll('a[href*="page="]')].map((a) => Number(new URL(a.href).searchParams.get("page")) || 0));
  return { href: location.href, recipes, pages };
}

/** Loads a list page in the tab and waits for its recipe cards, which the page draws after loading. */
async function loadListPage(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    await sleep(500);
    let found;
    try {
      [{ result: found }] = await chrome.scripting.executeScript({ target: { tabId }, func: readListPage });
    } catch (e) {
      if (/no tab/i.test(String(e))) throw e;
      continue; // still loading
    }
    if (found && samePage(found.href, url) && found.recipes.length) return found;
  }
  throw new Error("NYT Cooking took too long to show the list.");
}

function samePage(a, b) {
  const [x, y] = [new URL(a), new URL(b)];
  const page = (u) => u.searchParams.get("page") ?? "1";
  return x.pathname.replace(/\/$/, "") === y.pathname.replace(/\/$/, "") && page(x) === page(y);
}

async function fetchRecipe(tabId, url) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (url) => {
      const res = await fetch(url, { credentials: "include" });
      return { status: res.status, html: res.ok ? await res.text() : "" };
    },
    args: [url],
  });
  return result;
}

class Abort extends Error {}
const STOPPED = "Save the list again to pick up where it left off.";

async function saveList(list, userTabId) {
  stopRequested = false;
  setJob({ state: "finding", title: list.title, page: 0, pages: list.count ? Math.ceil(list.count / 48) : null, total: 0, saved: 0, skipped: 0, failed: [], message: "", seen: false });
  // Chrome stops an idle extension after 30 seconds, and a slow import can leave it idle that long.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  let tabId = null;
  try {
    if (!(await ensureApp(userTabId))) throw new Abort(NOT_RUNNING.message);
    const base = new URL(list.url);
    base.search = "";
    base.hash = "";
    tabId = (await chrome.tabs.create({ url: "about:blank", active: false })).id;

    const urls = new Set();
    for (let page = 1, pages = 1; page <= pages; page++) {
      if (stopRequested) throw new Abort(STOPPED);
      const url = page === 1 ? base.href : `${base.href}?page=${page}`;
      const found = await loadListPage(tabId, url);
      pages = found.pages;
      found.recipes.forEach((u) => urls.add(u));
      setJob({ page, pages });
    }

    const known = new Set(await postJson("/known", { urls: [...urls] }));
    const todo = [...urls].filter((u) => !known.has(u));
    setJob({ state: "saving", total: todo.length, skipped: known.size });

    let inARow = 0;
    for (const [index, url] of todo.entries()) {
      if (index) await sleep(PAUSE_MS);
      if (stopRequested) throw new Abort(STOPPED);
      const page = await fetchRecipe(tabId, url);
      if (page.status === 403 || page.status === 429) {
        throw new Abort("NYT Cooking stopped sending recipes for now. Try again later; recipes already saved are skipped.");
      }
      let result;
      if (page.status !== 200) {
        result = { status: "error", message: `NYT Cooking answered with error ${page.status}.` };
      } else {
        try {
          result = await postJson("/import", { url, html: page.html, batch: { index, total: todo.length } });
        } catch {
          throw new Abort("Recipe Box closed partway through. Open it and save the list again to finish; recipes already saved are skipped.");
        }
      }
      if (savedOk(result)) {
        inARow = 0;
        setJob({ saved: job.saved + 1 });
      } else {
        inARow++;
        setJob({ failed: [...job.failed, { url, message: result.message ?? "Something went wrong." }] });
        if (inARow >= MAX_FAILURES_IN_A_ROW) {
          throw new Abort(`Stopped after ${inARow} recipes in a row couldn't be saved.`);
        }
      }
    }
    setJob({ state: "done" });
  } catch (e) {
    const message =
      e instanceof Abort ? e.message : /no tab/i.test(String(e)) ? "The background NYT Cooking tab was closed, so saving stopped." : String(e.message ?? e);
    setJob({ state: "stopped", message });
  } finally {
    clearInterval(keepAlive);
    if (tabId !== null) chrome.tabs.remove(tabId).catch(() => {});
    chrome.action.setBadgeText({ text: "" });
    showBadge(job.state === "done" && job.failed.length === 0);
  }
}

// ---------------------------------------------------------------------------
// Messages from the popup

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message?.type) {
    case "save":
      save(message.tabId).then((result) => {
        showBadge(savedOk(result));
        sendResponse(result);
      });
      return true; // responding asynchronously
    case "popup-opened":
      jobLoaded.then(async () => {
        const list = await inspectList(message.tab);
        sendResponse({ job, list });
      });
      return true;
    case "job-seen":
      if (job && !isRunning(job)) setJob({ seen: true });
      return false;
    case "save-list":
      if (!isRunning(job)) void saveList(message.list, message.tabId);
      return false;
    case "stop":
      stopRequested = true;
      return false;
  }
  return false;
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
    save(tab.id).then((result) => showBadge(savedOk(result)));
  }
});
