const card = document.getElementById("card");
const headline = document.getElementById("headline");
const detail = document.getElementById("detail");

function show(state, title, text = "") {
  card.dataset.state = state;
  headline.textContent = title;
  detail.textContent = text;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "status") show("working", message.text);
});

chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
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
});
