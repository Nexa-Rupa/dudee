---
name: dude
description: Your AI staff, issued as credentials. The local web app is the badge board.
colors:
  credential-ground: "#eef1f5"
  badge-stock: "#ffffff"
  sunk-stock: "#e4e8ee"
  hairline: "#d9dee7"
  hairline-strong: "#c3cad6"
  ink: "#14161b"
  ink-hover: "#20242c"
  ink-raised: "#2a2e38"
  muted-text: "#545b69"
  faint-text: "#6a7282"
  rail-text: "#b9c0cc"
  rail-label: "#8f97a6"
  needs-amber: "#f2b33d"
  needs-amber-light: "#f6c766"
  needs-amber-soft: "#fdf1d6"
  needs-amber-text: "#7a4f00"
  ok-green: "#0b7a55"
  ok-green-soft: "#dcf1e7"
  live-dot: "#3ccf8e"
  danger-red: "#b4231f"
  danger-red-soft: "#fbeceb"
  role-marketing: "#c8402b"
  role-content: "#5b3ac0"
  role-calls: "#0b7a55"
  role-research: "#2459c4"
  role-umber: "#8a4b0f"
  role-teal: "#0f6e7a"
  role-plum: "#a0306e"
  role-slate: "#3f4a5c"
typography:
  display:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.025em"
    fontVariation: "'wdth' 112"
  headline:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.025em"
    fontVariation: "'wdth' 112"
  badge-name:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.025em"
    fontVariation: "'wdth' 118"
  title:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 750
    lineHeight: 1.5
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 108"
  body:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  ui:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.5
  band-label:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "0.07em"
  numeral:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 700
    fontFeature: "'tnum' 1"
  mono:
    fontFamily: "ui-monospace, Cascadia Code, Menlo, Consolas, monospace"
    fontSize: "12.5px"
    fontWeight: 400
rounded:
  mark: "3px"
  kbd: "4px"
  row: "8px"
  control: "9px"
  avatar: "10px"
  slip: "12px"
  badge: "14px"
  panel: "16px"
  pill: "999px"
spacing:
  hair: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  gutter: "28px"
  section: "34px"
  page-x: "40px"
  page-bottom: "64px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.badge-stock}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    padding: "0 15px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.ink-raised}"
  button-secondary:
    backgroundColor: "{colors.badge-stock}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 15px"
    height: "38px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.muted-text}"
    rounded: "{rounded.control}"
    padding: "0 15px"
    height: "38px"
  button-quiet-hover:
    backgroundColor: "{colors.sunk-stock}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.badge-stock}"
    textColor: "{colors.danger-red}"
    rounded: "{rounded.control}"
  button-danger-hover:
    backgroundColor: "{colors.danger-red-soft}"
  button-small:
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "30px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.muted-text}"
    rounded: "{rounded.control}"
    size: "36px"
  send-button:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.badge-stock}"
    rounded: "{rounded.avatar}"
    size: "38px"
  input-field:
    backgroundColor: "{colors.badge-stock}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "40px"
  badge-card:
    backgroundColor: "{colors.badge-stock}"
    rounded: "{rounded.badge}"
  badge-band:
    backgroundColor: "{colors.role-slate}"
    textColor: "{colors.badge-stock}"
    typography: "{typography.band-label}"
    padding: "10px 16px"
  strip-working:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.badge-stock}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  strip-needs:
    backgroundColor: "{colors.needs-amber}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  strip-idle:
    backgroundColor: "transparent"
    textColor: "{colors.muted-text}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  strip-tag:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.needs-amber}"
    padding: "2px 8px"
  slip:
    backgroundColor: "{colors.badge-stock}"
    rounded: "{rounded.slip}"
  slip-head:
    backgroundColor: "{colors.role-slate}"
    textColor: "{colors.badge-stock}"
    padding: "8px 12px"
  count:
    backgroundColor: "{colors.needs-amber}"
    textColor: "{colors.ink}"
    typography: "{typography.numeral}"
    rounded: "{rounded.pill}"
    height: "22px"
  rail-item:
    backgroundColor: "transparent"
    textColor: "{colors.rail-text}"
    rounded: "{rounded.row}"
    padding: "8px 10px"
  rail-item-hover:
    backgroundColor: "{colors.ink-hover}"
    textColor: "{colors.badge-stock}"
  rail-item-active:
    backgroundColor: "{colors.ink-raised}"
    textColor: "{colors.badge-stock}"
  tab:
    textColor: "{colors.muted-text}"
    padding: "8px 10px 10px"
  tab-selected:
    textColor: "{colors.ink}"
  chip:
    backgroundColor: "{colors.credential-ground}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  chip-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.badge-stock}"
  pill:
    backgroundColor: "{colors.sunk-stock}"
    textColor: "{colors.muted-text}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  pill-ok:
    backgroundColor: "{colors.ok-green-soft}"
    textColor: "{colors.ok-green}"
  pill-local:
    backgroundColor: "{colors.needs-amber-soft}"
    textColor: "{colors.needs-amber-text}"
  user-bubble:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.badge-stock}"
    padding: "10px 15px"
  composer:
    backgroundColor: "{colors.badge-stock}"
    rounded: "{rounded.badge}"
    padding: "8px 8px 8px 16px"
