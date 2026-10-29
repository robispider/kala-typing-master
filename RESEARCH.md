# Historical B01 shared arrangement: Goti/Jhor physical pilot

The Research page now holds B01's physical positions fixed and compares Goti versus Jhor entry rules. This experimental B01 map is separate from the published Goti/Jhor course maps. Research history and interpretation live at https://robispider.github.io/kala-layout/en/publication/. B02's rare two-sign exchange is retained as historical map evidence, not a main participant condition. This pilot is separate from ordinary courses and the existing 4:20 typing check. Results are exploratory observations from the typist, not a measured validation of the search formula or a claim about other people. Feedback can guide a default without implying one style suits everyone.

## Run and copy

Run `npm run dev`, then open `/kala-typing-master/research/`. Use a physical keyboard with the system input set to English and the Kala desktop input app/other Bangla IME off. This page translates physical positions to Bangla using the existing FixedComposer. No extra keyboard installation is required.

Choose guided or memory testing, prior familiarity with the entry styles, B01 map experience, keyboard and intended fingering. Both styles are assigned automatically within the session. Practice explains the current entry rules and offers the next physical key, Shift and traditional finger; a decoder-generated example shows how that style types বই. It is unmeasured and can be skipped when ready. Each of four blocks contains 60 active seconds of ordinary text and 60 active seconds of vowel/context diagnostic text. Breaks and focus loss pause capture and the clock; reading/searching while a trial is running counts. A fresh button action and released keys are required to start the next timed role. Stop retains partial data. Give an optional comfort score and note after each block, then optionally choose your preferred style on the result screen before copying the report.

At the end choose **Copy report**, then paste the entire report into the research conversation. **Download full JSON** retains original key transitions, deliveries, text edits, boundaries and prompt texts for finer analysis. Raw events are kept in memory only; download before leaving. The last compact report is saved locally when browser storage permits. There is no network submission, account or normal Learn progress update.

## Identity and entry rules

- B01: `shared-76c9b9dbfc689d0b`.
- Both participant conditions use exactly `shared-76c9b9dbfc689d0b` and the same normal/Shift positions. B02 (`shared-7083b1ebfa5aa3a7`) remains in the source snapshot and regression checks only.
- Goti inherits the Goti hasant-to-independent-vowel sequences; Jhor inherits its context-vowel and repeated-vowel rules. Digits and punctuation are copied from the same existing runtime templates. Research symbol labels ড়/ঢ়/য় are converted to Kala's atomic characters for decoder classification; NFC output remains equivalent.
- `src/data/shared-candidates.json` records original layout-file SHA-256 and a hash of the ordered symbol-map JSON. Runtime SHA-256 covers the actual language, vowel mode, normal/Shift maps, sequences and rules. The original rule-template source hash is also retained. Course catalogs/paths are not changed.

## Order and exposure

The first session for each assistance setting uses Goti–Jhor–Jhor–Goti; the next uses Jhor–Goti–Goti–Jhor. B01 positions never change. This deterministic alternation is not random assignment and does not eliminate carryover in one learner. Interrupted starts also advance the local sequence. Each style receives both ordinary forms and both diagnostic forms, assigned by block parity. Text therefore repeats across styles; local shown counts and within-trial repeats are retained, not called unseen material. Prior counters are local to this browser/origin and cannot establish the person's complete training history. Previous style familiarity can dominate a short comparison even with practice before every block.

The bank `b01-style-authored-pilot-2` is separate from search training, published check banks and the old rare-sign diagnostic. Ordinary text remains the same; diagnostic text now exercises all vowels, signs, full vowels after consonants and repeated-key cases such as বই and তিনিই. Some diagnostic items are syllable exercises, not ordinary prose. Every word is recipe/replay checked under both styles. That establishes typeability, not equivalent difficulty, natural-frequency balance or human review. Ordinary and diagnostic roles remain separate in summaries. Practice gets an unmeasured capture and is excluded from aggregate scores. Goti and Jhor are reported separately within a run; guided and recall results must not be pooled.

## Reports and limits

Format: `kala.b01-style-pilot/2`; protocol: `b01-style-pilot-v2`. New local history/report keys keep the old B01/B02 pilot separate, and the previous compact report remains readable as a fallback. Its results are not migrated into the new comparison. The experimental wrapper contains captures from the existing Recorder but is deliberately **not** an upload-compatible normal study `/2` session package. No standard-bank validation or receiver acceptance is claimed.

Reports include the B01 identity and physical-map hash, distinct runtime/rule hashes for both entry styles, assistance, self-reported prior style/map experience, fingering and keyboard, local order/history, completion, practice duration and responses, measured block counts, active milliseconds, attempted/reference/response units, matches, edit distance, first-try words, Backspaces, corrections, physical and Shift key-down counts, hints/cue-following, incoming timing for all vowel-sign keys, integrity flags, comfort notes and the final optional style preference. Cue deviations are not errors: another valid recipe can produce correct text. Timing includes thinking and guidance; it is not isolated motor movement. Actual fingers cannot be inferred from key events.

Scoring reuses `kala-grapheme-v1` and the existing attempted-prefix policy for stopped/timed-out prompts. Correct GPM is shown only with at least 60 active seconds and 100 attempted target units in that style/role group. Invalid replay/dropped capture hides aggregate accuracy and speed. Missing groups have null scores, not zero accuracy; raw denominators remain available. No winner or significance claim is computed. Small samples, order, practice, prior style familiarity, expectations and carryover can dominate a first session. Future feedback may support a default while both styles remain useful choices.

Synthetic browser smoke sessions used during development are software checks, not participant evidence. They use the development origin; the user preview is served at a different origin so the user's session starts with fresh local counters.

## Validation

`npm test` includes map identity, preservation of fixed keys/rules, all authored word recipes, remapped original Jhor regression cases, ABBA/BAAB balance, timing deadline/pause exclusion, error recovery, assistance separation, vowel timing boundaries, partial reporting and text-event replay. `npm run build` checks TypeScript/Astro and the complete static site.
