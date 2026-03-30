<script>
  import { invoke } from "@tauri-apps/api/core";
  import { onDestroy, onMount, tick } from "svelte";
  import { Terminal } from "xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import "xterm/css/xterm.css";

  /**
   * @typedef {{ sessionId: string, cwd: string }} TerminalSessionResult
   * @typedef {{ output: string, cwd: string, exited: boolean }} TerminalOutputResult
   * @typedef {{ id: string, label: string, shortcut: string, description: string, run: () => void }} PaletteAction
   * @typedef {{ terminal: import("xterm").Terminal, fitAddon: FitAddon }} TerminalRuntime
   * @typedef {{ id: string, sessionId: string | null, title: string, cwd: string | null, busy: boolean, host: HTMLDivElement | null, runtime: TerminalRuntime | null }} TerminalTab
   */

  /** @type {TerminalTab[]} */
  let tabs = $state([]);
  let activeTabId = $state("tab-1");
  let paletteOpen = $state(false);
  let paletteQuery = $state("");
  /** @type {HTMLInputElement | null} */
  let paletteInput = $state(null);
  /** @type {number | null} */
  let pollTimer = $state(null);
  /** @type {ResizeObserver | null} */
  let resizeObserver = $state(null);
  /** @type {HTMLElement | null} */
  let terminalViewport = $state(null);
  let removeShortcutListener = $state(() => {});

  const sshProfiles = [
    "deploy@prod-east.example.com",
    "admin@staging.internal",
    "kusha@192.168.0.24",
  ];

  /** @type {PaletteAction[]} */
  const paletteActions = [
    {
      id: "new-tab",
      label: "New terminal tab",
      shortcut: "Ctrl+T",
      description: "Open another local shell tab.",
      run: () => createTerminalTab(),
    },
    {
      id: "appearance",
      label: "Appearance settings",
      shortcut: "Soon",
      description: "Theme and layout customization will live here.",
      run: () => writeSystemMessage("Appearance settings are the next layer after the terminal core."),
    },
    {
      id: "ssh-manager",
      label: "SSH manager",
      shortcut: "Soon",
      description: "Saved profiles and remote launches.",
      run: () => writeSystemMessage(`Saved SSH profiles: ${sshProfiles.join(" | ")}\r\n`),
    },
  ];

  const activeTab = $derived(
    tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
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

  /**
   * @param {string} id
   * @param {string} title
   * @returns {TerminalTab}
   */
  function createPendingTab(id, title) {
    return {
      id,
      sessionId: null,
      title,
      cwd: null,
      busy: true,
      host: null,
      runtime: null,
    };
  }

  async function createTerminalTab() {
    const terminalTabs = tabs.length + 1;
    const id = `tab-${Date.now()}`;
    const newTab = createPendingTab(id, `Shell ${terminalTabs}`);
    tabs = [...tabs, newTab];
    activeTabId = id;

    await tick();
    mountTabTerminal(id);
    await initializeTabSession(id);
    focusActiveTerminal();
  }

  /**
   * @param {string} tabId
   */
  async function initializeTabSession(tabId) {
    const tab = tabs.find((entry) => entry.id === tabId);
    if (!tab || !tab.runtime) {
      return;
    }

    try {
      /** @type {TerminalSessionResult} */
      const session = await invoke("create_terminal_session");
      tab.sessionId = session.sessionId;
      tab.cwd = session.cwd;
      tab.busy = false;
      tab.runtime.terminal.writeln("Session ready. Ctrl+T for another tab, Ctrl+K for command bar.");
      resizeActiveTerminal();
    } catch (error) {
      tab.busy = false;
      tab.runtime.terminal.writeln(`Failed to start terminal session: ${String(error)}`);
    }
  }

  function openPalette() {
    paletteOpen = true;
    paletteQuery = "";
    queueMicrotask(() => paletteInput?.focus());
  }

  function closePalette() {
    paletteOpen = false;
    paletteQuery = "";
    focusActiveTerminal();
  }

  /**
   * @param {PaletteAction} action
   */
  function runPaletteAction(action) {
    action.run();
    closePalette();
  }

  /**
   * @param {KeyboardEvent} event
   */
  function handleGlobalShortcuts(event) {
    if (event.defaultPrevented) {
      return;
    }

    if (event.ctrlKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openPalette();
      return;
    }

    if (event.ctrlKey && event.key.toLowerCase() === "t") {
      event.preventDefault();
      createTerminalTab();
      return;
    }

    if (event.key === "Escape" && paletteOpen) {
      event.preventDefault();
      closePalette();
    }
  }

  /**
   * @param {string} text
   */
  function writeSystemMessage(text) {
    const tab = activeTab;
    if (!tab?.runtime) {
      return;
    }

    tab.runtime.terminal.writeln("");
    tab.runtime.terminal.writeln(text);
  }

  /**
   * @param {string} tabId
   */
  function mountTabTerminal(tabId) {
    const tab = tabs.find((entry) => entry.id === tabId);
    if (!tab || !tab.host || tab.runtime) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "Cascadia Code, Consolas, monospace",
      fontSize: 14,
      lineHeight: 1.35,
      theme: {
        background: "#0d1218",
        foreground: "#e8edf5",
        cursor: "#f3a76e",
        black: "#0d1218",
        brightBlack: "#5f6c82",
        red: "#f38ba8",
        brightRed: "#f9a6ba",
        green: "#7ee787",
        brightGreen: "#9df3a5",
        yellow: "#ffd479",
        brightYellow: "#ffe29e",
        blue: "#7ba7ff",
        brightBlue: "#9dbbff",
        magenta: "#c6a0f6",
        brightMagenta: "#d7b8ff",
        cyan: "#76e3ea",
        brightCyan: "#98edf2",
        white: "#d8dee9",
        brightWhite: "#f8fbff",
      },
      allowProposedApi: false,
      convertEol: false,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(tab.host);
    fitAddon.fit();
    terminal.focus();

    terminal.onData((data) => {
      if (!tab.sessionId) {
        return;
      }

      invoke("write_terminal_input", {
        sessionId: tab.sessionId,
        input: data,
      }).catch((error) => {
        terminal.writeln(`\r\nInput error: ${String(error)}`);
      });
    });

    tab.runtime = { terminal, fitAddon };
    terminal.writeln("Starting terminal session...");
  }

  function focusActiveTerminal() {
    activeTab?.runtime?.terminal.focus();
  }

  /**
   * @param {string} tabId
   */
  async function closeTab(tabId) {
    const tab = tabs.find((entry) => entry.id === tabId);
    if (!tab) {
      return;
    }

    tab.runtime?.terminal.dispose();

    if (tab.sessionId) {
      await invoke("close_terminal_session", { sessionId: tab.sessionId }).catch(() => {});
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
        resizeActiveTerminal();
        focusActiveTerminal();
      });
    }
  }

  function resizeActiveTerminal() {
    if (!activeTab?.runtime || !activeTab.sessionId) {
      return;
    }

    activeTab.runtime.fitAddon.fit();
    const { cols, rows } = activeTab.runtime.terminal;
    invoke("resize_terminal", {
      sessionId: activeTab.sessionId,
      cols,
      rows,
    }).catch(() => {});
  }

  async function pollTerminalSessions() {
    for (const tab of tabs) {
      if (!tab.sessionId || !tab.runtime) {
        continue;
      }

      try {
        /** @type {TerminalOutputResult} */
        const result = await invoke("poll_terminal_output", {
          sessionId: tab.sessionId,
        });

        tab.cwd = result.cwd;

        if (result.output) {
          tab.runtime.terminal.write(result.output);
        }

        if (result.exited) {
          await closeTab(tab.id);
          break;
        }
      } catch (error) {
        tab.runtime.terminal.writeln(`\r\nPolling error: ${String(error)}`);
      }
    }
  }

  onMount(async () => {
    const initialTab = createPendingTab("tab-1", "PowerShell");
    tabs = [initialTab];
    activeTabId = initialTab.id;

    await tick();
    mountTabTerminal(initialTab.id);
    await initializeTabSession(initialTab.id);

    pollTimer = window.setInterval(pollTerminalSessions, 60);
    resizeObserver = new ResizeObserver(() => {
      resizeActiveTerminal();
    });

    const captureShortcutListener = /** @param {KeyboardEvent} event */ (event) => {
      const isCommandPalette = event.ctrlKey && event.key.toLowerCase() === "k";
      const isNewTab = event.ctrlKey && event.key.toLowerCase() === "t";
      const isEscape = event.key === "Escape" && paletteOpen;

      if (!isCommandPalette && !isNewTab && !isEscape) {
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

    resizeObserver?.disconnect();
    removeShortcutListener();

    for (const tab of tabs) {
      tab.runtime?.terminal.dispose();
      if (tab.sessionId) {
        invoke("close_terminal_session", { sessionId: tab.sessionId }).catch(() => {});
      }
    }
  });
</script>

<main class="app-shell">
  <section class="tabbar">
    <div class="tabs">
      {#each tabs as tab (tab.id)}
        <button
          class:active={activeTabId === tab.id}
          class="tab"
          type="button"
          onclick={() => {
            activeTabId = tab.id;
            queueMicrotask(() => {
              resizeActiveTerminal();
              focusActiveTerminal();
            });
          }}
        >
          <span>{tab.title}</span>
        </button>
      {/each}
    </div>

    <div class="tab-actions">
      <button class="action-button" type="button" onclick={createTerminalTab}>+</button>
      <button class="action-button" type="button" onclick={openPalette}>⌘</button>
    </div>
  </section>

  <section bind:this={terminalViewport} class="terminal-panel">
    {#each tabs as tab (tab.id)}
      <div class:hidden={activeTabId !== tab.id} class="terminal-surface">
        <div
          bind:this={tab.host}
          class="terminal-host"
          role="application"
          aria-label={`Terminal ${tab.title}`}
        ></div>
      </div>
    {/each}
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
          <button class="palette-item" type="button" onclick={() => runPaletteAction(action)}>
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
    justify-content: space-between;
    gap: 10px;
    padding: 6px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .tabs {
    display: flex;
    gap: 4px;
    min-width: 0;
    overflow: auto;
  }

  .tab {
    min-width: 88px;
    max-width: 180px;
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
    background: rgba(255, 255, 255, 0.04);
    border-color: rgba(255, 255, 255, 0.06);
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
  }

  .terminal-panel {
    min-height: 0;
    height: 100%;
    padding: 12px 14px 14px;
    box-sizing: border-box;
    overflow: hidden;
  }

  .terminal-surface {
    height: 100%;
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.06);
    background: #0d1218;
    overflow: hidden;
  }

  .terminal-surface.hidden {
    display: none;
  }

  .terminal-host {
    height: 100%;
    padding: 8px 10px;
    box-sizing: border-box;
  }

  .palette-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
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

  .palette-item:hover {
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
