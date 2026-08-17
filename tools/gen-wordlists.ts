/*
 * Regenerates public/words/{answers,allowed}.txt.
 *
 * Run with `node tools/gen-wordlists.ts` (Node strips the types natively).
 * Outputs are committed, so this runs rarely, but every source is pinned to a
 * commit SHA so re-running it produces byte-identical files rather than
 * silently drifting with upstream.
 *
 * We deliberately do NOT ship the New York Times' curated answer list. This
 * derives its own from open corpora:
 *
 *   allowed  every 5-letter word in a public-domain dictionary
 *   answers  the most frequent of those, so the secret word is always fair
 *
 * Three hand lists sit on top of that, each for something the corpora cannot do
 * for themselves: HAND_ALLOWED for guesses newer than the dictionary,
 * HAND_BLOCKED for what the filters wave through, HAND_ADDED for answers the
 * ranking never sees. Each is documented where it is declared, and each entry
 * has to earn itself, because a hand list is the part of this that rots.
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

/**
 * Guesses younger than the corpus that carries the guesses.
 *
 * words_alpha is a scrape of an older dictionary, and it shows: 198 five-letter
 * words in the ENABLE lexicon are missing from it, and ENABLE itself closed in
 * 2001, so anything the language picked up after that is missing from both.
 * EMOJI, LATTE, REHAB, DETOX and PESTO were not legal guesses at all, which is
 * the one failure the permissive-guesses rule below exists to prevent.
 *
 * Scoped to everyday modern vocabulary a player might actually type. The 198
 * are mostly Scrabble esoterica (KHAPH, KHETH, LWEIS) and none of that is here.
 *
 * Singulars only, which is a rule about this list and not about guesses. It
 * held nine plurals of four-letter words (BLOGS, VAPES, MEMES, CROCS) and they
 * are gone. `allowed` is full of plurals and should be, but those arrive from
 * the dictionary with their singulars beside them, so isPlural can see the
 * shape and keep it out of answers. A hand-added plural has no singular in the
 * lemma list by definition, since a word missing from the dictionary is why it
 * is here, so isPlural is blind to it and it is eligible to be the secret word.
 * CARBS proved that rather than threatened it: it ranked in on the first
 * regeneration and needed a HAND_BLOCKED entry to get back out. Better to spend
 * the entry on a fifth letter that is doing something.
 */
const HAND_ALLOWED = [
  "bling",
  "chemo",
  "decaf",
  "detox",
  "dorky",
  "dweeb",
  "emoji",
  "expat",
  "futon",
  "geeky",
  "glitz",
  "gulag",
  "inbox",
  "indie",
  "latte",
  "nuked",
  "penne",
  "pesto",
  "ramen",
  "rehab",
  "satay",
  "sicko",
  "synth",
  "thunk",
  "tranq",
  "wacko",
  "wimpy",
  "wussy",
]

// Every legal guess. Kept permissive on purpose: rejecting a word a player
// typed as an information probe is far more annoying than allowing a rude one.
const allowed = [...new Set([...lines(alphaRaw).filter(isTarget), ...HAND_ALLOWED])].sort()

// The frequency corpus is movie subtitles, so it is thick with proper nouns
// (ALICE, DIEGO), foreign dialogue (NICHT, MERCI, DANKE) and apostrophe-stripped
// contractions (DOESN, WEREN). words_alpha is lowercased and admits all of them.
// So a candidate must additionally be a lowercase entry in an en_US hunspell
// dictionary, which stores proper nouns capitalized and no other language at all.
//
// That dictionary lists only lemmas, so we try a few obvious suffix strips
// before giving up, or ZONES and TRIED would fail on a technicality.
// It is SCOWL's *small* list, so the rule is imperfect in one direction: real
// words get rejected too, along with British spellings, which is arguably
// correct for a US-spelling answer set. Erring this way is still right, because
// letting ALICE through is a round the player cannot reason their way to.
//
// This note used to add that we accept the loss, since a word rejected here is
// still a legal guess and only never the secret one. That held while the loss
// was theoretical. It named ALIVE, TEETH, DEPOT and INPUT as the examples, and
// a word game whose answer is never TEETH is not paying a technicality, it is
// missing a word. The count is not twenty either: 228 of the rejections are in
// ENABLE. Most are junk the ranking would never have reached anyway, so the
// repair is not to loosen this rule but to name the survivors: see HAND_ADDED.
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

