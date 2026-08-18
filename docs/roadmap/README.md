# Roadmap

Status of major workstreams and where full plans live.

## Completed (archived plans)

| Workstream | Status | Plan |
|------------|--------|------|
| Controls UI overhaul (Look / Object tabs, stack UX, object segments) | **Done** | [history/ui-overhaul-plan.md](./history/ui-overhaul-plan.md) |
| Phase 0 inventory (commands & element ids) | **Done** | [history/ui-overhaul-phase-0-inventory.md](./history/ui-overhaul-phase-0-inventory.md) |
| Shader controls overhaul (widgets, schema v1.1, package pass) | **Done** | [history/shader-controls-overhaul-plan.md](./history/shader-controls-overhaul-plan.md) |
| Param modulation (LFO sources, clocks, presets) | **Done** | [history/param-modulation-plan.md](./history/param-modulation-plan.md) |
| Floating container management (Controls add/remove/list) | **Done (v1)** | [container-management-plan.md](./container-management-plan.md) |
| Performance timeline (showcase conductor) | **Done (v1)** | [performance-timeline-plan.md](./performance-timeline-plan.md) |
| Single-window workspace | **Done** | [fullscreen-single-window-plan.md](./fullscreen-single-window-plan.md) |
| Postprocess toolkit (grade, optics, feedback, glitch, stylize, utility) | **Done (A–D)** | [postprocess-toolkit-plan.md](./postprocess-toolkit-plan.md) |
| ARTEF4KT embed (vendor + floating container + song analysis) | **Done (v1)** | [artef4kt-integration-plan.md](./artef4kt-integration-plan.md) |

These docs are **historical design records**. Prefer the living guides under `docs/authoring/` and `docs/overview/` for day-to-day work. Update archived plans only if correcting factual errors; new work gets new docs or backlog entries.

Shipped after those plans (see [CHANGELOG](../CHANGELOG.md)): design-space layout, Show FX, Container Walk, per-container `audioInput` + continuous mix tap, stage background (solid / shader / image / video + BG FX), generative `bg-*` fills, Look → Render FPS, boot load overlay, live background fade on morph.

## Open work

See **[backlog.md](./backlog.md)** for:

- Features still to add  
- Deferred items from completed overhauls  
- Suggested overhauls and tech debt  

## How to plan new work

1. Add a short item to [backlog.md](./backlog.md).  
2. For multi-phase efforts, add `docs/roadmap/<feature>-plan.md` (or `history/` once done).  
3. Link it from this README.  
4. Keep authoring contracts (`docs/authoring/*`) updated when shipping user-visible schema.
