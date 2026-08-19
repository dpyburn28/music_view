const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  DESIGN_W,
  DESIGN_H,
  LAYOUT_SPACE,
  inferLayoutScale,
  normalizeScene,
  normalizePreset,
  normalizePerformance,
} = require("../src/shared/layout-space");

test("relative classic look resolves onto 1080×1920", () => {
  const scene = normalizeScene({
    containers: [
      {
        role: "song-cover",
        left: null,
        top: null,
        width: null,
        height: null,
        relative: { widthOfMin: 0.48, centerX: true, centerYOffset: -0.06 },
        style: { label: { fontSize: 12 }, border: { lineWidth: 5 } },
      },
      {
        role: "song-info",
        left: null,
        top: null,
        width: 160,
        height: 72,
        relative: { centerX: true, belowRole: "song-cover", gap: 16 },
        style: { label: { fontSize: 12 } },
      },
    ],
  });
  assert.equal(scene.layoutSpace, LAYOUT_SPACE);
  const cover = scene.containers[0];
  const info = scene.containers[1];
  assert.equal(cover.width, Math.round(Math.min(DESIGN_W, DESIGN_H) * 0.48));
  assert.equal(cover.height, cover.width);
  assert.equal(cover.left, Math.round((DESIGN_W - cover.width) / 2));
  assert.equal(info.width, 160);
  assert.equal(info.height, 72);
  assert.equal(info.top, cover.top + cover.height + 16);
  assert.equal(info.style.text.fontSize, 12);
  assert.equal(cover.style.label.fontSize, 12);
});

test("small-stage absolute capture scales geometry, type, and strokes", () => {
  const src = {
    containers: [
      { role: "song-cover", left: 215, top: 188, width: 269, height: 269, style: { label: { fontSize: 12 }, border: { lineWidth: 5 } } },
      { role: "song-info", left: 111, top: 433, width: 101, height: 56, style: { label: { fontSize: 12 } } },
      { role: "song-lyrics", left: 114, top: 577, width: 312, height: 118, style: { label: { fontSize: 12 } } },
      { role: "song-progress", left: 85, top: 765, width: 380, height: 28, style: { label: { fontSize: 12 } } },
    ],
  };
  const scale = inferLayoutScale(src);
  assert.ok(scale > 1.5, `expected upscale, got ${scale}`);
  const scene = normalizeScene(src);
  const cover = scene.containers[0];
  assert.ok(cover.width > 500, `cover should be design-sized, got ${cover.width}`);
  assert.ok(cover.style.label.fontSize > 18, `font should scale, got ${cover.style.label.fontSize}`);
  assert.ok(cover.style.border.lineWidth > 8);
  assert.equal(scene.layoutSpace, LAYOUT_SPACE);
  assert.equal(inferLayoutScale(scene), 1);
});

test("already-1080 layout is not scaled again", () => {
  const scene = {
    layoutSpace: LAYOUT_SPACE,
    containers: [
      { role: "song-cover", left: 281, top: 574, width: 518, height: 518, style: { label: { fontSize: 12 } } },
    ],
  };
  assert.equal(inferLayoutScale(scene), 1);
  const out = normalizeScene(scene);
  assert.equal(out.containers[0].width, 518);
  assert.equal(out.containers[0].style.label.fontSize, 12);
});

test("wide 1080 capture without layoutSpace is left alone", () => {
  const scene = {
    containers: [
      { role: "song-cover", left: 227, top: 545, width: 626, height: 626 },
      { role: "song-info", left: 440, top: 683, width: 200, height: 80 },
      { role: "song-lyrics", left: 350, top: 779, width: 380, height: 120 },
    ],
  };
  assert.equal(inferLayoutScale(scene), 1);
});

