# Research pilot software validation

28 October 2026. These are software checks, not participant observations.

- `npm test`: **25 passed, 0 failed**, including a complete simulated eight-role run and original decoder regression cases.
- `npm run build`: Astro/TypeScript check and all 15 static pages passed (0 errors; existing/deprecated API hints are reported).
- `git diff --check`: passed. No new dependencies; normal course content and ordinary check implementation unchanged.
- In-app browser on the development origin (`127.0.0.1:4321`): setup opened; physical S/D/O/F/D produced আমরা in Goti guided practice; subsequent measured S/D/H/Space produced আজ; Escape paused; Stop retained a partial report with text replay true, eight measured physical transitions and speed withheld for the short sample. Copy report displayed its success message.
- The partial report named B01/B02 by their frozen IDs, included distinct runtime hashes, marked assistance as guided and completion as stopped, and left missing candidate/role accuracy and speed null.
- A fresh production preview at `http://127.0.0.1:4322/kala-typing-master/research/` opened with no prior report. This separates the user's browser-local exposure/session counters from the development smoke check. No session was started on the fresh origin.
- `research-preview.png` records the final setup screen. The preview tab is retained for the user.

The human test, comfort ratings and results interpretation remain for the user. Keyboard events do not verify actual fingers, and browser results are not calibrated against the desktop implementation or the frozen search model.

## Revision: fixed B01, compare entry styles

Owner steering: use B01 as the provisional shared arrangement and focus physical feedback on Goti/Jhor entry rules. The UI no longer assigns B02. Protocol `b01-style-pilot-v2`, bank `b01-style-authored-pilot-2` and report `kala.b01-style-pilot/2` separate these observations from the earlier candidate comparison. New local counters do not merge old results; the old compact report remains readable.

- All **25 tests passed** after the revision. The complete simulated eight-role run now crosses styles on B01, keeps ordinary/diagnostic summaries separate, and rejects pooling across styles. Normal/Shift maps are asserted identical across Goti/Jhor.
- Build passed with **0 errors and 0 warnings** (10 API/style hints).
- Browser: first session began with B01/Goti and showed বই as `L → S → A`. The next session began with B01/Jhor and showed `L → A → A`; physical D/O/F/D typed আমরা under Jhor. Both rule variants used physical-map hash `1151ea2be084c0237077ed37827e3c96df1105b7905bc78f7c35daa8aa0bd0c4` with different runtime hashes.
- The copied-report view contained schema `/2`, candidate B01, separate A/D summaries and optional preference. Selecting Goti changed the reported preference to `A`.
- The user preview was inspected before updating: it was still on setup. After refresh, its existing external-keyboard and finger-guide selections were restored. No participant trial was started. `b01-style-preview.png` shows the revised page.
