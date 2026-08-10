/*
 * Regenerates public/words/{answers,allowed}.txt.
 *
 * Run with `node tools/gen-wordlists.ts` (Node strips the types natively).
 * Outputs are committed, so this runs rarely — but every source is pinned to a
 * commit SHA so re-running it produces byte-identical files rather than
 * silently drifting with upstream.
 *
 * We deliberately do NOT ship the New York Times' curated answer list. This
 * derives its own from open corpora:
 *
 *   allowed  every 5-letter word in a public-domain dictionary
 *   answers  the most frequent of those, so the secret word is always fair
 *
 * Sources:
 *   dwyl/english-words         Unlicense
 *   hermitdave/FrequencyWords  MIT       (OpenSubtitles 2018 frequencies)
 *   LDNOOBW/*bad-words*        CC-BY-4.0
 *   wooorm/dictionaries        SCOWL/BSD (en_US hunspell, casing signal only)
 */

import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const WORDS_ALPHA =
  "https://raw.githubusercontent.com/dwyl/english-words/20f5cc9b3f0ccc8ce45d814c532b7c2031bba31c/words_alpha.txt"
const FREQUENCY =
  "https://raw.githubusercontent.com/hermitdave/FrequencyWords/525f9b560de45753a5ea01069454e72e9aa541c6/content/2018/en/en_50k.txt"
const PROFANITY =
  "https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/5faf2ba42d7b1c0977169ec3611df25a3c08eb13/en"
const HUNSPELL =
  "https://raw.githubusercontent.com/wooorm/dictionaries/8cfea406b505e4d7df52d5a19bce525df98c54ab/dictionaries/en/index.dic"

const WORD_LENGTH = 5
const ANSWER_COUNT = 2300

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "words")

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`)
  return res.text()
}

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l.length > 0)
}

const isTarget = (w: string) => w.length === WORD_LENGTH && /^[a-z]+$/.test(w)

const [alphaRaw, freqRaw, profanityRaw, hunspellRaw] = await Promise.all([
  fetchText(WORDS_ALPHA),
  fetchText(FREQUENCY),
  fetchText(PROFANITY),
  fetchText(HUNSPELL),
])

// Every legal guess. Kept permissive on purpose: rejecting a word a player
// typed as an information probe is far more annoying than allowing a rude one.
const allowed = [...new Set(lines(alphaRaw).filter(isTarget))].sort()

// The frequency corpus is movie subtitles, so it is thick with proper nouns
// (ALICE, DIEGO), foreign dialogue (NICHT, MERCI, DANKE) and apostrophe-stripped
// contractions (DOESN, WEREN). words_alpha is lowercased and admits all of them.
// So a candidate must additionally be a lowercase entry in an en_US hunspell
// dictionary, which stores proper nouns capitalized and no other language at all.
//
// That dictionary lists only lemmas, so we try a few obvious suffix strips
// before giving up — otherwise ZONES and TRIED would fail on a technicality.
// It is SCOWL's *small* list, so the rule is imperfect in one direction: about
// twenty real words (ALIVE, TEETH, DEPOT, INPUT) get rejected too, along with
// British spellings, which is arguably correct for a US-spelling answer set.
// We accept that. Losing a word here only means it is never the secret word —
// it is still a legal guess — whereas letting ALICE through is a blind the
// player cannot reason their way to.
const lemmas = new Set<string>()
for (const line of hunspellRaw.split("\n")) {
  const entry = line.split("\t")[0]?.split("/")[0]?.trim()
  if (entry && /^[a-z]+$/.test(entry)) lemmas.add(entry)
}

function stems(w: string): string[] {
  const out = [w]
  const drop = (n: number) => w.slice(0, -n)
  if (w.endsWith("s")) {
    out.push(drop(1))
    if (w.endsWith("es")) out.push(drop(2), `${drop(2)}e`)
    if (w.endsWith("ies")) out.push(`${drop(3)}y`)
  }
  if (w.endsWith("d")) {
    out.push(drop(1))
    if (w.endsWith("ed")) out.push(drop(2), `${drop(2)}e`)
    if (w.endsWith("ied")) out.push(`${drop(3)}y`)
  }
  if (w.endsWith("ing") || w.endsWith("est")) out.push(drop(3), `${drop(3)}e`)
  if (w.endsWith("er") || w.endsWith("ly")) out.push(drop(2), `${drop(2)}e`)
  return out
}

const isEnglish = (w: string) => stems(w).some((s) => lemmas.has(s))

// Answers are the intersection of "allowed", "common" and "English", ranked by
// corpus frequency. Unlike guesses, these ARE filtered for slurs — nobody wants
// one as the secret word. The block list holds lemmas, so it gets the same stem
// treatment; matching it literally lets RAPES and CUNTS straight through.
// Substring matching would catch those too, but it also eats GRAPE and SPOON.
const blocked = new Set(lines(profanityRaw))
const isBlocked = (w: string) => stems(w).some((s) => blocked.has(s))
const allowedSet = new Set(allowed)

const ranked: string[] = []
for (const line of lines(freqRaw)) {
  const word = line.split(/\s+/)[0]
  if (!word || !isTarget(word)) continue
  if (!allowedSet.has(word) || isBlocked(word) || !isEnglish(word)) continue
  ranked.push(word)
  if (ranked.length >= ANSWER_COUNT) break
}

if (ranked.length < ANSWER_COUNT) {
  throw new Error(`only found ${ranked.length} answers, wanted ${ANSWER_COUNT}`)
}

// Sorted, not frequency-ordered: the engine selects by seed, and alphabetical
// order keeps regeneration diffs readable.
const answers = ranked.sort()

await mkdir(OUT_DIR, { recursive: true })
await writeFile(join(OUT_DIR, "allowed.txt"), `${allowed.join("\n")}\n`)
await writeFile(join(OUT_DIR, "answers.txt"), `${answers.join("\n")}\n`)

console.log(`allowed  ${allowed.length}`)
console.log(`answers  ${answers.length}`)
