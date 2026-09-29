# ROAM

ROAM is a turn-based wasteland truck RPG in 3D. The factory in this repo turns voted GitHub issues into approved game changes.

## Layout

- `game/` holds the game. Start with `game/CLAUDE.md` and `game/DESIGN.md`.
- `factory/` holds the factory. Start with `factory/README.md`.
- `quality/` holds the pre-commit quality gate. See `quality/README.md`.

## Run the game

    cd game
    npm ci
    npm run dev

The game opens at <http://localhost:5173>.

## Contribute

Run `npm ci` at the root. Then run `npm run hooks:install` from the main checkout. The hook blocks new lint and type debt.
