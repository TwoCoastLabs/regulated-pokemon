/**
 * The Advisor's two propose steps, wired to a model.
 *
 * This is the only code that lets a model speak into the pipeline, and it is
 * trusted with nothing. A scope proposal becomes an untrusted `proposal` event
 * that binds only if the trainer confirms it (the kernel's ladder); an answer
 * becomes a draft that `compileManifest` recomputes from the snapshot. The
 * adapter's whole job is to build the prompt, decode the reply, and hand the
 * result to machinery that assumes it is hostile.
 *
 * Prompts are plain and deterministic. A run has to replay (IA-10), so nothing
 * here reads a clock or the environment; the timestamp an event carries is
 * supplied by the caller, exactly as `runTransaction` takes its own.
 */

import type { ScopeDimension, ScopeEvent, ScopeTranscript, TrainerScope } from "../kernel/contracts.js";
import type { ManifestContext } from "../kernel/manifest.js";
import { type AccordPack, type DictionaryEntry, type DictionarySubject, NO_FIELD } from "../kernel/pack.js";
import { MOVE_FACT_IDS, SPECIES_FACT_IDS , ITEM_FACT_IDS, STATUS_CONDITIONS } from "../kernel/registry.js";
import { candidateDigest } from "../kernel/scope.js";
import { type AnswerDecode, decodeAnswer, decodeCandidate } from "./decode.js";
import type { CompletionRequest, ModelProvider, Usage } from "./provider.js";
import { certifiedReference, retrieveReference } from "./reference.js";
import { ANSWER_SCHEMA_NAME, answerSchema } from "./schema.js";
import { nominateFillerKinds } from "./grammar-gate.js";
import type { NominableRoute } from "./schema.js";

/** Only the trainer's own words are evidence (IA-8); the model interprets those. */
function trainerText(transcript: ScopeTranscript): string[] {
  return transcript
    .filter((event): event is Extract<ScopeEvent, { kind: "utterance" }> => event.kind === "utterance")
    .filter((event) => event.source === "trainer")
    .map((event) => event.text);
}

/**
 * The exchange as the answer step is shown it: the trainer's own words, and
 * — between them, where it happened — the advisor's own clarification (R3b
 * step 3) so the pick that follows it can be read. The clarification is
 * labelled as the advisor's, never as the trainer's words: IA-8 holds in the
 * prompt as in the resolver, and a question the model itself asked is
 * context, not evidence.
 */
function exchangeLines(transcript: ScopeTranscript): string[] {
  return transcript.flatMap((event) => {
    if (event.kind === "utterance" && event.source === "trainer") return [event.text];
    if (event.kind === "clarification" && event.source === "advisor") {
      return [`(you asked them: "${event.text}" — options: ${event.options.map((option) => option.label).join(" / ")})`];
    }
    return [];
  });
}

function approvedValues(pack: AccordPack, dimension: ScopeDimension): string {
  const rule = pack.vocabulary.dimensions.find((entry) => entry.dimension === dimension);
  return (rule?.terms ?? []).map((term) => String(term.value)).join(", ");
}

function scopePrompt(pack: AccordPack, missing: readonly ScopeDimension[], said: readonly string[]): string {
  const options = missing.map((dimension) => `  ${dimension}: one of [${approvedValues(pack, dimension)}]`).join("\n");
  return [
    "The trainer said:",
    ...said.map((line) => `  - ${line}`),
    "",
    `Still unestablished: ${missing.join(", ")}.`,
    "Propose one approved value per dimension you can justify from the trainer's",
    "own words, as JSON: {\"candidate\": {<dimension>: <value>}, \"interpreting\": \"<their wording>\"}.",
    "In \"interpreting\", quote the trainer's exact words you are reading — never",
    "your own reasoning about them.",
    "Approved values:",
    options,
  ].join("\n");
}

/**
 * The answer contract, described but never answered.
 *
 * A live model cannot return a shape it was never shown: told only "reply with
 * rosters and claims" it invents a plausible team-builder object and the
 * decoder rejects it, so usefulness reads zero for a reason that has nothing to
 * do with the architecture. This spells out the schema — the roster-criteria
 * vocabulary and the claim kinds — and deliberately no content: no entity, no
 * count, no stat value appears here, so what the model asserts is still its own
 * and the usefulness number still measures the model. Identifiers are the
 * registry's canonical ids (lowercase, hyphenated), and a claim is recomputed
 * from the certified registry before it may commit, so an unsupported one sinks
 * the whole answer — omit what you cannot stand behind rather than guess.
 *
 * It also shows the model what the trainer actually asked. That is a
 * correctness fix, not a nudge toward a number: the step was composing an
 * answer from the *profile* alone (version, region, badges) and could not see
 * the question, so it improvised unbidden claims — and every unrequested claim
 * is one more thing that can be wrong and sink the whole answer under IA-4. A
 * responsive advisor answers what was asked; showing it the ask is the input
 * that step was missing, not tuning to make the reply look better.
 *
 * And it names the certified fact vocabulary — the fact *ids* that resolve, not
 * their *values*. A model asked for a species fact reaches for a plausible id
 * ("type", "national-dex-number") the snapshot does not carry, and IA-2 refuses
 * it though the value it had in mind was right. Listing the ids (drawn straight
 * from the registry, so the prompt cannot drift from what actually resolves) is
 * the same schema disclosure the roster vocabulary already makes: the menu, not
 * the meal. What each fact *is* stays the model's to assert or omit.
 *
 * The whole block is part of the run artifact by design: a reader can see
 * exactly what the model was and was not told.
 */
