# main.ts extraction map

`workspace-prototype/src/main.ts` is 8,451 lines with 181 top-level declarations.
This maps those clusters to target modules so the extraction is mechanical.

**Do it bottom-up** (highest line numbers first) so the earlier ranges stay valid
while you work. One module per commit. After each commit:

```
cd workspace-prototype && node --test
```

**285 must stay 285.** If a count changes, a module boundary leaked.

## Target modules

| Target | Line ranges (current) | Contents | Owner |
|---|---|---|---|
| `src/room/` | 62, 1017-1146, 3036, 4289-4470, 4521-4600, 5970-6147, 7350-7420, 8082, 8355 | reduced-motion probe, floor geometry, orbit math, carousel cycling, selection, camera positions, resize, render profile, animation loop | 02 |
| `src/input/` | 6751-7206 | pointer down/move/up, wheel, canvas keys, double-click, hit testing | 02 |
| `src/cards/` | 674, 1153-1369, 1613-1750, 3054-4270, 5143-5238 | card model, slot/bench layout, persistence, id allocation, tier logic, `createCard`, every `drawCard*` / texture painter | 02 |
| `src/bin/` | 5919, 6279-6701 | paper bin model, drag-to-bin, fold flight, restore, permanent delete confirmation | 02 |
| `src/guests/` | 2929-3009, 4841-5551, 5706-5907, 8366 | guest status polling, `requestGuestApi`, VNC connect, start/stop/finalize, snapshots, memory/network/cpu profiles, serial exec, kernel telemetry bridge | 04 |
| `src/planes/` | 5512, 5838, 7213-7306 | send plane, backend delivery, airplane animation, file-drop upload, inject into VM | 05 |
| `src/butler/` | 1816-1963, 2743-2800 | butler context/dialogue/hover, blueprint HUD, share dialog, local profile | 02 |
| `src/monetization/` | 7650-7673+ | Stripe checkout, commercial editions init | 06 |
| `src/ui/` | 2276, 2800-2889, 4629-4766, 7343, 7471-7650 | chip actions, performance dialog, theme picker, toasts, guided tour + recording | 02 |

`src/main.ts` keeps only the bootstrap: DOM lookup, module wiring, initial
`selectCard()`, and the first `animate()` call. Target: **under 200 lines**.

## What makes this safe

- **No behavior change.** Move and re-export; don't "improve" while moving.
- **One module per commit**, tests green after each.
- `SystemCard` is the view model and is threaded through nearly everything.
  Put it in `src/cards/model.ts` and import it everywhere — do not duplicate it.
- `style.css` (6,823 lines) gets the same treatment in a separate pass: one
  stylesheet per component under `src/styles/`. 08 owns that.

## Why it's worth a day

Two sections (02 and 05) both need `main.ts` today. Extraction is what turns
"8 teams" from a merge-conflict generator into actual parallelism.
