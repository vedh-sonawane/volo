// ─────────────────────────────────────────────────────────────────────────────
// Outcome → capability → path reasoning (generic, domain-agnostic).
//
// Volo is given a messy, natural-language OUTCOME. It must infer WHAT the user
// wants to happen, then reason about which available CAPABILITIES could achieve
// it — without the user ever naming a capability ("email", "calendar", "pay"…).
//
// This module builds three reusable abstractions:
//   • inferOutcomeNeeds — reads the objective into abstract NEEDS (answer,
//     find-options, reach-a-party, schedule, submit, pay, needs-current-facts).
//     These are intent classes, never domain nouns.
//   • matchPaths — maps those needs onto the capabilities that are actually
//     available, in RELEVANCE order, each with a rationale, whether it's
//     consequential (needs approval), whether it depends on research first, and
//     whether the capability is connected. A capability is offered ONLY when it
//     is relevant to the outcome — never "because it exists".
//   • selectPath / unmetPaths — pick the best available path, and (for honest
//     reporting) surface relevant paths that can't run because a capability or
//     credential is missing.
//
// Nothing here is domain-specific. The same reasoning serves refunds, quotes,
// bookings, reminders, or answering a question. Consequential paths are always
// approval-gated downstream; this layer only decides RELEVANCE, never executes.
// ─────────────────────────────────────────────────────────────────────────────

import type { CapabilityId, CapabilityStatus, ExecutionPath, TaskConstraints } from "@/lib/types";
import { needsExternalFacts } from "./action-router";

/** Abstract needs an objective implies — the vocabulary path reasoning runs on. */
export interface OutcomeNeeds {
  /** Wants information / a creative artifact produced directly. */
  answer: boolean;
  /** Wants to discover & compare real entities (providers, products, places). */
  findOptions: boolean;
  /** Wants to ENGAGE an external party (a response, quote, arrangement, resolution). */
  reachParty: boolean;
  /** Wants an event/reminder on a calendar. */
  schedule: boolean;
  /** Wants to submit a form/application/cancellation. */
  submit: boolean;
  /** Wants to pay/transfer to a target. */
  pay: boolean;
  /** The answer depends on current/external facts that must be looked up. */
  needsCurrentFacts: boolean;
  /** A concrete actionable target (email/URI) is already present in the text. */
  haveTarget: boolean;
}

// ── generic intent classes (verbs/phrasings, NOT domain nouns) ───────────────
// Each captures an abstract way of asking to engage/act, so indirect wording
// works ("get a quote", "sort out a refund", "reach the vendor") without the
// user naming a capability.
const REACH_PARTY =
  /\b(?:contact\s+(?:them|us|the\s+\w+|a\s+\w+)|reach\s+out|reach\s+(?:the|them)|get\s+in\s+touch|(?:enquir|inquir)\w*|(?:send|get|request|obtain)\s+(?:them\s+)?(?:a\s+)?(?:message|enquiry|inquiry|quote|estimate|response|reply)|ask\s+(?:them|the\s+\w+|about\s+(?:availability|pricing|a\s+quote|whether))|(?:call|phone|ring)\s+(?:them|the\s+\w+)|let\s+(?:them|us|the\s+\w+)\s+know|arrange\s+(?:a\s+)?\w+|make\s+(?:an?\s+)?(?:appointment|reservation|booking)|book\s+(?:a|an|the|my)\b|reserve\s+(?:a|an|the|my)\b|(?:request|want|need|claim|chase|demand|get)\s+(?:me\s+)?(?:a\s+|my\s+|the\s+)?refund|get\s+(?:me\s+)?(?:a\s+)?(?:quote|estimate|appointment|slot|response)|check\s+(?:if|whether)\b[^.]*\b(?:available|availab\w*|open|has|have|in\s+stock|any\s+(?:openings|slots|spots))|follow[-\s]?up\s+with|complain\s+to|dispute\s+(?:the|a|with))\b/i;

const SCHEDULE =
  /\b(?:add\s+(?:a\s+|an\s+)?(?:calendar\s+)?(?:event|reminder|meeting|appointment)|schedule\s+(?:a\s+|an\s+)?\w+|remind\s+me|set\s+(?:up\s+)?(?:a\s+|an\s+)?(?:reminder|event|meeting)|put\s+[^.]*\bon\s+(?:my|the)\s+calendar|block\s+(?:off|out)\s+(?:some\s+)?time|save\s+the\s+date)\b/i;

