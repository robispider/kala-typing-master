# Shared-layout physical pilot

The Research page is a personal B01/B02 comparison. It is separate from ordinary courses and the existing 4:20 typing check. Its results are exploratory observations from the typist, not a measured validation of the search formula or a claim about other people.

## Run and copy

Run `npm run dev`, then open `/kala-typing-master/research/`. Use a physical keyboard with the system input set to English and the Kala desktop input app/other Bangla IME off. This page translates physical positions to Bangla using the existing FixedComposer. No extra keyboard installation is required.

Choose Goti or Jhor, guided or memory testing, experience, keyboard and intended fingering. Practice always offers the next physical key, Shift and traditional finger. It is unmeasured and can be skipped when ready. Each of four blocks contains 60 active seconds of ordinary text and 60 active seconds of deliberately vowel-heavy diagnostic text. Breaks and focus loss pause capture and the clock; reading/searching while a trial is running counts. A fresh button action and released keys are required to start the next timed role. Stop retains partial data. Give an optional comfort score and note after each block.

At the end choose **Copy report**, then paste the entire report into the research conversation. **Download full JSON** retains original key transitions, deliveries, text edits, boundaries and prompt texts for finer analysis. Raw events are kept in memory only; download before leaving. The last compact report is saved locally when browser storage permits. There is no network submission, account or normal Learn progress update.

## Identity and entry rules

- B01: `shared-76c9b9dbfc689d0b`.
- B02: `shared-7083b1ebfa5aa3a7`.
- The only physical difference is the exchange of ৈ and ৌ on Shift+X and Shift+W.
- Goti inherits the Goti hasant-to-independent-vowel sequences; Jhor inherits its context-vowel and repeated-vowel rules. Digits and punctuation are copied from the same existing runtime templates. Research symbol labels ড়/ঢ়/য় are converted to Kala's atomic characters for decoder classification; NFC output remains equivalent.
- `src/data/shared-candidates.json` records original layout-file SHA-256 and a hash of the ordered symbol-map JSON. Runtime SHA-256 covers the actual language, vowel mode, normal/Shift maps, sequences and rules. The original rule-template source hash is also retained. Course catalogs/paths are not changed.

## Order and exposure

The first session for each style/assistance pair uses B01–B02–B02–B01. The next uses B02–B01–B01–B02. This deterministic alternation is not random assignment and does not eliminate carryover in one learner. Interrupted starts also advance the local sequence. Each candidate receives both ordinary forms and both diagnostic forms, assigned by block parity. Text therefore repeats across candidates; local shown counts and within-trial repeats are retained, not called unseen material. Prior counters are local to this browser/origin and cannot establish the person's complete training history.

The bank `shared-authored-pilot-1` was authored for this feature and is not part of search training or published check banks. Every word is recipe/replay checked for all four candidate/style combinations. That check establishes typeability, not equivalent difficulty, natural-frequency balance or human review. Two formal minute roles remain separate in all summaries. Practice gets its own unmeasured capture and is excluded from aggregate scores. A Goti run and a Jhor run must be interpreted separately; guided and recall results must not be pooled.

## Reports and limits

Format: `kala.shared-layout-pilot/1`; protocol: `shared-physical-pilot-v1`. The downloaded experimental wrapper contains captures from the existing Recorder but is deliberately **not** an upload-compatible normal study `/2` session package. No standard-bank validation or receiver acceptance is claimed.

Reports include candidate IDs/hashes, style, assistance, self-reported experience/fingering/keyboard, local session order/history, completion, practice duration and responses, measured block counts, active milliseconds, attempted/reference/response units, matches, edit distance, first-try words, Backspaces, corrections, hint presentations/cue-following, incoming timing samples for the swapped vowel keys, integrity flags and optional comfort notes. Cue deviations are not declared errors: another valid key recipe can produce correct text. Incoming timing includes thinking and guidance; it is not isolated motor movement time. Actual fingers cannot be inferred from key events.

Scoring reuses `kala-grapheme-v1` and the existing attempted-prefix policy for stopped/timed-out prompts. Correct GPM is shown only with at least 60 active seconds and 100 attempted target units in that candidate/role group. Invalid replay/dropped capture hides aggregate accuracy and speed. Missing groups have null scores, not zero accuracy; raw denominators remain available. No winner or significance claim is computed. Small samples, order, practice, expectations and carryover can overwhelm this rare two-key difference.

Synthetic browser smoke sessions used during development are software checks, not participant evidence. They use the development origin; the user preview is served at a different origin so the user's session starts with fresh local counters.

## Validation

`npm test` includes map identity, preservation of fixed keys/rules, all authored word recipes, remapped original Jhor regression cases, ABBA/BAAB balance, timing deadline/pause exclusion, error recovery, assistance separation, vowel timing boundaries, partial reporting and text-event replay. `npm run build` checks TypeScript/Astro and the complete static site.
