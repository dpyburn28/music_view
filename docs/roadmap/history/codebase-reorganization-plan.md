# Codebase reorganization plan

**Status:** Planning
**Location:** `docs/roadmap/codebase-reorganization-plan.md`
**Target app:** music_view (this repo)

---

## 1. Goals

| Goal | Success look |
|------|----------------|
| **A. Reduce root clutter** | Root has ≤8 files (app.js, preload.js, workspace.html, package.json, README.md, .gitignore, maybe 1–2 more) |
| **B. Logical grouping** | Related files live together per window/feature (renderer, controls, music, workspace) |
| **C. Shared code explicit** | Files used by both main and renderer are in a clear `shared/` location |
| **D. No behavior change** | App boots and works identically — this is pure file moves + path updates |

### Non-goals

- Converting to ES modules or adding a bundler (out of scope)
- Splitting large files (renderer.js, controls.js) — that's a separate effort
- Renaming files or changing APIs
- Changing the shader/preset/vendor directory structure

---

## 2. Current state

### 2.1 Root directory (32 source files)

```
music_view/
├── app.js                    ← main process (920 lines)
├── preload.js                ← IPC bridge (429 lines)
├── index.html                ← LEGACY (not loaded by app.js)
├── workspace.html            ← single entry point (1142 lines)
├── controls.html             ← LEGACY (not loaded)
├── music.html                ← LEGACY (not loaded)
├── performance.html          ← LEGACY (not loaded)
├── renderer.js               ← Display rendering (10,472 lines)
├── shaders.js                ← Shader compiler (1,253 lines)
├── layout-space.js           ← Layout math (382 lines) [SHARED]
├── scene-match.js            ← Scene auto-match (144 lines)
├── artef4kt-host.js          ← artef4kt adapter (528 lines)
├── performance.js            ← Performance conductor (1,410 lines)
├── controls.js               ← Controls UI (5,748 lines)
├── music.js                  ← Music playback (2,454 lines)
├── audio-analysis.js         ← FFT analysis (860 lines)
├── workspace.js              ← Workspace shell (365 lines)
├── workspace-bus.js          ← IPC bus (313 lines)
├── workspace-hotkeys.js      ← Keyboard shortcuts (155 lines)
├── workspace-load.js         ← Boot loader (99 lines)
├── param-mod.js              ← Modulation engine (281 lines) [SHARED]
├── audio-input.js            ← Per-container audio (119 lines) [SHARED]
├── music-library.js          ← Library scanner (354 lines) [Node.js]
├── spotify-import.js         ← Spotify import (1,110 lines) [Node.js]
├── presets.js                ← Preset FS (283 lines) [Node.js]
├── performances.js           ← Performance FS (417 lines) [Node.js]
├── user-settings.js          ← Settings FS (191 lines) [Node.js]
├── controls.css              ← Controls styles (1,714 lines)
├── music.css                 ← Music styles (973 lines)
├── workspace.css             ← Workspace styles (324 lines)
├── performance.css           ← Performance styles (255 lines)
├── main.css                  ← Display shell styles (705 lines)
├── package.json
├── README.md
├── .gitignore
├── docs/
├── shaders/
├── presets/
├── vendor/
├── assets/
│   ├── img/
│   └── performances/
├── scripts/                  ← tests (9 files)
└── node_modules/
```

### 2.2 Execution contexts

**Main process (Node.js `require`):**
- `app.js` → requires `music-library`, `spotify-import`, `presets`, `performances`, `user-settings`
- `presets.js` → requires `layout-space`
- `performances.js` → requires `presets`, `layout-space`
- `spotify-import.js` → requires `music-library`

**Renderer (script tags in `workspace.html`):**
- Display: `param-mod`, `shaders`, `artef4kt-host`, `scene-match`, `layout-space`, `audio-input`, `renderer`
- Music: `audio-analysis`, `music`
- Controls: `controls` (+ `param-mod`, `audio-input` loaded earlier)
- Performance: `performance`
- Workspace: `workspace-hotkeys`, `workspace` (+ `workspace-bus` loaded first)

