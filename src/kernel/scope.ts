/**
 * Scope resolution (IA-1, IA-8): turning what a trainer said into typed
 * values, and — far more often — declining to.
 *
 * Three ideas carry this module.
 *
 * 1. **The vocabulary is closed.** The only values this code can emit are the
 *    ones written into the Accord pack. That is the guarantee IA-8 actually
 *    rests on: it does not matter what a pasted walkthrough, a retrieved page,
 *    or a sentence beginning "ignore your instructions" contains, because
 *    there is no text that makes a closed vocabulary produce a value outside
 *    itself. Detection is a fallback here, never the mechanism.
 * 2. **Authority is a channel, not a judgement.** Every utterance carries the
 *    source the transport assigned it. Only the trainer's own channel is read
 *    for bindings. Inside that channel, quoted spans are excised and clauses
 *    carrying reported speech, advisor instructions, negation, or a question
 *    are excluded — a weaker second layer, for the case that matters most in a
 *    chat box: the trainer typing their rival's wish themselves.
 * 3. **Not knowing is a question, not a denial.** Failing closed here means
 *    asking. {@link resolveScope} returns a grant or exactly one clarification
 *    and never a partial release. The denials this module owes come from
 *    {@link verifyScopeGrant}, which takes a grant and the transcript it
 *    claims to rest on and redoes the whole derivation — so, as in the
 *    manifest layer, the thing that produces grants is built on top of the
 *    thing that audits them and cannot be the more trusted of the two.
 *
 * And one corollary of asking: **the question is the context** — and the
 * answer is the trainer's last word on it, superseding what made the asking
 * necessary (so a contradiction is a question, never a dead end).
 * The bare-noun
 * ban demands context words because prose gives a value token nothing to be
 * about — but a recorded clarifying question already said what the reply is
 * about, so a direct answer binds that one dimension deterministically
 * (route `answer`, see {@link answerMatches}) instead of costing the trainer
 * a model proposal and a confirmation card for their own one-word answer.
 *
 * Nothing here reads a clock, a registry, or a model. A grant is a pure
 * function of the recorded transcript, the pack, and the commit time it was
 * handed (IA-10).
 */

import { sha256Hex } from "./sha256.js";
import type {
  Resolution,
  ScopeBinding,
  ScopeCandidate,
  ScopeDimension,
  ScopeEvent,
  ScopeGrant,
  ScopeTranscript,
  ScopeValue,
  TrainerScope,
  Verdict,
  Violation,
} from "./contracts.js";
import { type AccordPack, type DimensionRule, SCOPE_DIMENSIONS, type ScopeVocabulary } from "./pack.js";
import { stableStringify } from "./snapshot-format.js";
import { verdictOf, violation } from "./violation.js";

/**
 * What must be bound before anything personalised is released. The comparison
 * basis is not here: it is material only to an answer that ranks, and callers
 * that rank ask for it explicitly.
 */
export const REQUIRED_DIMENSIONS: readonly ScopeDimension[] = ["version", "region", "badgeLevel"];

export interface ScopeContext {
  pack: AccordPack;
  /** RFC 3339. The moment scope is established, supplied rather than read. */
  at: string;
  /** Dimensions this conversation must establish. Defaults to {@link REQUIRED_DIMENSIONS}. */
  required?: readonly ScopeDimension[];
}

// --- what a clause is not allowed to do -------------------------------------

/**
 * Why a match was seen and not believed. Each maps to one named denial, so a
 * grant resting on excluded wording is refused under the rule that excluded
 * it rather than under a generic "unevidenced".
 */
export type BlockReason =
  | "foreign-channel"
  | "foreign-question"
  | "foreign-profile"
  | "unapproved-profile"
  | "quoted"
  | "instruction"
  | "reported"
  | "negated"
  | "question"
  | "unconfirmed"
  | "rejected"
  | "digest-mismatch"
  | "unapproved"
  | "superseded";

/**
 * The article and rule each exclusion is denied under, and why in one line.
 *
 * Exported because a match that was seen and not believed is the most
 * instructive thing this module produces, and a console that could only say
 * "ignored" would be hiding the interesting half: it is the difference between
 * "the resolver missed the rival's wish" and "the resolver read it, and
 * refused it under IA-8 for reporting somebody else's words".
 */
