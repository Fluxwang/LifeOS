const browserApi = typeof browser !== "undefined" ? browser : chrome;

const state = {
  tabId: null,
  url: null,
  hostname: null,
  rootDomain: null,
  blockedRuleId: null
};

const elements = {
  mainView: document.querySelector("#main-view"),
  confirmView: document.querySelector("#confirm-view"),
  currentSite: document.querySelector("#current-site"),
  statusText: document.querySelector("#status-text"),
  message: document.querySelector("#message"),
  blockButton: document.querySelector("#block-button"),
  unblockButton: document.querySelector("#unblock-button"),
  manageButton: document.querySelector("#manage-button"),
  confirmSite: document.querySelector("#confirm-site"),
  rootChoiceTitle: document.querySelector("#root-choice-title"),
  rootChoiceHelp: document.querySelector("#root-choice-help"),
  exactChoiceTitle: document.querySelector("#exact-choice-title"),
  confirmError: document.querySelector("#confirm-error"),
  cancelButton: document.querySelector("#cancel-button"),
  confirmButton: document.querySelector("#confirm-button")
};

function sendMessage(message) {
  return browserApi.runtime.sendMessage(message);
}

function getCurrentTab() {
  return new Promise((resolve, reject) => {
    browserApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const error = browserApi.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tabs[0] || null);
    });
  });
}

function parseHttpUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed;
  } catch (error) {
    return null;
  }
}

function getRootDomain(hostname) {
  const parts = hostname.split(".").filter(Boolean);
  if (parts.length <= 2) {
    return hostname;
  }
  return parts.slice(-2).join(".");
}

function setMessage(text, isError = false) {
  elements.message.hidden = !text;
  elements.message.textContent = text || "";
  elements.message.classList.toggle("error", isError);
}

function setConfirmError(text) {
  elements.confirmError.hidden = !text;
  elements.confirmError.textContent = text || "";
}

function showMainView() {
  elements.mainView.hidden = false;
  elements.confirmView.hidden = true;
  setConfirmError("");
}

function showConfirmView() {
  elements.mainView.hidden = true;
  elements.confirmView.hidden = false;
}

function renderUnavailable(label) {
  elements.currentSite.textContent = label;
  elements.statusText.textContent = "无法屏蔽";
  elements.statusText.classList.remove("blocked");
  elements.blockButton.hidden = false;
  elements.blockButton.disabled = true;
  elements.unblockButton.hidden = true;
  setMessage("无法屏蔽此页面");
}

function renderMainStatus(blocked) {
  elements.currentSite.textContent = state.hostname;
  elements.statusText.textContent = blocked ? "已屏蔽" : "未屏蔽";
  elements.statusText.classList.toggle("blocked", blocked);
  elements.blockButton.hidden = blocked;
  elements.blockButton.disabled = blocked;
  elements.unblockButton.hidden = !blocked;
  setMessage("");
}

function renderConfirmChoices() {
  elements.confirmSite.textContent = state.hostname;
  elements.rootChoiceTitle.textContent = `屏蔽整个 ${state.rootDomain}`;
  elements.rootChoiceHelp.textContent = `含 ${state.rootDomain} 的所有子域`;
  elements.exactChoiceTitle.textContent = `仅屏蔽 ${state.hostname}`;
}

function selectedRulePayload() {
  const selected = document.querySelector("input[name='scope']:checked").value;
  if (selected === "root") {
    return {
      pattern: `*.${state.rootDomain}`,
      displayName: `${state.rootDomain}（含所有子域）`
    };
  }
  return {
    pattern: state.hostname,
    displayName: state.hostname
  };
}

async function initialize() {
  try {
    const tab = await getCurrentTab();
    state.tabId = tab ? tab.id : null;
    state.url = tab ? tab.url : null;

    const parsed = parseHttpUrl(state.url);
    if (!parsed) {
      renderUnavailable(state.url || "当前页面");
      return;
    }

    state.hostname = parsed.hostname.toLowerCase();
    state.rootDomain = getRootDomain(state.hostname);
    renderConfirmChoices();

    const response = await sendMessage({ action: "checkUrl", url: state.url });
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "读取状态失败");
    }
    state.blockedRuleId = response.ruleId;
    renderMainStatus(response.blocked);
  } catch (error) {
    renderUnavailable("当前页面");
    setMessage(error.message || "读取状态失败", true);
  }
}

elements.blockButton.addEventListener("click", () => {
  renderConfirmChoices();
  showConfirmView();
});

elements.cancelButton.addEventListener("click", showMainView);

elements.confirmButton.addEventListener("click", async () => {
  elements.confirmButton.disabled = true;
  setConfirmError("");
  try {
    const response = await sendMessage({
      action: "addRule",
      ...selectedRulePayload()
    });
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "写入规则失败");
    }
    window.close();
  } catch (error) {
    setConfirmError(error.message || "写入规则失败");
    elements.confirmButton.disabled = false;
  }
});

elements.unblockButton.addEventListener("click", async () => {
  elements.unblockButton.disabled = true;
  try {
    const response = await sendMessage({ action: "removeRule", id: state.blockedRuleId });
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "删除规则失败");
    }
    window.close();
  } catch (error) {
    setMessage(error.message || "删除规则失败", true);
    elements.unblockButton.disabled = false;
  }
});

elements.manageButton.addEventListener("click", () => {
  browserApi.runtime.openOptionsPage();
});

initialize();
