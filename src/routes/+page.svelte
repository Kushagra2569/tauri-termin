<script>
  import { invoke } from "@tauri-apps/api/core";
  import { onDestroy, onMount, tick } from "svelte";
  import { Terminal } from "xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import TerminalSplitTree from "$lib/components/TerminalSplitTree.svelte";
  import {
    actionDefinitions,
    findActionByLeader,
    findActionByShortcut,
    getActionBindingLabel,
    matchesShortcut,
  } from "$lib/terminal-actions";
  import {
    createTerminalSettings,
    hydrateTerminalSettings,
  } from "$lib/terminal-config";
  import "xterm/css/xterm.css";

  /**
   * @typedef {{ sessionId: string, cwd: string }} TerminalSessionResult
   * @typedef {{ output: string, cwd: string, exited: boolean }} TerminalOutputResult
   * @typedef {{ id: string, label: string, shortcut: string, description: string, run: () => void }} PaletteAction
   * @typedef {{ terminal: import("xterm").Terminal, fitAddon: FitAddon, removeSelectionHandler: (() => void) | null, removeContextMenuHandler: (() => void) | null }} TerminalRuntime
   * @typedef {{ id: string, title: string, sessionId: string | null, cwd: string | null, busy: boolean, host: HTMLDivElement | null, runtime: TerminalRuntime | null, transcript: string }} TerminalPane
   * @typedef {{ id: string, paneId: string, type: "pane" }} PaneNode
   * @typedef {{ id: string, direction: "row" | "column", type: "split", sizes: number[], children: Array<PaneNode | SplitNode> }} SplitNode
   * @typedef {PaneNode | SplitNode} LayoutNode
   * @typedef {{ id: string, title: string, panes: TerminalPane[], rootNode: LayoutNode, activePaneId: string | null, paneNavigationHints: Record<string, Partial<Record<"left" | "right" | "up" | "down", string>>> }} TerminalTab
   */

  /** @type {TerminalTab[]} */
  let tabs = $state([]);
  let activeTabId = $state("tab-1");
  let paletteOpen = $state(false);
  let paletteQuery = $state("");
  let selectedPaletteIndex = $state(0);
  /** @type {HTMLInputElement | null} */
  let paletteInput = $state(null);
  /** @type {number | null} */
  let pollTimer = $state(null);
  /** @type {ResizeObserver | null} */
  let resizeObserver = $state(null);
  /** @type {HTMLElement | null} */
  let terminalViewport = $state(null);
  let removeShortcutListener = $state(() => {});
  let settings = $state(createTerminalSettings());
  let leaderActive = $state(false);
  /** @type {number | null} */
  let leaderTimer = null;

  const sshProfiles = [
    "deploy@prod-east.example.com",
    "admin@staging.internal",
    "kusha@192.168.0.24",
  ];

  const activeTab = $derived(
    tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
  );

  const activePane = $derived.by(() => {
    if (!activeTab?.activePaneId) {
      return null;
    }

    return activeTab.panes.find((pane) => pane.id === activeTab.activePaneId) ?? null;
  });

  const paletteActions = $derived.by(() =>
    actionDefinitions
      .map((action) => ({
        id: action.id,
        label: action.label,
        description: action.description,
        shortcut: getActionBindingLabel(settings, action.id) || "Command bar",
        run: () => performAction(action.id),
      }))
      .filter((action) => !action.id.startsWith("focusTab") || canFocusTab(action.id)),
  );

  const filteredPaletteActions = $derived.by(() => {
    const query = paletteQuery.trim().toLowerCase();
    if (!query) {
      return paletteActions;
    }

    return paletteActions.filter((action) =>
      [action.label, action.description, action.shortcut]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  });

  $effect(() => {
    if (!paletteOpen) {
      return;
    }

    if (filteredPaletteActions.length === 0) {
      selectedPaletteIndex = 0;
      return;
    }

    if (selectedPaletteIndex >= filteredPaletteActions.length) {
      selectedPaletteIndex = 0;
    }
  });

  /**
   * @param {string} id
   * @param {string} title
   * @returns {TerminalTab}
   */
  function createPendingTab(id, title) {
    const paneId = `pane-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      id,
      title,
      panes: [createPendingPane(paneId, title)],
      rootNode: {
        id: `node-${paneId}`,
        type: "pane",
        paneId,
      },
      activePaneId: paneId,
      paneNavigationHints: {},
    };
  }

  /**
   * @param {string} id
   * @param {string} title
   * @returns {TerminalPane}
   */
  function createPendingPane(id, title) {
    return {
      id,
      title,
      sessionId: null,
      cwd: null,
      busy: true,
      host: null,
      runtime: null,
      transcript: "",
    };
  }

  async function createTerminalTab() {
    const terminalTabs = tabs.length + 1;
    const id = `tab-${Date.now()}`;
    const newTab = createPendingTab(id, `Shell ${terminalTabs}`);
    tabs = [...tabs, newTab];
    activeTabId = id;

    await tick();
    mountPendingTabTerminals(id);
    await initializePendingTabSessions(id);
    focusActiveTerminal();
  }

  /**
   * @param {string} tabId
   */
  function mountPendingTabTerminals(tabId) {
    const tab = tabs.find((entry) => entry.id === tabId);
    if (!tab) {
      return;
    }

    for (const pane of tab.panes) {
      mountPaneTerminal(tab.id, pane.id);
    }
  }

  /**
   * @param {string} tabId
   */
  async function initializePendingTabSessions(tabId) {
    const tab = tabs.find((entry) => entry.id === tabId);
    if (!tab) {
      return;
    }

    for (const pane of tab.panes) {
      if (!pane.sessionId) {
        await initializePaneSession(tab.id, pane.id, pane.cwd);
      }
    }
  }

  /**
   * @param {string} tabId
   * @param {string} paneId
   * @param {string | null | undefined} cwd
   */
  async function initializePaneSession(tabId, paneId, cwd = null) {
    const pane = getPane(tabId, paneId);
    if (!pane || !pane.runtime) {
      return;
    }

    try {
      /** @type {TerminalSessionResult} */
      const session = await invoke("create_terminal_session", { cwd });
      pane.sessionId = session.sessionId;
      pane.cwd = session.cwd;
      pane.busy = false;
      appendPaneOutput(tabId, paneId, "Session ready.\r\n");
      resizeTabTerminals(tabId);
    } catch (error) {
      pane.busy = false;
      appendPaneOutput(tabId, paneId, `Failed to start terminal session: ${String(error)}\r\n`);
    }
  }

  function openPalette() {
    paletteOpen = true;
    paletteQuery = "";
    selectedPaletteIndex = 0;
    queueMicrotask(() => paletteInput?.focus());
  }

  function closePalette() {
    paletteOpen = false;
    paletteQuery = "";
    selectedPaletteIndex = 0;
    focusActiveTerminal();
  }

  function clearLeaderMode() {
    leaderActive = false;

    if (leaderTimer) {
      window.clearTimeout(leaderTimer);
      leaderTimer = null;
    }
  }

  function activateLeaderMode() {
    clearLeaderMode();
    leaderActive = true;
    leaderTimer = window.setTimeout(() => {
      leaderActive = false;
      leaderTimer = null;
    }, settings.leader.timeoutMs);
  }

  function isLeaderEnabled() {
    return !!settings.leader?.enabled && !!settings.leader?.trigger;
  }

  /**
   * @param {KeyboardEvent} event
   */
  function handleGlobalShortcuts(event) {
    if (event.defaultPrevented) {
      return;
    }

    if (paletteOpen && handleCommandBarNavigation(event)) {
      return;
    }

    if (event.key === "Escape" && paletteOpen) {
      event.preventDefault();
      closePalette();
      return;
    }

    if (leaderActive && isLeaderEnabled()) {
      const leaderAction = findActionByLeader(settings, event);
      clearLeaderMode();

      if (leaderAction) {
        event.preventDefault();
        performAction(leaderAction.id);
        return;
      }
    }

    if (isLeaderEnabled() && matchesShortcut(settings.leader.trigger, event)) {
      event.preventDefault();
      activateLeaderMode();
      return;
    }

    const action = findActionByShortcut(settings, event);
    if (action) {
      event.preventDefault();
      performAction(action.id);
    }
  }

  /**
   * @param {KeyboardEvent} event
   */
  function handleCommandBarNavigation(event) {
    if (!paletteOpen) {
      return false;
    }

    if (matchesShortcut(settings.commandBar.nextItem, event)) {
      event.preventDefault();
      movePaletteSelection(1);
      return true;
    }

    if (matchesShortcut(settings.commandBar.previousItem, event)) {
      event.preventDefault();
      movePaletteSelection(-1);
      return true;
    }

    if (matchesShortcut(settings.commandBar.runSelected, event)) {
      if (filteredPaletteActions.length === 0) {
        return true;
      }

      event.preventDefault();
      runPaletteAction(filteredPaletteActions[selectedPaletteIndex] ?? filteredPaletteActions[0]);
      return true;
    }

    return false;
  }

  /**
   * @param {number} offset
   */
  function movePaletteSelection(offset) {
    if (filteredPaletteActions.length === 0) {
      selectedPaletteIndex = 0;
      return;
    }

    selectedPaletteIndex =
      (selectedPaletteIndex + offset + filteredPaletteActions.length) %
      filteredPaletteActions.length;
  }

  /**
   * @param {string} text
   */
  function writeSystemMessage(text) {
    if (!activePane?.runtime) {
      return;
    }

    appendPaneOutput(activeTab.id, activePane.id, `\r\n${text}\r\n`);
  }

  async function copyActiveSelection() {
    const selection = activePane?.runtime?.terminal.getSelection() ?? "";
    if (!selection) {
      return;
    }

    try {
      await navigator.clipboard.writeText(selection);
    } catch (error) {
      writeSystemMessage(`Clipboard copy failed: ${String(error)}`);
    }
  }

  /**
   * @param {TerminalPane | null} pane
   */
  async function pasteClipboardIntoPane(pane) {
    if (!pane?.sessionId) {
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        return;
      }

      await invoke("write_terminal_input", {
        sessionId: pane.sessionId,
        input: text,
      });
    } catch (error) {
      writeSystemMessage(`Clipboard paste failed: ${String(error)}`);
    }
  }

  /**
   * @param {string} tabId
   * @param {string} paneId
   */
  function handlePaneSelectionChange(tabId, paneId) {
    const pane = getPane(tabId, paneId);
    if (!pane?.runtime || !settings.terminal.copyOnSelect) {
      return;
    }

    const selection = pane.runtime.terminal.getSelection();
    if (!selection) {
      return;
    }

    navigator.clipboard.writeText(selection).catch(() => {});
  }

  /**
   * @param {MouseEvent} event
   * @param {string} tabId
   * @param {string} paneId
   */
  function handlePaneContextMenu(event, tabId, paneId) {
    const pane = getPane(tabId, paneId);
    if (!pane?.runtime) {
      return;
    }

    const behavior = settings.terminal.rightClickBehavior;
    if (behavior === "native") {
      return;
    }

    event.preventDefault();
    activatePane(tabId, paneId);

    if (behavior === "copy-paste" && pane.runtime.terminal.hasSelection()) {
      navigator.clipboard.writeText(pane.runtime.terminal.getSelection()).catch(() => {});
      return;
    }

    if (behavior === "paste" || behavior === "copy-paste") {
      pasteClipboardIntoPane(pane);
    }
  }

  /**
   * @param {string} tabId
   * @param {string} paneId
   */
  function mountPaneTerminal(tabId, paneId) {
    const pane = getPane(tabId, paneId);
    if (!pane || !pane.host || pane.runtime) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: settings.terminal.cursorBlink,
      fontFamily: settings.terminal.fontFamily,
      fontSize: settings.terminal.fontSize,
      lineHeight: settings.terminal.lineHeight,
      scrollback: settings.terminal.scrollback,
      theme: settings.terminal.theme,
      allowProposedApi: false,
      convertEol: false,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(pane.host);
    fitAddon.fit();

    terminal.onData((data) => {
      if (!pane.sessionId) {
        return;
      }

      invoke("write_terminal_input", {
        sessionId: pane.sessionId,
        input: data,
      }).catch((error) => {
        terminal.writeln(`\r\nInput error: ${String(error)}`);
      });
    });

    const selectionHandler = () => handlePaneSelectionChange(tabId, paneId);
    const selectionDisposable = terminal.onSelectionChange(selectionHandler);

    const contextMenuHandler = /** @param {MouseEvent} event */ (event) =>
      handlePaneContextMenu(event, tabId, paneId);
    pane.host.addEventListener("contextmenu", contextMenuHandler);

    pane.runtime = {
      terminal,
      fitAddon,
      removeSelectionHandler: () => selectionDisposable.dispose(),
      removeContextMenuHandler: () => pane.host?.removeEventListener("contextmenu", contextMenuHandler),
    };
    if (pane.transcript) {
      terminal.write(pane.transcript);
    } else {
      appendPaneOutput(tabId, paneId, "Starting terminal session...\r\n");
    }
  }

  function focusActiveTerminal() {
    activePane?.runtime?.terminal.focus();
  }

  /**
   * @param {"left" | "right" | "up" | "down"} direction
   */
  function focusAdjacentPane(direction) {
    if (!activeTab || !activePane?.host) {
      return;
    }

    const hintedPaneId = activeTab.paneNavigationHints[activePane.id]?.[direction];
    if (hintedPaneId && activeTab.panes.some((pane) => pane.id === hintedPaneId)) {
      activatePane(activeTab.id, hintedPaneId);
      return;
    }

    const sourceRect = activePane.host.getBoundingClientRect();
    const candidates = activeTab.panes
      .filter((pane) => pane.id !== activePane.id && pane.host)
      .map((pane) => ({
        pane,
        rect: /** @type {HTMLDivElement} */ (pane.host).getBoundingClientRect(),
      }))
      .filter(({ rect }) => isCandidateInDirection(sourceRect, rect, direction))
      .map(({ pane, rect }) => ({
        pane,
        score: paneDirectionScore(sourceRect, rect, direction),
      }))
      .sort((left, right) => left.score - right.score);

    if (candidates.length > 0) {
      rememberPaneNavigation(activeTab, activePane.id, candidates[0].pane.id, direction);
      activatePane(activeTab.id, candidates[0].pane.id);
    }
  }

  /**
   * @param {string} tabId
   */
  async function closeTab(tabId) {
    const tab = tabs.find((entry) => entry.id === tabId);
    if (!tab) {
      return;
    }

    for (const pane of tab.panes) {
      pane.runtime?.terminal.dispose();
      if (pane.sessionId) {
        await invoke("close_terminal_session", { sessionId: pane.sessionId }).catch(() => {});
      }
    }

    const closingIndex = tabs.findIndex((entry) => entry.id === tabId);
    const nextActive =
      activeTabId === tabId
        ? tabs[closingIndex + 1]?.id ?? tabs[closingIndex - 1]?.id ?? null
        : activeTabId;

    tabs = tabs.filter((entry) => entry.id !== tabId);

    if (tabs.length === 0) {
      await createTerminalTab();
      return;
    }

    if (nextActive) {
      activeTabId = nextActive;
      queueMicrotask(() => {
        resizeActiveTerminals();
        focusActiveTerminal();
      });
    }
  }

  /**
   * @param {string} tabId
   * @param {string} paneId
   */
  async function closePane(tabId, paneId) {
    const tab = tabs.find((entry) => entry.id === tabId);
    const pane = getPane(tabId, paneId);
    if (!tab || !pane) {
      return;
    }

    if (tab.panes.length === 1) {
      await closeTab(tabId);
      return;
    }

    pane.runtime?.terminal.dispose();
    if (pane.sessionId) {
      await invoke("close_terminal_session", { sessionId: pane.sessionId }).catch(() => {});
    }

    tab.rootNode = removePaneNode(tab.rootNode, paneId);
    tab.panes = tab.panes.filter((entry) => entry.id !== paneId);
    if (tab.activePaneId === paneId) {
      tab.activePaneId = firstPaneIdFromNode(tab.rootNode);
    }

    queueMicrotask(() => {
      resizeTabTerminals(tabId);
      focusActiveTerminal();
    });
  }

  /**
   * @param {string} tabId
   * @param {"row" | "column"} direction
   */
  async function splitActivePane(tabId, direction) {
    const tab = tabs.find((entry) => entry.id === tabId);
    const sourcePane = getPane(tabId, tab?.activePaneId ?? "");
    if (!tab || !sourcePane) {
      return;
    }

    const paneId = `pane-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newPane = createPendingPane(paneId, `Split ${tab.panes.length + 1}`);
    newPane.cwd = sourcePane.cwd;

    tab.panes = [...tab.panes, newPane];
    tab.rootNode = splitPaneNode(tab.rootNode, sourcePane.id, direction, paneId);
    tab.activePaneId = paneId;

    await tick();
    mountPaneTerminal(tab.id, paneId);
    await initializePaneSession(tab.id, paneId, sourcePane.cwd);
    resizeTabTerminals(tab.id);
    focusActiveTerminal();
  }

  /**
   * @param {number} offset
   */
  function focusTabByOffset(offset) {
    if (tabs.length < 2 || !activeTabId) {
      return;
    }

    const currentIndex = tabs.findIndex((entry) => entry.id === activeTabId);
    if (currentIndex === -1) {
      return;
    }

    const nextIndex = (currentIndex + offset + tabs.length) % tabs.length;
    activateTab(tabs[nextIndex]?.id);
  }

  /**
   * @param {number} index
   */
  function focusTabByIndex(index) {
    activateTab(tabs[index]?.id ?? null);
  }

  /**
   * @param {string | null} tabId
   */
  async function activateTab(tabId) {
    if (!tabId || !tabs.some((tab) => tab.id === tabId)) {
      return;
    }

    activeTabId = tabId;
    await tick();
    resizeActiveTerminals();
    focusActiveTerminal();
  }

  /**
   * @param {string} tabId
   * @param {string} paneId
   */
  function activatePane(tabId, paneId) {
    const tab = tabs.find((entry) => entry.id === tabId);
    if (!tab || !tab.panes.some((pane) => pane.id === paneId)) {
      return;
    }

    activeTabId = tabId;
    tab.activePaneId = paneId;
    queueMicrotask(() => {
      resizeActiveTerminals();
      focusActiveTerminal();
    });
  }

  /**
   * @param {string} actionId
   */
  async function performAction(actionId) {
    if (actionId === "openCommandBar") {
      openPalette();
      return;
    }

    if (actionId === "newTab") {
      await createTerminalTab();
      return;
    }

    if (actionId === "copySelection") {
      await copyActiveSelection();
      return;
    }

    if (actionId === "pasteClipboard") {
      await pasteClipboardIntoPane(activePane);
      return;
    }

    if (actionId === "splitVertical" && activeTab) {
      await splitActivePane(activeTab.id, "row");
      closePalette();
      return;
    }

    if (actionId === "splitHorizontal" && activeTab) {
      await splitActivePane(activeTab.id, "column");
      closePalette();
      return;
    }

    if (actionId === "closePane" && activeTab?.activePaneId) {
      await closePane(activeTab.id, activeTab.activePaneId);
      return;
    }

    if (actionId === "focusPaneLeft") {
      focusAdjacentPane("left");
      return;
    }

    if (actionId === "focusPaneRight") {
      focusAdjacentPane("right");
      return;
    }

    if (actionId === "focusPaneUp") {
      focusAdjacentPane("up");
      return;
    }

    if (actionId === "focusPaneDown") {
      focusAdjacentPane("down");
      return;
    }

    if (actionId === "closeTab") {
      await closeTab(activeTabId);
      return;
    }

    if (actionId === "nextTab") {
      focusTabByOffset(1);
      return;
    }

    if (actionId === "previousTab") {
      focusTabByOffset(-1);
      return;
    }

    if (actionId === "appearance") {
      writeSystemMessage("Appearance settings will be driven by saved terminal settings soon.");
      closePalette();
      return;
    }

    if (actionId === "sshManager") {
      writeSystemMessage(`Saved SSH profiles: ${sshProfiles.join(" | ")}\r\n`);
      closePalette();
      return;
    }

    if (actionId.startsWith("focusTab")) {
      const index = Number(actionId.replace("focusTab", "")) - 1;
      focusTabByIndex(index);
      closePalette();
    }
  }

  /**
   * @param {string} actionId
   */
  function canFocusTab(actionId) {
    const index = Number(actionId.replace("focusTab", "")) - 1;
    return Number.isInteger(index) && index >= 0 && index < tabs.length;
  }

  /**
   * @param {PaletteAction} action
   */
  function runPaletteAction(action) {
    action.run();
    if (action.id !== "openCommandBar") {
      closePalette();
    }
  }

  function resizeActiveTerminals() {
    if (!activeTab) {
      return;
    }

    resizeTabTerminals(activeTab.id);
  }

  /**
   * @param {string} tabId
   */
  function resizeTabTerminals(tabId) {
    const tab = tabs.find((entry) => entry.id === tabId);
    if (!tab) {
      return;
    }

    for (const pane of tab.panes) {
      if (!pane.runtime || !pane.sessionId || !pane.host || pane.host.offsetParent === null) {
        continue;
      }

      pane.runtime.fitAddon.fit();
      const { cols, rows } = pane.runtime.terminal;
      invoke("resize_terminal", {
        sessionId: pane.sessionId,
        cols,
        rows,
      }).catch(() => {});
    }
  }

  async function pollTerminalSessions() {
    for (const tab of tabs) {
      for (const pane of tab.panes) {
        if (!pane.sessionId || !pane.runtime) {
          continue;
        }

        try {
          /** @type {TerminalOutputResult} */
          const result = await invoke("poll_terminal_output", {
            sessionId: pane.sessionId,
          });

          pane.cwd = result.cwd;

          if (result.output) {
            appendPaneOutput(tab.id, pane.id, result.output);
          }

          if (result.exited) {
            await closePane(tab.id, pane.id);
            break;
          }
        } catch (error) {
          appendPaneOutput(tab.id, pane.id, `\r\nPolling error: ${String(error)}\r\n`);
        }
      }
    }
  }

  onMount(async () => {
    try {
      const storedSettings = await invoke("load_terminal_settings");
      settings = hydrateTerminalSettings(storedSettings);
    } catch {
      settings = createTerminalSettings();
    }

    const initialTab = createPendingTab("tab-1", "PowerShell");
    tabs = [initialTab];
    activeTabId = initialTab.id;

    await tick();
    mountPendingTabTerminals(initialTab.id);
    await initializePendingTabSessions(initialTab.id);

    pollTimer = window.setInterval(pollTerminalSessions, 60);
    resizeObserver = new ResizeObserver(() => {
      resizeActiveTerminals();
    });

    const captureShortcutListener = /** @param {KeyboardEvent} event */ (event) => {
      const isEscape = event.key === "Escape" && paletteOpen;
      const isLeaderTrigger =
        isLeaderEnabled() && matchesShortcut(settings.leader.trigger, event);
      const leaderAction =
        leaderActive && isLeaderEnabled() ? findActionByLeader(settings, event) : null;
      const shortcutAction = findActionByShortcut(settings, event);
      const isCommandBarNavigation =
        paletteOpen &&
        (matchesShortcut(settings.commandBar.nextItem, event) ||
          matchesShortcut(settings.commandBar.previousItem, event) ||
          matchesShortcut(settings.commandBar.runSelected, event));

      if (
        !shortcutAction &&
        !isEscape &&
        !isCommandBarNavigation &&
        !isLeaderTrigger &&
        !leaderAction &&
        !leaderActive
      ) {
        return;
      }

      handleGlobalShortcuts(event);
      event.stopPropagation();
    };

    window.addEventListener("keydown", captureShortcutListener, { capture: true });
    removeShortcutListener = () => {
      window.removeEventListener("keydown", captureShortcutListener, { capture: true });
    };

    if (terminalViewport) {
      resizeObserver.observe(terminalViewport);
    }

    focusActiveTerminal();
  });

  onDestroy(() => {
    if (pollTimer) {
      window.clearInterval(pollTimer);
    }

    clearLeaderMode();
    resizeObserver?.disconnect();
    removeShortcutListener();

    for (const tab of tabs) {
      for (const pane of tab.panes) {
        pane.runtime?.removeSelectionHandler?.();
        pane.runtime?.removeContextMenuHandler?.();
        pane.runtime?.terminal.dispose();
        if (pane.sessionId) {
          invoke("close_terminal_session", { sessionId: pane.sessionId }).catch(() => {});
        }
      }
    }
  });

  /**
   * @param {string} tabId
   * @param {string} paneId
   * @returns {TerminalPane | undefined}
   */
  function getPane(tabId, paneId) {
    return tabs
      .find((entry) => entry.id === tabId)
      ?.panes.find((pane) => pane.id === paneId);
  }

  /**
   * @param {string} tabId
   * @param {string} paneId
   * @param {HTMLDivElement | null} element
   */
  function setPaneHost(tabId, paneId, element) {
    const pane = getPane(tabId, paneId);
    if (!pane) {
      return;
    }

    if (pane.host === element) {
      return;
    }

    pane.host = element;
    if (pane.runtime) {
      pane.runtime.removeSelectionHandler?.();
      pane.runtime.removeContextMenuHandler?.();
      pane.runtime.terminal.dispose();
      pane.runtime = null;
    }

    if (element) {
      mountPaneTerminal(tabId, paneId);
    }
  }

  /**
   * @param {string} tabId
   * @param {string} paneId
   * @param {string} text
   */
  function appendPaneOutput(tabId, paneId, text) {
    const pane = getPane(tabId, paneId);
    if (!pane || !text) {
      return;
    }

    pane.transcript += text;
    pane.runtime?.terminal.write(text);
  }

  /**
   * @param {LayoutNode} node
   * @param {string} paneId
   * @param {"row" | "column"} direction
   * @param {string} newPaneId
   * @returns {LayoutNode}
   */
  function splitPaneNode(node, paneId, direction, newPaneId) {
    if (node.type === "pane") {
      if (node.paneId !== paneId) {
        return node;
      }

      return {
        id: `split-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "split",
        direction,
        sizes: [1, 1],
        children: [
          node,
          {
            id: `node-${newPaneId}`,
            type: "pane",
            paneId: newPaneId,
          },
        ],
      };
    }

    return {
      ...node,
      children: node.children.map((child) =>
        containsPane(child, paneId) ? splitPaneNode(child, paneId, direction, newPaneId) : child,
      ),
    };
  }

  /**
   * @param {LayoutNode} node
   * @param {string} paneId
   * @returns {LayoutNode}
   */
  function removePaneNode(node, paneId) {
    if (node.type === "pane") {
      return node;
    }

    const keptChildren = node.children
      .map((child) => (containsPane(child, paneId) ? removePaneNode(child, paneId) : child))
      .filter((child) => !(child.type === "pane" && child.paneId === paneId));

    const keptSizes = node.sizes.filter((_, index) => {
      const child = node.children[index];
      return !(child.type === "pane" && child.paneId === paneId);
    });

    if (keptChildren.length === 1) {
      return keptChildren[0];
    }

    return {
      ...node,
      sizes: normalizeSizes(keptSizes),
      children: keptChildren,
    };
  }

  /**
   * @param {string} splitId
   * @param {number} index
   * @param {number} leftSize
   * @param {number} rightSize
   */
  function resizeSplit(splitId, index, leftSize, rightSize) {
    if (!activeTab) {
      return;
    }

    activeTab.rootNode = resizeSplitNode(activeTab.rootNode, splitId, index, leftSize, rightSize);
    queueMicrotask(() => resizeActiveTerminals());
  }

  /**
   * @param {LayoutNode} node
   * @param {string} splitId
   * @param {number} index
   * @param {number} leftSize
   * @param {number} rightSize
   * @returns {LayoutNode}
   */
  function resizeSplitNode(node, splitId, index, leftSize, rightSize) {
    if (node.type === "pane") {
      return node;
    }

    if (node.id === splitId) {
      const sizes = [...node.sizes];
      sizes[index] = leftSize;
      sizes[index + 1] = rightSize;

      return {
        ...node,
        sizes,
      };
    }

    return {
      ...node,
      children: node.children.map((child) =>
        resizeSplitNode(child, splitId, index, leftSize, rightSize),
      ),
    };
  }

  /**
   * @param {number[]} sizes
   * @returns {number[]}
   */
  function normalizeSizes(sizes) {
    if (sizes.length === 0) {
      return sizes;
    }

    const total = sizes.reduce((sum, value) => sum + value, 0);
    return total > 0 ? sizes.map((value) => value / total) : sizes.map(() => 1 / sizes.length);
  }

  /**
   * @param {LayoutNode} node
   * @param {string} paneId
   * @returns {boolean}
   */
  function containsPane(node, paneId) {
    if (node.type === "pane") {
      return node.paneId === paneId;
    }

    return node.children.some((child) => containsPane(child, paneId));
  }

  /**
   * @param {LayoutNode} node
   * @returns {string | null}
   */
  function firstPaneIdFromNode(node) {
    if (node.type === "pane") {
      return node.paneId;
    }

    return node.children.length > 0 ? firstPaneIdFromNode(node.children[0]) : null;
  }

  /**
   * @param {TerminalTab} tab
   * @param {string} fromPaneId
   * @param {string} toPaneId
   * @param {"left" | "right" | "up" | "down"} direction
   */
  function rememberPaneNavigation(tab, fromPaneId, toPaneId, direction) {
    const oppositeDirection = oppositePaneDirection(direction);

    tab.paneNavigationHints = {
      ...tab.paneNavigationHints,
      [fromPaneId]: {
        ...tab.paneNavigationHints[fromPaneId],
        [direction]: toPaneId,
      },
      [toPaneId]: {
        ...tab.paneNavigationHints[toPaneId],
        [oppositeDirection]: fromPaneId,
      },
    };
  }

  /**
   * @param {"left" | "right" | "up" | "down"} direction
   * @returns {"left" | "right" | "up" | "down"}
   */
  function oppositePaneDirection(direction) {
    if (direction === "left") {
      return "right";
    }

    if (direction === "right") {
      return "left";
    }

    if (direction === "up") {
      return "down";
    }

    return "up";
  }

  /**
   * @param {DOMRect} source
   * @param {DOMRect} target
   * @param {"left" | "right" | "up" | "down"} direction
   */
  function isCandidateInDirection(source, target, direction) {
    if (direction === "left") {
      return target.right <= source.left;
    }

    if (direction === "right") {
      return target.left >= source.right;
    }

    if (direction === "up") {
      return target.bottom <= source.top;
    }

    return target.top >= source.bottom;
  }

  /**
   * @param {DOMRect} source
   * @param {DOMRect} target
   * @param {"left" | "right" | "up" | "down"} direction
   */
  function paneDirectionScore(source, target, direction) {
    if (direction === "left" || direction === "right") {
      const primary = Math.abs((direction === "left" ? source.left : source.right) - (direction === "left" ? target.right : target.left));
      const secondary = Math.abs(source.top + source.height / 2 - (target.top + target.height / 2));
      return primary * 10 + secondary;
    }

    const primary = Math.abs((direction === "up" ? source.top : source.bottom) - (direction === "up" ? target.bottom : target.top));
    const secondary = Math.abs(source.left + source.width / 2 - (target.left + target.width / 2));
    return primary * 10 + secondary;
  }
</script>

<main class="app-shell">
  <section class="tabbar">
    <div class="tabs">
      {#each tabs as tab (tab.id)}
        <button
          class:active={activeTabId === tab.id}
          class="tab"
          type="button"
          onclick={() => activateTab(tab.id)}
        >
          <span>{tab.title}</span>
        </button>
      {/each}
    </div>

    <div class="tab-actions">
      <button class="action-button" title="Close pane" type="button" onclick={() => performAction("closePane")}>x</button>
      <button class="action-button" type="button" onclick={() => performAction("splitVertical")}>|</button>
      <button class="action-button" type="button" onclick={() => performAction("splitHorizontal")}>-</button>
      <button class="action-button" type="button" onclick={() => performAction("newTab")}>+</button>
      <button class="action-button" title="Open command bar" type="button" onclick={() => performAction("openCommandBar")}>/</button>
    </div>
  </section>

  <section bind:this={terminalViewport} class="terminal-panel">
    {#if activeTab}
      {#key activeTab.id}
        <TerminalSplitTree
          activePaneId={activeTab.activePaneId}
          node={activeTab.rootNode}
          onResizeSplit={resizeSplit}
          panes={activeTab.panes}
          onMountHost={(paneId, element) => setPaneHost(activeTab.id, paneId, element)}
          onSelectPane={(paneId) => activatePane(activeTab.id, paneId)}
        />
      {/key}
    {/if}
  </section>

  {#if paletteOpen}
    <div class="palette-backdrop" role="presentation" onclick={closePalette}></div>
    <section class="palette" aria-label="Command bar">
      <input
        bind:this={paletteInput}
        bind:value={paletteQuery}
        placeholder="Search commands, SSH profiles, or settings"
      />

      <div class="palette-results">
        {#each filteredPaletteActions as action (action.id)}
          <button
            class:selected={filteredPaletteActions[selectedPaletteIndex]?.id === action.id}
            class="palette-item"
            type="button"
            onmousemove={() => {
              selectedPaletteIndex = filteredPaletteActions.findIndex((entry) => entry.id === action.id);
            }}
            onclick={() => runPaletteAction(action)}
          >
            <div>
              <strong>{action.label}</strong>
              <p>{action.description}</p>
            </div>
            <span>{action.shortcut}</span>
          </button>
        {:else}
          <p class="palette-empty">No matches.</p>
        {/each}
      </div>
    </section>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    min-height: 100vh;
    height: 100vh;
    overflow: hidden;
    background: #0b0f14;
    color: #e8edf5;
    font-family: "Segoe UI", "IBM Plex Sans", sans-serif;
  }

  :global(html) {
    height: 100%;
    overflow: hidden;
  }

  :global(button),
  :global(input) {
    font: inherit;
  }

  :global(.xterm) {
    height: 100%;
  }

  :global(.xterm-viewport) {
    overflow-y: auto !important;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  :global(.xterm-viewport::-webkit-scrollbar) {
    display: none;
  }

  .app-shell {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 100vh;
    height: 100vh;
    overflow: hidden;
    background:
      radial-gradient(circle at top, rgba(123, 167, 255, 0.08), transparent 24%),
      #0b0f14;
  }

  .tabbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px 7px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(255, 255, 255, 0.01));
  }

  .tabs {
    display: flex;
    gap: 4px;
    min-width: 0;
    flex: 1;
    overflow: auto;
  }

  .tab {
    min-width: 72px;
    max-width: 170px;
    padding: 5px 9px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: #8f9cb1;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.82rem;
  }

  .tab.active {
    color: #eef3fb;
    background: rgba(255, 255, 255, 0.045);
    border-color: rgba(255, 255, 255, 0.07);
  }

  .tab:hover {
    background: rgba(255, 255, 255, 0.025);
  }

  .tab-actions {
    display: flex;
    gap: 4px;
  }

  .action-button {
    width: 26px;
    height: 26px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 7px;
    background: transparent;
    color: #9dabc0;
    cursor: pointer;
    font-size: 0.82rem;
    transition:
      background 140ms ease,
      border-color 140ms ease,
      color 140ms ease;
  }

  .action-button:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.14);
    color: #eef3fb;
  }

  .terminal-panel {
    min-height: 0;
    height: 100%;
    padding: 12px 14px 14px;
    box-sizing: border-box;
    overflow: hidden;
  }

  .palette-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 40;
  }

  .palette {
    position: fixed;
    top: 70px;
    left: 50%;
    width: min(720px, calc(100vw - 32px));
    transform: translateX(-50%);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 18px;
    background: #111720;
    overflow: hidden;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4);
    z-index: 50;
  }

  .palette input {
    width: 100%;
    padding: 16px 18px;
    border: none;
    outline: none;
    background: transparent;
    color: inherit;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    box-sizing: border-box;
  }

  .palette-results {
    max-height: 280px;
    overflow: auto;
    padding: 8px;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .palette-results::-webkit-scrollbar {
    display: none;
  }

  .palette-item {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 12px;
    border: none;
    border-radius: 12px;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .palette-item:hover,
  .palette-item.selected {
    background: rgba(255, 255, 255, 0.05);
  }

  .palette-item p,
  .palette-empty {
    margin: 4px 0 0;
    color: #8e9cb1;
  }

  .palette-empty {
    padding: 16px 12px;
  }

  @media (max-width: 700px) {
    .tab {
      min-width: 120px;
    }
  }
</style>
