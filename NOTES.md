# Notes

Things spotted but deliberately not fixed. The refactor stays behaviour-neutral
so that if something breaks, the cause is unambiguous. Everything noticed along
the way lands here instead.

## Known before the split

- **Fonts load from Google Fonts.** Four families, so with no network the game
  renders in system sans-serif. Breaks the offline-USB-stick use case that the
  single-file build exists to serve. Fixed as part of step 5 in START-HERE.md,
  since it is a distribution bug rather than a behaviour change.
- **Four type families for one page** is probably one too many. Check whether
  Space Grotesk is referenced anywhere before keeping it.
- **No `prefers-reduced-motion` handling** that I could see in the fragment I
  read. Screen shake and full-screen red flash are exactly the effects that
  need it.

## Found during the split

<!-- Add as you go: file, what you noticed, why you left it. -->
