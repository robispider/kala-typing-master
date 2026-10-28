# Kala Learn — web prototype

Interactive Bangla and English touch-typing course for the browser, built with [Astro](https://astro.build) and published to GitHub Pages. No login, no installation; progress stays in the learner's browser.

It uses the current Kala desktop course content and logic:

- **Courses and teaching paths** from `kala.bn-literature` 1.1.1 (the shared-layout revision of the 1.1.0 migration baseline) and `kala.en-touch` 1.0.0. Pack hashes and teaching-path layout hashes are verified on import.
- **Layouts**: Kala Goti and Kala Jhor use the same provisional **Kala Layout** B01 arrangement (`shared-76c9b9dbfc689d0b`), with distinct hasant/sign and context-vowel typing styles. UniJoy and QWERTY remain available. The importer derives bilingual examples from actual key positions, including Goti `S D O A` and Jhor `D O A` for আমি.
- **Decoder**: `src/lib/composer.ts` is a port of `FixedLayoutManager` (pass-through and suppression rules, sequences, style D context vowels with run pairing, Backspace continuation).
- **Scoring**: `src/lib/scoring.ts` ports `TextScoring` (`kala-grapheme-v1`). It uses .NET 8 grapheme units, so ক্ষ counts as two units, plus NFC and the same alignment tie-break. It deliberately does not use `Intl.Segmenter`.
- **Key recipes**: `src/lib/recipe.ts` finds the shortest key sequence by replaying keys through the decoder, including Backspace recovery after a mistake.
- **Library**: 1,474 reviewed "train" excerpts from 12 authors, with source credits. Check/assessment partitions are not published.
- **Typing skill check**: `src/lib/check/` ports Kala's study code: prompt bank `kala.bn-typing-check` 1.4.1 (forms validated for Kala Goti, Kala Jhor and UniJoy), protocol `2026.10-bhe-pilot-r3` with schedule `bhe-task-schedule-2` (warm-up, passage, targeted and physical-key blocks, passage, anchor repeat, with a fresh Enter between timed steps), `SkillCheckScorer` and the `kala.typing-check.session/2` package. The result is added to Learn. After the result the person may preview and send that one check to Kala's research API (`GET /config`, `POST /sessions`, `DELETE /contributors/{id}`); nothing is recorded outside the check or sent without that choice. Packages say they come from the browser: `kala_version` ends in `-web`, `wave` is `bhe-web-pilot-1`, and limitations include `browser-client` and `browser-event-timing`. Set `PUBLIC_RESEARCH_ENDPOINT` at build time to use another research server.

## Pages

| Route | What it does |
| --- | --- |
| `/` | Landing page with a live "try it" box (Kala Goti) |
| `/learn/` and `/learn/<layout>/` | Layout choice, learning path, finger-coloured key map and typing rules |
| `/practice/<layout>/?step=…` | Practice: meet new keys → path micro-lessons → guided words → recall from memory |
| `/library/` | Literature by author and work; typing resumes where you left off |
| `/check/` | Typing skill check: Kala's 4 min 20 s research protocol, result, optional sharing for research |
| `/progress/` | Streak, time, accuracy, key confidence map, session history, backup and restore |
| `/about/` | Sources, faithfulness notes, licences |
| `/research/` | Fixed B01 map, Goti versus Jhor entry rules: guided practice, separate ordinary/vowel blocks, copyable report and full JSON download |

The interface is available in English and Bangla, with light and dark themes. It supports physical and on-screen keyboards, works at phone width and respects reduced motion.

The **Research** link is the last navigation item; an entry card also appears at the end of the home page. This experimental pilot requires a physical keyboard. It reuses the composer, recipe finder, keyboard, study recorder and scorer, with its own local report format. It does not use the existing study upload endpoint or add course progress. See [the research protocol and report guide](RESEARCH.md). To refresh the two frozen maps from the sibling research repository, run `node scripts/import-shared-candidates.mjs ../kala-layout`.

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

- The shared-map transition archives earlier Goti/Jhor positional progress in backups, keeps past sessions labelled with their mapping identity, and starts fresh key confidence. Reading bookmarks, preferences, UniJoy and QWERTY progress are preserved.
- Progress uses `localStorage` with a downloadable JSON backup. IndexedDB, offline caching and desktop-profile import are not built yet.
- Progression is simplified: 90% accuracy in the recall part completes a step. Kala's full adaptive planner and milestone checks are not ported.
- Browser speed and accuracy are practice feedback. They are not validated as equivalent to desktop assessments.
- Only fixed layouts are supported. Avro/phonetic and imported layouts are out of scope.
- The rendered hand guide (Brotli palette frames) is not converted yet. Finger guidance uses colours and labels.
- About 30% of literature excerpts use curly quotes, long dashes, ZWNJ or ॥, which no layout types. Those excerpts are skipped; Kala's typing editions would cover them.