/** The dictionary as the model reads it: every certified field by id, with
 * its name and one line of description, grouped by the subject whose field it
 * is. Ids only — the aliases are the driver's cross-check, not a hint. */
function dictionaryLines(dictionary: readonly DictionaryEntry[], items: boolean): string[] {
  const heading: Record<DictionarySubject, string> = {
    species: "about a species (entityId is a species id):",
    move: "about a move (entityId is a move id):",
    item: "about an item (entityId is an item id):",
    type: "about type effectiveness (entityId is a species or a type; answer it with a matchup claim, never a fact):",
  };
  const subjects: DictionarySubject[] = items ? ["species", "move", "item", "type"] : ["species", "move", "type"];
  return subjects.flatMap((subject) => {
    const fields = dictionary.filter((entry) => entry.subject === subject);
    if (fields.length === 0) return [];
    return [`  ${heading[subject]}`, ...fields.map((entry) => `    ${entry.id} — ${entry.name}: ${entry.description}`)];
  });
}

function answerPrompt(
  scope: TrainerScope | undefined,
  asks: readonly string[],
  previously: readonly string[] | undefined,
  previousSubjects: readonly string[] | undefined,
  routes: readonly NominableRoute[] | undefined,
  tools: readonly string[],
  lessons: readonly string[],
  rules: readonly { id: string; label: string }[],
  reference: string | undefined,
  dictionary: readonly DictionaryEntry[],
  feedback: readonly string[] | undefined,
  items = false, itemCategories: readonly string[] = [],
  clarify = false,
  suggest = false,
): string {
  return [
    // Grounding, when on: the certified facts in front of the model so it reads
    // rather than recalls. Prefixed, so the contract and the question that
    // follow are read in its light. Absent when ungrounded — the same prompt
    // otherwise, so the two are a clean before/after.
    ...(reference === undefined ? [] : [reference, ""]),
    ...(scope === undefined
      ? [
          // The discovery call (epic #64, slice 2): scope is gathered *after*
          // the answer's shape is known, so this call learns that shape. A
          // lesson certifies now; any other claim is read as intent — it names
          // the scope to establish first, and only what that claim needs.
          "Scope is NOT established yet: nothing about this trainer is known.",
          "A lesson (explanation claim) can be certified right now. Any other",
          "claim you propose is read as intent: it will not be certified here,",
          "it tells the system which scope to establish first, and only what",
          "that claim needs. Propose the claims that answer what they asked.",
          "Small talk, greetings, or questions about you rather than the game —",
          '"hi", "are you working?", "thanks" — are off-topic: reply with no',
          "claims at all. Do not reach for a lesson that is merely adjacent; a",
          "lesson is for a real question about what something is or how the game",
          "works, not a way to avoid saying nothing. When a built-in door fits",
          "the ask better than a lesson — see the nominations below, if any are",
          "offered — nominate the door instead. A question about a specific",
          "character or how the story unfolds, or anything no lesson squarely",
          "covers, also gets no claims — the records certify Pokémon and rules,",
          "not people or plot, and an honest pass beats teaching the nearest thing.",
          ...(suggest ? ["A lesson you teach here also carries the suggested questions described below, like any answer."] : []),
        ]
      : [
          "Scope is established:",
          `  version=${scope.version} region=${scope.region} badges=${scope.badgeLevel}` +
            (scope.comparisonBasis === undefined ? "" : ` basis=${scope.comparisonBasis}`),
        ]),
    "",
    ...(previously === undefined || previously.length === 0
      ? []
      : ["Earlier in this conversation the trainer said (context for the ask below, not itself the ask):", ...previously.map((line) => `  - ${line}`), ""]),
    ...(previousSubjects === undefined || previousSubjects.length === 0
      ? []
      : [
          `The previous certified answer the trainer is looking at was about: ${previousSubjects.join(", ")}.`,
          '"It", "this one" or "this species" in the ask below most likely means one of these — use that id.',
          "",
        ]),
    "The trainer's own words:",
    ...asks.map((line) => `  - ${line}`),
    "",
    // The verifier-in-the-loop retry (docs/routing.md, R3b): the previous
    // reply's denial, by name, in fixed wording the driver derives from the
    // violations — never free prose, so the record shows exactly what the
    // model was told and a reader can replay the reasoning.
    ...(feedback === undefined || feedback.length === 0
      ? []
      : [
          "Your previous answer to these words was refused by the verifier, by name:",
          ...feedback.map((line) => `  - ${line}`),
          "Do not repeat the refused claim. Only the ids in the closed lists below resolve.",
          "If the thing asked about is not one of them, link its phrase to \"none\" in \"asked\"",
          "and claim nothing — unless a lesson squarely answers the question, in which case",
          "teach that lesson; a lesson that is merely adjacent is worse than no claim.",
          "",
        ]),
    "Answer what they asked, and assert nothing they did not: an unrequested",
    "claim is one more thing that can be wrong, and one wrong claim refuses the",
    "whole answer. Omit anything you cannot support rather than guess. At most",
    "twelve claims and four rosters fit one answer — choose the ones the",
    "question calls for, and never state the same claim twice.",
    "",
    "Prefer the most specific claim the question calls for: a \"how many\" is a",
    "count, a stat question a fact, a weakness question a matchup. Reach for a",
    "lesson only when no such claim fits.",
    "",
    ...(dictionary.length === 0
      ? ['Reply with one JSON object, {"rosters": [...], "claims": [...]}, and nothing else.']
      : [
          // Schema linking (docs/routing.md, R3b): the model says what each
          // phrase of the ask is about before it says anything about it.
          // The driver holds the claims to this — a claim about a field not
          // linked is dropped — so "true but not what you asked" cannot be
          // stated in this grammar without the mapping contradicting it.
          'Reply with one JSON object, {"asked": [...], "rosters": [...], "claims": [...]}, and nothing else.',
          "",
          "First, link each thing the trainer asked for to the certified field it names, from",
          "the data dictionary at the end:",
          `  {"phrase": "<their words for the thing>", "entityId": "<the subject's id>", "fieldId": "<field-id>" | "${NO_FIELD}"}`,
          `One entry per thing asked for. Use "${NO_FIELD}" when the records certify no such field —`,
          "a height, a weight, an ability, a cry, the story, anything the dictionary does not",
          `list. "${NO_FIELD}" is an honest answer and is reported to the trainer in your phrase;`,
          "linking a field that merely resembles the ask is not. Every fact, comparison, ranking",
          "or matchup claim must be about a field you linked here: the others are dropped.",
        ]),
    "",
    ...(clarify && dictionary.length > 0
      ? [
          // The clarification nomination (docs/routing.md, R3b step 3): the
          // model may ask, in its own words, with typed options; the
          // trainer's pick binds. Asked only for a real ambiguity — the
          // driver caps the chain at two per ask, and a question the model
          // could have answered is a lost turn, not a safe one.
          "When their words are genuinely ambiguous — you cannot tell WHICH field they mean",
          '("is it strong?" could be its Attack or, for a move, its power) or WHICH subject ("the fast',
          'one") — do not guess and do not answer the nearest reading: ask. Reply with ONE clarify',
          "entry in \"claims\" and no other claim:",
          '  {"kind": "clarify", "about": "<their words for the ambiguous thing>", "question": "<one short question in your own words, ending in ?>",',
          '   "options": [{"kind": "field", "label": "<two or three words>", "fieldId": "<field-id>" | "' + NO_FIELD + '"} | {"kind": "entity", "label": "<its name>", "entityId": "<certified id>"}, ...]}',
          "Two to four options, each a real reading of their words, typed: a field of the dictionary",
          `("${NO_FIELD}" for "none of these"), or a certified subject. The trainer picks one and you`,
          `then answer that reading. A phrase whose SUBJECT you cannot place is not "${NO_FIELD}" and not an`,
          "empty reply — an empty reply is for small talk and off-topic words; an on-topic ask you cannot",
          "place is this question, with the likely subjects as entity options. Ask only when the ambiguity is real; never ask about the",
          "trainer's own scope (their game version, region or standing) — the system asks those",
          "itself; and the question may state no fact and no number. If their words already pick one reading",
          "(they named the field or the subject, or answered a question of yours), answer it.",
          "",
        ]
      : []),
    ...(suggest
      ? [
          // Follow-up suggestions (docs/routing.md, R3b step 4): a next step
          // beside every answer, shown as the model's own and uncertified.
          // The topic-not-value rule is the kernel's gate as well as this
          // sentence; the driver drops what the gate would refuse.
          // Worded around "questions", never "next step" or "follow-up
          // action": the strong model read "ends with a next step" as an
          // act and answered "what's a gym badge?" with an add-to-team
          // action on the lesson id (dogfood, 2026-09-06). A suggestion is
          // a question the trainer may ask; the sentence says only that.
          "Also add, after your claims, ONE entry listing two or three QUESTIONS the trainer might want to",
          "ask you next — for every answer, a lesson included:",
          '  {"kind": "suggest", "asks": ["<a short question in the trainer\'s voice>", ...]}',
          'Each is a question about this same subject or a related one, worded with "it" or "they" —',
          "never a number and never a name from the records (no species, move, item or type by name): a",
          "suggestion names a topic, not a value, and one that states a value is dropped. These are shown",
          "beside the certified answer as your suggested questions, labelled uncertified. They are not",
          "claims and not actions. Do not add them beside a clarify entry or an empty reply.",
          "",
        ]
      : []),
    "A roster is a declarative set you name and then cite by id:",
    '  {"id": "<your-id>", "criteria": {"all": [<criterion>, ...]}}',
    // Vacuous satisfaction is a logician's reading; the catalogue-wide set
    // must be stated or a small model abstains on "the strongest Pokémon"
    // (tire-kicking, 2026-08-30 — the filed coverage runs show the strong
    // model discovering {"all": []} on its own; the weak one never did).
    'An EMPTY criteria list means every certified member: {"criteria": {"all": []}} is the whole certified set — use it when a question ranges over all Pokémon rather than a named group, e.g. as the set a catalogue-wide ranking runs over.',
    "where each criterion is one of:",
    '  {"kind": "has-type", "type": "<type-id>"}',
    '  {"kind": "learns-move", "move": "<move-id>"}',
    '  {"kind": "rarity", "rarity": "legendary" | "mythical"}',
    '  {"kind": "stat-at-least", "stat": "<stat-id>", "value": <number>}',
    '  {"kind": "stat-at-most", "stat": "<stat-id>", "value": <number>}',
    ...(items
      ? [
          "…or an ITEM roster, whose criteria are ONLY these (never mixed with the species criteria above):",
          '  {"kind": "item-category", "category": "<category-id>"}  — items in a certified category',
          '  {"kind": "treats-condition", "condition": "<condition>"}  — items that treat that status condition',
          '  {"kind": "cost-at-most", "value": <number>}',
          '  {"kind": "cost-at-least", "value": <number>}',
          `A <category-id> must be one of: ${itemCategories.join(", ")}. No other category exists.`,
        ]
      : []),
    "A member is exactly what satisfies every criterion. Species criteria define a set of species" +
      (items
        ? "; item criteria a set of items — one roster is one universe, never both. A \"what all…\" or \"cheapest…\" over items (everything that cures a condition, everything under a price) is an item roster plus a count or a ranking: the system then derives the certified set, the number or the winner, which answers it more strongly than naming examples one by one."
        : "."),
    "",
    ...(routes === undefined || routes.length === 0
      ? []
      : [
          "Some asks are better served by a built-in door than by composing claims. When one of these",
          "descriptions fits the ask, reply with ONE nomination claim and nothing else —",
          '  {"kind": "route", "routeId": "<id>", ...its arguments} — and the system does the rest:',
          ...routes.map((route) => `  - ${route.id}: ${route.description}`),
          "",
        ]),
    "Each claim is one of:",
    '  {"kind": "fact", "entityId": "<id>", "factId": "<fact-id>"}  — the system reads the certified value; you may add "asserted" only when you are certain of the exact certified form, and a wrong one refuses the whole answer',
    '  {"kind": "count", "rosterId": "<id>"}  — defines a set to be counted; the system counts it, so state no number',
    '  {"kind": "typeCount"}  — how many types exist in this generation; the system counts the certified type chart',
    ...(rules.length === 0
      ? []
      : [
          '  {"kind": "gameRule", "ruleId": "<rule-id>"}  — a fixed rule of the game as a certified number. Use it only for a "how many" question about a rule (how many Pokémon fit on a team, how many moves one can know). It counts a rule; it does not list what a trainer owns — the records do not know this trainer\'s team, so "what is on my team?" gets no claim. The system fills the number, so state none.',
        ]),
    '  {"kind": "membership", "rosterId": "<id>", "entityId": "<id>", "asserted": <boolean>}',
    'To LIST some members of a set ("name a few", "list 10"): name one roster, then one membership claim per member you list, "asserted": true — each is checked against the certified set. Add a count claim beside them so the total stands next to the sample.',
    ...(items
      ? [
          '  {"kind": "treats", "itemId": "<item-id>", "condition": "<condition>"}  — does this item treat that condition? The system derives the certified yes or no from the item\'s closed effect set, so state neither; the certified *no* is a real answer. A <condition> must be one of: poison, burn, freeze, sleep, paralysis, confusion.',
          '  {"kind": "comparison", "factId": "<numeric-fact-id>", "leftId": "<id>", "rightId": "<id>"}  — one certified numeric fact on two DIFFERENT entities; the system derives both values, the gap and which leads, so state none of them. Only numeric facts compare — cost, restores-hp, restores-pp, a base stat, move-power — never prose or lists (what an item does is a fact claim, not a comparison). Never compare a thing with itself: one entity\'s value is a fact claim.',
        ]
      : []),
    '  {"kind": "ranking", "rosterId": "<id>", "basis": "<fact-id>", "direction": "highest"|"lowest"}  — defines a set and an ordering; the system names the winner, so name none',
    '  {"kind": "matchup", "subject": {"kind": "species", "entityId": "<id>"} | {"kind": "type", "typeId": "<type>"}, "direction": "weak-to"|"resists"|"immune-to"|"strong-against"}  — type effectiveness; the system reads the chart and lists the types, so list none. A species can be weak-to, resist or be immune-to; only a type can be strong-against.',
    'Matchup direction follows the QUESTION, not the subject: "what beats X" / "what is good against X" / "how do I counter X" asks what X is weak-to; "what does X beat" / "what is X good against" asks what X is strong-against. Getting this backwards certifies a true chart for the wrong question.',
    '  {"kind": "eligibility", "entityId": "<species-id>"}  — what the League\'s rules say about advising this trainer toward that species; the system derives the verdict, the rule and the thresholds. Use it when the trainer asks about a restricted species you cannot recommend to them: the rule itself is a useful, certified answer, and you may pair it with a recommendation of an eligible alternative.',
    ...(lessons.length === 0
      ? []
      : [
          '  {"kind": "explanation", "blockId": "<lesson-id>"}  — a reviewed lesson from the League\'s catalogue, shown to the trainer word for word. Route to it when the trainer asks what something is or how the game works. It is a last resort, never a shortcut: if a count, fact, matchup or eligibility claim can answer the question, use that — a lesson that merely mentions the answer in prose is a worse answer than the certified value itself. You may pair a lesson with the structured claims that answer the specific case.',
        ]),
    '  {"kind": "recommendation", "entityId": "<id>"}',
    '  {"kind": "action", "tool": "<tool-id>", "entityId": "<species-id>"}  — an act you propose to perform. It is shown to the trainer and executes only on their confirmation; claim one only when the trainer asked for it.',
    "",
    ...(lessons.length === 0 ? [] : [`A <lesson-id> must be one of: ${lessons.join(", ")}. No other lesson exists.`]),
    ...(rules.length === 0
      ? []
      : [`A <rule-id> must be one of, each with what it counts: ${rules.map((rule) => `${rule.id} (${rule.label})`).join(", ")}. No other rule exists.`]),
    `A <tool-id> must be one of: ${tools.join(", ")}. No other tool exists.`,
    "",
    ...(dictionary.length === 0
      ? [
          "A <fact-id> must be one of these certified ids; no other resolves.",
          `  about a species (entityId is a species id): ${SPECIES_FACT_IDS.join(", ")}`,
          `  about a move (entityId is a move id): ${MOVE_FACT_IDS.join(", ")}`,
          ...(items ? [`  about an item (entityId is an item id): ${ITEM_FACT_IDS.join(", ")}`] : []),
        ]
      : [
          "The data dictionary — every certified field, by id. A <field-id> and a <fact-id> must be one of these; no other resolves.",
          ...dictionaryLines(dictionary, items),
        ]),
    "Cite only rosters you defined; recompute nothing you are unsure of — omit it.",
  ].join("\n");
}

