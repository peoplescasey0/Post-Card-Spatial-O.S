/**
 * Blueprint & Architectural Diagram Registry for Post Card Spatial OS
 * Diagrams sourced from verified system designs in "Desktop/Going over".
 */

export type BlueprintItem = {
  id: string;
  title: string;
  kicker: string;
  category: "DevOps & CI/CD" | "Data & Storage" | "Product & UX" | "Robotics & Telemetry" | "Spatial OS Architecture";
  description: string;
  svgPath: string;
  mermaidSourceType: string;
  highlights: string[];
};

export const BLUEPRINTS: BlueprintItem[] = [
  {
    id: "ci-cd-pipeline",
    title: "Continuous Integration & Automated Delivery Pipeline",
    kicker: "DEVOPS & RELEASE INFRASTRUCTURE",
    category: "DevOps & CI/CD",
    description: "Multi-stage automated delivery pipeline with automated linting, test matrices, secure artifact publishing, and canary deployments.",
    svgPath: "/blueprints/ci-cd-pipeline-diagram-mermaid-community.svg",
    mermaidSourceType: "flowchart TD",
    highlights: [
      "Code Checkout & Linting validation",
      "Unit & End-to-End Vitest/Playwright matrix",
      "Signed artifact generation & containerization",
      "Production deployment gate with health probes",
    ],
  },
  {
    id: "erd-data-model",
    title: "Post Card OS Relational Entity Architecture",
    kicker: "POSTGRES & SUPABASE DATA MODEL",
    category: "Data & Storage",
    description: "Database entity-relationship mapping for licenses, Stripe subscriptions, spatial card snapshots, device telemetry, and paper planes.",
    svgPath: "/blueprints/entity-relationship-diagram-mermaid-community.svg",
    mermaidSourceType: "erDiagram",
    highlights: [
      "One-to-many relationship: Accounts to Licenses",
      "Row Level Security (RLS) policies on Supabase",
      "Encrypted token storage & audit timestamps",
      "Foreign key constraints & idempotency keys",
    ],
  },
  {
    id: "system-mindmap",
    title: "Spatial OS Full System Mindmap",
    kicker: "UNIFIED OPERATOR MAP",
    category: "Spatial OS Architecture",
    description: "High-level map connecting the Bare-Metal Rust micro-host kernel, QEMU hypervisor, 3D WebGL card turntable, audio rack, and the AI Butler.",
    svgPath: "/blueprints/system-mindmap-overview-mermaid-community.svg",
    mermaidSourceType: "mindmap",
    highlights: [
      "Bare-metal minimal Rust micro-host",
      "3D Spatial carousel with 6-way card flipping",
      "DirectLink 10.0.0.2 low-latency tunnel",
      "AI Butler co-pilot and automated state recovery",
    ],
  },
  {
    id: "lidar-decimation-filter",
    title: "State-Machine LiDAR UART Streaming Filter",
    kicker: "HARDWARE & SENSOR INTERFACING",
    category: "Robotics & Telemetry",
    description: "Deterministic state machine decimation filter for high-frequency LiDAR UART telemetry streams and spatial collision detection.",
    svgPath: "/blueprints/state-machine-based-decimation-filter-for-lidar-uart-streaming-mermaid-community.svg",
    mermaidSourceType: "stateDiagram-v2",
    highlights: [
      "Header synchronization (0xAA55 framing)",
      "High-throughput decimation filter & buffer safety",
      "UART baud rate lock & parity verification",
      "Real-time packet streaming to spatial 3D radar",
    ],
  },
  {
    id: "product-flowchart",
    title: "Spatial Experience Product Development Flow",
    kicker: "LIFECYCLE & SPECIFICATION",
    category: "Product & UX",
    description: "Operator product progression from initial boot & hardware discovery to multi-OS virtualization, Pro AV upgrade, and automated agent orchestration.",
    svgPath: "/blueprints/product-development-flowchart-mermaid-community.svg",
    mermaidSourceType: "flowchart LR",
    highlights: [
      "Discovery -> Evaluation -> Onboarding",
      "Freemium Core vs. Pro Suite activation",
      "Enterprise air-gapped security & golden locks",
      "AI Butler co-pilot subscription loop",
    ],
  },
];

