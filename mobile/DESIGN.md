# Blu — design system

The living reference for how the app looks and moves. Update it in the same change as any design
decision, so the reasoning survives. Source mockups: `.superpowers/brainstorm/4170-1790006514/content/`
(`app-screens.html`, `component-sheet-v2.html`, `weather-sky.html`, `rain-window.html`).

## Principles

1. **The sky is the surface.** A live Skia sky (real sun position, live weather) is the background
   of everything. Content sits on it; it is not boxed off from it.
2. **Glass is the only material.** Anything that floats (bar, sheets, toast, cards that ask for an
   answer) is glass. Nothing else gets a container.
3. **The headline is what's next,** never a greeting.
4. **One accent, used for meaning.** `#82a9ff` marks what is live or tappable: countdowns, times,
   the primary chip, links. Red means overdue or destructive. Nothing else is coloured.
5. **Motion explains.** Things spring when pressed, fade in when they arrive, and the orb spins
   faster while Blu thinks. No decorative looping except the sky and the orb.
6. **Look from the mockups, structure from iOS.** Glass, bold Helvetica and the element kit come
   from the mockups; sheet titles with Done, grouped settings and checkmark choices follow iOS.

## Decisions (newest first)

| Date | Decision | Why |
|---|---|---|
| 2026-09-22 | **Home-screen widget: A2 "Orb and next"** (4×2), chosen from the widget mockups. The orb opens Blu's input (`blu://assistant`); the text opens Now (`blu://now`). Still orb frame from the app's shader; countdown shown only when ≥ 2 h away. | The user's pick. Widgets redraw at most every 30 minutes, so a near countdown would be stale; the app pushes an update on every refresh. |
| 2026-09-22 | **Voice notes, WhatsApp-style.** The bar's right button is a mic (home and chat); with text typed it becomes send. Recording shows the mockup's Voice panel: live waveform from the mic level, timer, Cancel, white Stop. Blu replies in text — no speech synthesis. | Voice was a key part of the WhatsApp experience; the mic in the mockups never reached the app. |
| 2026-09-22 | **"Todo added" replies offer Tonight 9pm / Tomorrow 8am chips** when no reminder was set. | Parity with WhatsApp's "Want a reminder for this?" follow-up. The server now also reads times from the message itself. |
| 2026-09-22 | **Sheets are opaque** (`#0a1024` under the glass). | At 94% the Now screen's big headline showed through and competed with the sheet. |
| 2026-09-22 | Chat's empty state renders **outside** the inverted list. | Android flips an inverted list's empty component on both axes, which mirrored the text. |
| 2026-09-22 | **Orb replaces the gear.** Blu's orb (shader port of the GradientOrb reference) sits top-right: tap to talk, long-press for Settings; tapping the date line also opens Settings. The orb is also the empty state and the "thinking" indicator. | The glass gear circle "looked very off". One living symbol for Blu is better than a utility button. |
| 2026-09-22 | **With no event, the top todo is the headline** ("Next up"). | Otherwise the top half of the screen is empty and the most important todo sits in a list. |
| 2026-09-22 | **"From Blu" shows only proactive messages** (briefs, nudges, reminders), never replies to your own messages. | A reply repeats what you just did ("Todo added: …"), which the list already shows. |
| 2026-09-22 | Swipe strips have **no padding and zero width at rest**. | Padding gave them a minimum width, so green/amber bars showed permanently. |
| 2026-09-22 | Back to the mockups' glass and motion, keeping iOS structure. | A pure iOS pass lost the character; the user preferred the mockups' look with iOS layout discipline. |
| 2026-09-22 | **Glass is drawn, never blurred** (gradient + rim + top edge). | Android's blur samples the element's own children and smears a halo around text and buttons. |
| 2026-09-22 | Night keyframes sit on navy `#050d2c`, clouds catch a faint city glow. | Pure black lost the "Blu" identity and hid clouds entirely. |
| 2026-09-21 | Helvetica (TeX Gyre Heros) everywhere, bold for primary lines. No monospace. | Inter + mono read as AI-generated. Heros has only Regular and Bold. |
| 2026-09-21 | No tab bar: one Now screen, an assistant bar, and sheets. | The app has one job — what's next — and everything else is a detail of it. |

## Tokens (`theme.js`)

- **Colour** — `accent #82a9ff`, `ink #07122e` (text on accent/white), `red #ff9b9b`;
  labels at 100% / 66% / 40% white; hairline `rgba(255,255,255,.13)`.
  Swipe reveals are muted: Done `#1d6b4a`/`#c9f5dd`, Later `#6b4c1d`/`#f5e3c9`.
