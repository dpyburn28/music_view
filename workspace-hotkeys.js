/**
 * Single workspace keyboard router (PR 7b).
 * Present / kiosk Esc steps land in PR 7c.
 */
(function (root) {
  function isTyping(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function spaceTarget(opts) {
    const o = opts || {};
    if (o.showDriving || o.focus === 'performance'
        || (o.present && o.inShow && o.focus !== 'music')) {
      return 'show';
    }
    return 'track';
  }

  function focusOwner() {
    return root.__musicViewFocus || 'music';
  }

  function closeOpenUi() {
    if (root.__musicViewControls && typeof root.__musicViewControls.closeMenus === 'function') {
      root.__musicViewControls.closeMenus();
    }
    const dlg = root.document.querySelector('dialog[open]');
    if (dlg && typeof dlg.close === 'function') dlg.close();
  }

  function onKeyDown(e) {
    const t = e.target;
    const typing = isTyping(t);
    const focus = focusOwner();
    const music = root.MusicViewMusic;
    const show = root.MusicViewShow;
    const ctrl = root.__musicViewControls;
    const present = !!(root.document.documentElement
      && root.document.documentElement.classList.contains('is-present'));

    if (e.key === 'Escape') {
      if (typing && t && t.blur) {
        t.blur();
        e.preventDefault();
        return;
      }
      closeOpenUi();
      const ws = root.__musicViewWorkspace;
      if (ws && ws.isPresent && ws.isPresent()) {
        e.preventDefault();
        if (ws.exitPresent) ws.exitPresent();
        return;
      }
      if (show && typeof show.getStatus === 'function' && show.getStatus() === 'preview'
          && typeof show.exitPreview === 'function') {
        show.exitPreview();
        e.preventDefault();
      }
      return;
    }

    if (typing) return;
    if (e.metaKey || e.ctrlKey) return;

    if (e.code === 'Space') {
      e.preventDefault();
      const dest = spaceTarget({
        focus,
        showDriving: !!(music && music.isShowDriving && music.isShowDriving()),
        present,
        inShow: !!(show && show.isInShow && show.isInShow()),
      });
      if (dest === 'show') {
        if (show && show.playShow) show.playShow();
      } else if (music && music.togglePlay) {
        music.togglePlay();
      }
      return;
    }

    if (e.key === '1') {
      e.preventDefault();
      if (ctrl && ctrl.setActiveTab) ctrl.setActiveTab('look');
      root.__musicViewFocus = 'look';
      return;
    }
    if (e.key === '2') {
      e.preventDefault();
      if (ctrl && ctrl.setActiveTab) ctrl.setActiveTab('object');
      root.__musicViewFocus = 'object';
      return;
    }

    if (e.key === 'Enter' || e.key === 'g' || e.key === 'G') {
      const inShow = !!(show && show.isInShow && show.isInShow());
      if (focus === 'performance' || (present && inShow)) {
        e.preventDefault();
        if (show && show.goNext) show.goNext();
      }
      return;
    }

    if (e.key === '[' || e.key === ']') {
      if (focus === 'performance' && show && show.jumpBy) {
        e.preventDefault();
        show.jumpBy(e.key === ']' ? 1 : -1);
      } else if (focus === 'object' && ctrl && ctrl.cycleObject) {
        e.preventDefault();
        ctrl.cycleObject(e.key === ']' ? 1 : -1);
      }
      return;
    }

    if (focus !== 'look' || !ctrl) return;

    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      if (ctrl.moveLookLayer) ctrl.moveLookLayer(e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (e.altKey) return;

    if (e.key === '/') {
      e.preventDefault();
      if (ctrl.focusPresetSearch) ctrl.focusPresetSearch();
      return;
    }
    if (e.key === 'e' || e.key === 'E') {
      e.preventDefault();
      if (ctrl.toggleLookLayer) ctrl.toggleLookLayer();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (ctrl.removeLookLayer) ctrl.removeLookLayer();
    }
  }

  function installWorkspaceHotkeys() {
    if (root.__musicViewHotkeysInstalled) return;
    root.__musicViewHotkeysInstalled = true;
    root.document.addEventListener('keydown', onKeyDown);
  }

  root.installWorkspaceHotkeys = installWorkspaceHotkeys;
  root.__musicViewSpaceTarget = spaceTarget;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { isTyping, spaceTarget };
  }
})(typeof window !== 'undefined' ? window : globalThis);
