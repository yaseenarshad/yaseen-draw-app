# Design mockups (reference, not app code)

Self-contained HTML files — open directly in a browser, or view the published copies. These are the
visual/interaction reference for the **folder-page architecture** (Linear: YAZ-812 approved spec,
YAZ-813 execution tree). They are NOT part of the build; the app implements the real thing.

| File | What it is | Published copy |
|---|---|---|
| `folder-pages-mockup.html` | Interactive mockup of the folder-page model on the real app's tokens/idioms. The header comment maps every piece `[D1]`–`[D12]` to the approved decisions. Vanilla JS, in-memory vault seeded from the business-wiki. | https://claude.ai/code/artifact/b8b14c07-3cf7-4976-b55a-594a8f469ae9 |
| `km-lay-of-the-land.html` | The concept explainer that led to the architecture (three-layer model, options A/B/C, prior-art survey). Partially superseded — banner inside points at the locked decisions. | https://claude.ai/code/artifact/de1b7ef5-c592-48de-89a5-59bf8f3dbdf0 |

Canon reading order for the architecture itself: YAZ-812 description → these mockups →
🔒 LOCKED comments on YAZ-796/797/799 → conversation record YAZ-810.
