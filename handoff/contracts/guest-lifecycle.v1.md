# Guest lifecycle API v1

Owner: **04 guest orchestration**. Source of truth: `workspace-prototype/guest-api.mjs`.
This file is an **inventory**, not an invented spec. 04 fills in request/response
bodies by reading the handler, then freezes it.

## Binding rules

- Everything binds to **loopback only**. Ports 5700 (VNC/WS) and 4444 (QMP) are
  per-guest and increment. Nothing here may ever be exposed to a network.
- Windows guests run under WSL2 with `swtpm` + OVMF. There is no `/dev/kvm` on
  this host, so Windows is TCG-emulated and slow. That is a hardware fact, not a bug.
- Max **4 concurrent guests**, max **8 GiB** guest RAM total.
- TPM state is guest identity. Deleting it breaks TPM-bound data in the guest.

## State machine (frozen)

```
absent --install--> installing --finalize-base--> installed --start--> running
   ^                    |                             |                 |
   |                    +--force-stop---------------->+<--stop----------+
   |                                                  |
   +--delete (confirmed, destroys state)-- stopped <---+--snapshot--> (checkpoint)
```

`error` is reachable from any transition and needs an explicit recovery path.

## Endpoints (all under `/api/guest/`, all real)

| Method | Path | Purpose |
|---|---|---|
| POST | `allocate-card-id` | Mint a card id |
| GET | `status` | Full `GuestServiceStatus` |
| POST | `start` | Boot a guest (mode: install/boot/resume) |
| POST | `stop` | Graceful shutdown request |
| POST | `force-stop` | Discard-unsaved shutdown, clearly labeled in UI |
| POST | `finalize-base` | Lock the Debian golden image |
| POST | `snapshot` | Named snapshot |
| POST | `restore-checkpoint` | Rollback with discard warning |
| POST | `reset-overlay` | Drop a per-card overlay |
| POST | `clone-overlay` | Clone card state |
| POST | `custom-iso` | Bring-your-own ISO / qcow2 |
| POST | `file-drop` | VVFAT drop |
| POST | `serial-exec` | Run a command in the guest |
| POST | `wake` | Wake the guest screen |
| POST | `network-mode` | user-mode only |
| POST | `memory-profile` | Per-card RAM |
| POST | `cpu-profile` | eco / balanced / gaming |
| POST | `swarm-fork` | Fork a card |
| POST | `paper-plane` | Send a plane |
| POST/GET | `paper-plane/inbox`, `paper-plane/catch`, `paper-plane/inject` | Plane transport hooks |
| POST | `ai-command` | Butler/AI command bridge |
| GET/POST | `telemetry` | See `telemetry.v1.json` |
| GET | `stderr` | Service log tail |
| POST | `delete` | Permanent delete, confirmed |

## What 04 must produce before this is frozen

1. Exact request body + response body per endpoint (copy from the handler, don't guess).
2. Error shapes: status code, `{error, detail}` or equivalent.
3. Which endpoints are idempotent, and which will double-boot if called twice.
4. A `GET /api/guest/contract` returning this document's version, so 02 can assert it.

02 codes against this file and nothing else. If 02 needs a field, 04 adds it here first.