---

# Design System: dude

## Overview

**Creative North Star: "The Badge Board"**

Every AI employee is issued a credential: a white badge with a flat role-colour band printed across the top, a heavy wide name, an employee number, and a live status strip along the bottom. The app is the board those badges hang on. Credential-stock grey is the wall, white is the badge stock, the left rail is solid ink, and the only loud colour that is not a role is needs-you amber, which appears as hard diagonal hazard stripes wherever the owner is wanted.

The system is light by design: owners check in on their staff at a desk, by day. Density is moderate and scannable, built for a glance that answers three questions: who is working, what needs me, what got done. Numbers are part of the material, not decoration: employees are EMP-001, EMP-002 in hiring order; deliverables are D-001 onward; every count, time and duration is set in tabular figures and right-aligned so columns read like a time card.

The world explicitly rejects the neutral sidebar-of-agents chat app with a single accent colour. Colour here is committed and flat, one hue per role, and state is shown by form as well as colour.

**Key Characteristics:**
- Flat, committed role bands carrying white text, never tinted or graded
- State by form: solid working, striped needs-you, outline idle
- Archivo variable, wide and heavy for names and headings, normal width for UI
- Sequential employee and deliverable numbers in tabular figures
- Ink rail, credential-grey ground, white badge stock, soft ambient lift on badges
- Destructive or declining actions set apart, at the far end of the action row

## Colors

A cool, paper-like neutral ground and ink, with flat saturated role colours and one hazard amber that means "you".

### Primary
- **Rail Ink** (`ink`): the left rail, primary buttons, the working status strip, the owner's chat bubble, code blocks, focus outlines and active chips. Ink is the app's voice; the primary action is always ink, never a role colour.

### Secondary
- **Needs-You Amber** (`needs-amber`, with `needs-amber-light` as the second stripe colour): the needs-you count, the hazard stripes on needs-you marks and strips, the highlighted "N need you" in the board meta line, the rail's connect-a-model warning, the current step number in first-run setup, the disconnected dot, and text selection. `needs-amber-soft` backs waiting work chips and warning notes; `needs-amber-text` is the readable amber-family text on that soft fill.

### Tertiary
- **Role Bands**: one flat colour per role pack. Marketing coral-red (`role-marketing`), content violet (`role-content`), calls green (`role-calls`), research blue (`role-research`). Packs without an assigned colour hash into umber, teal, plum or slate (`role-umber`, `role-teal`, `role-plum`, `role-slate`); slate is also the fallback. Each is applied through a single `--role` custom property set on the element that belongs to that employee, and drives the badge band, monogram avatar, rail swatch, slip header, chat header band, step-duration bar, live work-chip border and the ledger's name column. Every role colour carries white text at 4.5:1 or better.

