# Agent Port Design Guide

## Purpose

Agent Port is a private, production-like browser UI for controlling local Codex CLI sessions on a MacBook through Tailscale. It should feel like dense operational software: quiet, precise, responsive, and built for repeated use.

The browser session controls a separate local Codex CLI process spawned in a whitelisted repo. It does not share conversation context, active skills, or memory with the Codex Desktop app thread. UI copy should make that boundary clear anywhere the user might confuse the two contexts.

## Product Principles

- Prefer operational density over decorative presentation. Do not build marketing-style sections, hero layouts, oversized cards, gradients, or ornamental visuals.
- Keep session identity visible: selected repo, branch, terminal status, task status, and control mode should be easy to find.
- Treat the task/chat composer as the preferred managed workflow. Treat the terminal as an escape hatch for direct Codex CLI interaction.
- Keep git surfaces read-only unless there is an explicit product decision to add write operations.
- Use repo keys in browser-facing flows. Do not expose or ask for raw repo paths in UI.
- Make stopped, archived, waiting, busy, and error states explicit. Avoid silent failure.
- Design for private local use behind app password auth and Tailscale, not for public SaaS onboarding.

## UI Workflow For Agents

Before implementing UI changes:

1. Read `AGENTS.md` and this file.
2. Inspect the current components and styles under `web/src`.
3. Produce a short plan.
4. Provide a plain-text mockup showing desktop/mobile layout when relevant, key labels, states, and interactions.
5. Wait for explicit user confirmation before editing files.

For validation, use Bun only:

```sh
bun run typecheck
bun run test
bun run build
```

For meaningful visual or responsive changes, run the app and verify the affected UI in a browser when practical.

## Layout Model

### Desktop

Desktop uses a fixed app shell with a top bar and three primary columns:

```text
+------------------------------------------------------------------------------+
| Agent Port | Repository | branch | terminal status | task status | actions    |
+---------------+----------------------------------------------+---------------+
| Sidebar       | Chat workspace                               | Inspector     |
|               |                                              |               |
| Repository    | Chat header: title, repo, branch, statuses   | Console tab   |
| New Chat      | System context note                          | Changes tab   |
| Sessions      | Message thread                               |               |
| Active/History| Composer / waiting-for-user composer         | Terminal/diff |
+---------------+----------------------------------------------+---------------+
```

Current proportions:

- Sidebar: about `290px`.
- Inspector: about `360px` to `430px`.
- Chat workspace: remaining width.
- Top bar: about `56px` tall.

Preserve this mental model unless the task explicitly changes navigation.

### Mobile

Mobile switches to one active panel at a time with bottom navigation:

```text
+------------------------------+
| Agent Port            actions|
+------------------------------+
| Active panel                 |
|                              |
| Sessions / Chat / Console /  |
| Changes                      |
+------------------------------+
| Sessions | Chat | Console |  |
| Changes                      |
+------------------------------+
```

Rules:

- Console remains a first-class mobile view.
- Controls must be touch-friendly on iPhone Safari.
- Use safe-area padding for bottom navigation.
- Avoid layouts that require horizontal page scrolling.
- Long file paths, branch names, and session titles must truncate or wrap intentionally.

## Visual System

### Color

Use the CSS custom properties in `web/src/styles.css`. Do not hard-code new colors unless adding a deliberate token.

Core token groups:

- App and surfaces: `--color-bg-app`, `--color-workspace-bg`, `--color-bg-panel`, `--color-bg-surface`, `--color-bg-subtle`.
- Text: `--color-text`, `--color-text-soft`, `--color-muted`, `--color-muted-strong`.
- Borders: `--color-border`, `--color-border-soft`, `--color-border-strong`, `--color-input-border`.
- Primary action: `--color-primary`, `--color-primary-strong`, `--color-primary-soft`, `--color-primary-softer`, `--color-primary-border`, `--color-on-primary`.
- Status and risk: warning, danger, info, connected, terminal, and markdown code tokens.

The existing palette is neutral with green as the primary operational accent. Keep new UI within that palette. Avoid one-off purple, blue-gradient, beige, orange, or decorative themes.

### Theme

Light, dark, and system display modes are supported. New UI must work in both resolved themes by using tokens instead of literal colors.

