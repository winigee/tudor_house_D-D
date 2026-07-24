# DECISIONS

Choices made where the specification left a gap, each with one line of
reasoning, per section 17. The rule applied throughout: prefer the
option closer to the 1982 original.

- **Camera sits 0.38 cells behind the cell centre.** With the eye at the
  centre, a wall half a cell ahead projects exactly onto the frame edge
  and vanishes; the pulled-back eye reproduces the original's nested-
  rectangle tunnel.
- **Canvas strokes rather than hand-plotted Bresenham lines.** The
  256x192 internal buffer nearest-neighbour upscale supplies the chunk;
  stroke antialiasing at that resolution reads as phosphor bloom.
- **Sight passes only open wall gaps.** Doors and undiscovered secret
  doors block vision as well as light, as closed doors did in 1982;
  visibility floods outward through openings up to the torch radius.
- **Secret doors are walls the player can walk through.** Creatures
  never pass them (spec 10.3); walking through one marks it discovered
  and it then renders as a door frame.
- **Escape flushes pending commands only.** The command already
  executing runs to completion; committed swings could not be recalled
  in the original either.
- **A parse error rejects the whole submission.** Executing half a
  mistyped chain would move the player somewhere they did not ask for;
  nothing enqueues and one error line prints.
- **PULL takes the first matching pack item.** Prefix words match in
  name order and ties go to pack order, as terse 1982 parsers did,
  rather than printing an ambiguity lecture mid-fight.
- **Creature damage feeds exertion, shock feeds pulse.** An unblocked
  hit adds `pulseShock` straight to the pulse (spec 10.1) and the damage
  roll, scaled by `hitExertionFactor`, to exertion, so heavy blows
  wind the player the way damage drove heart rate in the original.
- **Only the player's floor simulates.** Creatures on other floors
  freeze in place, as level-local activity worked on the CoCo; respawn
  timers likewise run on the active floor only.
- **One creature per cell.** Creatures do not stack, and only one may
  occupy the player's cell at a time, matching the original's single
  attacker model.
- **Being struck alerts a creature.** An attacked idle creature enters
  `hunting` immediately, even outside its sense range.
- **Torch light comes from hands only.** A lit torch stowed in the pack
  keeps burning but casts nothing — carelessness costs oil, as it did
  in 1982.
- **Two lit torches take the larger radius and the larger intensity**
  (spec 10.4 names radius; intensity follows the same rule).
- **Reading a scroll consumes it.** USE on a scroll teaches its word,
  identifies it, and the parchment crumbles; INCANT then works from
  memory forever, so scrolls are one-shot unlocks.
- **REVEAL needs a ring of seeing.** A charge is drawn from the ring in
  the other hand, or from the target itself when it is such a ring;
  otherwise the command fails with a hint.
- **Starting kit is a pine torch and wooden sword, stowed.** The player
  must PULL and USE them, which teaches the parser in the first minute,
  exactly as the original's opening did.
- **Seeded floor generation with hand-placed content tables** (open
  question 2): a deterministic generator (`npm run build:levels`) built
  the five committed floor files from per-floor roster tables; the JSON
  in `src/data/levels/` is the content of record and regenerating is a
  deliberate act.
- **Difficulty is faithful-first** (open question 3): the shipped
  numbers make a loaded sprint lethal in about eight seconds; softening
  belongs in `tuning.ts`, not in the model.
- **Mode C name plates unlock on first blood.** The portrait names a
  creature type once the player has struck one, standing in for
  "identified" until the author rules otherwise.
- **Victory triggers on any tier-5 kill.** Only the wizard is tier 5;
  the rule lives in data rather than a hard-coded id.
- **Debug commands are typed with a `$` prefix** (`$TELEPORT x y`,
  `$SPAWN id`, `$PULSE`, `$TORCH`), parsed only under `?debug=1`, so the
  shipping parser has no reserved words beyond the sixteen verbs.
