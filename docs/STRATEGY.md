# Strategy: open-source employees, paid cloud

## The idea

1. **Open source** (`dude`): a runtime for AI employees plus a library of employee packs. Anyone runs it with their own model keys, on their own machine or server. Free forever.
2. **dude Cloud**: the same employees, hosted. No keys, no server. Hire a Marketing Manager, a Content Creator or a Calling Agent in the browser and pay per employee.

## Verdict

**Worth doing, with three conditions.** Open core is a proven model for developer and automation tools (n8n, Supabase, PostHog, Cal.com). n8n is the closest match: free self-hosting and community templates bring distribution, and the hosted version earns the money. Employee packs play the role of n8n's templates.

The conditions:

1. **Cloud and open source run the same core.** The earlier cloud prototype (`legacy/cloud-v0`) carried its own copies of the agent packages, so the two products were already drifting apart. From now on the cloud imports `@dude/core` and adds hosting, multi-tenancy and billing around it, nothing else.
2. **Charge for what self-hosting can't easily give, not for tokens.** The earlier plan resold model tokens at cost, which leaves no margin and can be undercut by anyone with their own key. The cloud should charge per employee per month, and charge for:
   - always-on hosting and routines that run while your laptop is closed
   - connected apps with OAuth handled for you (Gmail, Slack, HubSpot, social accounts)
   - phone numbers and voice minutes for the Calling Agent
   - a browser or computer per employee (later)
   - a team workspace: shared employees, approvals from anyone on the team, audit log
   - premium packs that are tuned and evaluated, for example "Real-estate inside sales" or "Course-launch marketer"
3. **Start with one hero employee.** "AI employee" products churn when the promise is bigger than the output. Pick the role with the clearest weekly deliverable and the lowest risk. **Content Creator** is the best first hero: the output is visible (posts, scripts, a calendar), easy to judge, and needs no risky actions. Marketing Manager is the second. The Calling Agent is a strong paid upsell but carries legal and cost risk, so it comes after.

## Competition (as of late 2026, check before you rely on it)

| | Examples | Our angle |
|---|---|---|
| Closed "AI employee" SaaS | Lindy, Sintra, Artisan, 11x, Relevance AI | Open source, bring your own model, inspect and edit every prompt, run it yourself |
| Open-source agent frameworks | Hermes Agent, CrewAI, LangGraph, OpenHands | Ready-made employees with roles, playbooks and approvals, not a framework to build with |
| Workflow automation | n8n, Zapier, Make | The employee decides the steps; you hand over goals, not flowcharts |

The defensible part is not the runtime, which is getting commoditized. It is the **employee packs** (tested playbooks per role and industry), **trust** (approvals, transparent memory, audit) and, in the cloud, **managed integrations and telephony**.

## Risks

| Risk | What we do |
|---|---|
| Output not good enough to keep paying for | One hero role first; a weekly deliverable; evals per pack before calling it "premium" |
| Open source eats cloud revenue | Cloud sells hosting, integrations, telephony, team features; self-hosting stays a real option, which is the marketing |
| Token costs eat margin | Per-employee pricing with a fair-use allowance; BYOK option on cloud; cheaper models for routine work |
| Calling Agent legal exposure | Consent-only calling, AI disclosure in the first line, calling hours, opt-out memory, approval on every call; inbound and appointment reminders before cold outreach. In the US an AI voice counts as an "artificial voice" under the TCPA; check local rules (PECR in the UK, TRAI/DND in India) |
| Prompt injection through web pages and email | Read freely, write only with approval; connected-app writes ask by default |
| Two products, one small team | One core, one repo for open source; the cloud is a thin private layer |

## Pricing hypothesis (to test, not decided)

- **Open source:** free, MIT.
- **Cloud Starter:** about $29 per employee per month, includes a usage allowance, routines and two connected apps.
- **Cloud Pro:** about $79 per employee per month, all apps, browser, priority models, premium packs.
- **Calling:** per minute on top, plus the phone number.
- **Teams and agencies:** per workspace, many clients; agencies are a natural channel for marketing and content employees.

## How to validate in the next 6 weeks

1. **Ship the open-source CLI** with Content Creator and Marketing Manager. Post it where builders are (GitHub, Hacker News, r/selfhosted, X). Signal: stars, installs, packs people contribute.
2. **Cloud waitlist page** with the pricing above. Signal: sign-ups per visitor, replies to "what would you hire first?".
3. **Ten design partners** (small businesses, creators, one agency) using a hosted Content Creator by hand-holding. Signal: still using it after four weeks; would pay the listed price.
4. Decide the second hero and the cloud launch scope from what those ten actually used.
