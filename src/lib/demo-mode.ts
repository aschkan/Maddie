/**
 * Whether seeded data is PRESENTED as placeholder data.
 *
 * One constant, read by the three places that mark example material: the
 * report markers and popups in `MapCanvas`, the banner in `FilterPanel`, and
 * the banner and per-card tag in `ResearchPanel`.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ IT IS OFF, ON PURPOSE, SO THE SYSTEM CAN BE EVALUATED AS IT WILL LOOK.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The banners and the hollow dashed markers make the app impossible to judge:
 * every report is visibly a stub, every interview card opens with a warning,
 * and the panel carries a standing notice. None of that will be there once the
 * fieldwork is in, so reviewing the app with it on is reviewing a screen that
 * will never ship. Off, the seeded data renders exactly as real data will.
 *
 * Two things are deliberately NOT affected, because switching this off is
 * about presentation and nothing else:
 *
 *   * **`source` is still stored on every record.** Reports carry
 *     `source: "example"` and interviews carry it too, in the database, exactly
 *     as before. That field is what makes the swap to real data possible at
 *     all — `npm run seed -- --no-demo` and the panel's clear button both find
 *     the seeded rows by it, and `--keep` spares real material by it. Deleting
 *     the field to make the data "more real" would strand the placeholder rows
 *     in the database with no way to tell them from the fieldwork.
 *   * **The seed still says what it wrote**, in its summary block on stdout.
 *     That is a log read by whoever pressed the button, not a label on the
 *     product, and it is the record of which rows are placeholders.
 *
 * ⚠ TURN THIS BACK ON, or delete the seeded rows, before anybody but the team
 * looks at the app — and before any number or sentence from it is quoted. With
 * it off there is nothing on screen that distinguishes a seeded report from one
 * a person filed, which is the entire point and also the entire risk.
 *
 * `npm run seed -- --no-demo` clears the placeholder data outright, which is
 * the better move once there is real material to put in its place.
 */
export const MARK_EXAMPLE_DATA = false;
