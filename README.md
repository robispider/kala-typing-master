# Kala Learn — web prototype

Interactive Bangla and English touch-typing course for the browser, built with [Astro](https://astro.build) and published to GitHub Pages. No login, no installation; progress stays in the learner's browser.

It uses the current Kala desktop course content and logic:

- **Courses and teaching paths** from `kala.bn-literature` 1.1.0 (the migration baseline in the feasibility study) and `kala.en-touch` 1.0.0. Pack hashes are verified against their manifests on import.
- **Layouts**: Kala Goti, Kala Jhor, UniJoy and QWERTY, with their own "how to type" rules and examples.
- **Decoder**: `src/lib/composer.ts` is a port of `FixedLayoutManager` (pass-through and suppression rules, sequences, style D context vowels with run pairing, Backspace continuation).
- **Scoring**: `src/lib/scoring.ts` ports `TextScoring` (`kala-grapheme-v1`). It uses .NET 8 grapheme units, so ক্ষ counts as two units, plus NFC and the same alignment tie-break. It deliberately does not use `Intl.Segmenter`.
- **Key recipes**: `src/lib/recipe.ts` finds the shortest key sequence by replaying keys through the decoder, including Backspace recovery after a mistake.
- **Library**: 1,474 reviewed "train" excerpts from 12 authors, with source credits. Check/assessment partitions are not published.

## Pages

| Route | What it does |
| --- | --- |
| `/` | Landing page with a live "try it" box (Kala Goti) |
| `/learn/` and `/learn/<layout>/` | Layout choice, learning path, finger-coloured key map and typing rules |
| `/practice/<layout>/?step=…` | Practice: meet new keys → path micro-lessons → guided words → recall from memory |
| `/library/` | Literature by author and work; typing resumes where you left off |
| `/progress/` | Streak, time, accuracy, key confidence map, session history, backup and restore |
| `/about/` | Sources, faithfulness notes, licences |

The interface is available in English and Bangla, with light and dark themes. It supports physical and on-screen keyboards, works at phone width and respects reduced motion.

## Develop

```bash
npm install
npm run dev        # http://localhost:4321/kala-typing-master/
npm test           # decoder, scorer, recipe and planner checks against Kala's fixtures
npm run build      # astro check + static build into dist/
```

### Refresh course content

Generated data in `src/data/` and `public/data/` is committed, so CI does not need the Kala repository. After a pack or layout changes in Kala:

```bash
npm run import:kala -- ../kala
```

## Deploy

`.github/workflows/deploy.yml` tests, builds and deploys on every push to `main`. Enable it once: **Settings → Pages → Build and deployment → Source: GitHub Actions**. For a custom domain or fork, set `SITE` / `BASE_PATH` (see `astro.config.mjs`).

## Prototype limits

- Progress uses `localStorage` with a downloadable JSON backup. IndexedDB, offline caching and desktop-profile import are not built yet.
- Progression is simplified: 90% accuracy in the recall part completes a step. Kala's full adaptive planner and milestone checks are not ported.
- Browser speed and accuracy are practice feedback. They are not validated as equivalent to desktop assessments.
- Only fixed layouts are supported. Avro/phonetic and imported layouts are out of scope.
- The rendered hand guide (Brotli palette frames) is not converted yet. Finger guidance uses colours and labels.
- About 30% of literature excerpts use curly quotes, long dashes, ZWNJ or ॥, which no layout types. Those excerpts are skipped; Kala's typing editions would cover them.