export const BLOCK_DENIALS: Record<BlockReason, { article: "IA-1" | "IA-8"; rule: string; because: string }> = {
  "foreign-channel": {
    article: "IA-8",
    rule: "unauthorized-speaker",
    because: "it arrived on a channel the trainer does not speak on",
  },
  "foreign-question": {
    article: "IA-8",
    rule: "unauthorized-questioner",
    because: "the question that armed it arrived on a channel the advisor does not speak on",
  },
  "foreign-profile": {
    article: "IA-8",
    rule: "unauthorized-profile",
    because: "the profile that carries it arrived on a channel the trainer does not speak on",
  },
  "unapproved-profile": {
    article: "IA-1",
    rule: "profile-value-not-approved",
    because: "the profile names a value that is not in the League-approved vocabulary",
  },
  quoted: {
    article: "IA-8",
    rule: "quotation-is-not-intent",
    because: "it sits inside something the trainer quoted",
  },
  instruction: {
    article: "IA-8",
    rule: "instruction-is-not-intent",
    because: "the clause instructs the Advisor rather than describing the trainer",
  },
  reported: {
    article: "IA-8",
    rule: "reported-intent",
    because: "the clause reports somebody else's words",
  },
  negated: {
    article: "IA-8",
    rule: "negation-ignored",
    because: "the clause negates it",
  },
  question: {
    article: "IA-1",
    rule: "question-is-not-assertion",
    because: "the sentence asks about it rather than asserting it",
  },
  unconfirmed: {
    article: "IA-1",
    rule: "unconfirmed-interpretation",
    because: "the interpretation was proposed and never confirmed",
  },
  rejected: {
    article: "IA-1",
    rule: "rejected-interpretation",
    because: "the trainer rejected that interpretation",
  },
  "digest-mismatch": {
    article: "IA-1",
    rule: "confirmation-digest-mismatch",
    because: "the candidate was not the one the trainer was shown",
  },
  unapproved: {
    article: "IA-1",
    rule: "value-not-approved",
    because: "the value is not in the League-approved vocabulary",
  },
  superseded: {
    article: "IA-1",
    rule: "superseded-by-answer",
    because: "the trainer was asked about it afterwards, and their recorded answer replaced it",
  },
};

// --- derivation -------------------------------------------------------------

/** One dimension a piece of the transcript would bind, believed or not. */
export interface ScopeMatch extends ScopeBinding {
  /** Absent when the match binds; otherwise the reason it does not. */
  blockedBy?: BlockReason;
}

export interface ScopeDerivation {
  /** One per dimension the evidence establishes unambiguously. */
  bindings: readonly ScopeBinding[];
  /** Dimensions the evidence establishes two ways. A contradiction binds nothing. */
  contradicted: readonly ScopeDimension[];
  /** Every match that was seen and not believed, with the reason. */
  ignored: readonly Required<ScopeMatch>[];
  /**
   * Trainer wording that reached no dimension at all.
   *
   * Reported rather than discarded, because a deterministic front door that
   * never engages is a silent usefulness ceiling. This is the number phase 7
   * measures instead of assuming.
   */
  unmatched: readonly string[];
}

/**
 * Read the transcript and report what it establishes, what it contradicts,
 * what it says that cannot bind, and what it says that the vocabulary does not
 * cover at all.
 */
export function deriveScope(pack: AccordPack, transcript: ScopeTranscript): ScopeDerivation {
  const matches = [
    ...directMatches(pack.vocabulary, transcript),
    ...profileMatches(pack.vocabulary, transcript),
    ...answerMatches(pack.vocabulary, transcript),
    // The ceremony dial (pack policy, not code): a pending proposal arms its
    // dimension the way a recorded question does, when — and only when — the
    // pack says so. Strict packs never reach this line's second half.
    ...(pack.ceremony?.proposalDirectAnswers === true ? proposalAnswerMatches(pack.vocabulary, transcript) : []),
    ...confirmedMatches(pack.vocabulary, transcript),
  ];

  const bindings: ScopeBinding[] = [];
  const contradicted: ScopeDimension[] = [];
  const superseded: Required<ScopeMatch>[] = [];
  for (const dimension of SCOPE_DIMENSIONS) {
    const believed = matches.filter((match) => match.blockedBy === undefined && match.dimension === dimension);

    // The trainer's latest recorded word on this dimension — a direct answer
    // to the question the advisor put to them, or their confirmation of a
    // candidate they were shown — outranks everything said before it. That is
    // what the question was *for*: the record established the dimension two
    // ways, the trainer was asked which they meant, and they said. Without
    // this a contradiction would be terminal — no answer could ever re-bind
    // the dimension, and a pasted line or a slip would make scope write-once
    // for the session (findings iteration 30). Recency alone still decides
    // nothing: a later *direct* statement contradicting the answer is a fresh
    // contradiction, and the trainer is asked again. What is set aside is
    // recorded under its own name, so a grant resting on it is refused as
    // superseded rather than as wording that never bound.
    // An ask parameter (the pack's `askParameter`, the comparison basis) is a
    // parameter of the ask it lives in, not standing scope: "who's fastest?"
    // and then "who has the highest attack?" are two asks, not a
    // contradiction. Its latest evidence outranks everything before it,
    // direct or not — found live (dogfood, 2026-09-20): the second ask fell
    // to the model's card, which re-read the first ask's basis, was
    // rejected, and was restated. World dimensions keep the rule below: a
    // later direct statement against the record is a fresh contradiction.
    const askParameter = pack.vocabulary.dimensions.find((rule) => rule.dimension === dimension)?.askParameter === true;
    const witness = believed.reduce<number | undefined>(
      (latest, match) => (match.route === "direct" && !askParameter ? latest : Math.max(latest ?? -1, match.evidenceIndex)),
      undefined,
    );
    const live = witness === undefined ? believed : believed.filter((match) => match.evidenceIndex >= witness);
    for (const match of believed) {
      if (witness !== undefined && match.evidenceIndex < witness) superseded.push({ ...match, blockedBy: "superseded" });
    }

    const values = new Set(live.map((match) => match.value));
    if (values.size > 1) {
      // Fail closed rather than picking the later one. "Actually I switched to
      // Yellow" and "my rival plays Yellow" look identical from here, and only
      // the trainer can say which they meant.
      contradicted.push(dimension);
      continue;
    }
    const first = live[0];
    if (first !== undefined) bindings.push(strip(first));
  }

  return {
    bindings,
    contradicted,
    ignored: [...matches.filter((match): match is Required<ScopeMatch> => match.blockedBy !== undefined), ...superseded],
    unmatched: unmatchedWording(pack.vocabulary, transcript, matches),
  };
}

