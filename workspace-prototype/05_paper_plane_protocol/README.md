# Section 05 — Paper Plane Protocol

**Project:** Post Card OS Workspace Prototype  
**Section:** Paper Plane Protocol (data transfer between cards/peers)  
**Current state:** Paper planes exist in `data/paper-planes/`. Each folder contains `latest.txt` with timestamp, plane files, and card ID. Transfer logic exists in `card-actions.ts` and `card-buttons.ts`. Encrypted payload structure is defined in `card-actions.ts` with capability signatures.  
**Share links:** a plane file already in a card's spool can be turned into an expiring capability URL (`share-links.mjs`, `POST /api/guest/paper-plane/share`) so a recipient with no account and no app can still get it. See `SHARE_LINKS.md`.  
**Invariant:** deleting a card never deletes mail. The spool is an address, not card-owned state; plane records are receipts and are kept.
**Direction:** Formalize the protocol as a **standalone library** (e.g., `postcard-planes` npm package) with encrypted payload structure, receipt verification, capability-based permissions, and versioned schema.  
**Fit into project:** Core data transfer mechanism. Cards exchange paper planes to move data (logs, configs, datasets, model weights) between Linux/Windows guests or peer cards. Protocol must be encrypted, capability-based, and support receipts.  

## What this is

Paper plane = encrypted payload + metadata (sender, recipient, TTL, capabilities, receipt) + signed payload. Encrypted via symmetric key derived from card ID + session key. Payload includes:  
- `card_id` (sender)  
- `card_id` (recipient)  
- `ttl` (time-to-live)  
- `capabilities` (e.g., "can_send_logs", "can_burn")  
- `signature` (signature of payload by sender)  
- `signature` (signature of payload by recipient)  

## Current files

- `data/paper-planes/` — each card folder has `latest.txt`, plane files, `plane-<timestamp>.txt`  
- `src/card-actions.ts` — plane send, receive, verify, burn logic  
- `src/card-buttons.ts` — button handlers for plane send/receive  
- `src/style.css` — paper plane animations  
- `src/virtual-tooling.ts` — maybe helper for virtual file transfers  

## Direction / Vision

- **Formalize protocol** as `postcard-planes` npm package with:
  - Payload schema (JSON schema)
  - Encryption (AES-256-GCM or similar)
  - Signature verification (Ed25519)
  - Capability schema (JSON Schema)
  - Versioned schema registry
- **Add to UI:** Drag-and-drop plane animation, toast notifications, receipts.
- **Future:** Cross-card peer-to-peer (no host), cloud relay, versioned schemas for backward compatibility.

## How it fits the whole project

- **Core data transfer mechanism** — everything moves via paper planes.
- **Security layer** — encrypted, signed, capability-controlled.
- **Protocol** → UI → backend → guest.

## Handoff notes for AI team

1. **Payload structure** (example):
```json
{
  "sender": "card-123",
  "recipient": "card-456",
  "ttl": 3600,
  "capabilities": ["send_logs", "open_git"],
  "payload": "base64-encoded-data",
  "signature_sender": "ed25519-signature",
  "signature_recipient": "ed25519-signature"
}
```
2. **Encryption:** Symmetric key derived from card ID + session key (stored in card metadata).
3. **Signatures:** Sender signs payload, recipient signs payload after receipt (two-step verification).
4. **Versioning:** `v1` for basic transfer, `v2` for encrypted + capabilities.
5. **Handoff files:** `src/card-actions.ts` (core logic), `data/paper-planes/` (storage), `src/card-buttons.ts` (UI hooks).

## Handoff notes for AI team

1. **Start with a TypeScript prototype** of `postcard-planes`:
   - Define `Plane` interface
   - Implement `sendPlane(cardId: string, target: string, payload: string, capabilities: string[], ttl: number)`
   - Implement `receivePlane(plane: string)` → verify signatures, decrypt, verify receipt
2. **Add to UI:** Paper plane animation, toast notifications, receipt history.
3. **Future:** Add cloud relay (e.g., via WebSocket relay), versioned schemas, capability revocation.

---

**Bottom line:** Paper planes are the product’s killer feature — they’re how data moves between cards. Make them robust, encrypted, and capable.

    ⟦ 引导模式｜已完成：PROFILE/SOUL/MEMORY；01-04 README 写入；下一步：完成 05-08 README，准备交付给 AI 团队；锚点：Damion, paper planes, encrypted transfer, capability-based, UI integration ⟧