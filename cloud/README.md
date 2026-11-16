# dude Cloud (plan)

The hosted product. Its code lives in a **separate private repository** that depends on the published `@dude/core` and `@dude/employees`. This folder only holds the plan so the open-source repo shows where the line is.

## What the cloud adds

| Area | Build |
|---|---|
| Accounts and workspaces | Auth with organizations and roles (port Better Auth setup from `legacy/cloud-v0/packages/auth`) |
| Hiring flow | Read the website, propose the company profile, pick an employee, ID card (port `legacy/cloud-v0/apps/web/src/components/onboarding`) |
| Workspace UI | Employees sidebar, chat with live steps, approval cards, files, memory, routines |
| Runtime hosting | Workers run `Runtime` per workspace; Postgres `Store`; queue for routines; SSE to the browser |
| Apps | Managed Composio connections per workspace, exposed to the runtime as MCP |
| Calling | Phone numbers and voice minutes through a telephony partner; consent records and opt-out list per workspace |
| Billing | Per-employee subscription plus metered extras (calls, heavy usage) via the `meter` seam; port `legacy/cloud-v0/packages/billing` |
| Secrets | Encrypted vault per workspace (port `legacy/cloud-v0/packages/vault`) |
| Premium packs | Tuned, evaluated packs per industry; cloud-only |

## Order

1. Postgres `Store` and a `Runtime` worker per workspace.
2. Web app on the same UI as the open-source local web app, plus auth and onboarding.
3. Billing and a free trial.
4. Managed apps (Composio), then calling.
