export const defaultTerminalSettings = {
  shortcuts: {
    openCommandBar: "Ctrl+K",
    newTab: "Ctrl+T",
    copySelection: "Ctrl+Shift+C",
    pasteClipboard: "Ctrl+Shift+V",
    splitVertical: "Alt+Shift+V",
    splitHorizontal: "Alt+Shift+H",
    closePane: "Ctrl+Shift+W",
    focusPaneLeft: "Alt+Left",
    focusPaneRight: "Alt+Right",
    focusPaneUp: "Alt+Up",
    focusPaneDown: "Alt+Down",
    closeTab: "Ctrl+W",
    nextTab: "Ctrl+Tab",
    previousTab: "Ctrl+Shift+Tab",
    focusTab1: "Alt+1",
    focusTab2: "Alt+2",
    focusTab3: "Alt+3",
    focusTab4: "Alt+4",
    focusTab5: "Alt+5",
    focusTab6: "Alt+6",
    focusTab7: "Alt+7",
    focusTab8: "Alt+8",
    focusTab9: "Alt+9",
  },
  leader: {
    enabled: false,
    trigger: "",
    timeoutMs: 1200,
    shortcuts: {},
  },
  terminal: {
    cursorBlink: true,
    fontFamily: "Cascadia Code, Consolas, monospace",
    fontSize: 14,
    lineHeight: 1.35,
    scrollback: 5000,
    rightClickBehavior: "paste",
    copyOnSelect: false,
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
  },
  commandBar: {
    nextItem: "Tab",
    previousItem: "Shift+Tab",
    runSelected: "Enter",
  },
};

export function createTerminalSettings() {
  return JSON.parse(JSON.stringify(defaultTerminalSettings));
}

/**
 * @param {unknown} settings
 */
export function hydrateTerminalSettings(settings) {
  return mergeSettings(createTerminalSettings(), settings);
}

/**
 * @param {Record<string, any>} base
 * @param {unknown} incoming
 * @returns {Record<string, any>}
 */
function mergeSettings(base, incoming) {
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return base;
  }

  const merged = { ...base };
  const incomingRecord = /** @type {Record<string, any>} */ (incoming);

  for (const [key, value] of Object.entries(base)) {
    const nextValue = incomingRecord[key];

    if (value && typeof value === "object" && !Array.isArray(value)) {
      merged[key] = mergeSettings(value, nextValue);
    } else if (nextValue !== undefined) {
      merged[key] = nextValue;
    }
  }

  return merged;
}
