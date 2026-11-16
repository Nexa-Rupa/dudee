---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/Chat.tsx","src/Settings.tsx","src/HireDialog.tsx"]
---

# dude web app (local)

Scope: the whole local web app (team board, employee chat, hiring, first run, settings). Mode: Operate.
Audience and job: non-technical owners checking on their AI staff, approving risky actions, picking up deliverables; self-hosters set it up. Priority: first run and hiring, then the team board, then chat.
Constraints: React + Vite, plain CSS, local server API unchanged; plain language; every action that asks must stay fast.

## Direction contract

THESIS: Your AI staff, issued as credentials. Every employee is a badge with a flat role-colour band, a name, an employee number and a live status strip; the app is the badge board. It refuses the neutral sidebar-of-agents chat app with one accent.

OWN-WORLD: Cool credential-stock ground (#EEF1F5), white badge stock, ink rail (#14161B). Flat role bands: marketing coral-red, content violet, calls green, research blue, all dark enough for white text. Needs-you amber (#F2B33D) as diagonal stripes. Archivo, wide and heavy for names and headings, normal width for UI; tabular figures for every number and time. Lucide line icons.

STORY: The owner sees who is working, what needs them, and what got done; approves in one click from the board; opens an employee to brief work and watch steps; hires by issuing a new badge.

FIRST VIEWPORT: Ink rail left (logo, Team board, Needs you with count, Settings, employee list with band swatch and status form, Hire). Main: team name heading, one meta line, badge grid. Right column: Needs you slips with Allow / Always allow, Don't allow set apart; Done today list numbered D-0NN. First run: full-width two-step setup, connect model, then issue first badge from large role badges.

FORM: Staff Credentials, candidate 3 of 7 on my ordered list (1 In/Out board, 2 kitchen ticket rail, 3 staff credentials, 4 pigeonhole rack, 5 corporate identity handbook, 6 noticeboard, 7 punch-card timesheet). Raises: running times right-aligned (j-card); sequential EMP/D numbers (catalog); destructive actions isolated (console); step bar length = duration (labanotation); flat committed colour (zoo map); state by form, solid working, striped needs-you, outline idle (emission rail). seed:bc372c2f94031d03

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
