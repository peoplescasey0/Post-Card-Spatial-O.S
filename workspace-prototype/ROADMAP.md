# Post Card OS Improvement Checklist

Work through these improvements in order. The card preview preference is compact (about 25% of the card face); cards that are not in use turn edge-on to conceal their displays, then face forward when selected.

1. [x] **Card controls and Paper Bin** — Provide a per-card move-to-bin action, a visible corner bin, a fully folded paper-airplane flight, and a way to restore cards. Moving a card preserves its guest disk and data; permanent deletion remains a separate confirmed action.
2. [x] **Compact, private multi-card previews** — Keep guest display previews near one quarter of the card face; show live output only on the selected card, turn inactive cards edge-on, and honor reduced-motion settings.
3. [x] **Reliable guest lifecycle** — Improve prerequisite checks and the install, boot, shutdown, resume, status, and recovery flows (including 4-OS lifecycle parity and Bring Your Own OS custom ISO/QCOW2 mounting).
4. [x] **Safe snapshots** — Add named guest snapshots and rollback with clear warnings about discarded changes.
5. [x] **Workspace organization** — Add useful grouping and search without losing the spatial workspace's benefits (1/2/3-card SecOps workbench, OS template picker, and 6-facet interactive rows).
6. [x] **Consent-based transfer** — Support guest-to-guest data transfer with explicit user permission (card-to-card drag transfer, VVFAT file drop, and host-to-VM clipboard bridge).
7. [x] **Clear support status and lifecycle coverage** — Make implemented versus illustrative guest features obvious and test the important VM lifecycle paths.
