# Jawabat design system

Source of truth for the answer page. Adapted from a friendly fintech style
(sage canvas, white cards, one bright lime call to action, big pill buttons),
renamed and trimmed for a single-purpose, phone-first form. No third-party
logo, brand name or font files are used.

## Principles
- One question per screen. The question is the hero; the answer card sits under it.
- One lime button per screen: the voice button. Navigation is ink (dark), secondary actions are soft gray-green.
- Lime is never used to mean "success". Success uses the positive green text colour.
- Big touch targets (52-64 px), readable type (17-19 px body), works one-handed on a phone.

## Colour tokens
| Token | Value | Use |
|---|---|---|
| primary | #9fe870 | the one call to action (Sajjel vocal, Bda) |
| on-primary | #0e0f0c | text on primary |
| primary-pale | #e2f6d5 | chips, answered markers, focus ring |
| ink | #0e0f0c | headings, navigation button, progress |
| body | #454745 | secondary text |
| mute | #868685 | labels, hints |
| canvas | #ffffff | cards |
| sage | #e8ebe6 | page background |
| line | #d6dbd3 | borders |
| positive | #2ead4b | "Wsel", "Tsajjel" |
| negative | #d03238 | errors, recording dot |
| warning-pale | #fff4c2 | demo banner |

## Type
Inter (Google Fonts) 400-900. Display: 900 at 40/34 px, question titles 800 at 30/26 px,
question text 19/18 px, body 17 px, labels 13 px uppercase 700 with 0.06em tracking.

## Shape
Cards 24 px radius, list items 16 px, inputs 12 px, buttons fully rounded (pill).
Soft two-layer shadow on cards; no hard borders on cards.

## Components
- Top bar: wordmark, "So2al n / 20" pill that opens the question grid, 4 px progress track.
- Question card: group chip, numbered title, question text.
- Answer card: voice button (lime; ink with a pulsing red dot while recording), screenshot button (soft),
  list of sent items with a status (Kaytsifet / Wsel / Ma wselch + 3awd), textarea with autosave status.
- Bottom bar: ghost "Lli 9bel", ink "Lli mn b3d" (last screen: "Salit").
- Question grid sheet: 5 x 4 numbers, answered ones pale green with a dot, current one outlined.
