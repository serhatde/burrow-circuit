# Burrow Circuit

Burrow Circuit is an independent, browser-based maze game that uses Squeekchain's public read-only API to make the live wheel and confirmed block progress affect each run. It requires no wallet, account, or transaction.

## Play

Play online: [GitHub Pages](https://serhatde.github.io/burrow-circuit/).

Source: [serhatde/burrow-circuit](https://github.com/serhatde/burrow-circuit).

To run locally, open index.html in a modern browser. The game is plain HTML, CSS, and JavaScript with no build step or dependencies.

- Move: WASD or arrow keys
- Dash: Space or Shift
- Pause or resume: P or Escape
- Touch: on-screen movement and dash buttons on narrow screens

Choose the daily maze to play the same deterministic layout as other players that day, or start a fresh random run. A run has three sectors. Collect five glowseeds in each sector, avoid the burrow bots, and reach the open exit. The game stores personal and daily high scores in browser local storage. Sharing a run adds its seed to the page URL; it does not send a score to a server.

## Project details

- Daily mazes are generated deterministically from the local calendar date.
- Free runs use a fresh random seed. Shared links recreate their maze.
- The game runs entirely in the browser and remains playable offline after its fonts are cached.
- Scores stay on the player's device.
- Sound is generated locally by the browser and starts muted.
- Squeekchain's public `/v1/status` endpoint changes bot pressure, seed points, and dash cooldown from live wheel speed and confirmed block progress.
- If the API is unavailable, the game clearly falls back to its local rules.
- The project is not an official Squeekchain product.

## Run locally

Open index.html directly, or serve this folder with any static file server. No package installation is required.

    python -m http.server 8000

Then open http://localhost:8000.

## Attribution

Burrow Circuit is an original community game and is not an official Squeekchain product. Its source and live version are linked above.

## License

MIT. See LICENSE.
