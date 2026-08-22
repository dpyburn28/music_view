/**
 * Workspace shell: letterbox, focus, Present / Fullscreen / Kiosk, dock layout.
 */
(function () {
  const STAGE_CAP_W = 1080;
  const STAGE_CAP_H = 1920;
  const DEFAULTS = {
    left: 360,
    right: 380,
    bottom: 240,
    showCollapsed: true,
  };

  const layout = {
    left: DEFAULTS.left,
    right: DEFAULTS.right,
    bottom: DEFAULTS.bottom,
    showCollapsed: DEFAULTS.showCollapsed,
    present: false,
    kiosk: false,
    fullscreen: false,
    nativeStage: false,
  };

  let persistTimer = null;

  function fitStage() {
    const slot = document.getElementById('stage-slot');
    const root = document.getElementById('stage-root');
    if (!slot || !root) return;

    const cw = slot.clientWidth;
    const ch = slot.clientHeight;
    if (cw < 2 || ch < 2) return;

    const native = layout.nativeStage === true || window.__musicViewNativeStage === true;
    const capW = native ? cw : STAGE_CAP_W;
    const capH = native ? ch : STAGE_CAP_H;

    let w = Math.min(cw, capW);
    let h = Math.round((w * 16) / 9);
    if (h > Math.min(ch, capH)) {
      h = Math.min(ch, capH);
      w = Math.round((h * 9) / 16);
    }
    w = Math.max(1, w);
    h = Math.max(1, h);

    root.style.setProperty('--stage-w', w + 'px');
    root.style.setProperty('--stage-h', h + 'px');

    // Wait a frame so .app-shell client box matches the new CSS size,
    // then reflow containers + canvases (works mid-playback / mid-show).
    requestAnimationFrame(() => {
      if (typeof window.__musicViewReflowScene === 'function') {
        window.__musicViewReflowScene();
      } else if (typeof window.__musicViewResizeCanvases === 'function') {
        window.__musicViewResizeCanvases();
      }
    });
  }

  function watchSlot() {
    const slot = document.getElementById('stage-slot');
    if (!slot || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fitStage);
      return;
    }
    new ResizeObserver(() => fitStage()).observe(slot);
  }

  function setFocus(owner) {
    window.__musicViewFocus = owner;
  }

  function applyDockVars() {
    const grid = document.getElementById('workspace-grid');
    if (!grid) return;
    grid.style.setProperty('--dock-left', layout.left + 'px');
    grid.style.setProperty('--dock-right', layout.right + 'px');
    grid.style.setProperty('--dock-bottom', layout.bottom + 'px');
    const show = document.getElementById('dock-show');
    if (show) show.classList.toggle('is-collapsed', !!layout.showCollapsed);
  }

  function schedulePersistDocks() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      if (!window.musicView || !window.musicView.setSettings) return;
      window.musicView.setSettings({
        docks: {
          left: { width: layout.left },
          right: { width: layout.right },
          bottom: { height: layout.bottom, collapsed: !!layout.showCollapsed },
        },
      });
    }, 400);
  }

  function applySettings(settings) {
    const docks = settings && settings.docks ? settings.docks : {};
    if (docks.left && docks.left.width) layout.left = docks.left.width;
    if (docks.right && docks.right.width) layout.right = docks.right.width;
    if (docks.bottom && docks.bottom.height) layout.bottom = docks.bottom.height;
    if (docks.bottom && typeof docks.bottom.collapsed === 'boolean') {
      layout.showCollapsed = docks.bottom.collapsed;
    }
    layout.nativeStage = !!(settings && settings.present && settings.present.nativeStage);
    window.__musicViewNativeStage = layout.nativeStage;
    if (settings && settings.render && typeof window.__musicViewSetRenderFps === 'function') {
      window.__musicViewSetRenderFps(settings.render.fps);
    }
    if (docks.right && docks.right.tab && window.__musicViewControls) {
      window.__musicViewControls.setActiveTab(docks.right.tab);
    }
    applyDockVars();
    fitStage();
  }

  function resetLayout() {
    layout.left = DEFAULTS.left;
    layout.right = DEFAULTS.right;
    layout.bottom = DEFAULTS.bottom;
    layout.showCollapsed = DEFAULTS.showCollapsed;
    document.documentElement.classList.remove('is-docks-hidden');
    applyDockVars();
    fitStage();
    if (window.musicView && window.musicView.resetSettings) {
      window.musicView.resetSettings();
    }
  }

  async function setFullscreen(on) {
    layout.fullscreen = !!on;
    if (window.musicView && window.musicView.setWorkspaceFullscreen) {
      await window.musicView.setWorkspaceFullscreen(layout.fullscreen);
    }
    const btn = document.getElementById('btn-fullscreen');
    if (btn) btn.classList.toggle('is-active', layout.fullscreen);
  }

  async function setKiosk(on) {
    layout.kiosk = !!on;
    if (on) setPresent(true);
    if (window.musicView && window.musicView.setWorkspaceKiosk) {
      await window.musicView.setWorkspaceKiosk(layout.kiosk);
    }
    if (on) layout.fullscreen = true;
    const btn = document.getElementById('btn-fullscreen');
    if (btn) btn.classList.toggle('is-active', layout.fullscreen);
  }

  function setPresent(on) {
    layout.present = !!on;
    document.documentElement.classList.toggle('is-present', layout.present);
    const btn = document.getElementById('btn-present');
    if (btn) btn.classList.toggle('is-active', layout.present);
    fitStage();
  }

  function togglePresent() {
    setPresent(!layout.present);
  }

  async function toggleFullscreen() {
    await setFullscreen(!layout.fullscreen);
  }

  async function toggleKiosk() {
    if (layout.kiosk) await exitKiosk(true);
    else await setKiosk(true);
  }

  async function exitKiosk(force) {
    if (!layout.kiosk) {
      if (layout.present) setPresent(false);
      return true;
    }
    if (!force && !window.confirm('Exit kiosk?')) return false;
    await setKiosk(false);
    setPresent(false);
    await setFullscreen(false);
    return true;
  }

  async function exitPresent() {
    if (layout.kiosk) return exitKiosk(false);
    if (layout.present) setPresent(false);
    return true;
  }

  function toggleDocks() {
    document.documentElement.classList.toggle('is-docks-hidden');
    fitStage();
  }

  function wireFocus() {
    if (document.getElementById('dock-music')) setFocus('music');
    else setFocus('stage');

    document.addEventListener('pointerdown', (e) => {
      const t = e.target;
      if (!t || typeof t.closest !== 'function') return;
      if (t.closest('#dock-music')) setFocus('music');
      else if (t.closest('#dock-controls')) {
        const objectOn = document.getElementById('tab-object')
          && !document.getElementById('tab-object').hasAttribute('hidden');
        setFocus(objectOn ? 'object' : 'look');
      } else if (t.closest('#dock-show')) setFocus('performance');
      else if (t.closest('#stage-slot')) {
        setFocus(t.closest('.floating-box') ? 'object' : 'stage');
      }
    }, true);

    document.querySelectorAll('#app-toolbar [data-panel]').forEach((btn) => {
      if (btn.disabled) return;
      btn.addEventListener('click', () => {
        const panel = btn.dataset.panel;
        if (panel === 'music') {
          setFocus('music');
          const play = document.getElementById('music-btn-play');
          if (play) play.focus({ preventScroll: true });
          return;
        }
        if ((panel === 'look' || panel === 'object') && window.__musicViewControls) {
          window.__musicViewControls.setActiveTab(panel);
          setFocus(panel);
          const dock = document.getElementById('dock-controls');
          if (dock) dock.focus({ preventScroll: true });
          return;
        }
        if (panel === 'show') {
          const dock = document.getElementById('dock-show');
          if (!dock) return;
          if (layout.showCollapsed) {
            layout.showCollapsed = false;
            applyDockVars();
            schedulePersistDocks();
          }
          setFocus('performance');
          dock.focus({ preventScroll: true });
          fitStage();
        }
      });
    });
  }

  function wireModeButtons() {
    const presentBtn = document.getElementById('btn-present');
    const fullBtn = document.getElementById('btn-fullscreen');
    if (presentBtn) presentBtn.addEventListener('click', () => togglePresent());
    if (fullBtn) fullBtn.addEventListener('click', () => toggleFullscreen());
  }

  function wireSplitters() {
    const grid = document.getElementById('workspace-grid');
    if (!grid) return;

    function startDrag(side, ev) {
      ev.preventDefault();
      const startX = ev.clientX;
      const startY = ev.clientY;
      const startLeft = layout.left;
      const startRight = layout.right;
      const startBottom = layout.bottom;
      const el = ev.currentTarget;
      el.classList.add('is-dragging');

      function move(e) {
        const rect = grid.getBoundingClientRect();
        if (side === 'left') {
          layout.left = Math.max(200, Math.min(800, startLeft + (e.clientX - startX)));
        } else if (side === 'right') {
          layout.right = Math.max(200, Math.min(800, startRight - (e.clientX - startX)));
        } else if (side === 'bottom') {
          if (layout.showCollapsed) {
            layout.showCollapsed = false;
          }
          layout.bottom = Math.max(88, Math.min(600, startBottom - (e.clientY - startY)));
        }
        applyDockVars();
      }

      function up() {
        el.classList.remove('is-dragging');
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        schedulePersistDocks();
        fitStage();
      }

      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    }

    document.querySelectorAll('.dock-split').forEach((el) => {
      el.addEventListener('pointerdown', (e) => startDrag(el.dataset.side, e));
      el.addEventListener('dblclick', () => {
        const side = el.dataset.side;
        if (side === 'left') layout.left = DEFAULTS.left;
        if (side === 'right') layout.right = DEFAULTS.right;
        if (side === 'bottom') {
          layout.bottom = DEFAULTS.bottom;
          layout.showCollapsed = DEFAULTS.showCollapsed;
        }
        applyDockVars();
        schedulePersistDocks();
        fitStage();
      });
    });
  }

  function exposeApi() {
    window.__musicViewWorkspace = {
      isPresent: () => layout.present,
      isKiosk: () => layout.kiosk,
      togglePresent,
      toggleFullscreen,
      toggleKiosk,
      exitPresent,
      exitKiosk,
      setPresent,
      resetLayout,
      toggleDocks,
    };
    window.__musicViewFitStage = fitStage;
  }

  /** The page is overflow:hidden and must never scroll. Programmatic scrolls
   *  (focus, scrollIntoView from embedded panes) can still shift it — undo them. */
  function guardPageScroll() {
    const de = document.documentElement;
    document.addEventListener('scroll', () => {
      if (de.scrollTop) de.scrollTop = 0;
      if (document.body && document.body.scrollTop) document.body.scrollTop = 0;
    }, true);
  }

  async function boot() {
    if (window.__musicViewLoad) window.__musicViewLoad.set(8, 'Workspace…');
    exposeApi();
    wireFocus();
    wireModeButtons();
    wireSplitters();
    guardPageScroll();
    applyDockVars();
    if (typeof window.installWorkspaceHotkeys === 'function') {
      window.installWorkspaceHotkeys();
    }
    if (window.musicView && window.musicView.getSettings) {
      try {
        const settings = await window.musicView.getSettings();
        applySettings(settings);
      } catch (e) {
        console.warn('settings load failed', e);
      }
    }
    fitStage();
    watchSlot();
    if (window.musicView && typeof window.musicView.onWorkspaceCommand === 'function') {
      window.musicView.onWorkspaceCommand((name) => {
        if (name === 'present') togglePresent();
        else if (name === 'fullscreen') toggleFullscreen();
        else if (name === 'kiosk') toggleKiosk();
        else if (name === 'reset-layout') resetLayout();
        else if (name === 'toggle-docks') toggleDocks();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
