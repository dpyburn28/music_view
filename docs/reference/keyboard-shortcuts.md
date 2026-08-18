# Keyboard shortcuts

Workspace (`workspace.html`) uses one router in `workspace-hotkeys.js`.

Typing in an `input`, `textarea`, `select`, or contenteditable field suppresses shortcuts except **Esc** (blur).

## Workspace

| Key | Action |
|-----|--------|
| `Space` | Play/pause the **track** unless focus is Performance, or a show is driving. Then play/pause the **show**. Works with a Music control focused (not body-only). |
| `1` / `2` | Look / Object tab + focus (unless typing) |
| `[` / `]` | Object focus: cycle panels. Performance focus: jump clip. Not both. |
| `E` / `Delete` | Look focus: enable / remove selected FX layer |
| `Alt`+`↑` / `Alt`+`↓` | Look focus: reorder selected FX layer |
| `/` | Look focus: preset search |
| `Enter` / `G` | Performance focus: Go |
| `Esc` | Blur field → close menus/dialogs → exit Present (confirm in kiosk) → exit Performance preview |
| `Cmd+Shift+P` | Toggle Present Stage (menu; chrome only) |
| `Cmd/Ctrl+C` / `V` / `X` / `A` | Copy / paste / cut / select all (Edit menu roles) |

Default focus on launch is **Music**, so Space before any click toggles the track.

Clicking a floating container on the stage sets Object focus.

## Stage

Container drag/resize uses pointer interaction (when Present is off). Click selects a container for the Object tab.

## Leftover standalone HTML

`controls.html`, `music.html`, and `performance.html` still contain the old per-window key tables if you open those files by hand. The product launch path is **workspace only**.
