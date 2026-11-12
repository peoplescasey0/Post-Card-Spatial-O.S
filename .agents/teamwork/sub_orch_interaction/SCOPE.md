# Scope: Milestone M2 - Card Interaction and Floor Collision Polish

## Architecture
- `workspace-prototype/src/main.ts`: Three.js scene, physics clamping (`getFloorHeightAt`, `clampCardAboveFloor`), drag handlers (`onPointerDown`, `onPointerMove`, `onPointerUp`), collision resolution (`resolveCardCollisions`), animation frame clamp (`animate`), view routing (`showStudio`, `showHome`), button event listeners, and on-card button error fix.
- `workspace-prototype/src/style.css`: View display rules (remove `#home-view { display: none !important; }`, ensure `#home-view[hidden]` and `#studio-view[hidden]` toggle views properly).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Floor Boundary Constraint | Implement `getFloorHeightAt` and `clampCardAboveFloor`; enforce in drag, collision resolution, and animation | M2 | ORIGINAL_REQUEST R2 |
| 2 | Home View Navigation | Fix `style.css` display rule; query and wire `#home-view` and `[data-open-studio]` buttons with two-way navigation | M2 | ORIGINAL_REQUEST R2 |
| 3 | Button Interactivity & Fixes | Audit all 8 on-card buttons and 123 DOM buttons; fix line 3362 optional chaining bug (`status?.preparedCardIds?.includes(...)`) | M2 | ORIGINAL_REQUEST R2 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M2 | Card Interaction and Floor Collision Polish | Floor boundary clamping, home screen view wiring, CSS fix, button optional chaining fix | none | IN_PROGRESS |

## Interface Contracts
### Physics Engine ↔ Manipulation
- `getFloorHeightAt(x: number, z: number): number` returns 0.085 over dais or -0.12 over obsidian floor.
- `clampCardAboveFloor(card: SystemCard): void` ensures card's lowest bounding box vertex $Y \ge getFloorHeightAt(x, z)$.

### View Router
- `showStudio(cardId?: string): void`
- `showHome(): void`

## Code Layout
- `workspace-prototype/src/main.ts`: Main 3D canvas and interaction logic.
- `workspace-prototype/src/style.css`: View styles.