### Neutral
- **Credential Ground** (`credential-ground`): the page wall behind badges; also the hover fill for rows on white panels.
- **Badge Stock** (`badge-stock`): badges, slips, side panels, inputs, the composer.
- **Sunk Stock** (`sunk-stock`): quiet-button hover, neutral pills and tags, empty step-bar tracks, disabled send.
- **Hairline** / **Hairline Strong** (`hairline`, `hairline-strong`): 1px panel dividers and ruled lists; strong for secondary button borders, the composer and dashed intro outlines.
- **Muted Text** (`muted-text`): secondary copy, meta lines, idle labels.
- **Faint Text** (`faint-text`): tertiary numerals and timestamps on white badge stock only.
- **Rail Text** / **Rail Label** (`rail-text`, `rail-label`): resting nav text and section labels on ink. `ink-hover` and `ink-raised` are the rail's hover and current-item fills.
- **Status**: `ok-green` (working mark, connected provider dot, done steps), `live-dot` (server connection on ink), `danger-red` (failed steps, errors, destructive settings actions) with `danger-red-soft` hover.

### Named Rules
**The Amber Means You Rule.** Amber appears only where the owner is wanted or where the owner currently is. It is never decoration and never a role colour.

**The Flat Band Rule.** Role colours are applied as flat fills only, always with white text. No tints, no gradients, no role-coloured body text except the ledger's name column at 650 weight.

**The One Role Variable Rule.** An employee's colour reaches every element through one `--role` property set on that employee's container; components never hard-code a role hex.

## Typography

**Display Font:** Archivo Variable (with ui-sans-serif, system-ui)
**Body Font:** Archivo Variable at normal width
**Label/Mono Font:** ui-monospace, Cascadia Code, Menlo, Consolas for skill slugs, model ids, slash commands and code

**Character:** One grotesque family pulled across its width axis: names and headings stretch wide (108 to 125%) and heavy (750 to 850), like a name printed on a lanyard card; everything operational stays at normal width so lists and controls stay compact.

### Hierarchy
- **Logo** (850, 26px, wdth 125%, -0.04em, line-height 1): the lowercase "dude" wordmark only, white on the rail, ink on first-run.
- **Display** (800, 40px, wdth 112%): first-run step headings. Drops to 30px under 760px.
- **Headline** (800, 30px, wdth 112%, -0.025em): page titles (team board, hire, settings). 26px under 760px; 20px in the chat header.
- **Badge Name** (800, 24px, wdth 118%, -0.025em, line-height 1.1): employee names on badges; 28px on the issue preview.
- **Title** (750, 17px, wdth 108%): section headings (Needs you, Done today, Choose a role). Role-card bands use 750 at 16px, wdth 110%.
- **Body** (400, 15px, line-height 1.5): base copy; prose capped at 62ch to 70ch.
- **UI** (13.5px to 14.5px, 600 to 650 for emphasis): buttons (600, 14px), rail items (14.5px), strips, ledger rows, step lines.
- **Band Label** (700, 12px, +0.07em, uppercase): the role title and EMP number printed on a badge band, and the NEEDS YOU strip tag. Uppercase lives only here.
- **Meta** (12.5px to 13px, muted or faint): timestamps, roles under names, notes.

### Named Rules
**The Wide Name Rule.** Width and weight above 700 are reserved for names, page headings and the wordmark. Controls, lists and prose stay at normal width.

**The Time Card Rule.** Every number, count, time and duration uses tabular figures. Durations and times sit right-aligned at the row's end.

**The Printed Band Rule.** Uppercase tracking belongs to the credential band and the strip tag only. Never use it as a small label above a heading.

## Layout