function strip(match: ScopeMatch): ScopeBinding {
  return {
    dimension: match.dimension,
    value: match.value,
    evidenceIndex: match.evidenceIndex,
    route: match.route,
    matchedText: match.matchedText,
  };
}

// --- matching the trainer's own words ---------------------------------------

interface Clause {
  text: string;
  tokens: readonly string[];
  /** The sentence this clause came from asks rather than asserts. */
  interrogative: boolean;
  /** Set when the clause was lifted out of a quotation. */
  quoted: boolean;
}

/**
 * Words, lowercased, with apostrophes and hyphens kept inside them so that
 * "don't" stays one negation marker instead of becoming "don" and "t".
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9'’-]+/)
    .map((token) => token.replace(/^['’-]+|['’-]+$/g, "").replace(/’/g, "'"))
    .filter((token) => token.length > 0);
}

const QUOTED_SPAN = /"[^"]*"|“[^”]*”/g;

/**
 * Cut a sentence at commas and at the conjunctions the pack lists, so that one
 * poisoned clause cannot spoil a sound one beside it: "I'm playing Red but my
 * rival says Yellow" establishes the version and reports the rival, and both
 * facts survive intact.
 *
 * The pattern is an alternation of literal words from the pack — a word list
 * compiled for matching, not a pattern language authors can write in.
 */
function clauseBreaker(vocabulary: ScopeVocabulary): RegExp {
  const words = vocabulary.markers.conjunction
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return new RegExp(`[,;:—–]+|\\b(?:${words})\\b`, "i");
}

function clausesOf(text: string, vocabulary: ScopeVocabulary): Clause[] {
  const quoted: string[] = [];
  const spoken = text.replace(QUOTED_SPAN, (span) => {
    quoted.push(span);
    return " ";
  });

  const clauses: Clause[] = [];
  const breaker = clauseBreaker(vocabulary);
  const collect = (source: string, isQuoted: boolean): void => {
    for (const sentence of source.split(/(?<=[.!?])\s+|\n+/)) {
      const sentenceTokens = tokenize(sentence);
      const opener = sentenceTokens[0];
      const interrogative =
        sentence.trimEnd().endsWith("?") ||
        (opener !== undefined && vocabulary.markers.interrogative.includes(opener));
      for (const part of sentence.split(breaker)) {
        const tokens = tokenize(part);
        // Normalised text rather than the raw slice: what is recorded in a
        // binding has to be reproducible from the transcript, byte for byte.
        if (tokens.length > 0) clauses.push({ text: tokens.join(" "), tokens, interrogative, quoted: isQuoted });
      }
    }
  };

  collect(spoken, false);
  for (const span of quoted) collect(span, true);
  return clauses;
}

/** Every term of every dimension this clause expresses, and whether it is negated. */
function termsIn(
  clause: Clause,
  vocabulary: ScopeVocabulary,
): Array<{ rule: DimensionRule; value: ScopeValue; negated: boolean }> {
  const found: Array<{ rule: DimensionRule; value: ScopeValue; negated: boolean }> = [];
  const window = vocabulary.contextWindow;

  for (const rule of vocabulary.dimensions) {
    for (const term of rule.terms) {
      for (let at = 0; at < clause.tokens.length; at += 1) {
        if (!term.tokens.includes(clause.tokens[at]!)) continue;
        const from = Math.max(0, at - window);
        const to = Math.min(clause.tokens.length - 1, at + window);

        // Context discipline: a value token alone binds nothing. Widening this
        // window is the recall dial and narrowing it is the specificity dial;
        // both are the pack's decision, not this function's.
        let supported = false;
        for (let near = from; near <= to; near += 1) {
          if (near !== at && term.context.includes(clause.tokens[near]!)) supported = true;
        }
        if (!supported) continue;

        const negated = clause.tokens
          .slice(from, at)
          .some((token) => vocabulary.markers.negation.includes(token));
        found.push({ rule, value: term.value, negated });
        break;
      }
    }
  }
  return found;
}

