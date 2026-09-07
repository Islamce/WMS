# WMS Landing Page — Design QA

- Source visual truth: `docs/uat/2026-09-07/wms-landing-page/source-r4c-desktop-hero.png` and `source-r4c-mobile-hero.png`
- Implementation evidence: the original landing captures plus `implementation-desktop-inbound-enhanced.png`, `implementation-mobile-hero-enhanced.png`, `implementation-mobile-inbound.png`, `implementation-mobile-outbound.png`, and `implementation-mobile-workflow-arabic.png` in the same evidence directory. Production-safe source captures used by the page are `public/img/landing/wms-inbound-operation.png` and `wms-outbound-operation.png`.
- Desktop comparison: 1425 × 860 pixels, 1440 × 900 requested CSS viewport, device scale factor 1, English and Arabic hero states
- Mobile comparison: 375 × 811 pixels, 390 × 844 requested CSS viewport, device scale factor 1, English and Arabic hero states
- State: public unauthenticated landing page at `/`; login remains at `#/login`

**Findings**

- No actionable P0, P1, or P2 visual differences remain.
- Typography preserves the source hierarchy, optical weight, line height, and responsive wrapping while replacing the R4C commercial narrative with WMS warehouse language.
- Spacing and layout preserve the source header, two-column desktop hero, stacked mobile hero, demo stage, audience grid, and final call-to-action rhythm. The expanded eight-step journey uses a 4 × 2 desktop grid and touch-friendly horizontal snap cards on mobile, avoiding an excessively long single-column presentation.
- Colors map the source blue/cyan system to WMS's existing light-theme tokens: navy `#102637`, operational teal `#168f98`, and mist `#edf4f8`.
- Image quality uses real, production-safe WMS captures of inbound quality control and outbound goods-issue processing. No secrets or personal customer data appear; the screens use the repository's existing demo/UAT records. Hero crops and demo frames remain sharp and intentional at desktop and mobile sizes.
- Copy is WMS-specific in both English and Arabic and now covers eight connected controls: request, approval/reservation, receipt/identity, quality release, allocation, picking, goods issue/dispatch, and count/audit.

**Focused comparison evidence**

- `implementation-desktop-demo.png` confirms readable tab labels, product screenshot treatment, annotation hierarchy, border radius, and panel spacing.
- `implementation-desktop-inbound-enhanced.png` confirms the authentic inbound capture, five-tab hierarchy, annotation treatment, and readable desktop framing.
- `implementation-mobile-hero-enhanced.png` confirms the original mobile hierarchy is retained while authentic operational screens replace the earlier generic concept imagery.
- `implementation-mobile-inbound.png` and `implementation-mobile-outbound.png` confirm both new product captures remain legible and correctly annotated at 390 × 844.
- `implementation-mobile-workflow-arabic.png` confirms the eight-step horizontal workflow treatment, Arabic RTL ordering, touch-card sizing, and zero document overflow.

**Interaction and accessibility checks**

- English ↔ Arabic updates page copy, `lang`, and `dir` correctly.
- All five demo tabs update `aria-selected`, the image, and annotations; inbound and outbound tabs were explicitly exercised.
- Solution, Workflow, and Demo controls scroll without changing the SPA hash route.
- Sign-in actions route to `#/login` and render the existing login form.
- Browser console errors: 0.
- Mobile document overflow: 0 pixels.

**Comparison history**

1. Initial implementation matched the visual source but used fragment anchors for section navigation. WMS's hash router interpreted those fragments as application routes and rendered login.
2. Replaced fragment links with accessible in-page scroll buttons, reloaded the page, and re-tested Demo, Workflow, demo tabs, language switching, and Sign in. All passed without console errors.
3. Recaptured desktop and mobile evidence after the fix. No actionable P0/P1/P2 visual issues remained.
4. The mobile-enhancement iteration preserved the approved header, typography, palette, and CTA hierarchy; replaced generic hero imagery with authentic inbound/outbound screens; expanded the journey from four to eight controls; and introduced mobile snap cards to keep the longer workflow scannable. Post-change desktop, English mobile, Arabic mobile, inbound, and outbound states were recaptured. No actionable P0/P1/P2 issues remained.

**Follow-up polish**

- P3 only: future iterations may add dedicated captures for allocation, picking, and dispatch-detail screens as those views receive production-safe visual curation.

final result: passed