const SUBMIT =
  /\b(?:submit|apply\s+(?:for|to)\b|application|sign\s*up|register\s+(?:for|me|with)|fill\s+(?:out|in)|complete\s+the\s+form|cancel\s+(?:my|the|this)\b|unsubscribe|opt\s+out)\b/i;

const PAY =
  /\b(?:pay\b|payment|transfer\s+(?:money|funds|\$?\d)|send\s+(?:money|\$?\d[\d,.]*\s+to)|settle\s+(?:the\s+)?(?:bill|invoice|balance)|check\s*out\b)\b/i;

// A concrete target already present: an email address or any URI scheme.
const HAVE_TARGET = /[\w.%+-]+@[\w.-]+\.\w{2,}|[a-z][\w+.-]*:\/\//i;

// "Remind me to X" schedules a reminder for the USER to do X — the inner action
// is the user's task, not Volo's — so it must not trigger contact/submit/pay.
const SELF_REMINDER = /\bremind\s+me\b/i;

/** Read a natural-language objective into abstract, domain-agnostic needs. */
export function inferOutcomeNeeds(objective: string, c: TaskConstraints): OutcomeNeeds {
  const reminder = SELF_REMINDER.test(objective);
  return {
    answer: c.outcome === "answer",
    findOptions: c.outcome === "candidates",
    reachParty: !reminder && REACH_PARTY.test(objective),
    schedule: SCHEDULE.test(objective),
    submit: !reminder && SUBMIT.test(objective),
    pay: !reminder && PAY.test(objective),
    needsCurrentFacts: needsExternalFacts(objective),
    haveTarget: HAVE_TARGET.test(objective),
  };
}

/**
 * Map needs onto AVAILABLE capabilities, in relevance order. A path is included
 * only when it's relevant to the outcome. Consequential paths are flagged (they
 * require approval before execution) and note whether they depend on research to
 * discover a target first.
 */
export function matchPaths(needs: OutcomeNeeds, caps: CapabilityStatus[]): ExecutionPath[] {
  const capOf = (id: CapabilityId) => caps.find((c) => c.id === id);
  const mk = (id: CapabilityId, rationale: string, consequential: boolean, dependsOnResearch: boolean): ExecutionPath => {
    const cap = capOf(id);
    const available = cap?.available ?? false;
    return { capability: id, rationale, consequential, dependsOnResearch, available, unavailableReason: available ? undefined : cap?.detail };
  };
  const paths: ExecutionPath[] = [];

  // A purely informational/creative outcome with no external need → answer.
  const pureAnswer = needs.answer && !needs.needsCurrentFacts && !needs.reachParty && !needs.schedule && !needs.submit && !needs.pay;
  if (pureAnswer) {
    paths.push(mk("answer", "The outcome is informational/creative and can be produced directly from knowledge — no external data needed.", false, false));
  }

  // Research to discover options, current facts, or the right party to engage.
  if (needs.findOptions || needs.needsCurrentFacts || (needs.reachParty && !needs.haveTarget)) {
    const why = needs.findOptions
      ? "The outcome needs discovering and comparing real options on the open web."
      : needs.reachParty
        ? "The outcome needs discovering the right party (and how to reach them) before acting."
        : "The outcome depends on current/external facts, which must be looked up.";
    paths.push(mk("research", why, false, false));
  }

  // Scheduling (calendar).
  if (needs.schedule) {
    paths.push(mk("schedule", "The outcome involves putting an event/reminder on a calendar.", true, false));
  }

  // Submitting a form/application/cancellation.
  if (needs.submit) {
    paths.push(mk("submit", "The outcome involves submitting a form/application/cancellation to a target.", true, !needs.haveTarget));
  }

  // Paying/transferring.
  if (needs.pay) {
    paths.push(mk("pay", "The outcome involves paying/transferring to a target.", true, !needs.haveTarget));
  }

  // Reaching a party through a communication channel — often the FALLBACK path
  // when direct research can't produce the outcome (private availability, a
  // quote, a resolution). Depends on knowing a target (discovered or supplied).
  if (needs.reachParty) {
    paths.push(mk("communicate", "The outcome needs engaging a relevant party for a response/quote/arrangement — a connected communication channel can do this (with your approval).", true, !needs.haveTarget));
  }

  return paths;
}

/** The best path that can actually run now, excluding ones already tried. */
export function selectPath(paths: ExecutionPath[], tried: CapabilityId[] = []): ExecutionPath | null {
  return paths.find((p) => p.available && !tried.includes(p.capability)) ?? null;
}

/** Relevant paths that cannot run because a capability/credential is missing. */
export function unmetPaths(paths: ExecutionPath[]): ExecutionPath[] {
  return paths.filter((p) => !p.available);
}
