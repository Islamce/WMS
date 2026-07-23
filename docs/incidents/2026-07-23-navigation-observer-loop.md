# Navigation observer loop incident

## Symptom
Production loaded a blank page or Chrome reported **Page Unresponsive** immediately after login, including on the forced-password and Home routes. The API and `/healthz` remained healthy.

## Root cause
`public/js/navigation-v2.js` observes the entire `#app` subtree. Its callback always called `applyShellIdentity()`, which unconditionally reassigned `textContent` on the brand elements. Each assignment generated another mutation, recursively scheduling the observer and saturating the browser main thread.

## Resolution
Brand text, mark text, navigation labels, titles, and the root class are now changed only when their desired value differs from the current value. This makes the observer callback idempotent and stops self-generated mutation cycles.

## Prevention
A focused source guard test verifies that the identity mutations remain conditional. Production UAT must confirm login, forced-password completion, Home, and navigation remain responsive.
