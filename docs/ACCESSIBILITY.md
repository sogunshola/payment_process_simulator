# Accessibility

What was checked in the frontend, the measured numbers, and what is still open. Paths are relative to `frontend/`.

## Colour contrast

`src/test/contrast.test.ts` parses the hex and `rgb(... / alpha)` tokens from `src/index.css`, composites translucent colours over the page background, and asserts WCAG 2.x ratios: 4.5:1 for text, 3:1 for non-text indicators. It fails if a token is edited into a bad value. Measured values (page = `--color-bg` #08090b; badge = `--color-surface` composited over the page; raised = `--color-surface-strong` #12141a, used by dialogs):

| Pair | On badge / card | On page | On raised surface | Needed |
| --- | --- | --- | --- | --- |
| status-pending #f5b942 (text and dot) | 10.55 | 11.29 | 10.43 | 4.5 text, 3 dot |
| status-processing #5aa9ff | 7.58 | 8.11 | 7.50 | same |
| status-succeeded #3ddc84 | 10.43 | 11.16 | 10.32 | same |
| status-failed #ff5d6c | 6.23 | 6.67 | 6.17 | same |
| status-cancelled #8a93a3 | 6.01 | 6.43 | 5.95 | same |
| muted text #9aa3b2 | 7.32 | 7.83 | 7.24 | 4.5 |
| body text #eceff4 | n/a | 17.28 | 15.97 | 4.5 |
| accent #3dffc2 (links, focus ring) | n/a | 15.44 | 14.27 | 4.5 text, 3 indicator |
| accent-ink on accent (primary button) | 14.75 | | | 4.5 |
| accent-ink on status-failed (danger button) | 6.37 | | | 4.5 |
| control-border #5f6877 (input and select outline) | n/a | 3.54 | 3.27 | 3 |

No status token failed, so none was changed. One token was added: form controls used the hairline `--color-line`, which is about 1.2:1 and fails 1.4.11 (non-text contrast) for the edge of an input; they now use `--color-control-border`.

## Keyboard map

| Where | Keys |
| --- | --- |
| Any page | Tab to the "Skip to content" link first; Tab / Shift+Tab move through nav, Settings, page controls |
| Modal, Drawer, Settings, New payment, Incident Report | Focus moves into the dialog on open; Tab and Shift+Tab wrap inside it (and pull focus back in if it escaped); Escape closes; focus returns to the opener, or to `<main>` if the opener no longer exists |
| New payment form | Enter submits; submit is disabled while the request is pending |
| Arena | Start, Pause/Resume, Reset, Auto-demo and the three powers are real buttons (Enter or Space). Powers use `aria-disabled` (not `disabled`) so they stay in the tab order; their accessible name includes the state, e.g. "Failover, cooling down 12 seconds", "Failover, ready", "Failover, available during a run". The engineer log is focusable so it can be scrolled with arrow keys |

Every interactive element gets the global `:focus-visible` ring (2px accent, 2px offset) from `src/index.css`; no component removes it.

## Screen reader notes

- The Arena canvas is `role="img"` with an `aria-label` that includes the live vault and failed counts. The engineer log (`aria-live="polite"`) is the text alternative for events.
- The backend-unreachable banner is `role="alert"` and only exists while the problem does, so it is announced once on appearance, not on every 5 s poll. The 401 hint is `role="status"`.
- Status is never colour only: every badge has a text label; dots are `aria-hidden`.
- Reduced motion is honoured by framer-motion (`MotionConfig reducedMotion="user"`), the CSS pulse animations and the canvas renderer.

## Known gaps

- Not tested with a real screen reader (VoiceOver, NVDA); the roles and names above come from reading the code and from Testing Library queries.
- Automated checks cover dialog focus (Modal only; Drawer and Settings share `use-dialog.ts` but have no test of their own) and contrast tokens, not rendered pixels. Contrast of the Arena canvas drawing and of the translucent card over the grid background is not measured.
- Secondary and ghost button edges use the low-contrast hairline; the text label identifies them, but their boundary is under 3:1.
- Focus ring visibility was not verified by automated screenshot.
- The Arena is a timed game; there is no way to slow the rounds down for users who need more time (WCAG 2.2.1). Pause is available.
- Phone DOM order differs from visual order in the top bar (links wrap under the controls).
