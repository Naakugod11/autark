# autark — brand basics

**Name:** autark (always lowercase)
**X / handle:** @autark_world
**Symbol:** the ant — a decentralized colony of autonomous agents. No leader, self-organizing, builds its own infrastructure. Maps directly to Autark: autonomous agent-to-agent settlement with no human in the loop.

## Colours
- Ink `#15120D` — primary mark on light backgrounds
- Bone `#F2EEE6` (surface) / `#ECE6DA` (mark on dark)
- Near-black `#111110` — dark background / avatar tile
- Amber `#E0A100` — optional accent, use sparingly (mark stays mono by default)

## Wordmark
Lowercase, monospace (JetBrains Mono or Space Mono), letter-spacing ~0.04em.
Before final publish, convert the wordmark text to outlines in a vector editor so it renders identically everywhere (the lockup SVGs currently use live text with a mono fallback).

## Clearspace
Keep a margin of at least one ant-segment height around the mark on all sides.

## Files
- `autark-mark.svg` / `-bone.svg` / `-line.svg` — the icon (ink / for-dark / linework)
- `autark-lockup.svg` / `-bone.svg` — icon + wordmark
- `autark-avatar.svg` + `autark-avatar-1000.png` — X / social profile picture (1000×1000)
- `favicon.svg` (auto light/dark) + `favicon-16.png` + `favicon-32.png`
- `apple-touch-icon-180.png` — iOS home-screen / Apple touch icon
- `autark-mark-512.png` — general-purpose raster

## Repo housekeeping (from the handover)
- tag v0 first: `git tag v0-agent-bazaar && git push --tags`
- rename repo to `autark` on GitHub (keeps history + stars + redirects)
- new program keypair → fresh program ID, update `declare_id!`, `Anchor.toml`, `Cargo.toml`