/**
 * The control arm's prompt: the same question, the same grammar, no kernel.
 *
 * Three deliberate differences from {@link answerPrompt}, each of which *is*
 * the ungoverned condition rather than a handicap applied to it:
 *
 *  - **No established scope.** A raw agent has no ladder to escalate to, so it
 *    answers from the trainer's words alone and fills any gap itself — the
 *    silent scope choice IA-1 exists to forbid.
 *  - **Derivables are the model's to state.** There is no kernel to count a
 *    set or name a ranking's winner, so the prompt asks for the number and the
 *    winner outright — they are published exactly as stated.
 *  - **An action executes as claimed.** Nothing renders a page or collects a
 *    confirmation; claiming an act is performing it.
 *
 * The grammar itself stays: it is the corpus's interlingua for *what set an
 * answer means*, which is what keeps a raw answer measurable by the same
 * deterministic meter — with no LLM judge — rather than prose someone has to
 * interpret.
 */
function rawPrompt(asks: readonly string[], tools: readonly string[], items = false, itemCategories: readonly string[] = []): string {
  return [
    "The trainer's own words:",
    ...asks.map((line) => `  - ${line}`),
    "",
    "Answer what they asked, directly. Your reply is final and is shown to the",
    "trainer exactly as you state it — nothing recomputes or checks it first.",
    "",
    'Reply with one JSON object, {"rosters": [...], "claims": [...]}, and nothing else.',
    // A chatbot can say "I can't help with that"; in a claim grammar the
    // equivalent has to be offered, or the model pads with the cheapest
    // valid claim — the first governance-tax probe (2026-09-10) answered
    // "What's the weather like today?" with a bare type count.
    'If none of these claims answers what was asked, reply {"rosters": [], "claims": []} — an empty answer is allowed.',
    "",
    "A roster is a declarative set you name and then cite by id:",
    '  {"id": "<your-id>", "criteria": {"all": [<criterion>, ...]}}',
    // Vacuous satisfaction is a logician's reading; the catalogue-wide set
    // must be stated or a small model abstains on "the strongest Pokémon"
    // (tire-kicking, 2026-08-30 — the filed coverage runs show the strong
    // model discovering {"all": []} on its own; the weak one never did).
    'An EMPTY criteria list means every certified member: {"criteria": {"all": []}} is the whole certified set — use it when a question ranges over all Pokémon rather than a named group, e.g. as the set a catalogue-wide ranking runs over.',
    "where each criterion is one of:",
    '  {"kind": "has-type", "type": "<type-id>"}',
    '  {"kind": "learns-move", "move": "<move-id>"}',
    '  {"kind": "rarity", "rarity": "legendary" | "mythical"}',
    '  {"kind": "stat-at-least", "stat": "<stat-id>", "value": <number>}',
    '  {"kind": "stat-at-most", "stat": "<stat-id>", "value": <number>}',
    ...(items
      ? [
          "…or an ITEM roster, whose criteria are ONLY these (never mixed with the species criteria above):",
          '  {"kind": "item-category", "category": "<category-id>"}',
          '  {"kind": "treats-condition", "condition": "<condition>"}  — items that treat that status condition',
          '  {"kind": "cost-at-most", "value": <number>}',
          '  {"kind": "cost-at-least", "value": <number>}',
          `A <category-id> must be one of: ${itemCategories.join(", ")}. No other category exists.`,
        ]
      : []),
    "",
    "Each claim is one of:",
    '  {"kind": "fact", "entityId": "<id>", "factId": "<fact-id>", "asserted": {"kind": "number"|"boolean"|"text"|"list"|"absent", "value": ...}}',
    '  {"kind": "count", "rosterId": "<id>", "reported": <number>}  — state the number yourself; nothing counts it for you',
    '  {"kind": "typeCount"}  — how many types exist in this generation; the kernel counts the certified type chart',
    '  {"kind": "membership", "rosterId": "<id>", "entityId": "<id>", "asserted": <boolean>}',
    'To LIST some members of a set ("name a few", "list 10"): name one roster, then one membership claim per member you list, "asserted": true — each is checked against the certified set. Add a count claim beside them so the total stands next to the sample.',
    ...(items
      ? [
          '  {"kind": "treats", "itemId": "<item-id>", "condition": "<condition>"}  — does this item treat that condition? The system derives the certified yes or no from the item\'s closed effect set, so state neither; the certified *no* is a real answer. A <condition> must be one of: poison, burn, freeze, sleep, paralysis, confusion.',
          '  {"kind": "comparison", "factId": "<numeric-fact-id>", "leftId": "<id>", "rightId": "<id>"}  — one certified numeric fact on two DIFFERENT entities; the system derives both values, the gap and which leads, so state none of them. Only numeric facts compare — cost, restores-hp, restores-pp, a base stat, move-power — never prose or lists (what an item does is a fact claim, not a comparison). Never compare a thing with itself: one entity\'s value is a fact claim.',
        ]
      : []),
    '  {"kind": "ranking", "rosterId": "<id>", "basis": "<fact-id>", "direction": "highest"|"lowest", "selectedEntityId": "<id>"}  — name the winner yourself',
    '  {"kind": "matchup", "subject": {"kind": "species", "entityId": "<id>"} | {"kind": "type", "typeId": "<type>"}, "direction": "weak-to"|"resists"|"immune-to"|"strong-against", "members": ["<type>", ...]}  — list the types yourself; nothing reads the chart for you',
    '  {"kind": "eligibility", "entityId": "<species-id>", "finding": {"eligible": <boolean>, "badgeLevel": <number>, "ruleId": "<id>", "minimumBadgeLevel": <number>}}  — state the verdict and thresholds yourself; nothing derives them for you',
    '  {"kind": "recommendation", "entityId": "<id>"}',
    '  {"kind": "action", "tool": "<tool-id>", "entityId": "<species-id>"}  — claiming an act performs it, immediately.',
    "",
    `A <tool-id> must be one of: ${tools.join(", ")}. No other tool exists.`,
    "",
    "A <fact-id> must be one of these ids:",
    `  about a species (entityId is a species id): ${SPECIES_FACT_IDS.join(", ")}`,
    `  about a move (entityId is a move id): ${MOVE_FACT_IDS.join(", ")}`,
    ...(items ? [`  about an item (entityId is an item id): ${ITEM_FACT_IDS.join(", ")}`] : []),
    "Identifiers are lowercase and hyphenated.",
  ].join("\n");
}