/**
 * Why this clause cannot bind, if it cannot. Ordered most structural first, so
 * a clause that is both quoted and reported is refused as a quotation.
 */
function clauseBlock(clause: Clause, vocabulary: ScopeVocabulary): BlockReason | undefined {
  if (clause.quoted) return "quoted";
  if (clause.tokens.some((token) => vocabulary.markers.instruction.includes(token))) return "instruction";
  if (clause.tokens.some((token) => vocabulary.markers.reported.includes(token))) return "reported";
  if (clause.interrogative) return "question";
  return undefined;
}

/**
 * Bindings from direct answers to recorded questions (route `answer`).
 *
 * The bare-noun ban exists because "yellow" loose in prose might be a
 * Pokémon's colour — the reader cannot know what the word is about. A direct
 * reply to "Which game version are you playing?" has no such ambiguity: the
 * question said what the words are about, so the question *is* the context,
 * and requiring the trainer to also utter a context word (or to confirm a
 * model's restatement of their one-word answer) is ceremony, not rigor.
 *
 * The leniency is narrow and fully audited. It reaches exactly one dimension —
 * the one the recorded question named; it reads only the trainer's channel;
 * every clause exclusion still applies (quoted, reported, instruction,
 * interrogative, negated); the answer window closes at the next question; and
 * the question event sits in the transcript under the evidence digest, so a
 * grant resting on an answer names the question it answered and the verifier
 * re-derives both sides. A question arriving on any other channel arms
 * nothing — it is read, and born blocked, exactly as foreign utterances are.
 */
/**
 * The ceremony dial's matcher: a proposal card arms its dimensions the way a
 * recorded question does (see {@link answerMatches}, whose subtleties this
 * mirrors — negation window, blocked clauses, first-answer-closes). Only the
 * dimensions the proposal actually put on the card are armed, the window
 * closes at the next question, proposal, or the card's own confirmation, and
 * the route is recorded as "answer" — because that is what it is: the reply
 * to ceremony the trainer was shown, auditable in the transcript where the
 * proposal sits. Reached only when the pack's ceremony policy opts in.
 */
function proposalAnswerMatches(vocabulary: ScopeVocabulary, transcript: ScopeTranscript): ScopeMatch[] {
  const matches: ScopeMatch[] = [];
  const window = vocabulary.contextWindow;

  transcript.forEach((event, proposalIndex) => {
    if (event.kind !== "proposal") return;
    const dimensions = Object.keys(event.candidate) as ScopeDimension[];

    for (let index = proposalIndex + 1; index < transcript.length; index += 1) {
      const reply = transcript[index]!;
      // A new question or proposal changes the subject; the card's own
      // confirmation settles it — either way this card stops arming.
      if (reply.kind === "question" || reply.kind === "clarification" || reply.kind === "proposal") break;
      if (reply.kind === "confirmation" && reply.proposalId === event.id) break;
      if (reply.kind !== "utterance" || reply.source !== "trainer") continue;

      let answered = false;
      for (const dimension of dimensions) {
        const rule = vocabulary.dimensions.find((entry) => entry.dimension === dimension);
        if (rule === undefined) continue;
        for (const clause of clausesOf(reply.text, vocabulary)) {
          const clauseReason = clauseBlock(clause, vocabulary);
          for (const term of rule.terms) {
            const at = clause.tokens.findIndex((token) => term.tokens.includes(token));
            if (at < 0) continue;
            const negated = clause.tokens
              .slice(Math.max(0, at - window), at)
              .some((token) => vocabulary.markers.negation.includes(token));
            const blockedBy = clauseReason ?? (negated ? "negated" : undefined);
            if (blockedBy === undefined) answered = true;
            matches.push({
              dimension: rule.dimension,
              value: term.value,
              evidenceIndex: index,
              route: "answer",
              matchedText: clause.text,
              ...(blockedBy === undefined ? {} : { blockedBy }),
            });
          }
        }
      }
      if (answered) break;
    }
  });
  return matches;
}

