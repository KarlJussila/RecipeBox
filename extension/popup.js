const card = document.getElementById("card");
const headline = document.getElementById("headline");
const detail = document.getElementById("detail");
const bar = document.getElementById("bar");
const failures = document.getElementById("failures");
const actions = document.getElementById("actions");
const actionButton = document.getElementById("action");

/** Whether the popup is following a whole list being saved, so its updates belong here. */
let followingJob = false;

function show(state, title, text = "") {
  card.dataset.state = state;
  headline.textContent = title;
  detail.textContent = text;
}

function setAction(label, run, primary = false) {
  actions.hidden = !label;
  if (!label) return;
  actionButton.textContent = label;
  actionButton.className = primary ? "primary" : "";
  actionButton.onclick = run;
}

const count = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const isRunning = (job) => job?.state === "finding" || job?.state === "saving";

function showFailures(failed) {
  failures.hidden = failed.length === 0;
  if (!failed.length) return;
  failures.querySelector("summary").textContent = `${count(failed.length, "recipe")} couldn't be saved`;
  const list = failures.querySelector("ul");
  list.replaceChildren(
    ...failed.map(({ url, message }) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.textContent = decodeURIComponent(new URL(url).pathname.split("/").pop().replace(/^\d+-/, "").replace(/-/g, " "));
      item.append(link, document.createTextNode(`: ${message}`));
      return item;
    }),
  );
}

function showJob(job) {
  followingJob = true;
  const done = job.saved + job.failed.length;
  bar.hidden = job.state !== "saving";
  showFailures(job.failed);
  const stop = () => {
    chrome.runtime.sendMessage({ type: "stop" }).catch(() => {});
    setAction("Stopping…", null);
    actionButton.disabled = true;
  };
  const already = job.skipped ? `${count(job.skipped, "recipe was", "recipes were")} already in Recipe Box.` : "";

  if (job.state === "finding") {
    show("working", "Finding your recipes…", job.pages ? `Page ${Math.max(job.page, 1)} of ${job.pages}` : "");
    setAction("Stop", stop);
  } else if (job.state === "saving") {
    show("working", `Saving ${Math.min(done + 1, job.total).toLocaleString()} of ${count(job.total, "recipe")}`, "You can close this and keep browsing.");
    bar.firstElementChild.style.width = `${job.total ? (100 * done) / job.total : 0}%`;
    if (!actionButton.disabled) setAction("Stop", stop);
  } else {
    actionButton.disabled = false;
    setAction(null);
    if (job.state === "done") {
      const title = job.total ? `Saved ${count(job.saved, "recipe")}` : "Nothing new to save";
      show(job.failed.length ? "error" : "saved", title, already);
    } else {
      show("error", "Saving stopped", [job.message, job.saved ? `${count(job.saved, "recipe")} saved before it stopped.` : ""].join(" ").trim());
    }
  }
}

function offerList(tab, list) {
  const minutes = list.count ? Math.max(1, Math.round((list.count * 2.5) / 60)) : null;
  show(
    "ready",
    list.count ? `Save all ${count(list.count, "recipe")}?` : "Save this whole list?",
    `From “${list.title}” on NYT Cooking${minutes ? `, about ${count(minutes, "minute")}` : ""}. Recipes already in Recipe Box are skipped.`,
  );
  setAction(
    "Save all",
    () => {
      followingJob = true;
      setAction(null);
      show("working", "Finding your recipes…");
      chrome.runtime.sendMessage({ type: "save-list", list, tabId: tab.id }).catch(() => {});
    },
    true,
  );
}

async function saveThisPage(tab) {
  show("working", "Saving recipe…");
  const result = await chrome.runtime.sendMessage({ type: "save", tabId: tab.id });
  if (result?.status === "saved") {
    show("saved", "Saved to Recipe Box", result.title);
    setTimeout(() => window.close(), 2500);
  } else if (result?.status === "duplicate") {
    show("saved", "Already in your Recipe Box", result.title);
    setTimeout(() => window.close(), 2500);
  } else {
    show("error", "Couldn't save this recipe", result?.message ?? "Something went wrong.");
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "status" && !followingJob) show("working", message.text);
  if (message?.type === "job" && followingJob) {
    showJob(message.job);
    if (!isRunning(message.job)) chrome.runtime.sendMessage({ type: "job-seen" }).catch(() => {});
  }
});

chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
  const { job, list } = await chrome.runtime.sendMessage({ type: "popup-opened", tab });
  if (isRunning(job)) {
    showJob(job);
  } else if (list && job && !job.seen) {
    // The last list finished while the popup was closed: report it once.
    showJob(job);
    chrome.runtime.sendMessage({ type: "job-seen" }).catch(() => {});
  } else if (list) {
    offerList(tab, list);
  } else {
    await saveThisPage(tab);
  }
});