/**
 * A word that is just a shorter word with S on the end. Wordle bars these from
 * its answer list and it is right to: a plural answer means the last slot is a
 * free S, which turns a five-letter deduction into a four-letter one and makes
 * every guess ending in S a better guess than it should be. The letter is
 * already the most common one in the corpus; handing it a guaranteed position
 * would make it the only letter worth buying anything for.
 *
 * Three shapes, which between them are what "add S" means in English:
 *
 *   ZONE  + s   -> ZONES     four-letter word, the one the note is about
 *   BOX   + es  -> BOXES     the sibilant plural
 *   TRY -> TRIES             the y-plural
 *
 * A double S ending is never one of these: the plural of a word ending in S is
 * spelled ES, so GRASS, BLESS and CROSS are answers and always were.
 *
 * Judged against the hunspell lemmas rather than against `allowed`, which holds
 * only five-letter words and could not answer the question at all. Being the
 * small SCOWL list, it errs toward letting a plural through rather than toward
 * eating a real word, which is the right direction: a missed plural is one
 * awkward round, an eaten word is a word nobody ever gets to be dealt.
 */
function isPlural(w: string): boolean {
  if (!w.endsWith("s") || w.endsWith("ss")) return false
  if (lemmas.has(w.slice(0, -1))) return true
  if (w.endsWith("es") && lemmas.has(w.slice(0, -2))) return true
  return w.endsWith("ies") && lemmas.has(`${w.slice(0, -3)}y`)
}

// Answers are the intersection of "allowed", "common" and "English", ranked by
// corpus frequency. Unlike guesses, these ARE filtered for slurs, since nobody wants
// one as the secret word. The block list holds lemmas, so it gets the same stem
// treatment; matching it literally lets RAPES and CUNTS straight through.
// Substring matching would catch those too, but it also eats GRAPE and SPOON.
/**
 * What the corpora between them still get wrong, one word at a time.
 *
 * This was two entries and a note saying a hand list is a maintenance burden
 * every entry has to earn itself. It is fifty-five, and the note still holds;
 * what changed is that somebody read all 2300 answers instead of spot-checking
 * them. SQUAW is a slur the block list does not carry; VINOD is a given name
 * that beat the lemma check by ending in D, so VINO answered for it. Both
 * surfaced when the plural filter pulled words in from deeper down the
 * frequency ranks, which is the general risk of digging: the further down you
 * go, the worse the corpus gets. The rest arrived in three groups.
 *
 * The first is the one that is simply a defect. `stems()` strips -ER and -LY
 * before the lemma lookup, so a name passes whenever its own first three or
 * four letters are a word: ASHER on ash, BOYER on boy, DOVER on dove, EWING on
 * ewe, MILLY on mill, POLLY on pol, TOLLY on toll. 151 of the 2300 got in by a
 * suffix strip and nothing else, and 13 of those are in no dictionary at all.
 * Tightening the strip is not the repair, because it is the same rule that
 * admits COMER, FEWER, NOBLY and about a hundred other words that are real.
 * So the leak is patched by name, here, where the names are visible.
 *
 * The second and third are taste, and worth saying so plainly rather than
 * dressing up as correctness. SENOR, CREME and VOILA are all in Merriam-Webster
 * and all Scrabble-legal; what disqualifies them is that their English spelling
 * carries a diacritic the board cannot draw, so the answer is a word spelled
 * wrong. The rest of that group is borrowings English only reaches for when it
 * is quoting another language. And GONNA sits at corpus rank #8, which is not a
 * fact about English but a fact about movie subtitles being transcribed speech.
 */
const HAND_BLOCKED = [
  "squaw",
  "vinod",
  // Names, trademarks and non-words the suffix strip let through.
  "asher",
  "boyer",
  "ching",
  "dover",
  "elmer",
  "ewing",
  "goths",
  "jared",
  "jello",
  "lovey",
  "mayer",
  "milly",
  "multi",
  "polly",
  "rager",
  "tilly",
  "tolly",
  "versa",
  // Borrowings, and the three whose real spelling needs an accent.
  "adios",
  "aloha",
  "amigo",
  "amour",
  "begum",
  "bijou",
  "creme",
  "fakir",
  "ganja",
  "hajji",
  "kanji",
  "laird",
  "largo",
  "padre",
  "pasha",
  "sadhu",
  "sahib",
  "senor",
  "swami",
  "tutti",
  "voila",
  // Eye-dialect, and inflections that left English with the King James Bible.
  "aught",
  "begat",
  "canst",
  "cuppa",
  "didst",
  "dunno",
  "durst",
  "gimme",
  "gonna",
  "gotta",
  "shalt",
  "thine",
  "wanna",
  // What blocking the above let in, since fifty-two seats freed is fifty-two
  // words pulled up from where the corpus is thinner. BOLLY fails the same test
  // as the names: in words_alpha, in no dictionary.
  "bolly",
]

