const STORAGE_KEY = "blockedRules";

function getRuntime() {
  return typeof browser !== "undefined" ? browser : chrome;
}

function promisifyChrome(method, context, ...args) {
  return new Promise((resolve, reject) => {
    method.call(context, ...args, (result) => {
      const error = getRuntime().runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result);
    });
  });
}

async function storageGet(defaults) {
  const api = getRuntime().storage.local;
  if (api.get.length === 1) {
    return api.get(defaults);
  }
  return promisifyChrome(api.get, api, defaults);
}

async function storageSet(value) {
  const api = getRuntime().storage.local;
  if (api.set.length === 1) {
    return api.set(value);
  }
  return promisifyChrome(api.set, api, value);
}

function updateDynamicRules(options) {
  const api = getRuntime().declarativeNetRequest;
  if (api.updateDynamicRules.length === 1) {
    return api.updateDynamicRules(options);
  }
  return promisifyChrome(api.updateDynamicRules, api, options);
}

function getDynamicRules() {
  const api = getRuntime().declarativeNetRequest;
  if (api.getDynamicRules.length === 0) {
    return api.getDynamicRules();
  }
  return promisifyChrome(api.getDynamicRules, api);
}

async function getStoredRules() {
  try {
    const data = await storageGet({ [STORAGE_KEY]: [] });
    return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
  } catch (error) {
    console.error("Failed to read blocked rules", error);
    return [];
  }
}

async function setStoredRules(rules) {
  await storageSet({ [STORAGE_KEY]: rules });
}

function normalizeStoredRules(rules) {
  const maxExistingId = rules.reduce((maxId, rule) => {
    const id = Number(rule && rule.id);
    return Number.isInteger(id) && id > 0 ? Math.max(maxId, id) : maxId;
  }, 0);
  const usedIds = new Set();
  let nextId = maxExistingId;

  return rules.map((rule) => {
    let id = Number(rule && rule.id);
    if (!Number.isInteger(id) || id <= 0 || usedIds.has(id)) {
      do {
        nextId += 1;
      } while (usedIds.has(nextId));
      id = nextId;
    }
    usedIds.add(id);
    return { ...rule, id };
  });
}

async function loadNormalizedRules() {
  const rules = await getStoredRules();
  const normalized = normalizeStoredRules(rules);
  if (JSON.stringify(rules) !== JSON.stringify(normalized)) {
    await setStoredRules(normalized);
  }
  return normalized;
}

function nextRuleId(rules) {
  return rules.reduce((maxId, rule) => Math.max(maxId, Number(rule.id) || 0), 0) + 1;
}

async function syncDynamicRules(rules) {
  const dynamicRules = await getDynamicRules();
  await updateDynamicRules({
    removeRuleIds: dynamicRules.map((rule) => rule.id),
    addRules: rules.map(buildDnrRule)
  });
}

function normalizeHostname(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  return parsed.hostname.toLowerCase();
}

function isWildcardPattern(pattern) {
  return pattern.startsWith("*.");
}

function hostFromPattern(pattern) {
  return isWildcardPattern(pattern) ? pattern.slice(2) : pattern;
}

function patternMatchesHostname(pattern, hostname) {
  const target = hostFromPattern(pattern).toLowerCase();
  if (isWildcardPattern(pattern)) {
    return hostname === target || hostname.endsWith(`.${target}`);
  }
  return hostname === target;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function regexFilterFromPattern(pattern) {
  const host = escapeRegExp(hostFromPattern(pattern).toLowerCase());
  if (isWildcardPattern(pattern)) {
    return `^https?://([^/?#@]+\\.)?${host}(:[0-9]+)?([/?#].*)?$`;
  }
  return `^https?://${host}(:[0-9]+)?([/?#].*)?$`;
}

function buildDnrRule(rule) {
  return {
    id: rule.id,
    priority: 1,
    action: {
      type: "redirect",
      redirect: {
        regexSubstitution: `${getRuntime().runtime.getURL("blocked/blocked.html")}?url=\\0`
      }
    },
    condition: {
      regexFilter: regexFilterFromPattern(rule.pattern),
      resourceTypes: ["main_frame"]
    }
  };
}

async function checkUrl(url) {
  const hostname = normalizeHostname(url);
  if (!hostname) {
    return { blocked: false, ruleId: null };
  }

  const rules = await loadNormalizedRules();
  const matchedRule = rules.find((rule) => patternMatchesHostname(rule.pattern, hostname));
  return {
    blocked: Boolean(matchedRule),
    ruleId: matchedRule ? matchedRule.id : null
  };
}

async function getPopupState(url) {
  let hostname = null;
  try {
    hostname = normalizeHostname(url);
  } catch (error) {
    hostname = null;
  }

  const rules = await loadNormalizedRules();
  const matchedRule = hostname
    ? rules.find((rule) => patternMatchesHostname(rule.pattern, hostname))
    : null;

  return {
    blocked: Boolean(matchedRule),
    ruleId: matchedRule ? matchedRule.id : null,
    ruleCount: rules.length
  };
}

async function addRule({ pattern, displayName }) {
  if (!pattern || !displayName) {
    throw new Error("Missing rule pattern or display name.");
  }

  const hostname = hostFromPattern(pattern).toLowerCase();
  if (!hostname || hostname.includes("/") || hostname.includes(":")) {
    throw new Error("Invalid rule pattern.");
  }

  const rules = await loadNormalizedRules();
  const duplicate = rules.find((rule) => rule.pattern === pattern);
  if (duplicate) {
    await syncDynamicRules(rules);
    return { rule: duplicate };
  }

  const id = nextRuleId(rules);
  const rule = {
    id,
    pattern,
    displayName,
    addedAt: Math.floor(Date.now() / 1000)
  };
  const nextRules = [...rules, rule];

  await syncDynamicRules(nextRules);
  await setStoredRules(nextRules);
  return { rule };
}

async function removeRule({ id }) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) {
    throw new Error("Invalid rule id.");
  }

  const rules = await loadNormalizedRules();
  const nextRules = rules.filter((rule) => rule.id !== numericId);
  await syncDynamicRules(nextRules);
  await setStoredRules(nextRules);
  return { success: true };
}

async function handleMessage(message) {
  switch (message && message.action) {
    case "checkUrl":
      return checkUrl(message.url);
    case "getPopupState":
      return getPopupState(message.url);
    case "addRule":
      return addRule(message);
    case "removeRule":
      return removeRule(message);
    case "getRules":
      return { rules: await loadNormalizedRules() };
    default:
      throw new Error("Unknown action.");
  }
}

getRuntime().runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      console.error(error);
      sendResponse({ ok: false, error: error.message || "Unknown error." });
    });
  return true;
});