export interface ScopeStep {
  usage: Usage;
  /** The proposal to append, or null when the model returned nothing usable. */
  event: Extract<ScopeEvent, { kind: "proposal" }> | null;
}

export interface ScopeStepInput {
  provider: ModelProvider;
  pack: AccordPack;
  scenarioId: string;
  transcript: ScopeTranscript;
  missing: readonly ScopeDimension[];
  unmatched: readonly string[];
  /** Stable per turn, so the proposal id and its confirmation replay. */
  turn: number;
  at: string;
}

/** Ask the model to interpret long-tail wording, and record it as an untrusted
 * proposal. A malformed reply yields no event — a fail-closed abstention. */
export async function proposeScope(input: ScopeStepInput): Promise<ScopeStep> {
  const said = trainerText(input.transcript);
  const request: CompletionRequest = {
    purpose: "scope",
    prompt: scopePrompt(input.pack, input.missing, said),
    hint: { scenarioId: input.scenarioId, missing: input.missing, unmatched: input.unmatched },
  };
  const completion = await input.provider.complete(request);
  const decoded = decodeCandidate(completion.text, input.pack);
  if (decoded === null) return { usage: completion.usage, event: null };
  return {
    usage: completion.usage,
    event: {
      kind: "proposal",
      at: input.at,
      id: `prop-${input.scenarioId}-${input.turn}`,
      candidate: decoded.candidate,
      interpreting: decoded.interpreting,
    },
  };
}