**Shared (both contexts):**
- `layout-space.js` — required by `presets.js` and `performances.js` (main); loaded via script tag (renderer)
- `param-mod.js` — loaded via script tag in display/controls/workspace
- `audio-input.js` — loaded via script tag in display/controls/workspace

### 2.3 Dependency chain

```
workspace.html
  ├── workspace-bus.js          (sets up window.__musicViewBus)
  ├── param-mod.js              [SHARED]
  ├── shaders.js
  ├── artef4kt-host.js
  ├── scene-match.js
  ├── layout-space.js           [SHARED]
  ├── audio-input.js            [SHARED]
  ├── renderer.js
  ├── audio-analysis.js
  ├── music.js
  ├── controls.js
  ├── performance.js
  ├── workspace-hotkeys.js
  └── workspace.js
```

---

## 3. Target structure

```
music_view/
├── app.js                          ← main process entry (stays)
├── preload.js                      ← IPC bridge (stays)
├── workspace.html                  ← single entry (stays, paths updated)
├── package.json
├── README.md
├── .gitignore
│
├── src/
│   ├── main/                       ← Node.js modules (require'd by app.js)
│   │   ├── music-library.js
│   │   ├── spotify-import.js
│   │   ├── presets.js
│   │   ├── performances.js
│   │   └── user-settings.js
│   │
│   ├── renderer/                   ← Display / scene / rendering
│   │   ├── renderer.js
│   │   ├── shaders.js
│   │   ├── scene-match.js
│   │   ├── artef4kt-host.js
│   │   ├── performance.js
│   │   ├── main.css
│   │   └── performance.css
│   │
│   ├── controls/                   ← Controls UI
│   │   ├── controls.js
│   │   └── controls.css
│   │
│   ├── music/                      ← Music library + playback
│   │   ├── music.js
│   │   ├── audio-analysis.js
│   │   └── music.css
│   │
│   ├── workspace/                  ← Workspace shell + bus
│   │   ├── workspace.js
│   │   ├── workspace-bus.js
│   │   ├── workspace-hotkeys.js
│   │   ├── workspace-load.js
│   │   └── workspace.css
│   │
│   └── shared/                     ← Used by both main + renderer
│       ├── param-mod.js
│       ├── audio-input.js
│       └── layout-space.js
│
├── legacy/                         ← Standalone HTML files (not loaded)
│   ├── index.html
│   ├── controls.html
│   ├── music.html
│   └── performance.html
│
├── assets/
│   ├── img/
│   └── performances/
├── shaders/                        ← GLSL packages (unchanged)
├── presets/                        ← Look preset JSONs (unchanged)
├── vendor/                         ← artef4kt + three-world (unchanged)
├── test/                           ← renamed from scripts/
│   ├── test-audio-input.js
│   ├── test-layout-space.js
│   ├── test-scene-match.js
│   ├── test-show-fx.js
│   ├── test-spotify-import.js
│   ├── test-tool-wrap.js
│   ├── test-user-settings.js
│   ├── test-workspace-bus.js
│   └── test-workspace-hotkeys.js
└── docs/
```

---

## 4. What moves where

### 4.1 File moves (25 files)

| File | From | To | Context |
|------|------|----|---------|
| `music-library.js` | root | `src/main/` | Node.js |
| `spotify-import.js` | root | `src/main/` | Node.js |
| `presets.js` | root | `src/main/` | Node.js |
| `performances.js` | root | `src/main/` | Node.js |
| `user-settings.js` | root | `src/main/` | Node.js |
| `renderer.js` | root | `src/renderer/` | Renderer |
| `shaders.js` | root | `src/renderer/` | Renderer |
| `scene-match.js` | root | `src/renderer/` | Renderer |
| `artef4kt-host.js` | root | `src/renderer/` | Renderer |
| `performance.js` | root | `src/renderer/` | Renderer |
| `controls.js` | root | `src/controls/` | Renderer |
| `music.js` | root | `src/music/` | Renderer |
| `audio-analysis.js` | root | `src/music/` | Renderer |
| `workspace.js` | root | `src/workspace/` | Renderer |
| `workspace-bus.js` | root | `src/workspace/` | Renderer |
| `workspace-hotkeys.js` | root | `src/workspace/` | Renderer |
| `workspace-load.js` | root | `src/workspace/` | Renderer |
| `param-mod.js` | root | `src/shared/` | Both |
| `audio-input.js` | root | `src/shared/` | Both |
| `layout-space.js` | root | `src/shared/` | Both |
| `controls.css` | root | `src/controls/` | Renderer |
| `music.css` | root | `src/music/` | Renderer |
| `workspace.css` | root | `src/workspace/` | Renderer |
| `performance.css` | root | `src/renderer/` | Renderer |
| `main.css` | root | `src/renderer/` | Renderer |

