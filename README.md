# Bill Splitter

A mobile-first web app for splitting a restaurant bill fairly. Enter each
line item, assign who had what, then see each person's share including
tax and tip. Runs entirely in the browser — no backend, no account.

## Features

- **Per-item splitting** — assign each line item to one or more people,
  including partial splits across sub-groups.
- **Party sizes** — a "person" can represent a group (e.g. "Alice & Bob"
  with party size 2), and tax/tip can split proportionally across heads.
- **Scan receipt (OCR)** — upload a photo of the receipt and the app
  runs Tesseract.js locally in the browser to extract line items, which
  you then review and edit before adding.
- **Import from LLM** — for receipts that OCR struggles with, copy a
  pre-written prompt, paste it into Gemini or ChatGPT along with the
  receipt photo, and paste the returned JSON back. The app parses items,
  tax, and tip and pre-fills them for review.
- **Flexible tax and tip** — enter tip as a percentage or a flat amount;
  choose whether tax/tip split proportionally to each person's subtotal
  or evenly across heads.
- **Summary image** — export a shareable summary image for the group.
- **Local-only** — state persists to `localStorage`; nothing is sent
  anywhere.
- **Light / dark / system theme** with a one-click toggle.

## Run (development)

Requires: Node.js 20+ and npm.

```bash
npm install
```

```bash
npm run dev
```