export interface AnswerStep {
  usage: Usage;
  decode: AnswerDecode;
  /** The completion, verbatim — set by the raw step, whose record has no
   * transaction to carry it (the governed record keeps its own). */
  text?: string;
}

export interface AnswerStepInput {
  provider: ModelProvider;
  context: ManifestContext;
  scenarioId: string;
  transactionId: string;
  /** The exchange so far. Only the trainer's own utterances are shown to the
   *  model, so the answer can be responsive to what was actually asked rather
   *  than improvised from the profile alone (IA-8: only the trainer speaks). */
  transcript: ScopeTranscript;
  /**
   * The trainer's own words from *earlier* exchanges, when the current ask
   * needs them to mean anything — "can you list at least 10 for me?" names
   * nothing, and without its antecedent no model can know ten of what
   * (found live, 2026-08-31). Supplied by the driver only for such asks, so
   * an ask that names its own subject keeps its clean single-ask prompt.
   * Trainer channel only, like everything the answer step reads (IA-8).
   */
  previously?: readonly string[];
  /**
   * The certified subjects of the previous filed answer, for an anaphoric
   * ask whose antecedent is the page the trainer was just reading rather
   * than anything they said (found live, 2026-09-06). Read from the record,
   * offered as the answer's context and never as the trainer's words.
   */
  previousSubjects?: readonly string[];
  /** Hand the model the certified registry to compose from, instead of asking
   *  it to recall. Facts only, never policy — see {@link certifiedReference}. */
  grounded?: boolean;
  /** Ground with only the rows *this question* needs ({@link retrieveReference})
   *  rather than the whole registry — grounding's usefulness without its token
   *  bill. Takes precedence over {@link grounded} when both are set. */
  retrieval?: boolean;
  /** Narrow the answer grammar to the filler kinds this question nominates
   *  ({@link nominateFillerKinds}) — the shape-deflection fix (§19). Independent
   *  of grounding; only the three aggregate kinds are ever gated. */
  gatedGrammar?: boolean;
  /** Deterministic routes the model may nominate instead of composing — the
   *  door, not the work (epic #118: recognition is the 1-of-k choice a small
   *  model holds; composition is what kept failing). The caller owns the
   *  catalogue and validates every nomination. */
  routes?: readonly NominableRoute[];
  /**
   * The verifier's word on the previous reply to these same words, one line
   * per violation in the driver's fixed wording (docs/routing.md, R3b: the
   * verifier-in-the-loop retry). Present only on the one retry the driver
   * allows; the prompt is otherwise identical, so the record shows exactly
   * what changed between the two calls.
   */
  feedback?: readonly string[];
  /** Whether the model may nominate a clarification with typed options
   * instead of answering (docs/routing.md, R3b step 3). Off for every path
   * that has not opted in; the driver validates and caps what comes back. */
  clarify?: boolean;
  /** Whether the model may offer follow-up suggestions beside its claims
   * (docs/routing.md, R3b step 4). Off for every path that has not opted in;
   * the driver and the kernel each hold what comes back to the
   * topic-not-value rule. */
  suggest?: boolean;
}