A fixed three-zone board at desktop: a 252px ink rail, a fluid main column, and a white side column (380px on the board, 372px for an employee's details, 380px for the hiring issue panel). Main content scrolls inside its column with page padding of 34px top, 40px sides, 64px bottom. The badge grid auto-fills columns of at least 300px with a 20px gap; role cards auto-fill at 260px with 16px gaps. Chat content centres at 800px max width.

Spacing runs on a loose 4px rhythm: 4 and 8 inside controls, 12 to 16 inside cards, 20 between badges, 26 to 34 between page sections, 28 as the narrow-screen gutter.

Responsive steps, observed:
- **1280px**: board side column narrows to 320px, badges to 260px minimum, gutters to 28px.
- **1180px**: an employee's details panel becomes a fixed right drawer (min(380px, 92vw)); the hire layout narrows its issue panel to 320px.
- **1100px**: the board collapses to one column: heading, then Needs you slips, then badges, then Done today on a white band.
- **900px**: hiring stacks the issue panel under the role cards.
- **760px**: the rail becomes a horizontal ink bar (logo, nav, roster swatches, Hire) with labels, roles and model line hidden; badges, slips and role cards go single-column; gutters drop to 16px; step lines show only name and duration.

**The Needs-First Rule.** When the layout collapses, anything waiting on the owner moves directly under the page heading, ahead of the badges.

## Elevation & Depth

A hybrid: the ground is flat and the rail is flat, but badges, role cards, slips and the composer float on white stock with a soft two-layer ambient shadow, like cards pinned to a board. Interactive badges and role cards lift a few pixels on hover. Side panels and ruled lists rely on 1px hairlines instead of shadow.

### Shadow Vocabulary
- **Pinned** (`box-shadow: 0 1px 2px rgb(20 22 27 / 0.06), 0 6px 18px rgb(20 22 27 / 0.06)`): badges, role cards, slips, the issue panel, settings panels, composer.
- **Lifted** (`box-shadow: 0 2px 4px rgb(20 22 27 / 0.08), 0 14px 32px rgb(20 22 27 / 0.1)`): badge and role-card hover (with translateY -3px and -2px), the slash-command menu.
- **Drawer** (`box-shadow: -10px 0 40px rgb(20 22 27 / 0.18)`): the details drawer below 1180px.

### Named Rules
**The Pinned Card Rule.** Only things that represent a person or a request (badges, role cards, slips) and the composer carry shadow. Structure (panels, lists, tabs) is drawn with hairlines.

## Shapes

Softly rounded rectangles throughout, with radius growing with object size: 3px for status marks and swatches, 8px for rail and list rows, 9px for buttons, inputs, strips and code, 10px for monogram avatars and the send button, 12px for slips and panels, 14px for badges, role cards, the composer and the chat intro, 16px for the issue panel, and full pills for counts, chips, tags and pills. The idle status mark is the one circle among squares. Bands are clipped by their card's radius (overflow hidden), so the role colour reads as printed onto the badge. The owner's chat bubble tucks its bottom-right corner to 4px. The roster swatch is a 6 by 28px vertical bar. Dashed outlines mark things not yet issued: the rail's Hire item and the new-employee intro.

## Components

### Buttons
- **Shape:** gently rounded (9px), 38px tall, 15px sides, 600 weight at 14px, 7px icon gap.
- **Primary:** ink fill, white text; hover lifts to `ink-raised`. One per action row.
- **Secondary:** white stock with a strong hairline; hover darkens the border to ink.
- **Quiet:** no fill or border, muted text; hover fills with sunk stock. Used for Don't allow, Cancel and Let them decide, always pushed to the far end of the row with an auto left margin.
- **Danger:** red text with a red-mixed border, soft red hover; reserved for removing things in settings, set apart with 32px above.
- **Small:** 30px tall, 10px sides, 13px.
- **Press / Disabled:** press nudges down 1px; disabled drops to 45% opacity.
- **Icon button:** 36px square, transparent, muted icon, sunk hover. **Send:** 38px ink square at 10px radius; sunk with faint icon when disabled.

### Chips
- **Count:** amber pill, ink 700 tabular figures, 22px tall. Only ever counts things that need the owner.
- **Model chip:** monospace pill on ground with hairline border; ink border on hover; ink fill when chosen.
- **Pills and tags:** sunk-stock pills with muted text; green variant for connected, amber-soft for local.
- **Work chip:** white pill summarising an agent turn ("Working for 12s"); role-colour border while live, amber-soft fill with amber border while waiting on the owner.

### Cards / Containers
- **Corner Style:** 14px badges and role cards, 12px slips and panels, 16px issue panel.
- **Background:** badge stock on credential ground.
- **Shadow Strategy:** Pinned at rest, Lifted on hover (see Elevation).
- **Border:** none on badges and role cards; 1px hairline on slips, steps and side panels.
- **Internal Padding:** 16px sides; band 10px by 16px; badge body 18px 16px 16px.

### Inputs / Fields
- **Style:** white, 1.5px hairline border, 9px radius, 40px tall, 12px sides. Labels sit above at 13px, 650 weight.
- **Focus:** border turns ink, no glow. Elsewhere focus is a 2px ink outline at 2px offset (white on the rail). Role cards show the role colour as a 2px outline when selected and ink when keyboard-focused.
- **Composer:** 14px-radius white box with 1.5px strong border and Pinned shadow; border goes ink on focus-within; a `/` opens a skill menu above it with the Lifted shadow.

### Navigation
- **Rail:** solid ink column. Items are 8px-radius rows, `rail-text` at rest, `ink-hover` on hover, `ink-raised` with white text when current. Needs you carries the amber count, or a quiet tabular zero. The roster lists each employee with their role swatch, name (650, white), role (12.5px) and status mark. Hire sits at the bottom in a dashed outline. A monospace model id closes the rail.
- **Tabs:** text tabs on a hairline; selected tab is ink, 650 weight, with a 2px ink underline.
- **First-run steps:** pill steps on white; the current step is an ink pill with its number in an amber circle; done steps turn green with a check.

### Badge (signature)
White card, 14px radius, Pinned shadow. Across the top, the role band: flat role colour, white uppercase role title left, EMP number right. Body: 52px monogram avatar on the role colour beside the wide heavy name and a two-line role summary. Along the bottom, inset 12px, the status strip: ink and white while working with a live running time at the right; amber hazard stripes with an ink "NEEDS YOU" tag while waiting; a hairline outline with muted text when idle.

### Slip (approvals and questions)
A needs-you card in the side column. Role-coloured header with a Lucide icon, who, and the time; a striped needs mark leads it when it is an approval. Plain-language request at 650 weight, an "Exact request" disclosure that reveals the raw JSON in an ink code block, then Allow (primary), Always allow (secondary), and Don't allow (quiet, set apart). Questions swap the secondary for an answer textarea.

### Status marks
12px (16px large) squares: solid green breathing at 1.8s when working, amber stripes with a faint inset outline when needs-you, a 2px outlined circle at 60% opacity when idle. They appear in the roster, on slips and in the chat header; colour is never the only signal.

### Step ledger and Done today
Agent steps list as ruled rows: plain-language step name, hint, a 6px duration bar in the role colour whose length is the step's share of the longest step, and a right-aligned tabular duration. Failed steps turn the bar and time red. Done today lists deliverables as D-NNN rows: faint number, file icon and path, the employee name in their role colour, and a right-aligned time.

### Motion
One easing, `cubic-bezier(0.16, 1, 0.3, 1)`. Colour and border changes run at 0.15s; card lift at 0.25s. Live loops: the working mark breathes at 1.8s, the streaming caret at 0.9s, loaders spin at 0.9s. The single authored moment is a freshly issued badge: the chat header band sweeps in from the left (0.8s), the monogram stamps down from 1.7x scale and -9 degrees (0.55s, 0.3s delay), and the intro rises 10px (0.6s, 0.55s delay). Reduced-motion turns off every animation and transition.

## Do's and Don'ts

### Do:
- **Do** set each employee's colour once through the `--role` property and let band, avatar, swatch, slip head, step bar and ledger name inherit it.
- **Do** show status by form as well as colour: solid for working, hazard stripes for needs-you, outline for idle.
- **Do** number employees EMP-NNN in hiring order and deliverables D-NNN in save order, in tabular figures.
- **Do** right-align running times, durations and timestamps at the end of their row.
- **Do** make the primary action ink, and put the declining action (Don't allow, Cancel) last as a quiet button pushed to the far end.
- **Do** use Lucide line icons at 14px to 18px, with `aria-hidden` when a text label is present.
- **Do** move anything that needs the owner directly under the heading when the layout collapses.
- **Do** keep faint text on white badge stock; on the credential ground use muted text.

### Don't:
- **Don't** build the neutral sidebar-of-agents chat app with one accent colour; the board of role-coloured badges comes first.
- **Don't** use amber for decoration, emphasis or a role; it means the owner is needed or is here.
- **Don't** tint, fade or gradient a role colour. The only gradient in the system is the hard-stop needs-you stripe.
- **Don't** use a role colour that cannot carry white text at 4.5:1.
- **Don't** stretch or weight UI text like a name; wide and heavy is for names, headings and the wordmark.
- **Don't** put small uppercase labels above headings; uppercase belongs to the credential band and the strip tag.
- **Don't** colour Don't allow red; declining is quiet, destructive is red, and only removal in settings is destructive.
- **Don't** add new choreographed motion; the issued badge is the one authored moment.
- **Don't** ship a dark theme by default; the app is light by design.
