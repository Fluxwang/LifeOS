const browserApi = typeof browser !== "undefined" ? browser : chrome;

const listElement = document.querySelector("#rules-list");
const emptyMessage = document.querySelector("#empty-message");
const errorMessage = document.querySelector("#error-message");
const template = document.querySelector("#rule-template");

function sendMessage(message) {
  return browserApi.runtime.sendMessage(message);
}

function setError(text) {
  errorMessage.hidden = !text;
  errorMessage.textContent = text || "";
}

function formatAddedAt(timestamp) {
  if (!timestamp) {
    return "添加时间未知";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp * 1000));
}

function renderRules(rules) {
  listElement.replaceChildren();
  emptyMessage.hidden = rules.length > 0;

  rules.forEach((rule) => {
    const item = template.content.firstElementChild.cloneNode(true);
    item.querySelector("h2").textContent = rule.displayName;
    item.querySelector("p").textContent = `添加于 ${formatAddedAt(rule.addedAt)}`;

    const button = item.querySelector("button");
    button.addEventListener("click", async () => {
      button.disabled = true;
      setError("");
      try {
        const response = await sendMessage({ action: "removeRule", id: rule.id });
        if (!response || !response.ok) {
          throw new Error(response && response.error ? response.error : "删除失败");
        }
        await loadRules();
      } catch (error) {
        setError(error.message || "删除失败");
        button.disabled = false;
      }
    });

    listElement.append(item);
  });
}

async function loadRules() {
  try {
    const response = await sendMessage({ action: "getRules" });
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "读取失败");
    }
    renderRules(response.blockedRules || []);
  } catch (error) {
    renderRules([]);
    setError(error.message || "读取失败");
  }
}

loadRules();
