/**
 * Deterministic analysis of what an assistant message tells the user.
 *
 * Works sentence by sentence and looks for two things:
 * - success claims: completed-action language ("is confirmed", "I've booked",
 *   "you're all set", "successfully").
 * - failure acknowledgements: language that tells the user something did not
 *   work ("unavailable", "I couldn't", "unfortunately", "try a different").
 *
 * Precision guards, so we do not flag a correct agent:
 * - questions ("Would you like me to book it?") are not claims;
 * - conditionals and futures ("once it's confirmed", "I'll book") are not claims;
 * - a sentence that contains a negation ("I couldn't book") is an
 *   acknowledgement, never a claim.
 *
 * Why rules and not an LLM: this runs on every logged call, so it must be
 * free, instant, and reproducible. Every match is returned as quoted
 * evidence, so a developer can see exactly why something was flagged.
 */

export interface SentenceMatch {
  sentence: string;
  phrase: string;
}

export interface ClaimAnalysis {
  successClaims: SentenceMatch[];
  failureAcknowledgements: SentenceMatch[];
}

const COMPLETED_VERBS =
  "confirmed|booked|scheduled|reserved|processed|completed|submitted|sent|cancell?ed|updated|created|placed|approved|issued|refunded|registered|transferred|paid|charged|delivered|shipped|added|saved|changed|rescheduled|activated|moved|switched|renewed|extended|upgraded|unlocked|reset|enrolled";