/** Ask the model for the certified answer and decode it into a draft. Whether
 * the draft survives is `compileManifest`'s ruling, not the advisor's. */
export async function proposeAnswer(input: AnswerStepInput): Promise<AnswerStep> {
  const { provider, context, scenarioId, transactionId } = input;
  const trainerLines = trainerText(input.transcript);
  const question = trainerLines.join(" ");
  // Retrieval first: the rows this question needs, not the whole registry. Full
  // grounding is the fallback when retrieval is off but grounding is on.
  const reference = input.retrieval
    ? retrieveReference(context.registry, question)
    : input.grounded
      ? certifiedReference(context.registry)
      : undefined;
  // Grammar gating: offer the three aggregate kinds only when the question
  // nominates them, so a ranking cannot decode as a count (§19).
  const fillerKinds = input.gatedGrammar ? nominateFillerKinds(question) : undefined;
  const request: CompletionRequest = {
    purpose: "answer",
    prompt: answerPrompt(
      context.grant?.scope,
      // The exchange with the advisor's own clarification in place, when
      // there was one — otherwise exactly the trainer's lines.
      input.clarify === true ? exchangeLines(input.transcript) : trainerLines,
      input.previously,
      input.previousSubjects,
      input.routes,
      context.pack.actions.map((action) => action.id),
      context.pack.curriculum.map((lesson) => lesson.id),
      context.pack.gameRules.map((rule) => ({ id: rule.id, label: rule.label })),
      reference,
      context.pack.dictionary,
      input.feedback,
      context.registry.itemIds.length > 0,
      [...new Set(context.registry.items.map((item) => item.category))].sort(),
      input.clarify === true,
      input.suggest === true,
    ),
    hint: {
      scenarioId,
      ...(context.grant === undefined ? {} : { scope: context.grant.scope }),
      // The doors this call held open, declared here where they are decided,
      // so a trace shows the prompt's adjustment between two calls as data.
      doors: {
        reference: input.retrieval ? "retrieval" : input.grounded ? "grounded" : "none",
        ...(fillerKinds === undefined ? {} : { fillerKinds: [...fillerKinds].sort() }),
        routes: (input.routes ?? []).map((route) => route.id),
        clarify: input.clarify === true,
        suggest: input.suggest === true,
        feedback: input.feedback ?? [],
      },
    },
    // The same contract the prose describes, in a form a provider can enforce.
    // Whether it is enforced is the provider's business, not the advisor's.
    schema: {
      name: ANSWER_SCHEMA_NAME,
      schema: answerSchema(
        context.pack,
        fillerKinds,
        context.registry.itemIds.length > 0,
        {
          types: [...context.registry.typeNames].sort(),
          itemCategories: [...new Set(context.registry.items.map((item) => item.category))].sort(),
        },
        input.routes,
        input.clarify === true,
        input.suggest === true,
      ),
    },
  };
  const completion = await provider.complete(request);
  const decode = decodeAnswer(completion.text, context, transactionId);
  // A completion the provider cut at the token cap is a different failure
  // from a malformed one; name it, in fixed wording, so the class is
  // countable from notes and artifacts (no silent caps — docs/scale.md, S1).
  if (!decode.ok && completion.finishReason === "length") {
    return { usage: completion.usage, decode: { ok: false, reason: `${decode.reason} — the completion hit the token cap (truncated)` }, text: completion.text };
  }
  return { usage: completion.usage, decode, text: completion.text };
}