test("normalizePreset and performance walk scenes", () => {
  const preset = normalizePreset({
    name: "x",
    scene: {
      containers: [
        { role: "song-cover", relative: { widthOfMin: 0.5, centerX: true, centerYOffset: 0 }, width: null, height: null, left: null, top: null },
      ],
    },
  });
  assert.equal(preset.scene.containers[0].width, 540);

  const perf = normalizePerformance({
    clips: [
      {
        lookCues: [
          {
            scene: {
              containers: [
                { role: "a", left: 12, top: 48, width: 200, height: 120 },
                { role: "b", left: 12, top: 180, width: 200, height: 120 },
                { role: "c", left: 12, top: 312, width: 140, height: 140 },
                { role: "d", left: 85, top: 765, width: 380, height: 28 },
              ],
            },
          },
        ],
      },
    ],
  });
  assert.equal(perf.clips[0].lookCues[0].scene.layoutSpace, LAYOUT_SPACE);
  assert.ok(perf.clips[0].lookCues[0].scene.containers[3].width > 500);
});

test("performance snapshots square covers and restack lyrics in design space", () => {
  const scene = normalizeScene({
    layoutSpace: LAYOUT_SPACE,
    containers: [
      {
        role: "song-cover",
        left: 227,
        top: 545,
        width: 626,
        height: 120,
        relative: { widthOfMin: 0.58, centerX: true, centerYOffset: -0.08 },
        style: { label: { fontSize: 12, letterSpacing: 0.3 } },
      },
      {
        role: "song-info",
        left: 440,
        top: 683,
        width: 200,
        height: 80,
        style: { label: { fontSize: 12 } },
      },
      {
        role: "song-lyrics",
        left: 350,
        top: 779,
        width: 380,
        height: 120,
        style: { label: { fontSize: 20 }, text: { fontSize: 20 } },
      },
    ],
  }, { snapshot: true });
  const cover = scene.containers[0];
  const info = scene.containers[1];
  const lyrics = scene.containers.find((c) => c.role === "song-lyrics") || scene.containers[2];
  assert.equal(cover.width, 626);
  assert.equal(cover.height, 626);
  assert.equal(cover.relative, null);
  assert.ok(info.top >= cover.top + cover.height, "info should sit below the square cover");
  assert.ok(lyrics, "lyrics panel present");
  assert.equal(lyrics.width, 380);
  assert.ok(lyrics.height >= 160, `lyrics height should fit scaled type, got ${lyrics.height}`);
  assert.equal(lyrics.left, Math.round((1080 - 380) / 2));
  assert.ok(lyrics.top >= info.top + info.height, "lyrics should sit below track info");
  assert.equal(lyrics.style.text.fontSize, 20);
});

test("checked-in presets and performances are design-space", () => {
  const presetDir = path.join(__dirname, "..", "presets");
  for (const name of fs.readdirSync(presetDir).filter((f) => f.endsWith(".json"))) {
    const preset = JSON.parse(fs.readFileSync(path.join(presetDir, name), "utf8"));
    assert.equal(preset.scene.layoutSpace, LAYOUT_SPACE, name);
    assert.equal(inferLayoutScale(preset.scene), 1, name);
    for (const c of preset.scene.containers || []) {
      if (c.width != null) {
        assert.ok(Number(c.width) <= DESIGN_W + 1, `${name} ${c.role} width`);
      }
      if (c.height != null) {
        assert.ok(Number(c.height) <= DESIGN_H + 1, `${name} ${c.role} height`);
      }
      const font = c.style?.text?.fontSize ?? c.style?.label?.fontSize;
      if (font != null) assert.ok(Number(font) >= 8, `${name} ${c.role} font`);
    }
  }
  const perfDir = path.join(__dirname, "..", "performances");
  for (const name of fs.readdirSync(perfDir).filter((f) => f.endsWith(".json"))) {
    const doc = JSON.parse(fs.readFileSync(path.join(perfDir, name), "utf8"));
    for (const clip of doc.clips || []) {
      for (const cue of clip.lookCues || []) {
        if (!cue.scene) continue;
        assert.equal(cue.scene.layoutSpace, LAYOUT_SPACE, name);
        assert.equal(inferLayoutScale(cue.scene), 1, name);
      }
    }
  }
});