const SUCCESS_PATTERNS: RegExp[] = [
  new RegExp(`\\b(?:is|are|was|were|has been|have been|'s|'re)\\s+(?:now\\s+|all\\s+|successfully\\s+)?(?:${COMPLETED_VERBS})\\b`, "i"),
  new RegExp(`\\b(?:i|we)(?:'ve| have)?\\s+(?:just\\s+|now\\s+|successfully\\s+|already\\s+)?(?:${COMPLETED_VERBS}|set up|gone ahead and \\w+)\\b`, "i"),
  /\byou(?:'re| are)\s+(?:all\s+)?(?:set|booked|confirmed|scheduled|registered|good to go)\b/i,
  /\ball set\b/i,
  /\bsuccessfully\b/i,
  /\b(?:went|gone) through\b/i,
  /\bgot you (?:booked|scheduled|down|in|covered)\b/i,
  /\b(?:here(?:'s| is)|your) (?:confirmation|booking|reservation|reference|order|ticket|tracking) (?:number|code|id)\b/i,
];

const NEGATION =
  /\b(?:not|no|never|unable|cannot|can't|couldn't|wasn't|weren't|isn't|aren't|didn't|doesn't|haven't|hasn't|won't|unfortunately|sorry|failed|failure|unavailable|error|problem|issue|trouble|apolog\w*)\b|n't\b/i;

const FAILURE_PATTERNS: RegExp[] = [
  /\b(?:un|not\s+)available\b/i,
  /\bunavailable\b/i,
  /\b(?:unable|wasn't able|was not able|weren't able|couldn't|could not|can't|cannot)\b/i,
  /\bunfortunately\b/i,
  /\b(?:sorry|apologi[sz]e)\b/i,
  /\b(?:failed|failure|error|problem|issue|trouble)\b/i,
  /\b(?:didn't|did not) (?:go through|work|succeed)\b/i,
  /\bnot (?:been )?(?:confirmed|booked|scheduled|processed|completed|possible)\b/i,
  /\b(?:already taken|fully booked|no longer)\b/i,
  /\btimed? ?out\b/i,
  /\b(?:try|choose|pick) (?:again|another|a different|a new)\b/i,
  /\b(?:different|another|other) (?:time|day|date|slot|option|card|method)\b/i,
];

const QUESTION_OR_HYPOTHETICAL =
  /^(?:would|should|shall|can|could|do|does|did|may|is|are)\b|\b(?:if|once|as soon as|when|after|unless|until)\b[^.]*\b(?:is|are|has been|have been)\b|\b(?:i'll|i will|we'll|we will|going to|let me)\b/i;

/** Friendly idioms that contain negation words but negate nothing. */
const IDIOMS = /\b(?:no problem|no worries|not a problem|no trouble|sorry for the wait|sorry to keep you waiting|sorry about the wait)\b/gi;

/** Clause boundaries: a negation in another clause does not negate this one. */
const CLAUSE_SPLIT = /[,;:–—]|\s-\s|\b(?:but|however|although|though|so|and then)\b/i;

/** Abbreviations whose period must not end a sentence. */
const ABBREVIATIONS = /\b(Dr|Mr|Mrs|Ms|St|Jr|Sr|No|Ave|Apt|Inc|Ltd|vs|etc|e\.g|i\.e|a\.m|p\.m)\./gi;
const DOT = "\u0000";

/** Normalize typographic quotes so patterns written with ' match ’ too. */
export function normalizeText(text: string): string {
  return text.replace(/[‘’ʼ′]/g, "'").replace(/[“”]/g, '"');
}

export function splitSentences(text: string): string[] {
  return normalizeText(text)
    .replace(/\s+/g, " ")
    .replace(ABBREVIATIONS, (m) => m.replace(/\./g, DOT))
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .map((s) => s.replaceAll(DOT, ".").trim())
    .filter(Boolean);
}

function firstMatch(patterns: RegExp[], text: string): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0];
  }
  return null;
}

/** The clause of `sentence` that contains `phrase`. */
function clauseContaining(sentence: string, phrase: string): string {
  const clauses = sentence.split(CLAUSE_SPLIT);
  return clauses.find((c) => c.toLowerCase().includes(phrase.toLowerCase())) ?? sentence;
}

export function analyzeMessage(text: string): ClaimAnalysis {
  const successClaims: SentenceMatch[] = [];
  const failureAcknowledgements: SentenceMatch[] = [];
  for (const sentence of splitSentences(text)) {
    const withoutIdioms = sentence.replace(IDIOMS, " ");
    const failure = firstMatch(FAILURE_PATTERNS, withoutIdioms);
    if (failure) failureAcknowledgements.push({ sentence, phrase: failure });

    const success = firstMatch(SUCCESS_PATTERNS, withoutIdioms);
    if (!success) continue;
    if (sentence.trim().endsWith("?")) continue;
    // Negations and hedges only count inside the clause that makes the claim:
    // "I couldn't do 3 PM, but you're booked for 4" still claims a booking.
    const clause = clauseContaining(withoutIdioms, success);
    if (NEGATION.test(clause)) continue;
    const hedge = clause.match(QUESTION_OR_HYPOTHETICAL);
    if (hedge && hedge.index !== undefined && hedge.index <= clause.toLowerCase().indexOf(success.toLowerCase())) continue;
    successClaims.push({ sentence, phrase: success });
  }
  return { successClaims, failureAcknowledgements };
}

/**
 * Identifier-like references the agent gave the user, e.g. "confirmation
 * number RSV-48213". Used to catch agents that invent IDs the tool never
 * returned.
 */
const REFERENCE_PATTERN =
  /\b(?:confirmation|booking|reservation|reference|order|ticket|tracking|case|transaction|appointment)\s*(?:number|code|id|#|no\.?)\s*(?:is|:|of)?\s*#?\s*([A-Z0-9][A-Z0-9-]{3,})\b/gi;

/** Compare identifiers ignoring case and formatting: "BK-2291" == "bk2291" == "B K 2 2 9 1". */
export function normalizeReference(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface ReferenceMention {
  sentence: string;
  phrase: string;
  value: string;
}

export function findReferences(text: string): ReferenceMention[] {
  const out: ReferenceMention[] = [];
  for (const sentence of splitSentences(text)) {
    for (const m of sentence.matchAll(REFERENCE_PATTERN)) {
      const value = m[1]!;
      // Require at least one digit so ordinary words ("number is pending") are not taken as IDs.
      if (/\d/.test(value) && !out.some((o) => normalizeReference(o.value) === normalizeReference(value))) {
        out.push({ sentence, phrase: m[0], value });
      }
    }
  }
  return out;
}