Use `color-scheme`, current CSS variables, and focus rings consistently. Do not introduce theme-specific class branches unless variables cannot express the state.

### Typography

Base font:

```css
Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
```

Monospace surfaces use:

```css
Menlo, Monaco, "SFMono-Regular", Consolas, monospace
```

Guidelines:

- Keep app chrome compact: labels and metadata are usually `11px` to `13px`.
- Main chat content uses about `16px` with readable line height.
- Panel headings use uppercase, `12px`, bold text with normal letter spacing.
- Do not use viewport-scaled font sizes.
- Keep letter spacing at `0`.

### Spacing, Radius, And Elevation

- Standard small gap: `6px` to `10px`.
- Standard panel gap/padding: `12px` to `14px`.
- Chat content has more air: about `24px` to `28px` on desktop.
- Most UI rectangles use `8px` radius.
- Composer and picker popovers may use larger rounded shapes because that is an established pattern.
- Do not nest visual cards inside visual cards.
- Shadows are reserved for elevated login panels, popovers, and composer emphasis. Use `--shadow-elevated`, `--shadow-soft`, and `--shadow-bubble`.

### Icons

Use `lucide-react` icons, matching current components. Prefer recognizable icon buttons for common actions: refresh, close, logout, archive, delete, console, changes, attach, send, stop, display mode.

Icon-only buttons must have `title` and accessible labels when the action is not obvious from visible text.

## Component Patterns

### Login

Login is a centered, compact panel:

- Lock icon.
- `Agent Port` heading.
- Short private-local-access description.
- `App password` input.
- Error banner for missing `APP_PASSWORD` or failed login.
- Primary submit button.

Keep this surface plain and security-oriented.

### Top Bar

Top bar communicates global context and actions:

- Product name.
- Selected repo label.
- Branch chip when available.
- Terminal status badge.
- Task status badge.
- Control mode chip.
- Notifications, display mode, refresh, close session, logout.

On mobile, collapse title/status details and keep action buttons compact.

### Sidebar

Sidebar order:

1. Repository switcher.
2. `New Chat` action.
3. Sessions heading.
4. Active/History segmented toggle.
5. Session list or empty state.

Session rows show title, terminal status, task status, and archived state. Archive/delete actions only appear when allowed by lifecycle state.

### Chat Workspace

The chat workspace has:

- Header with session title, repo/branch metadata, status badges, and console shortcut.
- System note explaining the separate local Codex CLI context.
- Message thread.
- Composer or waiting-for-user composer.

User messages use right-aligned bubbles. Assistant messages are unframed markdown with optional collapsible activity. This distinction should remain clear.

Default empty states:

- No selected session: explain that the user must create a chat in a selected whitelisted repo.
- Empty active session: indicate readiness in the selected repo.

### Composer

The composer is the main managed work surface.

Expected controls:

- Attachment button.
- Permission mode picker.
- Plan mode toggle.
- Model/reasoning picker.
- Send button.
- Stop button while Codex is working.
- Busy indicator while a turn is running.
- Attachment tray for uploaded/pending/error files.

Rules:

- Disable sending while uploads are pending, attachments have errors, no sendable content exists, the session is archived, or Codex is already busy.
- Preserve `Cmd+Enter` send behavior.
- Keep placeholder copy state-aware: no session, archived, waiting for user, busy, first prompt, or follow-up.
- Plan mode copy should clarify that Codex will propose a plan and wait for confirmation before edits.

### Waiting For User

`WAITING_FOR_USER` applies to managed sessions/tasks. The waiting composer should be visually distinct with warning styling and should include:

- `Waiting for user` eyebrow.
- Confirmation title.
- The question/request from Codex.
- `Confirm plan`.
- `Request changes`.
- Stop action.
- Context copy that the confirmation is sent only to this browser-controlled local CLI session.

### Terminal

The terminal is a live Codex CLI console, not a general-purpose shell.

Terminal UI uses a dark terminal shell in both app themes. Keep:

- Compact toolbar.
- Connection/status dot.
- Command buttons only for product-approved Codex controls.
- xterm area with stable height.

Do not add arbitrary shell command execution controls.

### Inspector

