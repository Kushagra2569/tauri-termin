export const actionDefinitions = [
  {
    id: "openCommandBar",
    label: "Open command bar",
    description: "Open the terminal command bar.",
  },
  {
    id: "newTab",
    label: "New tab",
    description: "Open a new local terminal tab.",
  },
  {
    id: "splitVertical",
    label: "Split vertically",
    description: "Split the active pane side by side.",
  },
  {
    id: "splitHorizontal",
    label: "Split horizontally",
    description: "Split the active pane into top and bottom panes.",
  },
  {
    id: "closePane",
    label: "Close pane",
    description: "Close the active pane.",
  },
  {
    id: "closeTab",
    label: "Close tab",
    description: "Close the active terminal tab.",
  },
  {
    id: "nextTab",
    label: "Next tab",
    description: "Switch to the tab on the right.",
  },
  {
    id: "previousTab",
    label: "Previous tab",
    description: "Switch to the tab on the left.",
  },
  {
    id: "appearance",
    label: "Appearance settings",
    description: "Theme and layout customization will live here.",
  },
  {
    id: "sshManager",
    label: "SSH manager",
    description: "Saved profiles and remote launches.",
  },
  ...Array.from({ length: 9 }, (_, index) => ({
    id: `focusTab${index + 1}`,
    label: `Focus tab ${index + 1}`,
    description: `Jump directly to tab ${index + 1}.`,
  })),
];

/**
 * @param {{ shortcuts: Record<string, string> }} settings
 * @param {string} actionId
 */
export function getShortcutLabel(settings, actionId) {
  return settings.shortcuts[actionId] ?? "";
}

/**
 * @param {{ shortcuts: Record<string, string> }} settings
 * @param {KeyboardEvent} event
 */
export function findActionByShortcut(settings, event) {
  return actionDefinitions.find((action) =>
    eventMatchesShortcut(getShortcutLabel(settings, action.id), event),
  );
}

/**
 * @param {string} binding
 * @param {KeyboardEvent} event
 */
function eventMatchesShortcut(binding, event) {
  if (!binding) {
    return false;
  }

  const tokens = binding
    .split("+")
    /** @param {string} token */
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  const key = normalizeKey(event.key);
  const wantsCtrl = tokens.includes("ctrl");
  const wantsAlt = tokens.includes("alt");
  const wantsShift = tokens.includes("shift");
  const wantsMeta = tokens.includes("meta");
  const bindingKey = tokens.find(
    /** @param {string} token */
    (token) => !["ctrl", "alt", "shift", "meta"].includes(token),
  );

  if (!!event.ctrlKey !== wantsCtrl) {
    return false;
  }

  if (!!event.altKey !== wantsAlt) {
    return false;
  }

  if (!!event.shiftKey !== wantsShift) {
    return false;
  }

  if (!!event.metaKey !== wantsMeta) {
    return false;
  }

  return key === bindingKey;
}

/**
 * @param {string} key
 */
function normalizeKey(key) {
  if (key === " ") {
    return "space";
  }

  return key.toLowerCase();
}