export interface PhraseStepInput {
  provider: ModelProvider;
  scenarioId: string;
  /** The exchange so far — trainer channel only, as everywhere. */
  transcript: ScopeTranscript;
  /** What the League needs to know, in the pack's own fixed words. */
  need: string;
  /** The typed options the trainer will be offered, by label. */
  options: readonly string[];
}

export interface PhraseStep {
  usage: Usage;
  /** The model's wording of the question, or null when it offered nothing
   * usable — the caller then asks the pack's fixed question. */
  text: string | null;
}

/** The phrase step's grammar: one string, nothing else. */
export const PHRASE_SCHEMA_NAME = "clarifying_question";

/**
 * Ask the model to put the League's fixed question in its own words, in the
 * light of the ask (docs/routing.md, R3b step 3: "the version question stops
 * sounding like a form"). The wording is the only thing the model supplies:
 * what the question is *about* and what a reply may bind to stay the pack's
 * — the options are the vocabulary's values, the recorded question event
 * carries the dimension, and the kernel's answer route reads the trainer's
 * reply against the approved terms exactly as it reads a reply to the fixed
 * wording. The text is held to {@link usableQuestion}; anything else falls
 * back to the pack's line, so a bad rewrite costs one call and nothing more.
 */
export async function phraseQuestion(input: PhraseStepInput): Promise<PhraseStep> {
  const said = trainerText(input.transcript);
  const request: CompletionRequest = {
    purpose: "phrase",
    prompt: [
      "The trainer said:",
      ...said.map((line) => `  - ${line}`),
      "",
      "Before their question can be answered, one thing about the trainer must be established.",
      `The fixed wording for asking it is: "${input.need}"`,
      `Their answer will be one of: ${input.options.join(", ")}.`,
      "",
      "Put that question in your own words, briefly and warmly, so it reads as part of this",
      "conversation — say in passing what you need it for. One sentence, ending in a question",
      "mark. State no fact, no value and no number; ask only that question.",
      'Reply with one JSON object, {"question": "<your wording>"}, and nothing else.',
    ].join("\n"),
    hint: { scenarioId: input.scenarioId },
    schema: {
      name: PHRASE_SCHEMA_NAME,
      schema: { type: "object", properties: { question: { type: "string" } }, required: ["question"], additionalProperties: false },
    },
  };
  const completion = await input.provider.complete(request);
  const parsed = decodePhrase(completion.text);
  return { usage: completion.usage, text: parsed !== null && usableQuestion(parsed) ? parsed.trim() : null };
}

