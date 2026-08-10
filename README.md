# 5 Wild

A Wordle roguelike. Every guess is a hand played: letters carry chip values,
feedback colours carry multipliers, and jokers bend the arithmetic. Beat a score
target per blind, shop between blinds, survive eight antes.

Guesses are one currency spent on two competing goals — information or income —
and solving pays a tempo bonus but ends the blind on the spot. That tension is
the game.

## Running it

```sh
npm ci
npm run dev        # http://localhost:5173
```

Quality gate, the same three commands CI runs:

```sh
npm run typecheck
npm run check      # Biome lint + format
npm test           # Vitest
```

## Installing on a phone

The web build is wrapped by Capacitor. Publishing a GitHub release builds a
signed APK and attaches it, so the phone can fetch it straight from the browser
with no login and no cable:

**<https://github.com/jmelahman/5-wild/releases/latest/download/5-wild.apk>**

Android will ask for permission to install from the browser the first time.
Everything the game needs is inside the package — the word lists included — so
it runs with no network at all.

Cutting a release is the whole publishing step:

```sh
gh release create v0.1.0 --generate-notes
```

Every push also builds the APK to prove it still compiles, but that one is
unsigned and cannot be installed: the signing key belongs to the release path
alone. It lives in the `ANDROID_KEYSTORE_BASE64` repo secret and is what allows
a new version to replace an installed one — Android treats a package signed by a
different key as a different app and refuses the upgrade, so losing that key
means every future install is a fresh one with the save wiped.

Building locally additionally needs a JDK and the Android SDK:

```sh
npm run apk        # build + cap sync + gradlew assembleDebug
```

## Layout

```
src/engine/     pure TypeScript rules engine — no DOM, no clocks, no ambient RNG
src/content/    letter tables and blind curves
src/ui/         DOM rendering and the scoring animation
public/words/   answer and allowed-guess lists
test/           unit tests, a headless full-run bot, and the engine-purity guard
tools/          word-list generation
android/        Capacitor's Android project, committed
```

`src/engine` is deliberately kept portable: it imports nothing outside itself and
`src/content`, and touches no ambient nondeterminism. `test/engine-purity.test.ts`
enforces that in CI rather than by discipline.