function answerMatches(vocabulary: ScopeVocabulary, transcript: ScopeTranscript): ScopeMatch[] {
  const matches: ScopeMatch[] = [];
  const window = vocabulary.contextWindow;

  transcript.forEach((event, questionIndex) => {
    if (event.kind !== "question") return;
    const rule = vocabulary.dimensions.find((entry) => entry.dimension === event.dimension);
    if (rule === undefined) return;
    const foreign = event.source !== "advisor";

    for (let index = questionIndex + 1; index < transcript.length; index += 1) {
      const reply = transcript[index]!;
      // The next question changes the subject; answers do not carry across it.
      // The advisor's own clarification is a question too (R3b step 3).
      if (reply.kind === "question" || reply.kind === "clarification") break;
      if (reply.kind !== "utterance" || reply.source !== "trainer") continue;

      // The window closes once the question is *answered* — the first trainer
      // reply that binds the asked dimension is the answer, and a later
      // utterance is not retroactively a second reply to a question already
      // settled. Without this, a stale question keeps arming every later turn:
      // a pasted line two exchanges on ("...players on Yellow.") would read as
      // the trainer's answer to a version question they answered long ago
      // (epic #94, slice 1 — the write-once follow-up). A reply that only
      // *attempts* the dimension and is blocked (a negation, a foreign
      // channel) does not close it, so "hmm" then "yellow" still binds and a
      // "not yellow" does not orphan a later real answer.
      let answered = false;
      for (const clause of clausesOf(reply.text, vocabulary)) {
        const clauseReason = foreign ? "foreign-question" : clauseBlock(clause, vocabulary);
        for (const term of rule.terms) {
          const at = clause.tokens.findIndex((token) => term.tokens.includes(token));
          if (at < 0) continue;
          const negated = clause.tokens
            .slice(Math.max(0, at - window), at)
            .some((token) => vocabulary.markers.negation.includes(token));
          const blockedBy = clauseReason ?? (negated ? "negated" : undefined);
          if (blockedBy === undefined) answered = true;
          matches.push({
            dimension: rule.dimension,
            value: term.value,
            evidenceIndex: index,
            route: "answer",
            matchedText: clause.text,
            ...(blockedBy === undefined ? {} : { blockedBy }),
          });
        }
      }
      if (answered) break;
    }
  });

  return matches;
}

/**
 * Bindings from the trainer's profile (route `profile`, epic #145 R2).
 *
 * A form is context the way a recorded question is: the field said what the
 * value is about, so a typed value binds its dimension with no context word
 * and no card. What the form cannot do is the same as everywhere — it cannot
 * speak on another channel (a profile that arrived as a tool result or a
 * pasted document is born blocked and denied under IA-8 by name), and it
 * cannot name a value the vocabulary lacks (denied under IA-1 as unapproved).
 * The `matchedText` is the typed pair itself, normalised, so replay can
 * point at exactly what bound.
 */
function profileMatches(vocabulary: ScopeVocabulary, transcript: ScopeTranscript): ScopeMatch[] {
  const matches: ScopeMatch[] = [];
  transcript.forEach((event, evidenceIndex) => {
    if (event.kind !== "profile") return;
    const foreign = event.source !== "trainer";
    for (const rule of vocabulary.dimensions) {
      const value = event.scope[rule.dimension];
      if (value === undefined) continue;
      const approved = rule.terms.some((term) => term.value === value);
      const blockedBy = foreign ? "foreign-profile" : approved ? undefined : "unapproved-profile";
      matches.push({
        dimension: rule.dimension,
        value,
        evidenceIndex,
        route: "profile",
        matchedText: `${rule.dimension}=${String(value)}`,
        ...(blockedBy === undefined ? {} : { blockedBy }),
      });
    }
  });
  return matches;
}

function directMatches(vocabulary: ScopeVocabulary, transcript: ScopeTranscript): ScopeMatch[] {
  const matches: ScopeMatch[] = [];

  transcript.forEach((event, evidenceIndex) => {
    if (event.kind !== "utterance") return;
    // The channel decides first and alone. Foreign text is still read here,
    // but only so the console and the verifier can say what it *would* have
    // bound; every match it produces is born blocked and can never be believed.
    const foreign = event.source !== "trainer";

    for (const clause of clausesOf(event.text, vocabulary)) {
      const clauseReason = foreign ? "foreign-channel" : clauseBlock(clause, vocabulary);
      for (const { rule, value, negated } of termsIn(clause, vocabulary)) {
        // An ask-parameter dimension binds inside the trainer's own question
        // — "who's faster?" is where a comparison basis lives (the pack
        // declares which dimensions are the ask's, never this code). Only
        // the question block lifts: clauseBlock orders quoted, instruction
        // and reported above it, so a "question" reason here means none of
        // those applied, and the foreign channel was decided before any.
        const lifted = clauseReason === "question" && rule.askParameter === true ? undefined : clauseReason;
        const blockedBy = lifted ?? (negated ? "negated" : undefined);
        matches.push({
          dimension: rule.dimension,
          value,
          evidenceIndex,
          route: "direct",
          matchedText: clause.text,
          ...(blockedBy === undefined ? {} : { blockedBy }),
        });
      }
    }
  });

  return matches;
}

/**
 * Wording in one utterance that the vocabulary does not cover at all — the
 * ladder's inbox for a single turn. A driver uses this to decide *who asks
 * next*: wording here is something a model could usefully interpret; an
 * utterance with none leaves nothing to interpret, and the pack's own
 * question (free, deterministic, and armed for a direct answer) should do
 * the asking instead of a proposal card.
 *
 * Coverage is by token presence, deliberately looser than a match: a bare
 * "Red" fails the context discipline and still is not long tail — the
 * vocabulary knows the word, and the ladder has nothing to add that a
 * recorded question would not bind more cheaply.
 */
/** Every clause of one utterance, normalised exactly as a binding's
 * `matchedText` is — so a caller can tell which clauses a derivation bound
 * and which it left alone, without re-implementing the split. */