### 4.2 Directory renames

| From | To |
|------|----|
| `scripts/` | `test/` |

### 4.3 Legacy moves

| File | To |
|------|----|
| `index.html` | `legacy/index.html` |
| `controls.html` | `legacy/controls.html` |
| `music.html` | `legacy/music.html` |
| `performance.html` | `legacy/performance.html` |

---

## 5. Path updates required

### 5.1 `workspace.html` — script tag paths

Current → New:

```html
<!-- Current -->
<script src="./workspace-bus.js"></script>
<script src="./param-mod.js"></script>
<script src="./shaders.js"></script>
<script src="./artef4kt-host.js"></script>
<script src="./scene-match.js"></script>
<script src="./layout-space.js"></script>
<script src="./audio-input.js"></script>
<script src="./renderer.js"></script>
<script src="./audio-analysis.js"></script>
<script src="./music.js"></script>
<script src="./controls.js"></script>
<script src="./performance.js"></script>
<script src="./workspace-hotkeys.js"></script>
<script src="./workspace.js"></script>

<!-- New -->
<script src="./src/workspace/workspace-bus.js"></script>
<script src="./src/shared/param-mod.js"></script>
<script src="./src/renderer/shaders.js"></script>
<script src="./src/renderer/artef4kt-host.js"></script>
<script src="./src/renderer/scene-match.js"></script>
<script src="./src/shared/layout-space.js"></script>
<script src="./src/shared/audio-input.js"></script>
<script src="./src/renderer/renderer.js"></script>
<script src="./src/music/audio-analysis.js"></script>
<script src="./src/music/music.js"></script>
<script src="./src/controls/controls.js"></script>
<script src="./src/renderer/performance.js"></script>
<script src="./src/workspace/workspace-hotkeys.js"></script>
<script src="./src/workspace/workspace.js"></script>
```

### 5.2 `app.js` — require() paths

```js
// Current
const musicLibrary = require('./music-library');
const spotifyImport = require('./spotify-import');
const presets = require('./presets');
const performances = require('./performances');
const userSettings = require('./user-settings');

// New
const musicLibrary = require('./src/main/music-library');
const spotifyImport = require('./src/main/spotify-import');
const presets = require('./src/main/presets');
const performances = require('./src/main/performances');
const userSettings = require('./src/main/user-settings');
```

Also update `workspaceWin.loadFile('workspace.html')` — no change needed (stays in root).

### 5.3 `src/main/presets.js` — require path

```js
// Current
const { normalizePreset, LAYOUT_SPACE } = require('./layout-space');

// New
const { normalizePreset, LAYOUT_SPACE } = require('../shared/layout-space');
```

### 5.4 `src/main/performances.js` — require paths

```js
// Current
const { sanitizePresetName } = require('./presets');
const { normalizePerformance } = require('./layout-space');

// New
const { sanitizePresetName } = require('./presets');  // same dir, no change
const { normalizePerformance } = require('../shared/layout-space');
```

### 5.5 `src/main/spotify-import.js` — require path

```js
// Current
const musicLibrary = require('./music-library');

// New — same directory, no change needed
```

### 5.6 `test/*.js` — require paths

All test files currently do `require('../foo')`. After moving `scripts/` → `test/`:

| Current require | New require |
|----------------|-------------|
| `require('../workspace-hotkeys')` | `require('../src/workspace/workspace-hotkeys')` |
| `require('../scene-match')` | `require('../src/renderer/scene-match')` |
| `require('../user-settings')` | `require('../src/main/user-settings')` |
| `require('../audio-input.js')` | `require('../src/shared/audio-input.js')` |
| `require('../performances')` | `require('../src/main/performances')` |
| `require('../spotify-import')` | `require('../src/main/spotify-import')` |
| `require('../workspace-bus')` | `require('../src/workspace/workspace-bus')` |

