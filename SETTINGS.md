# Settings Reference

This project reads `settings.json` on startup from a custom config location under your home directory.

On Windows, the current path is:

- `C:\Users\kusha\.config\tauri-termin\settings.json`

Only keys defined in the frontend settings schema are applied. Unknown keys are ignored.

## Full Example

```json
{
  "shortcuts": {
    "openCommandBar": "Ctrl+K",
    "newTab": "Ctrl+T",
    "copySelection": "Ctrl+Shift+C",
    "pasteClipboard": "Ctrl+Shift+V",
    "splitVertical": "Alt+Shift+V",
    "splitHorizontal": "Alt+Shift+H",
    "closePane": "Ctrl+Shift+W",
    "focusPaneLeft": "Alt+Left",
    "focusPaneRight": "Alt+Right",
    "focusPaneUp": "Alt+Up",
    "focusPaneDown": "Alt+Down",
    "closeTab": "Ctrl+W",
    "nextTab": "Ctrl+Tab",
    "previousTab": "Ctrl+Shift+Tab",
    "focusTab1": "Alt+1",
    "focusTab2": "Alt+2",
    "focusTab3": "Alt+3",
    "focusTab4": "Alt+4",
    "focusTab5": "Alt+5",
    "focusTab6": "Alt+6",
    "focusTab7": "Alt+7",
    "focusTab8": "Alt+8",
    "focusTab9": "Alt+9"
  },
  "leader": {
    "enabled": false,
    "trigger": "",
    "timeoutMs": 1200,
    "shortcuts": {}
  },
  "window": {
    "titleBar": "native",
    "showControlsInMinimalTitleBar": true
  },
  "terminal": {
    "cursorBlink": true,
    "fontFamily": "Cascadia Code, Consolas, monospace",
    "fontSize": 14,
    "lineHeight": 1.35,
    "scrollback": 5000,
    "rightClickBehavior": "paste",
    "copyOnSelect": false,
    "createReplacementOnLastExit": false,
    "theme": {
      "background": "#0d1218",
      "foreground": "#e8edf5",
      "cursor": "#f3a76e",
      "black": "#0d1218",
      "brightBlack": "#5f6c82",
      "red": "#f38ba8",
      "brightRed": "#f9a6ba",
      "green": "#7ee787",
      "brightGreen": "#9df3a5",
      "yellow": "#ffd479",
      "brightYellow": "#ffe29e",
      "blue": "#7ba7ff",
      "brightBlue": "#9dbbff",
      "magenta": "#c6a0f6",
      "brightMagenta": "#d7b8ff",
      "cyan": "#76e3ea",
      "brightCyan": "#98edf2",
      "white": "#d8dee9",
      "brightWhite": "#f8fbff"
    }
  },
  "commandBar": {
    "nextItem": "Tab",
    "previousItem": "Shift+Tab",
    "runSelected": "Enter"
  }
}
```

## `shortcuts`

These are direct app shortcuts. Values are keybinding strings like:

- `Ctrl+K`
- `Ctrl+Shift+V`
- `Alt+Left`
- `Alt+1`

Currently supported shortcut keys include:

- letters and numbers, like `K`, `V`, `1`
- arrows, as `Left`, `Right`, `Up`, `Down`
- `Tab`
- `Enter`
- `Space`

Supported modifiers:

- `Ctrl`
- `Alt`
- `Shift`
- `Meta`

Available shortcut keys:

- `openCommandBar`
- `newTab`
- `copySelection`
- `pasteClipboard`
- `splitVertical`
- `splitHorizontal`
- `closePane`
- `focusPaneLeft`
- `focusPaneRight`
- `focusPaneUp`
- `focusPaneDown`
- `closeTab`
- `nextTab`
- `previousTab`
- `focusTab1`
- `focusTab2`
- `focusTab3`
- `focusTab4`
- `focusTab5`
- `focusTab6`
- `focusTab7`
- `focusTab8`
- `focusTab9`

## `leader`

Optional leader-key mode for app actions.

Keys:

- `enabled`
  - Type: boolean
  - Default: `false`
  - Values: `true`, `false`
