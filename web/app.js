(function () {
  const h = React.createElement;
  const API = "";
  const SETTINGS_PATH = "/settings";

  const CATEGORIES = ["编程", "学习", "工作", "娱乐", "游戏", "其他"];
  const MODE_META = {
    pomodoro: { label: "番茄专注", short: "FOCUS", accent: "#E05C5C", sessionType: "pomodoro" },
    free_focus: { label: "自由专注", short: "FREE", accent: "#5C9BE0", sessionType: "free_focus" },
    short_break: { label: "短休息", short: "BREAK", accent: "#4CAF50" },
    long_break: { label: "长休息", short: "BREAK", accent: "#9B5CE0" },
  };

  function fmt(seconds) {
    const safe = Math.max(0, Math.floor(seconds || 0));
    const m = Math.floor(safe / 60).toString().padStart(2, "0");
    const s = Math.floor(safe % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  function minutes(seconds) {
    return Math.round((seconds || 0) / 60);
  }

  function clampNumber(value, fallback, min, max) {
    const next = Number(value);
    if (!Number.isFinite(next)) return fallback;
    return Math.max(min, Math.min(max, Math.round(next)));
  }

  async function api(path, options) {
    const res = await fetch(API + path, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        const body = await res.json();
        message = body.error || body.message || message;
      } catch (_) {
        message = await res.text();
      }
      throw new Error(message);
    }
    return res.json();
  }

  function isSettingsPage() {
    return window.location.pathname.replace(/\/+$/, "") === SETTINGS_PATH;
  }

  function notifySettingsUpdated() {
    try {
      window.localStorage.setItem("lifeos-settings-updated", String(Date.now()));
    } catch (_) {
      // localStorage can be unavailable in some embedded webview modes.
    }
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: "lifeos-settings-updated" }, window.location.origin);
      }
    } catch (_) {
      // Cross-window messaging is best-effort.
    }
  }

  function closeSettingsPage() {
    window.close();
    window.setTimeout(() => {
      if (!window.closed) window.location.href = "/dashboard";
    }, 50);
  }

  function App() {
    const [settings, setSettings] = React.useState(null);
    const [stats, setStats] = React.useState(null);
    const [activity, setActivity] = React.useState({ category: "其他", color: "#888888", seconds: 0 });
    const [rules, setRules] = React.useState({ rules: [], default: "其他", colors: {} });
    const [calendar, setCalendar] = React.useState({ google: { connected: false }, outlook: { connected: false } });
    const [mode, setMode] = React.useState("pomodoro");
    const [taskName, setTaskName] = React.useState("");
    const [running, setRunning] = React.useState(false);
    const [paused, setPaused] = React.useState(false);
    const [startedAt, setStartedAt] = React.useState(null);
    const [elapsed, setElapsed] = React.useState(0);
    const [settingsOpen, setSettingsOpen] = React.useState(false);
    const [settingsTab, setSettingsTab] = React.useState("timer");
    const [confirm, setConfirm] = React.useState(null);
    const [toasts, setToasts] = React.useState([]);
    const [loadError, setLoadError] = React.useState("");
    const finishingRef = React.useRef(false);

    React.useEffect(() => {
      refreshAll();
      const id = setInterval(refreshActivity, 5000);
      return () => clearInterval(id);
    }, []);

    React.useEffect(() => {
      if (isSettingsPage()) return undefined;

      function refreshFromSettingsWindow(event) {
        if (!event || event.key === "lifeos-settings-updated") refreshAll();
      }

      function refreshFromMessage(event) {
        if (event.data && event.data.type === "lifeos-settings-updated") refreshAll();
      }

      window.addEventListener("focus", refreshAll);
      window.addEventListener("storage", refreshFromSettingsWindow);
      window.addEventListener("message", refreshFromMessage);
      return () => {
        window.removeEventListener("focus", refreshAll);
        window.removeEventListener("storage", refreshFromSettingsWindow);
        window.removeEventListener("message", refreshFromMessage);
      };
    }, []);

    React.useEffect(() => {
      if (!running || paused) return undefined;
      const id = setInterval(() => setElapsed((value) => value + 1), 1000);
      return () => clearInterval(id);
    }, [running, paused]);

    React.useEffect(() => {
      if (!settings || !running || paused || isFreeMode(mode)) return;
      const total = durationForMode(mode, settings);
      if (total > 0 && elapsed >= total) {
        completeCurrent(true, { auto: true });
      }
    }, [elapsed, mode, paused, running, settings]);

    async function refreshAll() {
      try {
        const [nextSettings, nextStats, nextActivity, nextRules, nextCalendar] = await Promise.all([
          api("/api/settings"),
          api("/api/stats/today"),
          api("/api/activity/current"),
          api("/api/rules"),
          api("/api/calendar/status"),
        ]);
        setSettings(nextSettings);
        setStats(nextStats);
        setActivity(nextActivity);
        setRules(nextRules);
        setCalendar(nextCalendar);
        setLoadError("");
      } catch (err) {
        setLoadError(err.message || String(err));
      }
    }

    async function refreshStats() {
      setStats(await api("/api/stats/today"));
    }

    async function refreshActivity() {
      try {
        setActivity(await api("/api/activity/current"));
      } catch (_) {
        // Keep the previous activity visible while the backend is temporarily unavailable.
      }
    }

    async function refreshRules() {
      setRules(await api("/api/rules"));
    }

    async function refreshCalendar() {
      setCalendar(await api("/api/calendar/status"));
    }

    function showToast(message, tone) {
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((items) => [...items, { id, message, tone: tone || "info" }].slice(-4));
      window.setTimeout(() => {
        setToasts((items) => items.filter((item) => item.id !== id));
      }, 3200);
    }

    function ask(options) {
      setConfirm(options);
    }

    async function openSettingsWindow() {
      const desktopApi = window.pywebview && window.pywebview.api;
      if (desktopApi && typeof desktopApi.open_settings === "function") {
        try {
          await desktopApi.open_settings();
          return;
        } catch (err) {
          showToast(err.message || String(err), "danger");
        }
      }

      const popup = window.open(
        SETTINGS_PATH,
        "lifeos-settings",
        "width=860,height=760,menubar=no,toolbar=no,location=no,status=no"
      );
      if (popup) {
        popup.focus();
      } else {
        setSettingsOpen(true);
      }
    }

    function resetTimer(nextMode) {
      setRunning(false);
      setPaused(false);
      setElapsed(0);
      setStartedAt(null);
      if (nextMode) setMode(nextMode);
    }

    function requestMode(nextMode) {
      if (nextMode === mode) return;
      if (running || paused || elapsed > 0) {
        ask({
          title: "切换模式将重置当前计时",
          message: "当前计时不会写入专注记录。",
          confirmText: "切换",
          tone: "danger",
          onConfirm: () => resetTimer(nextMode),
        });
        return;
      }
      resetTimer(nextMode);
    }

    function startTimer() {
      if (!startedAt) setStartedAt(new Date());
      setRunning(true);
      setPaused(false);
    }

    function pauseTimer() {
      setRunning(false);
      setPaused(true);
    }

    function stopTimer() {
      resetTimer(mode);
      showToast("已停止当前计时", "info");
    }

    function finishFreeFocus() {
      if (elapsed <= 0) {
        showToast("自由专注时长必须大于 0 秒", "warning");
        return;
      }
      ask({
        title: "本次专注完成",
        message: `确认记录 ${fmt(elapsed)} 的自由专注？`,
        confirmText: "记录",
        onConfirm: () => completeCurrent(true),
      });
    }

    async function completeCurrent(completed, options) {
      if (!settings || finishingRef.current) return;
      finishingRef.current = true;
      const finishedMode = mode;
      const actual = actualSecondsFor(finishedMode, elapsed, settings, Boolean(options && options.auto));
      const start = startedAt || new Date(Date.now() - Math.max(actual, 1) * 1000);
      const end = new Date();
      setRunning(false);
      setPaused(false);

      try {
        if (completed && MODE_META[finishedMode].sessionType && actual > 0) {
          await api("/api/session", {
            method: "POST",
            body: JSON.stringify({
              type: MODE_META[finishedMode].sessionType,
              task_name: taskName || null,
              planned_minutes: finishedMode === "pomodoro" ? settings.pomodoro_minutes : null,
              actual_seconds: actual,
              completed: true,
              started_at: start.toISOString(),
              ended_at: end.toISOString(),
            }),
          });
          await refreshStats();
        }

        if (finishedMode === "pomodoro" && completed) {
          const nextMode = nextBreakMode(stats, settings);
          resetTimer(nextMode);
          showToast(nextMode === "long_break" ? "番茄完成，进入长休息" : "番茄完成，进入短休息", "success");
        } else if (isBreakMode(finishedMode)) {
          resetTimer("pomodoro");
          showToast("休息结束，回到番茄专注", "success");
        } else {
          resetTimer(finishedMode);
          if (completed) showToast("专注记录已保存", "success");
        }
      } catch (err) {
        showToast(err.message || String(err), "danger");
      } finally {
        finishingRef.current = false;
      }
    }

    async function patchSettings(changes, message) {
      try {
        const next = await api("/api/settings", { method: "PATCH", body: JSON.stringify(changes) });
        setSettings(next);
        if (message) showToast(message, "success");
        return next;
      } catch (err) {
        showToast(err.message || String(err), "danger");
        throw err;
      }
    }

    if (!settings || !stats) {
      return h(
        "main",
        { className: "app app-loading" },
        h("div", { className: "loading-card" }, h("strong", null, "LifeOS Focus"), h("span", null, loadError || "Loading..."))
      );
    }

    const meta = MODE_META[mode];
    const total = durationForMode(mode, settings);
    const displaySeconds = isFreeMode(mode) ? elapsed : Math.max(total - elapsed, 0);
    const progress = progressFor(mode, elapsed, total);
    const stateLabel = stateText(mode, running, paused, settings, activity);
    const monitorText = monitorStatusText(settings, activity);

    if (isSettingsPage()) {
      return h(
        "main",
        { className: "app settings-page" },
        h(SettingsModal, {
          open: true,
          standalone: true,
          onClose: closeSettingsPage,
          tab: settingsTab,
          setTab: setSettingsTab,
          settings,
          setSettings,
          stats,
          rules,
          calendar,
          refreshRules,
          refreshCalendar,
          patchSettings,
          showToast,
        }),
        h(ToastStack, { toasts })
      );
    }

    return h(
      "main",
      { className: "app", style: { "--accent": meta.accent, "--progress": `${progress}%` } },
      h(
        "section",
        { className: "focus-window" },
        h(
          "header",
          { className: "titlebar" },
          h("div", { className: "brand" }, h("span", { className: "brand-mark" }, ""), h("span", null, "LifeOS Focus")),
          h(
            "div",
            { className: "window-tools" },
            h("button", { className: "icon-button", title: "刷新", onClick: refreshAll }, "↻"),
            h("button", { className: "icon-button", title: "设置", onClick: openSettingsWindow }, "⚙")
          )
        ),
        h(
          "div",
          { className: "mode-tabs", role: "tablist" },
          modeButton("pomodoro", mode, requestMode),
          modeButton("free_focus", mode, requestMode)
        ),
        h(
          "section",
          { className: `timer-panel ${isFreeMode(mode) && running ? "free-running" : ""}` },
          h(
            "div",
            { className: "ring-shell" },
            h(
              "div",
              { className: "ring" },
              h(
                "div",
                { className: "ring-inner" },
                h("div", { className: "time" }, fmt(displaySeconds)),
                h("div", { className: "mode-label" }, meta.short),
                h("div", { className: "state-label" }, stateLabel)
              )
            )
          ),
          h("input", {
            className: "task-input",
            value: taskName,
            onChange: (e) => setTaskName(e.target.value),
            placeholder: running || paused ? "当前任务" : "今天要专注什么？",
            disabled: running,
            maxLength: 80,
          }),
          h(
            "div",
            { className: "actions" },
            running
              ? h("button", { className: "control secondary", onClick: pauseTimer }, "暂停")
              : h("button", { className: "control primary", onClick: startTimer }, paused ? "继续" : isBreakMode(mode) ? "开始休息" : "开始"),
            isFreeMode(mode)
              ? h("button", { className: "control primary-soft", onClick: finishFreeFocus, disabled: elapsed <= 0 }, "完成")
              : h("button", { className: "control primary-soft", onClick: () => completeCurrent(true), disabled: elapsed <= 0 && !isBreakMode(mode) }, isBreakMode(mode) ? "结束休息" : "完成"),
            h("button", { className: "control danger", onClick: stopTimer, disabled: elapsed <= 0 && !running && !paused }, "停止")
          )
        ),
        h(
          "section",
          { className: "today-strip" },
          metric(`${stats.pomodoros_done}/${stats.pomodoros_goal}`, "番茄"),
          metric(`${minutes(stats.total_focus_seconds)}m`, "专注"),
          metric(stats.free_focus_count, "自由"),
          metric(stats.points_today, "积分")
        ),
        h(
          "footer",
          { className: "monitor-bar" },
          h("span", { className: "dot", style: { background: activity.color || "#888888" } }),
          h("span", { className: "monitor-text" }, monitorText)
        )
      ),
      h(SettingsModal, {
        open: settingsOpen,
        onClose: () => setSettingsOpen(false),
        tab: settingsTab,
        setTab: setSettingsTab,
        settings,
        setSettings,
        stats,
        rules,
        calendar,
        refreshRules,
        refreshCalendar,
        patchSettings,
        showToast,
      }),
      h(ConfirmDialog, { confirm, setConfirm }),
      h(ToastStack, { toasts })
    );
  }

  function SettingsModal(props) {
    const {
      open,
      standalone,
      onClose,
      tab,
      setTab,
      settings,
      setSettings,
      stats,
      rules,
      calendar,
      refreshRules,
      refreshCalendar,
      patchSettings,
      showToast,
    } = props;
    const [draft, setDraft] = React.useState(settings);
    const [ruleDraft, setRuleDraft] = React.useState({ matcher: "domain", value: "", category: "编程" });
    const [saving, setSaving] = React.useState(false);

    React.useEffect(() => {
      if (open) setDraft(settings);
    }, [open, settings]);

    if (!open || !draft) return null;

    function setDraftValue(key, value) {
      setDraft((current) => ({ ...current, [key]: value }));
    }

    async function saveSettings() {
      setSaving(true);
      try {
        const sanitized = sanitizeSettings(draft);
        const next = await patchSettings(sanitized, "设置已保存");
        setDraft(next);
        notifySettingsUpdated();
      } finally {
        setSaving(false);
      }
    }

    async function toggleMonitor() {
      const nextEnabled = !settings.monitor_enabled;
      const next = await patchSettings({ monitor_enabled: nextEnabled }, nextEnabled ? "监听已开启" : "监听已关闭");
      setSettings(next);
      setDraft(next);
      notifySettingsUpdated();
    }

    async function connectCalendar(provider) {
      try {
        const result = await api(`/api/calendar/${provider}/auth-url`);
        if (result.configured && result.url) {
          window.location.href = result.url;
          return;
        }
        showToast(result.message || "日历 OAuth 未配置", "warning");
      } catch (err) {
        showToast(err.message || String(err), "danger");
      }
    }

    async function disconnectCalendar(provider) {
      try {
        await api(`/api/calendar/${provider}/disconnect`, { method: "POST", body: "{}" });
        await refreshCalendar();
        showToast(`${providerName(provider)} 已断开`, "success");
      } catch (err) {
        showToast(err.message || String(err), "danger");
      }
    }

    async function addRule() {
      const value = ruleDraft.value.trim();
      if (!value) {
        showToast("请输入规则匹配内容", "warning");
        return;
      }
      try {
        await api("/api/rules", {
          method: "POST",
          body: JSON.stringify({
            id: String(Date.now()),
            [ruleDraft.matcher]: value,
            category: ruleDraft.category,
          }),
        });
        setRuleDraft((current) => ({ ...current, value: "" }));
        await refreshRules();
        showToast("分类规则已新增", "success");
      } catch (err) {
        showToast(err.message || String(err), "danger");
      }
    }

    async function deleteRule(id) {
      try {
        await api(`/api/rules/${encodeURIComponent(id)}`, { method: "DELETE" });
        await refreshRules();
        showToast("分类规则已删除", "success");
      } catch (err) {
        showToast(err.message || String(err), "danger");
      }
    }

    const settingsPanel = h(
      "section",
      {
        className: `settings-modal ${standalone ? "settings-window" : ""}`,
        role: standalone ? "region" : "dialog",
        "aria-modal": standalone ? undefined : "true",
        "aria-label": "设置",
      },
      h(
        "header",
        { className: "modal-header" },
        h("div", null, h("h2", null, "设置"), h("p", null, "LifeOS Focus")),
        h("button", { className: "icon-button", title: "关闭", onClick: onClose }, "×")
      ),
      h(
        "div",
        { className: "settings-body" },
        h(
          "nav",
          { className: "settings-tabs" },
          tabButton("timer", "计时器", tab, setTab),
          tabButton("calendar", "日历", tab, setTab),
          tabButton("monitor", "监听", tab, setTab),
          tabButton("about", "关于", tab, setTab)
        ),
        h(
          "section",
          { className: "settings-content" },
            tab === "timer" &&
              h(
                React.Fragment,
                null,
                h("div", { className: "form-grid" },
                  numberField("番茄时长", "pomodoro_minutes", draft, setDraftValue, 1, 180, "分钟"),
                  numberField("短休息", "short_break_minutes", draft, setDraftValue, 1, 60, "分钟"),
                  numberField("长休息", "long_break_minutes", draft, setDraftValue, 1, 120, "分钟"),
                  numberField("长休息间隔", "long_break_after", draft, setDraftValue, 1, 12, "个番茄"),
                  numberField("每日目标", "daily_goal_pomodoros", draft, setDraftValue, 1, 24, "个"),
                  numberField("自由提醒", "free_focus_reminder_minutes", draft, setDraftValue, 5, 240, "分钟")
                ),
                h("div", { className: "switch-list" },
                  switchRow("番茄结束通知", draft.notify_pomodoro_end, (v) => setDraftValue("notify_pomodoro_end", v)),
                  switchRow("休息结束通知", draft.notify_break_end, (v) => setDraftValue("notify_break_end", v))
                )
              ),
            tab === "calendar" &&
              h(
                React.Fragment,
                null,
                h("div", { className: "calendar-grid" },
                  calendarCard("google", calendar.google, connectCalendar, disconnectCalendar),
                  calendarCard("outlook", calendar.outlook, connectCalendar, disconnectCalendar)
                ),
                providerSelect(draft, setDraftValue, calendar),
                h("div", { className: "switch-list compact" },
                  switchRow("番茄同步到日历", draft.calendar_sync_pomodoro, (v) => setDraftValue("calendar_sync_pomodoro", v)),
                  switchRow("自由专注同步到日历", draft.calendar_sync_free_focus, (v) => setDraftValue("calendar_sync_free_focus", v)),
                  switchRow("休息同步到日历", draft.calendar_sync_break, (v) => setDraftValue("calendar_sync_break", v)),
                  switchRow("事件包含任务名", draft.calendar_include_task_name, (v) => setDraftValue("calendar_include_task_name", v))
                )
              ),
            tab === "monitor" &&
              h(
                React.Fragment,
                null,
                h("div", { className: "monitor-settings" },
                  switchRow("系统活动监听", settings.monitor_enabled, toggleMonitor),
                  numberField("采样间隔", "monitor_interval_seconds", draft, setDraftValue, 1, 60, "秒"),
                  numberField("空闲阈值", "idle_threshold_seconds", draft, setDraftValue, 30, 3600, "秒")
                ),
                h("div", { className: "rule-composer" },
                  h("select", { value: ruleDraft.matcher, onChange: (e) => setRuleDraft({ ...ruleDraft, matcher: e.target.value }) },
                    h("option", { value: "domain" }, "域名"),
                    h("option", { value: "process" }, "进程"),
                    h("option", { value: "title_contains" }, "标题包含")
                  ),
                  h("input", {
                    value: ruleDraft.value,
                    onChange: (e) => setRuleDraft({ ...ruleDraft, value: e.target.value }),
                    placeholder: "github.com / code.exe",
                  }),
                  h("select", { value: ruleDraft.category, onChange: (e) => setRuleDraft({ ...ruleDraft, category: e.target.value }) },
                    CATEGORIES.map((item) => h("option", { key: item, value: item }, item))
                  ),
                  h("button", { className: "small-button primary", onClick: addRule }, "+")
                ),
                h("div", { className: "rules-list" },
                  (rules.rules || []).map((rule) =>
                    h("div", { className: "rule-row", key: rule.id },
                      h("span", { className: "rule-type" }, rule.domain ? "域名" : rule.process ? "进程" : "标题"),
                      h("span", { className: "rule-value" }, rule.domain || rule.process || rule.title_contains || "-"),
                      h("span", { className: "rule-category", style: { "--rule-color": (rules.colors || {})[rule.category] || "#888888" } }, rule.category),
                      h("button", { className: "icon-button small", title: "删除", onClick: () => deleteRule(rule.id) }, "×")
                    )
                  )
                )
              ),
            tab === "about" &&
              h(
                "div",
                { className: "about-panel" },
                h("div", { className: "about-mark" }, ""),
                h("h3", null, "LifeOS Focus"),
                h("p", null, "本地优先的番茄、自由专注、活动监听与轻量统计工具。"),
                h("div", { className: "about-stats" },
                  h("span", null, `今日 ${stats.pomodoros_done}/${stats.pomodoros_goal} 番茄`),
                  h("span", null, `专注 ${minutes(stats.total_focus_seconds)} 分钟`)
                ),
                h("button", { className: "control primary", onClick: () => (window.location.href = "/dashboard") }, "打开 Dashboard")
              )
        )
      ),
      h(
        "footer",
        { className: "modal-footer" },
        h("button", { className: "control secondary", onClick: onClose }, "关闭"),
        h("button", { className: "control primary", onClick: saveSettings, disabled: saving }, saving ? "保存中" : "保存设置")
      )
    );

    if (standalone) return settingsPanel;

    return h(
      "div",
      { className: "modal-backdrop", role: "presentation", onMouseDown: (e) => e.target === e.currentTarget && onClose() },
      settingsPanel
    );
  }

  function ConfirmDialog({ confirm, setConfirm }) {
    if (!confirm) return null;
    async function confirmAction() {
      const action = confirm.onConfirm;
      setConfirm(null);
      if (action) await action();
    }
    return h(
      "div",
      { className: "dialog-backdrop" },
      h(
        "section",
        { className: "confirm-dialog", role: "alertdialog", "aria-modal": "true" },
        h("h2", null, confirm.title),
        h("p", null, confirm.message),
        h(
          "div",
          { className: "dialog-actions" },
          h("button", { className: "control secondary", onClick: () => setConfirm(null) }, confirm.cancelText || "取消"),
          h("button", { className: `control ${confirm.tone === "danger" ? "danger-solid" : "primary"}`, onClick: confirmAction }, confirm.confirmText || "确认")
        )
      )
    );
  }

  function ToastStack({ toasts }) {
    return h(
      "div",
      { className: "toast-stack", "aria-live": "polite" },
      toasts.map((toast) => h("div", { className: `toast ${toast.tone || "info"}`, key: toast.id }, toast.message))
    );
  }

  function modeButton(value, current, onClick) {
    return h(
      "button",
      { className: value === current ? "active" : "", onClick: () => onClick(value), role: "tab", "aria-selected": value === current },
      MODE_META[value].label
    );
  }

  function tabButton(value, label, current, setTab) {
    return h("button", { className: value === current ? "active" : "", onClick: () => setTab(value) }, label);
  }

  function metric(value, label) {
    return h("div", { className: "metric" }, h("b", null, value), h("span", null, label));
  }

  function numberField(label, key, draft, setDraftValue, min, max, unit) {
    return h(
      "label",
      { className: "field" },
      h("span", null, label),
      h("div", { className: "number-input" },
        h("input", {
          type: "number",
          min,
          max,
          value: draft[key],
          onChange: (e) => setDraftValue(key, clampNumber(e.target.value, draft[key], min, max)),
        }),
        h("em", null, unit)
      )
    );
  }

  function switchRow(label, checked, onChange) {
    return h(
      "div",
      { className: "switch-row" },
      h("span", null, label),
      h("button", { className: `toggle ${checked ? "on" : ""}`, onClick: () => onChange(!checked), "aria-pressed": Boolean(checked), title: label })
    );
  }

  function calendarCard(provider, state, connectCalendar, disconnectCalendar) {
    const connected = Boolean(state && state.connected);
    return h(
      "div",
      { className: "calendar-card" },
      h("div", null,
        h("strong", null, providerName(provider)),
        h("span", { className: connected ? "connected" : "" }, connected ? state.email || "已连接" : "未连接")
      ),
      connected
        ? h("button", { className: "small-button secondary", onClick: () => disconnectCalendar(provider) }, "断开")
        : h("button", { className: "small-button primary", onClick: () => connectCalendar(provider) }, "连接")
    );
  }

  function providerSelect(draft, setDraftValue, calendar) {
    const googleConnected = Boolean(calendar && calendar.google && calendar.google.connected);
    const outlookConnected = Boolean(calendar && calendar.outlook && calendar.outlook.connected);
    return h(
      "label",
      { className: "field calendar-provider" },
      h("span", null, "同步到"),
      h("select", {
        value: draft.calendar_provider || "",
        onChange: (e) => setDraftValue("calendar_provider", e.target.value || null),
      },
        h("option", { value: "" }, "不自动同步"),
        h("option", { value: "google", disabled: !googleConnected && draft.calendar_provider !== "google" }, "Google Calendar"),
        h("option", { value: "outlook", disabled: !outlookConnected && draft.calendar_provider !== "outlook" }, "Outlook Calendar")
      )
    );
  }

  function sanitizeSettings(draft) {
    return {
      ...draft,
      calendar_provider: draft.calendar_provider || null,
      pomodoro_minutes: clampNumber(draft.pomodoro_minutes, 25, 1, 180),
      short_break_minutes: clampNumber(draft.short_break_minutes, 5, 1, 60),
      long_break_minutes: clampNumber(draft.long_break_minutes, 15, 1, 120),
      long_break_after: clampNumber(draft.long_break_after, 4, 1, 12),
      daily_goal_pomodoros: clampNumber(draft.daily_goal_pomodoros, 8, 1, 24),
      free_focus_reminder_minutes: clampNumber(draft.free_focus_reminder_minutes, 90, 5, 240),
      monitor_interval_seconds: clampNumber(draft.monitor_interval_seconds, 3, 1, 60),
      idle_threshold_seconds: clampNumber(draft.idle_threshold_seconds, 300, 30, 3600),
    };
  }

  function durationForMode(mode, settings) {
    if (mode === "pomodoro") return settings.pomodoro_minutes * 60;
    if (mode === "short_break") return settings.short_break_minutes * 60;
    if (mode === "long_break") return settings.long_break_minutes * 60;
    return 0;
  }

  function actualSecondsFor(mode, elapsed, settings, auto) {
    if (mode === "pomodoro" && auto) return settings.pomodoro_minutes * 60;
    if (isBreakMode(mode)) return durationForMode(mode, settings);
    return Math.max(0, Math.floor(elapsed || 0));
  }

  function progressFor(mode, elapsed, total) {
    if (isFreeMode(mode)) return runningFreeProgress(elapsed);
    if (!total) return 0;
    return Math.max(0, Math.min(100, (elapsed / total) * 100));
  }

  function runningFreeProgress(elapsed) {
    return Math.min(100, ((elapsed % 3600) / 3600) * 100);
  }

  function nextBreakMode(stats, settings) {
    const done = (stats ? stats.pomodoros_done : 0) + 1;
    const interval = Math.max(1, Number(settings.long_break_after || 4));
    return done % interval === 0 ? "long_break" : "short_break";
  }

  function stateText(mode, running, paused, settings, activity) {
    if (!settings.monitor_enabled && !running && !paused) return "监听未启动";
    if (running) return isBreakMode(mode) ? "休息中" : "专注中";
    if (paused) return isFreeMode(mode) ? "自由暂停" : "已暂停";
    if (mode === "short_break") return "短休息";
    if (mode === "long_break") return "长休息";
    if (isFreeMode(mode)) return "自由专注";
    if (!activity.process && activity.title && activity.title.indexOf("unavailable") >= 0) return "监听不可用";
    return "待开始";
  }

  function monitorStatusText(settings, activity) {
    if (!settings.monitor_enabled) return "监听未启动";
    if (activity.process) {
      return `${activity.category || "其他"} · ${activity.process} · ${activity.seconds || 0}s`;
    }
    if (activity.title && activity.title.indexOf("unavailable") >= 0) return "当前系统不支持活动监听";
    if (activity.title && activity.title.indexOf("disabled") >= 0) return "监听未启动";
    return "未监听或当前空闲";
  }

  function providerName(provider) {
    return provider === "google" ? "Google Calendar" : "Outlook Calendar";
  }

  function isFreeMode(mode) {
    return mode === "free_focus";
  }

  function isBreakMode(mode) {
    return mode === "short_break" || mode === "long_break";
  }

  ReactDOM.createRoot(document.getElementById("root")).render(h(App));
})();