export function clauseTexts(pack: AccordPack, text: string): string[] {
  return clausesOf(text, pack.vocabulary).map((clause) => clause.text);
}

export function unmatchedClauses(pack: AccordPack, text: string): string[] {
  const vocabulary = pack.vocabulary;
  return clausesOf(text, vocabulary)
    .filter((clause) => !clause.quoted)
    .filter(
      (clause) =>
        !vocabulary.dimensions.some((rule) =>
          rule.terms.some((term) => clause.tokens.some((token) => term.tokens.includes(token))),
        ),
    )
    .map((clause) => clause.text);
}

/** Trainer clauses that expressed no dimension at all — the ladder's inbox. */
function unmatchedWording(
  vocabulary: ScopeVocabulary,
  transcript: ScopeTranscript,
  matches: readonly ScopeMatch[],
): string[] {
  const matched = new Set(matches.map((match) => match.matchedText));
  const wording: string[] = [];
  for (const event of transcript) {
    if (event.kind !== "utterance" || event.source !== "trainer") continue;
    for (const clause of clausesOf(event.text, vocabulary)) {
      if (!clause.quoted && !matched.has(clause.text)) wording.push(clause.text);
    }
  }
  return wording;
}

// --- the propose/confirm ladder ---------------------------------------------

/** The digest a confirmation names: the exact candidate, under its proposal. */
export function candidateDigest(proposalId: string, candidate: ScopeCandidate): string {
  return sha256(stableStringify({ proposalId, candidate }));
}

/** Is this a value the League's vocabulary actually offers for this dimension? */
function approved(vocabulary: ScopeVocabulary, dimension: ScopeDimension, value: ScopeValue): boolean {
  const rule = vocabulary.dimensions.find((entry) => entry.dimension === dimension);
  return rule !== undefined && rule.terms.some((term) => term.value === value);
}

/**
 * What the trainer confirmed, and what they were only offered.
 *
 * A proposal is an untrusted candidate however capable the thing that made it.
 * It binds when — and only when — the trainer confirms that exact candidate,
 * checked by digest rather than by a "yes": a candidate edited between being
 * shown and being confirmed is a different candidate, not a close-enough one.
 *
 * And a confirmed candidate is still checked against the approved vocabulary.
 * Otherwise the ladder would be the one hole in a closed system — a proposer
 * could name a version the League never certified, and a trainer clicking yes
 * to a plausible-looking card would mint it.
 */
function confirmedMatches(vocabulary: ScopeVocabulary, transcript: ScopeTranscript): ScopeMatch[] {
  const matches: ScopeMatch[] = [];

  transcript.forEach((event, proposalIndex) => {
    if (event.kind !== "proposal") return;

    // The first reply settles it. A second bite at a candidate the trainer has
    // already answered is a different conversational act, and the Advisor may
    // make a fresh proposal rather than re-reading an old answer.
    const answer = transcript
      .map((reply, index) => ({ reply, index }))
      .find(({ reply }) => reply.kind === "confirmation" && reply.proposalId === event.id);

    const ruling: BlockReason | undefined =
      answer === undefined
        ? "unconfirmed"
        : rulingOn(answer.reply as Extract<ScopeEvent, { kind: "confirmation" }>, event.id, event.candidate);
    const evidenceIndex = answer?.index ?? proposalIndex;

    for (const [key, value] of Object.entries(event.candidate)) {
      if (value === undefined) continue;
      const dimension = key as ScopeDimension;
      const blockedBy = ruling ?? (approved(vocabulary, dimension, value) ? undefined : "unapproved");
      matches.push({
        dimension,
        value,
        evidenceIndex,
        route: "confirmed",
        matchedText: event.interpreting,
        ...(blockedBy === undefined ? {} : { blockedBy }),
      });
    }
  });

  return matches;
}

function rulingOn(
  confirmation: Extract<ScopeEvent, { kind: "confirmation" }>,
  proposalId: string,
  candidate: ScopeCandidate,
): BlockReason | undefined {
  if (confirmation.source !== "trainer") return "foreign-channel";
  if (confirmation.decision === "reject") return "rejected";
  if (confirmation.candidateDigest !== candidateDigest(proposalId, candidate)) return "digest-mismatch";
  return undefined;
}

// --- resolution -------------------------------------------------------------

export type ScopeOutcome =
  | { status: "granted"; grant: ScopeGrant; derivation: ScopeDerivation }
  | {
      status: "clarify";
      /** The one thing to ask about now. One open clarification, never a barrage. */
      asking: ScopeDimension;
      question: string;
      missing: readonly ScopeDimension[];
      derivation: ScopeDerivation;
    }
  | { status: "refused"; violations: readonly Violation[]; derivation: ScopeDerivation };

/**
 * Establish scope, or ask for exactly one more thing.
 *
 * There is no third answer and no partial release. A confirmation commits the
 * mappings it challenged, never completeness, so the required dimensions are
 * re-checked from scratch here every time — including immediately after a
 * trainer says yes to something.
 */
