# Shared Kala Layout migration — 29 October 2026

Ordinary Learn courses now use the same provisional B01 arrangement as the
updated Kala Windows application: `shared-76c9b9dbfc689d0b`. Goti and Jhor keep
their distinct native vowel rules. The existing B01 research pilot and its
uncommitted changes are preserved.

## Changes

- Import literature pack `1.1.1` and typing-check bank `1.4.1` from the sibling
  Kala project. Verify all pack-file hashes, teaching-path/layout hash bindings
  and eight typing-check variants for each Bangla layout before using them.
- Generate bilingual instructions and examples from the actual native key maps.
  Goti types আমি with `S D O A`; Jhor uses `D O A`. Both use `J Q` for কী,
  hasant on `S`, and অ on `Shift+D`.
- Update cards, landing/Learn copy and MIT shared-map attribution. The original
  maps' CC0 dedication remains in the copied notice.
- Refresh all 950 desktop Jhor fixture cases. Expected output stays unchanged;
  physical strokes follow the new map.
- Add mapping identities to positional progress and session records. Earlier
  Goti/Jhor confidence, completions and error counts are archived under their
  original mapping hashes and remain in JSON backups. Shared-map confidence
  starts fresh; reading bookmarks, settings, sessions, activity days and the
  UniJoy/QWERTY records remain available. Repeated reload/restore is idempotent.

The shared selection is provisional under `shared-layout-relaxed-v1`, with
separate R calibration for each style; no combined score, global optimality or
measured speed improvement is claimed.

## Checks performed

- `npm run import:kala -- ../kala`: passed; 4 layouts, 4 teaching paths, 12 authors,
  49 hand poses. The importer checked source manifests and layout bindings.
- `npm test`: **28 passed, 0 failed**. Covers all 950 Jhor cases, UniJoy cases,
  both styles' examples and recipes, vocabulary, every course group, all B01
  positions, eight current check variants per Bangla layout, a full simulated
  check, progress migration and the existing research pilot regressions.
- `npm run build`: passed, all 15 static pages; Astro reports zero errors and
  warnings, with 10 existing hints (deprecated keyCode and an async suggestion).
- `git diff --check`: passed.
- Both imported map SHA-256 values match the current desktop assets. The six
  unrelated research files with existing changes still match their pre-task
  diffs. No changes to their contents were made by this migration.
- In-app browser at `http://127.0.0.1:4337/kala-typing-master/`: inspected the
  English and Bangla course cards and Jhor instructions; typed `S D O A` in the
  live Goti demo and observed আমি plus its successful completion prompt.
  Screenshot: `shared-layout/course-cards-bn.png`.

Changes and the static build are local. No commit, push, production deployment,
research upload or modification of an existing user's browser progress was made.
Bangla wording remains available for native-speaker review. Test migration uses
synthetic progress; historical sessions retain their original map identities.

## Intro wording update

At the owner's request, Home/Learn now use a brief shared introduction emphasizing
research design, easy reaches, about one-third lower modeled effort than UniJoy,
four billion search proposals, and the 45,526-alternative local certificate.
Goti/Jhor cards explain only their vowel-entry difference. The About evidence
section states the certificate's two/three-symbol scope, provisional selection,
relaxed eligibility policy and separate R calibration. No measured speed advantage
or global-best claim is made. Both languages and the importer use the same copy.
`npm test` still passes 28/28; the production build passes. The updated Learn page
was inspected in the browser. Bangla copy remains available for native review.
