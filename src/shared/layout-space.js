/**
 * Design-space layout (1080×1920).
 * Preset / snapshot pixels, type, and strokes are authored here and projected live.
 */
(function (root) {
  const DESIGN_W = 1080;
  const DESIGN_H = 1920;
  const LAYOUT_SPACE = "design-1080x1920";
  const COMMON_SRC_W = [360, 405, 450, 480, 540, 608, 720, 810];

  function num(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function roundPx(v) {
    const n = num(v);
    if (n == null) return n;
    return Math.round(n);
  }

  function designFloatSize(bottomPanel) {
    const ratio = num(bottomPanel && bottomPanel.heightRatio) || 0;
    const include = !!(bottomPanel && bottomPanel.includeInFloatArea);
    const height = include || ratio <= 0
      ? DESIGN_H
      : Math.max(1, Math.round(DESIGN_H * (1 - Math.max(0, Math.min(1, ratio)))));
    return { width: DESIGN_W, height };
  }

  function sceneExtent(scene) {
    const boxes = Array.isArray(scene && scene.containers) ? scene.containers : [];
    let minL = Infinity;
    let minT = Infinity;
    let maxX = 0;
    let maxY = 0;
    let abs = 0;
    for (const c of boxes) {
      if (!c || typeof c !== "object") continue;
      const l = num(c.left);
      const t = num(c.top);
      const w = num(c.width);
      const h = num(c.height);
      if (l != null && w != null) {
        abs += 1;
        minL = Math.min(minL, l);
        maxX = Math.max(maxX, l + w);
      }
      if (t != null && h != null) {
        minT = Math.min(minT, t);
        maxY = Math.max(maxY, t + h);
      }
    }
    return {
      abs,
      minL: Number.isFinite(minL) ? minL : 0,
      minT: Number.isFinite(minT) ? minT : 0,
      maxX,
      maxY,
    };
  }

  function snapSourceWidth(srcW) {
    let best = srcW;
    let bestD = Infinity;
    for (const c of COMMON_SRC_W) {
      const d = Math.abs(c - srcW) / c;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return bestD <= 0.08 ? best : srcW;
  }

  /**
   * Scale that maps a pre-design capture onto 1080×1920.
   * Relative-only / already-1080 / FX-only scenes stay at 1.
   */
  function inferLayoutScale(scene) {
    if (!scene || typeof scene !== "object") return 1;
    if (scene.layoutSpace === LAYOUT_SPACE) return 1;
    const { abs, maxX, maxY } = sceneExtent(scene);
    if (abs < 3) return 1;
    if (maxX >= 700 || maxY >= 1100) return 1;
    if (maxX < 200) return 1;
    const srcW = snapSourceWidth(Math.max(maxX + 12, maxY * 9 / 16));
    if (srcW >= 900) return 1;
    const s = DESIGN_W / srcW;
    return Number.isFinite(s) && s > 1.05 ? s : 1;
  }

  function scaleLinear(value, s) {
    const n = num(value);
    if (n == null) return value;
    return roundPx(n * s);
  }

  function scaleStyleMetrics(style, s) {
    if (!style || typeof style !== "object" || s === 1) return style;
    const out = Object.assign({}, style);
    if (out.padding != null) out.padding = scaleLinear(out.padding, s);
    if (out.border && typeof out.border === "object") {
      out.border = Object.assign({}, out.border);
      if (out.border.lineWidth != null) out.border.lineWidth = scaleLinear(out.border.lineWidth, s);
      if (Array.isArray(out.border.dash)) {
        out.border.dash = out.border.dash.map((d) => scaleLinear(d, s));
      }
    }
    if (out.connect && typeof out.connect === "object") {
      out.connect = Object.assign({}, out.connect);
      if (out.connect.lineWidth != null) out.connect.lineWidth = scaleLinear(out.connect.lineWidth, s);
      if (Array.isArray(out.connect.dash)) {
        out.connect.dash = out.connect.dash.map((d) => scaleLinear(d, s));
      }
    }
    for (const key of ["label", "text"]) {
      if (out[key] && typeof out[key] === "object") {
        out[key] = Object.assign({}, out[key]);
        if (out[key].fontSize != null) out[key].fontSize = scaleLinear(out[key].fontSize, s);
        if (out[key].letterSpacing != null) out[key].letterSpacing = scaleLinear(out[key].letterSpacing, s);
      }
    }
    return out;
  }

  function scaleContainerLinear(entry, s) {
    if (!entry || typeof entry !== "object" || s === 1) return entry;
    const out = Object.assign({}, entry);
    for (const key of ["left", "top", "width", "height", "distancing", "wanderAmplitude", "anchorDistance"]) {
      if (out[key] != null && Number.isFinite(Number(out[key]))) {
        out[key] = scaleLinear(out[key], s);
      }
    }
    if (out.relative && typeof out.relative === "object") {
      out.relative = Object.assign({}, out.relative);
      for (const key of ["maxWidth", "gap", "bottomInset"]) {
        if (out.relative[key] != null) out.relative[key] = scaleLinear(out.relative[key], s);
      }
    }
    if (out.style) out.style = scaleStyleMetrics(out.style, s);
    return out;
  }

  function resolveGeometry(entry, area, placedByRole) {
    const panelW = area.width;
    const panelH = area.height;
    const rel = (entry && entry.relative && typeof entry.relative === "object") ? entry.relative : {};

    let width = num(entry.width);
    let height = num(entry.height);
    let left = num(entry.left);
    let top = num(entry.top);

    if (width == null && rel.widthOfMin != null) {
      width = Math.round(Math.min(panelW, panelH) * Number(rel.widthOfMin));
    }
    if (width == null && rel.widthOfPanel != null) {
      width = Math.round(panelW * Number(rel.widthOfPanel));
      if (rel.maxWidth != null) width = Math.min(width, Number(rel.maxWidth));
    }
    if (height == null && width != null && (rel.square || (entry && entry.role === "song-cover"))) {
      height = width;
    }

    if (left == null && rel.centerX && width != null) {
      left = Math.round((panelW - width) / 2);
    }
    if (top == null && rel.centerYOffset != null && height != null) {
      top = Math.round((panelH - height) / 2 + panelH * Number(rel.centerYOffset));
      top = Math.max(16, top);
    }
    if (top == null && rel.belowRole && height != null) {
      const anchor = placedByRole[rel.belowRole];
      if (anchor) {
        top = anchor.top + anchor.height + (Number(rel.gap) || 14);
      }
    }
    if (top == null && rel.bottomInset != null && height != null) {
      top = Math.max(12, panelH - height - Number(rel.bottomInset));
    }
    if (left == null && width != null) {
      left = Math.round((panelW - width) / 2);
    }

    return {
      left: left == null ? entry.left : roundPx(left),
      top: top == null ? entry.top : roundPx(top),
      width: width == null ? entry.width : roundPx(width),
      height: height == null ? entry.height : roundPx(height),
    };
  }

  function ensureTextStyle(style) {
    if (!style || typeof style !== "object") return style;
    const out = Object.assign({}, style);
    if (out.label && typeof out.label === "object" && !out.text) {
      out.text = Object.assign({}, out.label);
    }
    return out;
  }

  function liftLegacyType(style) {
    if (!style || typeof style !== "object") return style;
    const out = Object.assign({}, style);
    const factor = 20 / 12;
    for (const key of ["label", "text"]) {
      if (!out[key] || typeof out[key] !== "object") continue;
      out[key] = Object.assign({}, out[key]);
      const fs = num(out[key].fontSize);
      if (fs != null && fs > 0 && fs <= 13) {
        out[key].fontSize = roundPx(fs * factor);
        if (out[key].letterSpacing != null) {
          out[key].letterSpacing = scaleLinear(out[key].letterSpacing, factor);
        }
      }
    }
    return out;
  }

  function lockSnapshotEntry(entry) {
    if (!entry || typeof entry !== "object") return entry;
    const out = Object.assign({}, entry);
    const complete = [out.left, out.top, out.width, out.height]
      .every((v) => num(v) != null);
    if (complete) out.relative = null;
    if (out.style) out.style = ensureTextStyle(out.style);
    return out;
  }

  /** Cover art is always square. Restack track/lyrics that sat under a stubby capture. */
  function squareCoverAndRestack(containers) {
    if (!Array.isArray(containers)) return;
    const cover = containers.find((c) => c && c.role === "song-cover");
    if (!cover) return;
    const w = num(cover.width);
    const h = num(cover.height);
    if (w == null || h == null) return;
    const side = Math.round(Math.max(w, h));
    if (side === w && side === h) return;
    const oldLeft = num(cover.left) || 0;
    const oldTop = num(cover.top) || 0;
    const oldBottom = oldTop + h;
    cover.width = side;
    cover.height = side;
    cover.left = roundPx(oldLeft + (w - side) / 2);
    cover.top = roundPx(oldTop + (h - side) / 2);
    const delta = (cover.top + side) - oldBottom;
    if (Math.abs(delta) < 1) return;
    for (const c of containers) {
      if (!c || c === cover) continue;
      if (c.role !== "song-info" && c.role !== "song-lyrics") continue;
      const t = num(c.top);
      if (t != null && t >= oldBottom - 8) c.top = roundPx(t + delta);
    }
  }

  function setStyleFontSize(style, size) {
    if (!style || typeof style !== "object") return;
    for (const key of ["label", "text"]) {
      if (style[key] && typeof style[key] === "object") {
        style[key] = Object.assign({}, style[key], { fontSize: size });
      }
    }
  }

  /**
   * Place lyrics under track info (or cover) in design space.
   * Height fits a 3-line focus at the design font so type can scale with the box.
   */
  function restackLyricsSnapshot(containers, area) {
    if (!Array.isArray(containers)) return;
    const lyrics = containers.find((c) => c && c.role === "song-lyrics");
    if (!lyrics) return;
    const info = containers.find((c) => c && c.role === "song-info");
    const cover = containers.find((c) => c && c.role === "song-cover");
    const panelW = (area && area.width) || DESIGN_W;
    const existingFont = num(lyrics.style && (lyrics.style.text || lyrics.style.label || {}).fontSize);
    const font = existingFont && existingFont > 13 ? existingFont : 20;
    if (lyrics.style) {
      lyrics.style = ensureTextStyle(lyrics.style);
      setStyleFontSize(lyrics.style, font);
    }
    const active = Math.max(font + 4, Math.round(font * 1.5));
    const computedHeight = Math.max(160, Math.round(font * 1.35 * 2 + active * 1.3 + 36));
    let width = num(lyrics.width);
    if (width == null || width < 200 || width > panelW) {
      width = Math.min(380, Math.round(panelW * 0.82));
      lyrics.width = roundPx(width);
    }
    if (num(lyrics.height) == null || lyrics.height < computedHeight) {
      lyrics.height = roundPx(computedHeight);
    }
    if (num(lyrics.left) == null) {
      lyrics.left = roundPx((panelW - (width || num(lyrics.width) || 380)) / 2);
    }
    if (num(lyrics.top) == null) {
      const anchor = (info && num(info.top) != null) ? info : cover;
      if (anchor && num(anchor.top) != null && num(anchor.height) != null) {
        lyrics.top = roundPx(anchor.top + anchor.height + 16);
      }
    }
    if (num(lyrics.top) != null) lyrics.relative = null;
  }

  function normalizeScene(scene, opts) {
    if (!scene || typeof scene !== "object") return scene;
    const snapshot = !!(opts && opts.snapshot);
    if (scene.layoutSpace === LAYOUT_SPACE && Array.isArray(scene.containers) && !snapshot) {
      return scene;
    }
    const out = Object.assign({}, scene);
    const scale = scene.layoutSpace === LAYOUT_SPACE ? 1 : inferLayoutScale(scene);
    const area = designFloatSize(out.bottomPanel);
    const placedByRole = {};
    if (Array.isArray(out.containers)) {
      out.containers = out.containers.map((raw) => {
        if (!raw || typeof raw !== "object") return raw;
        let entry = scaleContainerLinear(raw, scale);
        if (entry.style) entry.style = ensureTextStyle(entry.style);
        const geo = resolveGeometry(entry, area, placedByRole);
        entry = Object.assign({}, entry, geo);
        if (entry.role && geo.left != null && geo.top != null && geo.width != null && geo.height != null) {
          placedByRole[entry.role] = {
            left: Number(geo.left) || 0,
            top: Number(geo.top) || 0,
            width: Number(geo.width) || 0,
            height: Number(geo.height) || 0,
          };
        }
        return snapshot ? lockSnapshotEntry(entry) : entry;
      });
      if (snapshot) {
        squareCoverAndRestack(out.containers);
        restackLyricsSnapshot(out.containers, area);
      }
    }
    out.layoutSpace = LAYOUT_SPACE;
    return out;
  }

  function normalizePreset(preset) {
    if (!preset || typeof preset !== "object") return preset;
    const out = Object.assign({}, preset);
    if (out.scene) out.scene = normalizeScene(out.scene);
    return out;
  }

  function normalizePerformance(doc) {
    if (!doc || typeof doc !== "object") return doc;
    const out = Object.assign({}, doc);
    if (!Array.isArray(out.clips)) return out;
    out.clips = out.clips.map((clip) => {
      if (!clip || typeof clip !== "object") return clip;
      const next = Object.assign({}, clip);
      if (!Array.isArray(next.lookCues)) return next;
      next.lookCues = next.lookCues.map((cue) => {
        if (!cue || typeof cue !== "object" || !cue.scene) return cue;
        return Object.assign({}, cue, { scene: normalizeScene(cue.scene, { snapshot: true }) });
      });
      return next;
    });
    return out;
  }

  const api = {
    DESIGN_W,
    DESIGN_H,
    LAYOUT_SPACE,
    designFloatSize,
    inferLayoutScale,
    normalizeScene,
    normalizePreset,
    normalizePerformance,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.musicViewLayoutSpace = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