- **Glass** — gradient `rgba(255,255,255,.13) → .04`, rim `.17`, top edge `.32`, shadow
  `0 10 18 rgba(0,0,0,.45)`. Sheets add an opaque base `#0a1024` so the screen behind never shows through.
- **Type** (`T`) — hero 42 bold −1.5 (32 for long titles); title 22; headline 17 bold; body 16;
  sub 14; small 12; label 11 bold uppercase +1.3 tracking. Never add `fontWeight`.
- **Radius** — chip 14, card 18, sheet 30, capsules fully round.
- **Spring** — damping 18, stiffness 260, mass 0.8 (`SPRING`), used by every press and tick.

## Components

| Component | File | Notes |
|---|---|---|
| Sky | `sky/Sky.js` | Gradient keyed to sun elevation, glow at the sun's azimuth, stars, clouds, 3-depth rain, drops on the glass, cloud-only lightning. Top capped at `#0d2a6e`; nothing bright behind the top 45%. |
| Orb | `components/Orb.js`, `orbShader.js` | SkSL runtime shader. Palette `c0 #3d5cff`, `c1 #82a9ff`, `c2 #4cdbff`. Idle: slow spin; `thinking`: faster; `still` with reduced motion. Verified by rendering frames in CanvasKit (Node) before shipping. |
| Glass | `components/Glass.js` | The material. `base` adds an opaque-ish layer under it. |
| Press | `components/Press.js` | Pressable with a spring scale. Use for every button-like control. |
| Kit | `components/kit.js` | `Label`, `Chip` (default / accent / line / warn), `Rolling` (digits roll on change), `countdown()`, `Skeleton`, `ShinyButton` (sign-in only), `GlowInput`. |
| Structure | `components/ui.js` | `Group`, `Row`, `SectionHeader`, `Segmented`, `SheetHeader` (title + Done). |
| SwipeRow | `components/SwipeRow.js` | Tap circle → spring fill + tick; swipe right Done, left Later (snooze 1h). |
| Sheet | `components/Sheet.js` | Glass, inset 6px, springs up, drag/tap-outside/Back to close. |
| Toast | `components/Toast.js` | Glass capsule; accent bar drains over the 4s Undo window. |
| Widget | `widget/BluNowWidget.js`, `widget/widget.js` | react-native-android-widget. Headless task handler fetches with the stored key; last snapshot cached for offline. `nextUp.js` decides "next" for both the widget and Now. Preview image and orb frame are rendered from the real shader in CanvasKit. |
| VoicePanel | `components/VoicePanel.js` | `useVoiceNote()` owns the mic (expo-audio, AAC/m4a, metering on); the panel shows 32 level bars, timer, Cancel, Stop. Auto-stops at 3 minutes; under 0.7 s is ignored as a mis-tap. |

## Screens

- **Now** — date + weather (tap → Settings) and the orb; NEXT (event, else top todo) with rolling
  countdown; OPEN todos; Coming up; Worth remembering (glass card, Got it / Again); latest proactive
  message (tap to expand); suggestion chips when nothing is open (hidden while a toast shows).
- **Assistant** — mic when the box is empty (voice notes show as "Voice note · 0:07", then the transcript once heard); white bubbles for you; replies as cards with a glowing accent edge; proactive
  messages as dashed cards; Undo / Tell me more chips under the newest reply; quick questions above
  the input; the orb spins while Blu thinks; timestamps only after a 30-minute gap.
- **Library** — segmented Todos / Upcoming / Notes; upcoming grouped under day labels.
- **Item** — label, title, details, snooze chips, one accent action.
- **Settings** — grouped rows: sky location (checkmark), live weather, sky follows sun, reduce
  motion, test notification, sign out.
- **Sign in** — big "Blu", glowing input, ShinyButton.

## Don'ts

- No emoji, no icon fonts (icons are Skia paths in `Icon.js`), no monospace.
- No uniformly boxed cards; only things that ask for an answer get glass.
- No `BlurView` over in-page content (halo artefact).
- No full-screen flashes; lightning only lights clouds and is off with reduced motion.
- No second filled accent control in the same view.

## Open

- More widgets from the mockups (B quick capture, C todos) if wanted — same library, JS-only once the native build is in.
- Image upload in the assistant (the server route exists and now accepts large bodies).
