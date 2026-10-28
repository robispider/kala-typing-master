# Certified layout audit — 29 October 2026

**The updated Kala software and Typing Master match the certified research map.
The previously installed Kala application still contains the original separate maps.**

## Authoritative source

- Publication descriptor: `kala-layout/data/layout-publications/shared-v1.json`.
- Certified arrangement: B01/P01, `shared-76c9b9dbfc689d0b`.
- Source map: `results/shared-top10-comparison-v1/layouts/shared-76c9b9dbfc689d0b.json`.
- Source-file SHA-256: `0570b0ca0f0e72f69920a91c8cd9b04ac6ce5f936becb8b076eb103c3fc5afe0`.
- Canonical arrangement SHA-256: `c00c4dbef480c1a1096c0f93c906398aa469d57b8ccecb0cc06ef491d9ab0e9b`.
- Certificate: `kala-layout/results/shared-certification-v1/certificate.json`.

The source-file hash was checked against the publication descriptor. The placement
hash was independently recomputed using the frozen portable scorer and compared
with the certificate, publication map and frozen scoring reference. All agree.

## Position comparison

Counts cover the 52 searched normal/Shift positions, separately for each style.
All other exported punctuation/digit positions and the native rules/sequences
were also checked for the updated source assets.

| Target | Goti position mismatches | Jhor position mismatches |
| --- | ---: | ---: |
| Kala current source assets | 0 | 0 |
| Kala rebuilt Release assets | 0 | 0 |
| Typing Master imported source assets | 0 | 0 |
| Typing Master built keyboard legends | 0 | 0 |
| Previously installed Kala assets | 43 | 39 |

The installed assets are dated 27 October 2026. The updated Release build is at
`kala/kala/artifacts/shared-layout/bin/Release/net8.0-windows/` relative to the
parent directory containing these repositories. The installed copy was read,
not modified, during this audit. There was no running `kala` process when checked.
Updating/reinstalling the installed application remains a separate deployment step.
This audit does not establish the state of a deployed GitHub Pages site.

Three research labels use NFC spellings ড়, ঢ় and য়. Both applications use their
canonically equivalent atomic Unicode spellings ড়, ঢ় and য়, exactly as the native
research exports do. This is an intentional runtime representation, with matching
positions and equivalent normalized output. No map difference is hidden by this
normalization.

## Independent behavior check

Expected text came directly from `bangla_dh.bangla.styles.Style`, with physical
keys taken from the authoritative research map. The generated set contains:

- Every single-symbol press and every ordered two-symbol combination.
- Every consonant followed by each vowel-sign key, repeated one through five times.
- 2,000 deterministic random sequences per style, including Space and punctuation.

Each application's real decoder passed **13,012/13,012 cases**. After normalization,
every output matched the independent research machine. The raw output streams of
the two applications were also byte-identical, with SHA-256
`83372f686143020b509ccd1c2bab2b21b9743f509b43eceb416a7411198fc63b`.

Goti keeps hasant-plus-sign full vowels; Jhor keeps context vowels and timing-free
repeat pairing. The existing desktop regression cases additionally cover native
Backspace. No keyboard hook or external document was used in this audit.

## Certificate and claims

`PYTHONPATH=src python -m bangla_dh verify-shared-certificate results/shared-certification-v1`
passed: all input/output hashes and **45,526 decisions** were replayed and
independently checked. This is a certificate of local non-dominance for two/three
symbol moves under the relaxed shared eligibility policy and separate R calibration.
It does not establish global optimality or measured faster typing than every
keyboard. The arrangement remains provisional. Current Typing Master copy states
modeled effort and a local certificate; its About page retains the exact scope.

The shared held-out modeled-effort reduction versus UniJoy is **33.709% for Goti**
and **35.366% for Jhor**. The visible “about one-third” wording is consistent with
these source values; it is not a typing-speed result.

## Regression reruns and evidence

- Desktop targeted shared/native/Jhor checks: **25 passed, zero failed**.
- Typing Master checks: **28 passed, zero failed**.
- Built Goti/Jhor keyboard legends: **52/52 positions each** match the publication.
- Full machine-readable comparison: `shared-layout/certified-map-audit.json`.
- Generated cases, decoder runners and desktop TRX are in Kala's ignored
  `artifacts/shared-layout/certified-audit/` directory. The standalone desktop
  runner emitted an assembly-reference warning while compiling, then passed all
  parity cases; no application source was changed for the harness.

No implementation mismatch was found in the updated projects. The concrete
remaining gap is that the installed Kala copy has not received the new assets.
