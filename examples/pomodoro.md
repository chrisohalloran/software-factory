Build a self-contained pomodoro timer as a single index.html (inline CSS and JS, no CDN, no build step).

Goal: a calm, precise focus timer that works on a phone.

Requirements:
- Default focus length 2 minutes so it is easy to demo; allow switching 2 / 5 / 25 minutes.
- Large remaining time, Start / Pause / Reset.
- Skip to next phase (focus ↔ short break). Short break is 1 minute.
- Subtle remaining ring or bar; no sound required.
- Keyboard: space starts/pauses.
- Distinct visual state for focus vs break.
- Works offline, no network calls.

Design: dark foundry-like UI, no purple, no emoji, system fonts only.
