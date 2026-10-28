# Review-only font assets

These unmodified WOFF2 files are used only by `FontPairingReview`. `fonts.css`
registers separate CSS aliases (`Review …`); the scene changes body/display
variables only inside its sample containers. JetBrains Mono is unchanged. The approved Bricolage/IBM Plex app pairing is independent of
these aliases; adding the second round does not change production font imports or tokens. There are no runtime Google Fonts requests.

`sources.json` records the exact download URLs, byte lengths, SHA-256 hashes,
unicode ranges and Google Fonts CSS request used on 2026-10-21. Each family keeps
its upstream OFL notice alongside the binaries. Latin and Latin Extended are both
included. These are the same measured distributions discussed in
`../../FONT_PAIRING_PROPOSAL.md` (Hubot/Mona 2.000; Saira 1.101; Anybody 1.113;
Spline Sans 1.001), with normal width and variable weight. The second round adds Tektur/Golos Text,
Chakra Petch/IBM Plex Sans, Oxanium/Hanken Grotesk and Unbounded/Onest; Chakra Petch
uses static normal weights 300/400/500/600/700, the other new families are variable.
Other axes and italics
are not part of this comparison.

This is an explicitly authorized typography experiment, not a new theme or a
production font installation. Its dedicated standalone page and matching Storybook
scene reuse real production components and their existing geometry, weights and
tracking. All fixture callbacks are local.

Font binaries are unmodified. OFL notice text is preserved with normalized line endings and trailing whitespace.
