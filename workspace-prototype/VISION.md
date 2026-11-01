# Post Card OS: Architectural Overview & Engineering Vision

## 1. The Big Picture & Product Vision
Post Card OS is a next-generation, hardware-adjacent spatial hypervisor and multi-OS environment. It moves away from flat, legacy window managers by treating workspaces as persistent, floating 3D spatial cards with Copy-on-Write (CoW) state management. The ultimate design goal is a precision studio-grade environment, blending high-end Apple/Linear minimalism with a rugged, custom-engineered industrial core.

## 2. Core Technical Stack & Architecture
- **Hypervisor layer:** Built around QEMU and WSL integrations, enabling multi-OS virtualization and local virtual machine management.
- **State & file handling:** CoW overlays for instant snapshot rollbacks, plus a native "paper airplane" state-transfer UI for moving data across development environments.
- **Performance focus:** Low-latency, high-density workspaces optimized for heavy local engineering tasks and spatial visualization.

## 3. Visual Design Language & Color System
Strict **Precision Studio** aesthetic: deep obsidian/slate foundations paired with industrial phosphor amber accents.

- **Logo DNA:** A dark obsidian plate split by a sharp horizontal amber trace line with an active terminal dot (`public/company-logo.svg`).
- **Backgrounds:** Deep matte void `#07090E`; hypervisor slate gutters `#0D111A`.
- **Surfaces:** Frosted glass panels `#14161B` → `#1E2736`; cool smoke borders `#262A33`.
- **Gold accent `#FFB81C`** (brightened from `#F59E0B`, Enterprise-E LCARS gold): Reserved **exclusively** for active states, primary terminal cursors, connection bridges, loading indicators, and critical focus states.
- **Typography:** Main text `#F4F5F7`; muted titanium text `#8A909E`.
