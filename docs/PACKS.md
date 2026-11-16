# Writing an employee pack

A pack is a folder. Copy one from `packages/employees/packs/` and change it.

```text
my-packs/
  podcast-producer/
    employee.yaml
    instructions.md
    skills/
      episode-outline/
        SKILL.md
      show-notes/
        SKILL.md
        references/
          chapter-format.md
```

Point your workspace at it in `.dude/config.yaml`:

```yaml
packDirs: [../my-packs]
```

## employee.yaml

```yaml
id: podcast-producer          # used in `dude hire podcast-producer`
title: Podcast Producer
defaultName: Nia
description: Plans episodes, researches guests, writes show notes and clips.
model: anthropic:claude-opus-5-5   # optional; otherwise the workspace model
tools: [web, files, routines]      # groups: web, web_search, web_fetch, browser, files, routines, media, phone, shell
approvals:                         # optional overrides: auto | ask | deny
  routine_add: ask
requires:
  env: [SOME_API_KEY]              # warned about at hire time
routines:
  - id: weekly-guest-research
    cron: "0 9 * * 2"
    enabled: false                 # the user switches it on
    prompt: Research three possible guests for next month and save a brief.
```

`memory`, `skills`, `ask_user`, `team` and `files` are always available.

## instructions.md

The role in plain language: what the employee owns, what good work looks like, and the rules it must not break. Keep it short; put procedures in skills.

## skills/<name>/SKILL.md

Skills use the open Agent Skills format, the same one Claude Code and Codex read, so a skill written for those works here and the other way round. Only the name and description sit in the prompt; the employee loads the body with `use_skill` when the task needs it, and the user can run it with `/show-notes`.

```markdown
---
name: show-notes
description: Turn an episode transcript into show notes with chapters and links.
argument-hint: "<transcript file>"   # optional, shown in the / menu
license: MIT                         # optional
---
1. Read the transcript from the files folder.
2. Follow references/chapter-format.md for the chapter list.
3. ...
```

Put long reference material in `references/` and helper scripts in `scripts/`; the employee reads them with `read_skill_file`, and runs scripts with `run_command` if the `shell` tool is on. Write steps a capable new hire could follow: what to check, what to produce, where to save it. A single `skills/name.md` file also works for short skills.