Also update `package.json` test script path:
```json
// Current
"test": "node --test scripts/test-*.js"
// New
"test": "node --test test/test-*.js"
```

---

## 6. Phased work

### Phase 1 — Create directories + move files

Tasks:
1. Create `src/main/`, `src/renderer/`, `src/controls/`, `src/music/`, `src/workspace/`, `src/shared/`, `legacy/`, `test/`.
2. Move all 25 source files to their target locations (§4.1).
3. Move `scripts/` → `test/` (§4.2).
4. Move 4 legacy HTML files to `legacy/` (§4.3).

**Exit criteria:** all files in new locations; root has only app.js, preload.js, workspace.html, package.json, README.md, .gitignore.

### Phase 2 — Update path references

Tasks:
1. Update `workspace.html` script tags (§5.1).
2. Update `app.js` require paths (§5.2).
3. Update `src/main/presets.js` require (§5.3).
4. Update `src/main/performances.js` require (§5.4).
5. Update all `test/*.js` require paths (§5.6).
6. Update `package.json` test script (§5.6).

**Exit criteria:** `npm start` boots app; `npm test` passes all 9 tests.

### Phase 3 — Verify + cleanup

Tasks:
1. Full smoke test: app boots, song plays, shaders render, controls work, presets load/save, performance timeline works.
2. Verify artef4kt mount/unmount still works.
3. Verify test suite passes.
4. Remove empty `scripts/` directory.
5. Update `.gitignore` if any paths changed.

**Exit criteria:** app fully functional; no regressions.

### Phase 4 — Docs + changelog

Tasks:
1. Update `docs/roadmap/README.md` if it references file paths.
2. Update any docs that reference root-level file paths (check `docs/architecture/`, `docs/authoring/`).
3. Add CHANGELOG entry for reorganization.
4. Move this plan to `docs/roadmap/history/`.

**Exit criteria:** all docs reflect new structure.

---

## 7. Risk register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Broken script paths in workspace.html | App won't boot | Phase 2 — update all paths; smoke test immediately |
| Broken require() in main process | App won't boot | Phase 2 — update all requires; `npm start` test |
| Broken test requires | Tests fail | Phase 2 — update test paths; `npm test` |
| CSS paths break (if referenced from JS) | Missing styles | Search for CSS references in JS; unlikely (CSS loaded via HTML) |
| Layout-space dual-context breakage | Presets/perf broken | Test require + script tag both work |
| Git history harder to follow | Medium | Use `git mv` for clean history tracking |
| Merge conflicts with in-flight work | Medium | Do this when no other branches are active |

---

## 8. File touch map

| Area | Files |
|------|-------|
| Root | `app.js` (require paths), `workspace.html` (script paths), `package.json` (test script) |
| src/main/ | 5 files moved from root |
| src/renderer/ | 5 JS + 2 CSS moved from root |
| src/controls/ | 1 JS + 1 CSS moved from root |
| src/music/ | 2 JS + 1 CSS moved from root |
| src/workspace/ | 4 JS + 1 CSS moved from root |
| src/shared/ | 3 JS moved from root |
| test/ | 9 files renamed from scripts/; require paths updated |
| legacy/ | 4 HTML files moved from root |

---

## 9. Acceptance criteria

1. Root directory has ≤8 files (app.js, preload.js, workspace.html, package.json, README.md, .gitignore, plus directories).
2. `npm start` boots the app with no console errors.
3. All 9 tests pass (`npm test`).
4. Song plays, cover art loads, shaders render, controls edit params, presets save/load.
5. artef4kt container mounts and reacts to audio.
6. Performance timeline loads and runs.
7. Legacy HTML files are in `legacy/` and not loaded.
8. Git history shows clean `git mv` renames.

---

## 10. Progress

| Phase | Status | Notes |
|-------|--------|-------|
| 1 Create directories + move files | Pending | |
| 2 Update path references | Pending | |
| 3 Verify + cleanup | Pending | |
| 4 Docs + changelog | Pending | |
