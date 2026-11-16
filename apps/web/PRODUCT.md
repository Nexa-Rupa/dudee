# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Self-hosters (developers and power users) install dude and bring their own model keys, but the people using the web app every day are non-technical business owners and their teams: founders, small-business owners, agency staff. They come to it to hand work to AI employees (marketing, content, calls, research), check what got done, and approve anything risky.

## Product Purpose

dude is open-source software for running AI employees with your own keys. In the web app you hire employees from role packs, give them work in chat, watch each step as it happens, approve actions that send, post, schedule, call or spend, and pick up their deliverables (files), memory and routines. Success: an owner trusts the team enough to hand over recurring work and only steps in to approve.

## Positioning

A team you manage, not a chat assistant. You run a small staff: you see who is working, what each one did, and you approve their actions. It is open source, runs on your machine, works with any model provider (Claude, GPT/Codex, Gemini, Groq, OpenRouter, DeepSeek, Kimi, GLM, Qwen, local models), and every employee's skills, memory and transcript are inspectable files.

## Operating Context

- Runs locally at 127.0.0.1 via `dude ui`; opened from a link with a one-time token.
- A paid hosted version (dude Cloud) is planned on the same core; the UI should carry over.
- Daily loop: pick an employee, brief a task or run a skill with `/`, watch live steps, answer approval and question cards, open saved files.
- Setup loop: connect a model provider (paste a key, check it, choose a model), hire employees from packs, toggle routines.

## Capabilities and Constraints

- Employees: role packs (Marketing Manager, Content Creator, Calling Agent, Research Analyst), each with skills, tools, memory (MEMORY.md), files folder, routines (cron), optional own browser with screenshots.
- Chat: turns grouped as request → steps → reply; live "Working for 12s · 3 steps"; approval cards (Allow / Always allow / Don't allow; calls always ask); question cards; `/` skill menu.
- Settings: 17 chat providers plus custom endpoints, media keys (fal.ai, Vapi, Brave), default model, per-employee model, global skills toggle.
- Stack: React 18 + Vite, plain CSS, no component library; served by the local server.
- Undecided: team accounts and roles (cloud only), mobile app.

## Brand Commitments

- Name: "dude", lowercase. Keep it.
- Logo mark and colors are open to change.

## Evidence on Hand

No customers, testimonials, usage numbers or pricing exist yet. Do not invent any.

## Product Principles

1. Trust through visibility: every step, approval and file is visible and inspectable.
2. Owners first: plain language, no jargon in the main flow; technical detail is one click away.
3. The team is the unit: employees, their status and what needs you come before any single conversation.
4. Safe by default: anything outside an employee's own folder asks first, and asking is fast.
5. Bring your own everything: any provider, any skill folder, your machine.