Desktop inspector uses two tabs:

- `Console`.
- `Changes`.

Mobile exposes the same surfaces through bottom tabs. Avoid introducing desktop-only capabilities without mobile access unless the task explicitly permits it.

### Changes Panel

Changes is a read-only git status and diff surface:

- Branch label.
- Refresh action.
- `All changes` summary row.
- Per-file rows with status marker, file name, directory, additions, deletions.
- Warning banner for non-repository/error state.
- Optional file preview.
- Diff viewer.

Do not add commit, push, checkout, reset, or destructive git actions without an explicit product decision.

### File Preview

File preview appears as an inline panel, not a modal:

- Header with file icon, name, path, and close button.
- Loading state with spinner.
- Error state with danger styling.
- Ready state as monospace code.

Path text can be long; truncate in headers and allow code content to scroll.

### Notifications And Popovers

Popovers are elevated, compact, and anchored to their trigger. They should:

- Close on outside click and Escape when interactive.
- Fit within mobile viewport.
- Use clear headings and short explanatory copy.
- Avoid blocking core chat/terminal work.

## Status Language

Terminal status and task status are separate. Do not collapse them into one generic state.

Terminal stopped states:

- `DISCONNECTED`
- `CLOSED`
- `ERROR`

Task states include:

- `IDLE`
- `CREATED`
- `RUNNING`
- `WAITING_FOR_USER`
- `COMPLETED`
- `FAILED`
- `CANCELLED`

Use badges for these states. Keep labels uppercase or normalized consistently with existing components.

## Copy Rules

- Be direct and operational.
- Prefer verbs on buttons: `New Chat`, `Refresh`, `Confirm plan`, `Request changes`, `Send changes`.
- Avoid marketing copy, tutorials, or visible instructions that describe obvious UI mechanics.
- Use `chat` for the managed browser workflow and `console` for the terminal surface.
- Use `session` when discussing the underlying Codex CLI process/lifecycle.
- Mention the context boundary where it matters: the browser chat controls a separate local Codex CLI session and does not share context with Codex Desktop.
- Never document real secrets. Refer to `APP_PASSWORD` by name only.
- Do not expose raw local repo paths in UI copy; show repo labels, repo keys, branch names, and file paths inside the whitelisted repo context.

## Accessibility And Interaction

- All buttons must be keyboard reachable.
- Icon-only buttons need `title` and accessible labels where appropriate.
- Use `aria-pressed`, `aria-expanded`, `aria-haspopup`, and menu roles for toggles/pickers as in existing components.
- Maintain visible focus states with tokenized focus rings.
- Disabled controls should remain understandable through nearby state text or context.
- Do not rely on color alone for important status; pair color with text, icon, or badge label.

## Responsive Rules

- Break to mobile behavior around the existing `940px` breakpoint unless a task has a specific reason to change it.
- Add extra small-screen handling around `420px` only for tight topbar/action cases.
- Mobile panels should use `min-height: 0`, internal scrolling, and stable bottom tabs.
- Chat composer controls must not overflow on narrow screens.
- Status badges may collapse visually in tight mobile headers, but the full status should remain available through title/ARIA labels.

## Implementation Rules

- Frontend code lives under `web/src`.
- Keep API calls in `web/src/api`.
- Keep layout, session, task, terminal, git, and chat components separated.
- Prefer extending existing CSS classes and variables before creating a new styling system.
- Use structured React state and typed API models. Do not parse UI state from display text.
- Do not add new package managers or lockfiles.
- Use Bun commands only.

## UI Task Checklist

Before editing:

- Read `AGENTS.md` and `DESIGN.md`.
- Identify affected desktop and mobile surfaces.
- Prepare a short plan.
- Provide a text mockup.
- Get explicit confirmation.

During implementation:

- Use existing tokens, components, and layout patterns.
- Keep repo/session/task context visible.
- Preserve the Codex Desktop vs browser CLI boundary in copy where relevant.
- Keep terminal and git safety boundaries intact.
- Check empty, loading, busy, waiting, error, archived, and narrow-mobile states.

Before finishing:

- Run relevant Bun validation for code changes.
- For UI changes, verify in a browser when practical.
- Summarize changed files and any validation not run.