export function resolveScope(context: ScopeContext, transcript: ScopeTranscript): ScopeOutcome {
  const required = context.required ?? REQUIRED_DIMENSIONS;
  const derivation = deriveScope(context.pack, transcript);
  const bound = new Map(derivation.bindings.map((binding) => [binding.dimension, binding]));

  const missing = required.filter(
    (dimension) => !bound.has(dimension) || derivation.contradicted.includes(dimension),
  );
  const asking = missing[0];
  if (asking !== undefined) {
    const rule = context.pack.vocabulary.dimensions.find((entry) => entry.dimension === asking);
    return {
      status: "clarify",
      asking,
      // A dimension with no question is unaskable, which the pack loader
      // already refuses; this stays honest rather than inventing prose.
      question: rule?.question ?? `Which ${asking} applies?`,
      missing,
      derivation,
    };
  }

  const bindings = derivation.bindings.filter(
    (binding) => required.includes(binding.dimension) || binding.dimension === "comparisonBasis",
  );
  const grant = mint(context, transcript, bindings);
  const verdict = verifyScopeGrant(context, transcript, grant);
  if (!verdict.allowed) return { status: "refused", violations: verdict.violations, derivation };
  return { status: "granted", grant, derivation };
}

/** The same thing {@link resolveScope} returns, for callers that only want the grant. */
export function establishScope(context: ScopeContext, transcript: ScopeTranscript): Resolution<ScopeGrant> {
  const outcome = resolveScope(context, transcript);
  if (outcome.status === "granted") return { ok: true, value: outcome.grant };
  if (outcome.status === "refused") return { ok: false, violations: outcome.violations };
  return {
    ok: false,
    violations: [
      violation("IA-1", "scope-incomplete", `scope is not established: ${outcome.question}`, {
        expected: outcome.missing.join(", "),
        actual: outcome.derivation.bindings.map((binding) => binding.dimension).join(", ") || "nothing",
      }),
    ],
  };
}

function mint(context: ScopeContext, transcript: ScopeTranscript, bindings: readonly ScopeBinding[]): ScopeGrant {
  const evidenceDigest = digestTranscript(transcript);
  const issued = Date.parse(context.at);
  return {
    // Derived from the evidence rather than from a counter or a clock, so the
    // same conversation replayed produces the same grant, id and all.
    id: `grant-${evidenceDigest.slice("sha256:".length, "sha256:".length + 12)}`,
    packId: context.pack.id,
    scope: assemble(bindings),
    bindings,
    evidenceDigest,
    issuedAt: context.at,
    expiresAt: new Date(issued + context.pack.vocabulary.validitySeconds * 1000).toISOString(),
  };
}

/**
 * Bindings to typed scope. Written out one dimension at a time rather than
 * spread: the compiler then checks that a numeric dimension carries a number,
 * which is the difference between typed scope and a bag of strings.
 */
function assemble(bindings: readonly ScopeBinding[]): TrainerScope {
  const scope: Partial<TrainerScope> = {};
  for (const binding of bindings) {
    if (binding.dimension === "badgeLevel" && typeof binding.value === "number") scope.badgeLevel = binding.value;
    if (binding.dimension === "version" && typeof binding.value === "string") scope.version = binding.value;
    if (binding.dimension === "region" && typeof binding.value === "string") scope.region = binding.value;
    if (binding.dimension === "comparisonBasis" && typeof binding.value === "string") {
      scope.comparisonBasis = binding.value;
    }
  }
  return scope as TrainerScope;
}

function valueIn(scope: TrainerScope, dimension: ScopeDimension): ScopeValue | undefined {
  return scope[dimension];
}

// --- the gate ---------------------------------------------------------------

/**
 * Recompute a grant from the evidence it claims to rest on.
 *
 * This knows nothing about how the grant was produced. A grant from the
 * resolver, from a cache, from a mutated fixture, or one day from an agent
 * loop is checked identically, so nothing about the producer can be
 * load-bearing.
 */
export function verifyScopeGrant(
  context: ScopeContext,
  transcript: ScopeTranscript,
  grant: ScopeGrant,
): Verdict {
  // Binding first and alone: a grant read under a different vocabulary, or
  // against a transcript that has since been edited, cannot be re-derived at
  // all, and reporting the downstream disagreements would be noise.
  if (grant.packId !== context.pack.id) {
    return verdictOf([
      violation("IA-1", "scope-pack-mismatch", `grant ${grant.id} was established under another Accord pack`, {
        expected: context.pack.id,
        actual: grant.packId,
      }),
    ]);
  }
  const digest = digestTranscript(transcript);
  if (grant.evidenceDigest !== digest) {
    return verdictOf([
      violation("IA-1", "evidence-digest-mismatch", `the evidence behind grant ${grant.id} is not the evidence recorded`, {
        expected: grant.evidenceDigest,
        actual: digest,
      }),
    ]);
  }

  const derivation = deriveScope(context.pack, transcript);
  const violations = [
    ...grant.bindings.flatMap((binding) => checkBinding(context, transcript, derivation, grant, binding)),
    ...checkCompleteness(context, grant),
  ];
  return verdictOf(violations);
}

