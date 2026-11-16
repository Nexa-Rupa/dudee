import { z } from "zod";
import type { ToolDef } from "../types.js";

/**
 * Outbound phone calls through Vapi (https://vapi.ai), using the user's own Vapi account.
 * Vapi runs the live voice conversation; the employee decides who to call, briefs the call,
 * and reads the transcript afterwards.
 *
 * Every call needs explicit approval (alwaysAsk), whatever the user chose earlier.
 * Calling people who have not agreed to be called is illegal in many places (TCPA in the
 * US, PECR in the UK, TRAI DND rules in India); the caller pack's instructions cover this.
 */
const VAPI = "https://api.vapi.ai";

function vapiEnv() {
  const key = process.env.VAPI_API_KEY;
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
  const assistantId = process.env.VAPI_ASSISTANT_ID;
  if (!key || !phoneNumberId || !assistantId) {
    throw new Error("Phone calls need VAPI_API_KEY, VAPI_PHONE_NUMBER_ID and VAPI_ASSISTANT_ID in .env");
  }
  return { key, phoneNumberId, assistantId };
}

async function vapi(pathname: string, init: RequestInit = {}) {
  const { key } = vapiEnv();
  const res = await fetch(`${VAPI}${pathname}`, {
    ...init,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Vapi ${res.status}: ${data.message ?? JSON.stringify(data)}`);
  return data;
}

export const phoneTools: ToolDef[] = [
  {
    name: "phone_call",
    description:
      "Place an outbound phone call. Only call people who agreed to be contacted. The voice agent opens with firstMessage and pursues the goal; read the result later with phone_call_status.",
    input: z.object({
      to: z.string().regex(/^\+[1-9]\d{6,14}$/).describe("E.164 number, e.g. +14155550123"),
      contactName: z.string(),
      goal: z.string().describe("What the call should achieve"),
      context: z.string().describe("Facts the voice agent needs: who we are, why we call, offer, constraints"),
      firstMessage: z.string().describe("Opening line; must say it is an AI assistant calling on behalf of the company"),
    }),
    risk: "write",
    alwaysAsk: true,
    summarize: (i: any) => `call ${i.contactName} at ${i.to}: ${i.goal}`,
    async execute(input: any) {
      const { phoneNumberId, assistantId } = vapiEnv();
      const call = await vapi("/call", {
        method: "POST",
        body: JSON.stringify({
          assistantId,
          phoneNumberId,
          customer: { number: input.to, name: input.contactName },
          assistantOverrides: {
            firstMessage: input.firstMessage,
            variableValues: { goal: input.goal, context: input.context, contactName: input.contactName },
          },
        }),
      });
      return { callId: call.id, status: call.status };
    },
  },
  {
    name: "phone_call_status",
    description: "Get a call's status, and once it ended, its summary and transcript.",
    input: z.object({ callId: z.string() }),
    risk: "read",
    async execute({ callId }: any) {
      const call = await vapi(`/call/${encodeURIComponent(callId)}`);
      return {
        status: call.status,
        endedReason: call.endedReason,
        summary: call.analysis?.summary ?? call.summary,
        transcript: typeof call.transcript === "string" ? call.transcript.slice(0, 15_000) : undefined,
      };
    },
  },
];