function decodePhrase(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced?.[1] ?? text;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && typeof (parsed as { question?: unknown }).question === "string") {
      return (parsed as { question: string }).question;
    }
  } catch {
    // not JSON — nothing usable
  }
  return null;
}

/**
 * The shape a model-phrased question must have to be shown at all — a
 * structural guard, never a word list: one sentence (no sentence break
 * before the question mark, no line break), ending in a question mark, of a
 * length a person would say, and carrying no digit — a number in a question
 * is a value stated, and a question may state nothing.
 */
export function usableQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 8 || trimmed.length > 240) return false;
  if (!trimmed.endsWith("?")) return false;
  if (/\d/.test(trimmed)) return false;
  if (/\n/.test(trimmed)) return false;
  // A statement before the question: "X is fast. Which version?" — the only
  // sentence allowed is the question itself.
  if (/[.!?]\s+\S/.test(trimmed)) return false;
  return true;
}

export interface RawStepInput {
  provider: ModelProvider;
  /** The meter's context — used only to decode (rosters resolve through the
   * registry so the answer is checkable) and never shown to the model. */
  context: ManifestContext;
  scenarioId: string;
  transactionId: string;
  transcript: ScopeTranscript;
}

/** Ask the model for an ungoverned answer. What comes back is published as-is;
 * the meter in raw.ts judges it afterwards, and nothing stops it first. */
export async function proposeRawAnswer(input: RawStepInput): Promise<AnswerStep> {
  const { provider, context, scenarioId, transactionId } = input;
  const request: CompletionRequest = {
    purpose: "raw",
    prompt: rawPrompt(
      trainerText(input.transcript),
      context.pack.actions.map((action) => action.id),
      context.registry.itemIds.length > 0,
      [...new Set(context.registry.items.map((item) => item.category))].sort(),
    ),
    hint: { scenarioId },
    // No dictionary, so no `asked` array: the control arm links nothing
    // because nothing downstream would check the link — that is the
    // ungoverned condition, not a handicap on it.
    schema: { name: ANSWER_SCHEMA_NAME, schema: answerSchema({ ...context.pack, dictionary: [] }) },
  };
  const completion = await provider.complete(request);
  const decode = decodeAnswer(completion.text, context, transactionId);
  // A completion the provider cut at the token cap is a different failure
  // from a malformed one; name it, in fixed wording, so the class is
  // countable from notes and artifacts (no silent caps — docs/scale.md, S1).
  if (!decode.ok && completion.finishReason === "length") {
    return { usage: completion.usage, decode: { ok: false, reason: `${decode.reason} — the completion hit the token cap (truncated)` }, text: completion.text };
  }
  return { usage: completion.usage, decode, text: completion.text };
}

/** The digest a truthful trainer names when confirming a proposal it agrees
 * with. Exposed so the trainer and the kernel compute the same one. */
export function proposalDigest(event: Extract<ScopeEvent, { kind: "proposal" }>): string {
  return candidateDigest(event.id, event.candidate);
}