function checkBinding(
  context: ScopeContext,
  transcript: ScopeTranscript,
  derivation: ScopeDerivation,
  grant: ScopeGrant,
  binding: ScopeBinding,
): Violation[] {
  const label = `${binding.dimension}=${String(binding.value)}`;
  const event = transcript[binding.evidenceIndex];
  if (event === undefined) {
    return [
      violation("IA-1", "evidence-not-recorded", `grant ${grant.id} binds ${label} to evidence the record does not contain`, {
        expected: `an event in a ${transcript.length}-event transcript`,
        actual: `index ${binding.evidenceIndex}`,
      }),
    ];
  }

  // The excluded matches are consulted before the believed ones. A grant that
  // read a rival's wish as the trainer's must be refused as reported speech,
  // not as a value that disagrees with the one the trainer actually gave.
  const blocked = derivation.ignored.find(
    (match) =>
      match.dimension === binding.dimension &&
      match.value === binding.value &&
      match.evidenceIndex === binding.evidenceIndex,
  );
  if (blocked !== undefined) {
    const denial = BLOCK_DENIALS[blocked.blockedBy];
    return [
      violation(denial.article, denial.rule, `grant ${grant.id} binds ${label} from wording that establishes nothing: ${denial.because}`, {
        expected: "wording the trainer used to describe themselves",
        actual: blocked.matchedText,
      }),
    ];
  }

  if (derivation.contradicted.includes(binding.dimension)) {
    return [
      violation("IA-1", "scope-contradicted", `the evidence establishes "${binding.dimension}" two ways, so it establishes neither`, {
        expected: "one value, or a question to the trainer",
        actual: label,
      }),
    ];
  }

  const derived = derivation.bindings.find((entry) => entry.dimension === binding.dimension);
  if (derived === undefined) {
    return [
      violation("IA-1", "scope-unevidenced", `nothing in the record establishes ${label}`, {
        expected: `evidence for ${binding.dimension}`,
        actual: binding.matchedText || "no wording recorded",
      }),
    ];
  }
  if (derived.value !== binding.value) {
    return [
      violation("IA-1", "scope-value-mismatch", `the record establishes a different "${binding.dimension}" from the one granted`, {
        expected: String(derived.value),
        actual: String(binding.value),
      }),
    ];
  }
  if (derived.evidenceIndex !== binding.evidenceIndex || derived.route !== binding.route) {
    return [
      violation("IA-1", "binding-misattributed", `grant ${grant.id} credits ${label} to the wrong evidence`, {
        expected: `${derived.route} at event ${derived.evidenceIndex}`,
        actual: `${binding.route} at event ${binding.evidenceIndex}`,
      }),
    ];
  }

  const violations: Violation[] = [];
  if (valueIn(grant.scope, binding.dimension) !== binding.value) {
    violations.push(
      violation("IA-1", "scope-value-mismatch", `grant ${grant.id} shows a "${binding.dimension}" its own bindings do not support`, {
        expected: String(binding.value),
        actual: String(valueIn(grant.scope, binding.dimension)),
      }),
    );
  }
  // Scope valid at issue is not scope established before it was said.
  if (Date.parse(grant.issuedAt) < Date.parse(event.at)) {
    violations.push(
      violation("IA-1", "grant-predates-evidence", `grant ${grant.id} was issued before the evidence behind ${label}`, {
        expected: `at or after ${event.at}`,
        actual: grant.issuedAt,
      }),
    );
  }
  return violations;
}

function checkCompleteness(context: ScopeContext, grant: ScopeGrant): Violation[] {
  const required = context.required ?? REQUIRED_DIMENSIONS;
  const bound = new Set(grant.bindings.map((binding) => binding.dimension));
  const violations: Violation[] = [];

  for (const dimension of required) {
    if (bound.has(dimension) && valueIn(grant.scope, dimension) !== undefined) continue;
    violations.push(
      violation("IA-1", "scope-incomplete", `grant ${grant.id} was released without establishing "${dimension}"`, {
        expected: required.join(", "),
        actual: [...bound].join(", ") || "nothing",
      }),
    );
  }

  // A value on the record with no binding behind it is the same failure seen
  // from the other side: something the trainer never said, shown as scope.
  for (const dimension of SCOPE_DIMENSIONS) {
    if (valueIn(grant.scope, dimension) === undefined || bound.has(dimension)) continue;
    violations.push(
      violation("IA-1", "scope-unevidenced", `grant ${grant.id} shows a "${dimension}" nothing in the record establishes`, {
        expected: "a binding, or no value at all",
        actual: String(valueIn(grant.scope, dimension)),
      }),
    );
  }

  return violations;
}

// --- digests ----------------------------------------------------------------

export function digestTranscript(transcript: ScopeTranscript): string {
  return sha256(stableStringify(transcript));
}

function sha256(value: string): string {
  return `sha256:${sha256Hex(value)}`;
}
