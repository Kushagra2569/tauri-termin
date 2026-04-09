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
    id: "copySelection",
    label: "Copy selection",
    description: "Copy the current terminal selection to the clipboard.",
  },
  {
    id: "pasteClipboard",
    label: "Paste clipboard",
    description: "Paste clipboard text into the active terminal.",
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
    id: "focusPaneLeft",
    label: "Focus pane left",
    description: "Move focus to the pane on the left.",
  },
  {
    id: "focusPaneRight",
    label: "Focus pane right",
    description: "Move focus to the pane on the right.",
  },
  {
    id: "focusPaneUp",
    label: "Focus pane up",
    description: "Move focus to the pane above.",
  },
  {
    id: "focusPaneDown",
    label: "Focus pane down",
    description: "Move focus to the pane below.",
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
 * @param {{ shortcuts: Record<string, string>, leader?: { enabled?: boolean, trigger?: string, shortcuts?: Record<string, string> } }} settings
 * @param {string} actionId
 */
export function getActionBindingLabel(settings, actionId) {
  const directShortcut = getShortcutLabel(settings, actionId);
  const leaderEnabled = settings.leader?.enabled ?? false;
  const leaderTrigger = leaderEnabled ? (settings.leader?.trigger ?? "") : "";
  const leaderKey = leaderEnabled ? (settings.leader?.shortcuts?.[actionId] ?? "") : "";

  if (directShortcut && leaderTrigger && leaderKey) {
    return `${directShortcut} / ${leaderTrigger} ${formatBindingToken(leaderKey)}`;
  }

  if (directShortcut) {
    return directShortcut;
  }

  if (leaderTrigger && leaderKey) {
    return `${leaderTrigger} ${formatBindingToken(leaderKey)}`;
  }

  return "";
}

/**
 * @param {{ shortcuts: Record<string, string> }} settings
 * @param {KeyboardEvent} event
 */
export function findActionByShortcut(settings, event) {
  return actionDefinitions.find((action) =>
    matchesShortcut(getShortcutLabel(settings, action.id), event),
  );
}

/**
 * @param {string} binding
 * @param {KeyboardEvent} event
 */
export function matchesShortcut(binding, event) {
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
 * @param {{ leader?: { enabled?: boolean, trigger?: string, shortcuts?: Record<string, string> } }} settings
 * @param {KeyboardEvent} event
 */
export function findActionByLeader(settings, event) {
  if (!settings.leader?.enabled) {
    return undefined;
  }

  const leaderKey = normalizeKey(event.key);

  return actionDefinitions.find((action) => {
    const binding = settings.leader?.shortcuts?.[action.id];
    return normalizeBindingKey(binding) === leaderKey;
  });
}

/**
 * @param {string | undefined} binding
 */
function normalizeBindingKey(binding) {
  if (!binding) {
    return "";
  }

  return normalizeKey(binding.trim());
}

/**
 * @param {string} token
 */
function formatBindingToken(token) {
  if (!token) {
    return "";
  }

  const normalized = normalizeBindingKey(token);
  if (!normalized) {
    return "";
  }

  if (normalized === "space") {
    return "Space";
  }

  if (normalized.length === 1) {
    return normalized.toUpperCase();
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

/**
 * @param {string} key
 */
function normalizeKey(key) {
  if (key === " ") {
    return "space";
  }

  if (key === "ArrowLeft") {
    return "left";
  }

  if (key === "ArrowRight") {
    return "right";
  }

  if (key === "ArrowUp") {
    return "up";
  }

  if (key === "ArrowDown") {
    return "down";
  }

  return key.toLowerCase();
}