/**
 * Answers the ranking cannot reach, for the two reasons it cannot reach them.
 *
 * The first group is the false rejections the lemma note above already admits
 * to: the small SCOWL list does not carry these lemmas, so the words never
 * reach the ranking to be ranked. The note calls it about twenty words and
 * accepts the loss. That was the right call when the loss was invisible; it
 * reads differently once you notice a Wordle-alike whose secret word is never
 * ALIVE and never TEETH. Every entry here ranked above #5223, which is where
 * the 2300th answer sits, so each would have made the list on merit.
 *
 * The second group is younger than both corpora. EMOJI is in neither
 * words_alpha nor ENABLE, and OpenSubtitles-2018 ranks it #39350 on 249 hits,
 * so no amount of loosening a filter reaches it: a word the corpus has barely
 * heard of cannot be ranked into a list the corpus orders. Hand-adding is the
 * only mechanism there is, and these are the words worth spending it on.
 */
const HAND_ADDED = [
  // Real words the lemma check ate. ALIVE is #113, TEETH #355, FORTH #698.
  "ahold",
  "alive",
  "caddy",
  "cyber",
  "depot",
  "donut",
  "forth",
  "inlet",
  "input",
  "pinky",
  "repay",
  "rerun",
  "reset",
  "resin",
  "snuck",
  "teeth",
  "untie",
  "unzip",
  "woken",
  // Too new for a 2017 scrape of an older dictionary, let alone a 2001 lexicon.
  "bling",
  "chemo",
  "decaf",
  "detox",
  "emoji",
  "futon",
  "geeky",
  "indie",
  "inbox",
  "latte",
  "pesto",
  "ramen",
  "rehab",
  "synth",
]

const blocked = new Set([...lines(profanityRaw), ...HAND_BLOCKED])
const isBlocked = (w: string) => stems(w).some((s) => blocked.has(s))
const allowedSet = new Set(allowed)

// A hand-added answer nobody can guess is worse than no hand-add at all, and
// the two lists are written far enough apart to make that an easy thing to do.
const unguessable = HAND_ADDED.filter((word) => !allowedSet.has(word))
if (unguessable.length > 0) {
  throw new Error(`hand-added answers that are not legal guesses: ${unguessable.join(", ")}`)
}

// The ranking still does the ranking; it just has fewer seats to fill.
const RANKED_COUNT = ANSWER_COUNT - HAND_ADDED.length
const handAdded = new Set(HAND_ADDED)

const ranked: string[] = []
let plurals = 0
for (const line of lines(freqRaw)) {
  const word = line.split(/\s+/)[0]
  if (!word || !isTarget(word)) continue
  if (!allowedSet.has(word) || isBlocked(word) || !isEnglish(word)) continue
  if (handAdded.has(word)) continue
  // Counted rather than silently skipped: this rule rejects common words on
  // purpose, and the number is how anyone re-running this can tell it is still
  // rejecting roughly what it was written to reject.
  if (isPlural(word)) {
    plurals++
    continue
  }
  ranked.push(word)
  if (ranked.length >= RANKED_COUNT) break
}

if (ranked.length < RANKED_COUNT) {
  throw new Error(`only found ${ranked.length} ranked answers, wanted ${RANKED_COUNT}`)
}

// Sorted, not frequency-ordered: the engine selects by seed, and alphabetical
// order keeps regeneration diffs readable.
const answers = [...ranked, ...HAND_ADDED].sort()

await mkdir(OUT_DIR, { recursive: true })
await writeFile(join(OUT_DIR, "allowed.txt"), `${allowed.join("\n")}\n`)
await writeFile(join(OUT_DIR, "answers.txt"), `${answers.join("\n")}\n`)

console.log(`allowed  ${allowed.length} (${HAND_ALLOWED.length} by hand)`)
console.log(`answers  ${answers.length} (${HAND_ADDED.length} by hand)`)
console.log(`plurals  ${plurals} rejected`)
