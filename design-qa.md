# WMS Landing Page — Design QA

- Source visual truth: `docs/uat/2026-09-07/wms-landing-page/source-r4c-desktop-hero.png` and `source-r4c-mobile-hero.png`
- Implementation evidence: `hypothetical-slides-light-desktop.png`, `hypothetical-slides-dark-desktop.png`, `hypothetical-slides-dark-mobile.png`, `production-hypothetical-light.png`, and `production-hypothetical-dark.png` in the same evidence directory. The displayed inbound/outbound product art is now generated specifically for the landing page under `public/img/landing/demo/`, with matching light/dark variants and explicit `DEMO DATA` labels.
- Desktop comparison: 1425 × 860 pixels, 1440 × 900 requested CSS viewport, device scale factor 1, English and Arabic hero states
- Mobile comparison: 375 × 811 pixels, 390 × 844 requested CSS viewport, device scale factor 1, English and Arabic hero states
- State: public unauthenticated landing page at `/`; login remains at `#/login`

**Findings**

- No actionable P0, P1, or P2 visual differences remain.
- Typography preserves the source hierarchy, optical weight, line height, and responsive wrapping while replacing the R4C commercial narrative with WMS warehouse language.
- Spacing and layout preserve the source header, two-column desktop hero, stacked mobile hero, demo stage, audience grid, and final call-to-action rhythm. The expanded eight-step journey uses a 4 × 2 desktop grid and touch-friendly horizontal snap cards on mobile, avoiding an excessively long single-column presentation.
- Colors map the source blue/cyan system to WMS's existing light-theme tokens: navy `#102637`, operational teal `#168f98`, and mist `#edf4f8`.
- Image quality uses purpose-built fictional WMS demonstrations of inbound quality control and outbound goods-issue processing. All people, IDs, materials, batches, warehouses, projects, quantities, and requests are hypothetical. The previous operational captures were removed from public assets, and hero/demo crops remain sharp and intentional at desktop and mobile sizes.
- Copy is WMS-specific in both English and Arabic and now covers eight connected controls: request, approval/reservation, receipt/identity, quality release, allocation, picking, goods issue/dispatch, and count/audit.

**Focused comparison evidence**

- `implementation-desktop-demo.png` confirms readable tab labels, product screenshot treatment, annotation hierarchy, border radius, and panel spacing.
- `hypothetical-slides-light-desktop.png` confirms the synthetic inbound content, visible data disclaimer, five-tab hierarchy, and light presentation.
- `hypothetical-slides-dark-desktop.png` confirms the same workflow in an accessible navy/slate dark presentation.
- `implementation-mobile-hero-enhanced.png` confirms the original mobile hierarchy is retained while authentic operational screens replace the earlier generic concept imagery.
- `hypothetical-slides-dark-mobile.png` confirms the redesigned toolbar, theme switch, slide metadata, and fictional outbound presentation remain usable at 390 × 844.
- `implementation-mobile-workflow-arabic.png` confirms the eight-step horizontal workflow treatment, Arabic RTL ordering, touch-card sizing, and zero document overflow.

**Interaction and accessibility checks**

- English ↔ Arabic updates page copy, `lang`, and `dir` correctly.
- All five demo tabs update `aria-selected`, the image, and annotations; inbound and outbound tabs were explicitly exercised. The Light/Dark controls update `aria-pressed`, preserve the active workflow, and select the matching synthetic asset.
- Solution, Workflow, and Demo controls scroll without changing the SPA hash route.
- Sign-in actions route to `#/login` and render the existing login form.
- Browser console errors: 0.
- Mobile document overflow: 0 pixels.

**Comparison history**

1. Initial implementation matched the visual source but used fragment anchors for section navigation. WMS's hash router interpreted those fragments as application routes and rendered login.
2. Replaced fragment links with accessible in-page scroll buttons, reloaded the page, and re-tested Demo, Workflow, demo tabs, language switching, and Sign in. All passed without console errors.
3. Recaptured desktop and mobile evidence after the fix. No actionable P0/P1/P2 visual issues remained.
4. The mobile-enhancement iteration preserved the approved header, typography, palette, and CTA hierarchy; replaced generic hero imagery with authentic inbound/outbound screens; expanded the journey from four to eight controls; and introduced mobile snap cards to keep the longer workflow scannable. Post-change desktop, English mobile, Arabic mobile, inbound, and outbound states were recaptured. No actionable P0/P1/P2 issues remained.
5. The privacy/design iteration replaced those operational captures with four purpose-built hypothetical assets, added coordinated light/dark slide styling, a bilingual theme switch, visible fictional-data labeling, and responsive slide metadata. Desktop light, desktop dark, and mobile dark states were compared directly with their generated source assets. No actionable P0/P1/P2 issues remain.

**Follow-up polish**

- P3 only: future iterations may add dedicated captures for allocation, picking, and dispatch-detail screens as those views receive production-safe visual curation.

final result: passed