- `trigger`
  - Type: string
  - Default: `""`
  - Example: `"Ctrl+A"`
- `timeoutMs`
  - Type: number
  - Default: `1200`
  - Meaning: how long the app waits for the second key after the leader trigger
- `shortcuts`
  - Type: object
  - Default: `{}`
  - Meaning: maps action ids to the second key in the leader sequence

Example:

```json
{
  "leader": {
    "enabled": true,
    "trigger": "Ctrl+A",
    "timeoutMs": 1200,
    "shortcuts": {
      "newTab": "c",
      "splitVertical": "v",
      "splitHorizontal": "s"
    }
  }
}
```

Leader shortcut action ids can use the same action names listed in the `shortcuts` section.

## `terminal`

### `cursorBlink`

- Type: boolean
- Default: `true`
- Values: `true`, `false`

### `fontFamily`

- Type: string
- Default: `"Cascadia Code, Consolas, monospace"`
- Example: `"JetBrains Mono, Consolas, monospace"`

### `fontSize`

- Type: number
- Default: `14`
- Example values: `12`, `13`, `14`, `16`

### `lineHeight`

- Type: number
- Default: `1.35`
- Example values: `1.1`, `1.2`, `1.35`, `1.5`

### `scrollback`

- Type: number
- Default: `5000`
- Meaning: number of lines preserved in terminal history
- Example values: `1000`, `5000`, `10000`

### `rightClickBehavior`

- Type: string
- Default: `"paste"`
- Allowed values:
  - `"paste"`
  - `"copy-paste"`
  - `"native"`

Behavior details:

- `"paste"`: right click pastes clipboard text into the clicked terminal pane
- `"copy-paste"`: right click copies selection if there is one, otherwise pastes
- `"native"`: app does not intercept right click

### `copyOnSelect`

- Type: boolean
- Default: `false`
- Values: `true`, `false`
- Meaning: when enabled, selecting text copies it to the clipboard automatically

### `createReplacementOnLastExit`

- Type: boolean
- Default: `false`
- Values: `true`, `false`

Behavior details:

- only applies when a shell process exits on the last remaining tab and pane
- `false`: the app closes
- `true`: the app opens a fresh replacement terminal tab instead

### `theme`

All theme values are strings and should be CSS color values, usually hex colors.

Available keys:

- `background`
- `foreground`
- `cursor`
- `black`
- `brightBlack`
- `red`
- `brightRed`
- `green`
- `brightGreen`
- `yellow`
- `brightYellow`
- `blue`
- `brightBlue`
- `magenta`
- `brightMagenta`
- `cyan`
- `brightCyan`
- `white`
- `brightWhite`

Example:

```json
{
  "terminal": {
    "theme": {
      "background": "#0b0f14",
      "foreground": "#e6edf3",
      "cursor": "#ffcc66"
    }
  }
}
```

## `window`

### `titleBar`

- Type: string
- Default: `"native"`
- Allowed values:
  - `"native"`
  - `"minimal"`

Behavior details:

- `"native"`: uses the normal Windows title bar, with the app tab strip rendered just below it
- `"minimal"`: uses a custom title bar with tabs alongside the window controls, similar to Ghostty/WezTerm

This setting is applied on app startup.

### `showControlsInMinimalTitleBar`

- Type: boolean
- Default: `true`
- Values:
  - `true`
  - `false`

Behavior details:

- only applies when `window.titleBar` is `"minimal"`
- `true`: shows the custom minimize, maximize, and close buttons in the minimal title bar
- `false`: hides those custom buttons for a cleaner look

This does not affect the native Windows title bar.

## `commandBar`

These control command bar navigation bindings.

Available keys:

- `nextItem`
- `previousItem`
- `runSelected`

Defaults:

- `nextItem`: `Tab`
- `previousItem`: `Shift+Tab`
- `runSelected`: `Enter`

## Notes

- Settings are currently read on app startup.
- Settings are not auto-saved by the app right now.
- If the settings file does not exist, the app still starts with the built-in frontend defaults.
- If a setting is missing, the app falls back to the default value from the frontend schema.
