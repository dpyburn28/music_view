/**
 * First-paint boot overlay + later busy bar.
 * window.__musicViewLoad.set / begin / end / mark
 */
(function () {
    const GATES = ['stage', 'controls', 'music'];

    function el() {
        return document.getElementById('app-load');
    }

    const state = {
        pct: 0,
        booting: true,
        busy: 0,
        gates: { stage: false, controls: false, music: false },
    };

    function paint(pct, label) {
        const root = el();
        if (!root) return;
        if (pct != null && Number.isFinite(pct)) {
            state.pct = Math.max(state.pct, Math.min(100, pct));
        }
        const fill = root.querySelector('.app-load-fill');
        const text = root.querySelector('.app-load-label');
        const num = root.querySelector('.app-load-pct');
        if (fill) fill.style.width = state.pct + '%';
        if (text && label) text.textContent = label;
        if (num) num.textContent = Math.round(state.pct) + '%';
        root.setAttribute('aria-valuenow', String(Math.round(state.pct)));
        if (label) root.setAttribute('aria-valuetext', label);
    }

    function showBoot() {
        const root = el();
        if (!root) return;
        root.classList.remove('hidden', 'is-done', 'is-busy');
        root.setAttribute('aria-busy', 'true');
        document.body.classList.add('is-booting');
    }

    function hide() {
        const root = el();
        if (!root) return;
        root.classList.add('is-done');
        root.setAttribute('aria-busy', 'false');
        document.body.classList.remove('is-booting', 'is-loading');
        window.setTimeout(() => {
            if (!state.booting && state.busy <= 0) root.classList.add('hidden');
        }, 320);
    }

    function tryFinishBoot() {
        if (!state.booting) return;
        if (!GATES.every((g) => state.gates[g])) return;
        state.booting = false;
        paint(100, 'Ready');
        hide();
    }

    const api = {
        set(pct, label) {
            if (state.booting) showBoot();
            paint(pct, label);
        },
        mark(gate) {
            if (GATES.indexOf(gate) >= 0) state.gates[gate] = true;
            tryFinishBoot();
        },
        begin(label) {
            if (state.booting) {
                paint(null, label);
                return;
            }
            state.busy += 1;
            const root = el();
            if (!root) return;
            root.classList.add('is-busy');
            root.classList.remove('hidden', 'is-done');
            root.setAttribute('aria-busy', 'true');
            document.body.classList.add('is-loading');
            paint(null, label || 'Loading…');
            if (el()?.querySelector('.app-load-fill')) {
                el().querySelector('.app-load-fill').style.width = '35%';
            }
        },
        end() {
            if (state.booting) return;
            state.busy = Math.max(0, state.busy - 1);
            if (state.busy > 0) return;
            hide();
        },
    };

    window.__musicViewLoad = api;
    showBoot();
    paint(4, 'Starting…');
})();
