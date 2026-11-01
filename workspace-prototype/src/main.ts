import * as THREE from "three";
import RFB from "@novnc/novnc";
import "./style.css";

type GuestBootMode = "installer" | "disk";
type GuestOS = "linux" | "windows" | "android" | "macos";
type GuestRuntimeStatus = "offline" | "starting" | "running" | "stopping" | "error";
type CpuProfile = "eco" | "balanced" | "gaming";
type GraphicsProfile = "performance" | "balanced" | "quality";
type CardFacet = "front" | "back" | "left" | "right" | "top" | "bottom";

type GuestStatus = {
  os: GuestOS;
  cardId: string;
  status: GuestRuntimeStatus;
  bootMode?: GuestBootMode;
  error?: string;
  websocketPort: number | null;
  serialPort?: number | null;
  serialOutput?: string;
  memoryMb?: number;
  vcpus?: number;
  diskPath: string;
};

type PaperPlaneRecord = {
  id: string;
  fromCardId: string;
  toCardId: string;
  os: string;
  message: string;
  createdAt: string;
  deliveredToVm: boolean;
  chainHash?: string;
  remoteTarget?: string;
  deliveredToRemote?: boolean;
  remoteDeliveryInfo?: string;
};

type CheckpointRecord = {
  tag: string;
  os: string;
  savedAt: string;
  mode?: string;
  rewoundAt?: string;
};

type AiCommandResult = {
  prompt: string;
  command: string;
  rationale: string;
  category: string;
  targetCardId: string;
  os: string;
};

type GuestServiceStatus = {
  baseReady: boolean;
  baseDiskExists: boolean;
  baseDiskPath: string;
  pairDropRooms?: Record<string, { pairKey?: string; roomId?: string; peers?: string[] }>;
  preparedCardIds: string[];
  preparedWindowsCardIds: string[];
  installedWindowsCardIds?: string[];
  guests: GuestStatus[];
  paperPlanes?: PaperPlaneRecord[];
  checkpoints?: Record<string, CheckpointRecord>;
  networkModes?: Record<string, "nat" | "cyber-range" | "airgap">;
  memoryProfiles?: Record<string, "eco" | "balanced" | "performance">;
  cpuProfiles?: Record<string, CpuProfile>;
  cpuCapacity?: number;
  aiResult?: AiCommandResult;
  swarmResult?: { sourceCardId: string; os: string; createdCardIds: string[] };
  serialExecResult?: { cardId: string; os: string; command: string; output: string };
  pairdropResult?: {
    action: string;
    pairKey?: string;
    roomId?: string;
    roomSecret?: string;
    peers?: string[];
    remoteTarget?: string;
    url?: string;
  };
};

type SystemCard = {
  id: string;
  name: string;
  os: string;
  detail: string;
  color: string;
  status: string;
  group: THREE.Group;
  receivedNotes: string[];
  sentNotes: string[];
  facet: CardFacet;
  backFaceVisible: boolean;
  targetRotation: number;
  tiltX: number;
  tiltZ: number;
  resetCount: number;
  clonedFrom?: string;
  liveCanvas?: HTMLCanvasElement;
  serialOutput?: string;
  layoutOffset: THREE.Vector3;
  layoutPosition: THREE.Vector3;
  orbitAngle: number;
  lastTextureKey?: string;
  flipAnim?: {
    startRotationY: number;
    targetRotationY: number;
    startTime: number;
    duration: number;
    midpointPassed: boolean;
    targetFacet: CardFacet;
    tiltDir: number;
    tiltAxis: "x" | "z";
  };
};

const FACET_ORDER: CardFacet[] = ["front", "back", "left", "right", "top", "bottom"];
const CPU_PROFILE_VCPUS: Record<CpuProfile, number> = {
  eco: 1,
  balanced: 2,
  gaming: 4,
};

const FACET_META: Record<
  CardFacet,
  { badge: string; header: string; shortLabel: string; accent: string }
> = {
  front: {
    badge: "01 / 06",
    header: "POST CARD OS",
    shortLabel: "display",
    accent: "#8a909e",
  },
  back: {
    badge: "02 / 06",
    header: "CARD SETTINGS",
    shortLabel: "settings",
    accent: "#FFB81C",
  },
  left: {
    badge: "03 / 06",
    header: "SECURITY & ISOLATION",
    shortLabel: "security",
    accent: "#8a909e",
  },
  right: {
    badge: "04 / 06",
    header: "PAPER PLANES",
    shortLabel: "paper planes",
    accent: "#FFB81C",
  },
  top: {
    badge: "05 / 06",
    header: "QUICK ACTIONS",
    shortLabel: "quick actions",
    accent: "#8a909e",
  },
  bottom: {
    badge: "06 / 06",
    header: "TELEMETRY & PORTS",
    shortLabel: "telemetry",
    accent: "#FFB81C",
  },
};

const container = document.querySelector<HTMLDivElement>("#scene");
const facetBar = document.querySelector<HTMLElement>("#facet-bar");
const secopsToggle = document.querySelector<HTMLButtonElement>("#secops-toggle");
const omniForm = document.querySelector<HTMLFormElement>("#omni-form");
const omniInput = document.querySelector<HTMLInputElement>("#omni-input");
const omniChips = document.querySelector<HTMLDivElement>("#omni-chips");
const quickFileInput = document.querySelector<HTMLInputElement>("#quick-file-input");
const flipCompass = document.querySelector<HTMLElement>("#flip-compass");
const compassCycleButton = document.querySelector<HTMLButtonElement>("#compass-cycle");
const compassZoomButton = document.querySelector<HTMLButtonElement>("#compass-zoom");
const selectedName = document.querySelector<HTMLDivElement>("#selected-name");
const cardCount = document.querySelector<HTMLSpanElement>("#card-count");
const sceneCardIndex = document.querySelector<HTMLSpanElement>("#scene-card-index");
const sceneCardTotal = document.querySelector<HTMLSpanElement>("#scene-card-total");
const zoomButton = document.querySelector<HTMLButtonElement>("#zoom-button");
const zoomButtonLabel = document.querySelector<HTMLSpanElement>("#zoom-button-label");
const flipButton = document.querySelector<HTMLButtonElement>("#flip-button");
const cloneButton = document.querySelector<HTMLButtonElement>("#clone-button");
const resetButton = document.querySelector<HTMLButtonElement>("#reset-button");
const sendButton = document.querySelector<HTMLButtonElement>("#send-button");
const guestButton = document.querySelector<HTMLButtonElement>("#guest-button");
const addButton = document.querySelector<HTMLButtonElement>("#add-button");
const performanceButton = document.querySelector<HTMLButtonElement>("#performance-button");
const shareDialog = document.querySelector<HTMLDialogElement>("#share-dialog");
const shareForm = document.querySelector<HTMLFormElement>("#share-form");
const recipientSelect = document.querySelector<HTMLSelectElement>("#recipient");
const remoteTargetInput = document.querySelector<HTMLInputElement>("#remote-target");
const fileDropInput = document.querySelector<HTMLInputElement>("#file-drop-input");
const messageInput = document.querySelector<HTMLTextAreaElement>("#message");
const performanceDialog = document.querySelector<HTMLDialogElement>("#performance-dialog");
const performanceForm = document.querySelector<HTMLFormElement>("#performance-form");
const cpuProfileSelect = document.querySelector<HTMLSelectElement>("#cpu-profile");
const graphicsProfileSelect = document.querySelector<HTMLSelectElement>("#graphics-profile");
const performanceGpuInfo = document.querySelector<HTMLElement>("#performance-gpu-info");
const performanceNotice = document.querySelector<HTMLElement>("#performance-notice");
const helpDialog = document.querySelector<HTMLDialogElement>("#help-dialog");
const guestDialog = document.querySelector<HTMLDialogElement>("#guest-dialog");
const guestDisplay = document.querySelector<HTMLDivElement>("#guest-display");
const guestState = document.querySelector<HTMLParagraphElement>("#guest-state");
const guestError = document.querySelector<HTMLDivElement>("#guest-error");
const guestTitle = document.querySelector<HTMLHeadingElement>("#guest-title");
const guestCloseButton = document.querySelector<HTMLButtonElement>("#guest-close");
const guestInstallButton = document.querySelector<HTMLButtonElement>("#guest-install");
const guestFinalizeBaseButton = document.querySelector<HTMLButtonElement>("#guest-finalize-base");
const guestBootDiskButton = document.querySelector<HTMLButtonElement>("#guest-boot-disk");
const guestCloneCardButton = document.querySelector<HTMLButtonElement>("#guest-clone-card");
const guestResetOverlayButton = document.querySelector<HTMLButtonElement>("#guest-reset-overlay");
const guestInjectPlaneButton = document.querySelector<HTMLButtonElement>("#guest-inject-plane");
const guestSavepointButton = document.querySelector<HTMLButtonElement>("#guest-savepoint");
const guestRewindButton = document.querySelector<HTMLButtonElement>("#guest-rewind");
const guestRestoreCheckpointButton = document.querySelector<HTMLButtonElement>("#guest-restore-checkpoint");
const guestShutdownButton = document.querySelector<HTMLButtonElement>("#guest-shutdown");
const guestForceStopButton = document.querySelector<HTMLButtonElement>("#guest-force-stop");
const toast = document.querySelector<HTMLDivElement>("#toast");
const tourButton = document.querySelector<HTMLButtonElement>("#tour-button");
const recordTourButton = document.querySelector<HTMLButtonElement>("#record-tour-button");
const selectedTier = document.querySelector<HTMLSpanElement>("#selected-tier");
const tourOverlay = document.querySelector<HTMLDivElement>("#tour-overlay");
const tourStepBadge = document.querySelector<HTMLSpanElement>("#tour-step-badge");
const tourStatusLabel = document.querySelector<HTMLSpanElement>("#tour-status-label");
const tourStepTitle = document.querySelector<HTMLDivElement>("#tour-step-title");
const tourStepDesc = document.querySelector<HTMLDivElement>("#tour-step-desc");
const tourProgressFill = document.querySelector<HTMLDivElement>("#tour-progress-fill");

if (
  !container ||
  !facetBar ||
  !secopsToggle ||
  !omniForm ||
  !omniInput ||
  !omniChips ||
  !flipCompass ||
  !compassCycleButton ||
  !compassZoomButton ||
  !selectedName ||
  !cardCount ||
  !sceneCardIndex ||
  !sceneCardTotal ||
  !zoomButton ||
  !zoomButtonLabel ||
  !flipButton ||
  !cloneButton ||
  !resetButton ||
  !sendButton ||
  !guestButton ||
  !addButton ||
  !performanceButton ||
  !shareDialog ||
  !shareForm ||
  !recipientSelect ||
  !remoteTargetInput ||
  !messageInput ||
  !performanceDialog ||
  !performanceForm ||
  !cpuProfileSelect ||
  !graphicsProfileSelect ||
  !performanceGpuInfo ||
  !performanceNotice ||
  !helpDialog ||
  !guestDialog ||
  !guestDisplay ||
  !guestState ||
  !guestError ||
  !guestTitle ||
  !guestCloseButton ||
  !guestInstallButton ||
  !guestFinalizeBaseButton ||
  !guestBootDiskButton ||
  !guestCloneCardButton ||
  !guestResetOverlayButton ||
  !guestInjectPlaneButton ||
  !guestSavepointButton ||
  !guestRewindButton ||
  !guestShutdownButton ||
  !guestForceStopButton ||
  !toast ||
  !tourButton ||
  !recordTourButton ||
  !selectedTier ||
  !tourOverlay ||
  !tourStepBadge ||
  !tourStatusLabel ||
  !tourStepTitle ||
  !tourStepDesc ||
  !tourProgressFill
) {
  throw new Error("Workspace UI is missing a required element.");
}

const sceneElement = container;
const facetBarElement = facetBar;
const secopsToggleElement = secopsToggle;
const tourButtonElement = tourButton;
const recordTourButtonElement = recordTourButton;
const selectedTierElement = selectedTier;
const tourOverlayElement = tourOverlay;
const tourStepBadgeElement = tourStepBadge;
const tourStatusLabelElement = tourStatusLabel;
const tourStepTitleElement = tourStepTitle;
const tourStepDescElement = tourStepDesc;
const tourProgressFillElement = tourProgressFill;
const omniFormElement = omniForm;
const omniInputElement = omniInput;
const omniChipsElement = omniChips;
const flipCompassElement = flipCompass;
const compassCycleButtonElement = compassCycleButton;
const compassZoomButtonElement = compassZoomButton;
const selectedNameElement = selectedName;
const cardCountElement = cardCount;
const sceneCardIndexElement = sceneCardIndex;
const sceneCardTotalElement = sceneCardTotal;
const zoomButtonElement = zoomButton;
const zoomButtonLabelElement = zoomButtonLabel;
const performanceButtonElement = performanceButton;
const performanceDialogElement = performanceDialog;
const performanceFormElement = performanceForm;
const cpuProfileSelectElement = cpuProfileSelect;
const graphicsProfileSelectElement = graphicsProfileSelect;
const performanceGpuInfoElement = performanceGpuInfo;
const performanceNoticeElement = performanceNotice;
const cloneButtonElement = cloneButton;
const resetButtonElement = resetButton;
const recipientSelectElement = recipientSelect;
const remoteTargetInputElement = remoteTargetInput;
const toastElement = toast;
const shareDialogElement = shareDialog;
const messageInputElement = messageInput;
const guestDisplayElement = guestDisplay;
const guestStateElement = guestState;
const guestErrorElement = guestError;
const guestTitleElement = guestTitle;
const guestButtonElement = guestButton;
const guestDialogElement = guestDialog;
const guestInstallButtonElement = guestInstallButton;
const guestFinalizeBaseButtonElement = guestFinalizeBaseButton;
const guestBootDiskButtonElement = guestBootDiskButton;
const guestCloneCardButtonElement = guestCloneCardButton;
const guestResetOverlayButtonElement = guestResetOverlayButton;
const guestInjectPlaneButtonElement = guestInjectPlaneButton;
const guestSavepointButtonElement = guestSavepointButton;
const guestRewindButtonElement = guestRewindButton;
const guestShutdownButtonElement = guestShutdownButton;
const guestForceStopButtonElement = guestForceStopButton;

const pricingDialogElement = document.querySelector<HTMLDialogElement>("#pricing-dialog");
const pricingButtonElement = document.querySelector<HTMLButtonElement>("#pricing-button");
const cancelPricingElement = document.querySelector<HTMLButtonElement>("#cancel-pricing");
const intervalMonthlyElement = document.querySelector<HTMLInputElement>("#pricing-interval-monthly");
const intervalAnnualElement = document.querySelector<HTMLInputElement>("#pricing-interval-annual");
const proPriceDisplayElement = document.querySelector<HTMLDivElement>("#pro-price-display");
const enterprisePriceDisplayElement = document.querySelector<HTMLDivElement>("#enterprise-price-display");

const scene = new THREE.Scene();
scene.background = new THREE.Color("#07090E");
scene.fog = new THREE.FogExp2("#07090E", 0.026);

const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 100);
camera.position.set(0, 4.48, 17.2);
camera.lookAt(0, 2.42, -0.25);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute("role", "application");
renderer.domElement.setAttribute(
  "aria-label",
  "Interactive Post Card studio. Use left and right arrow keys to browse, WASD or 1-6 for 6-way card flips, or drag a card to arrange it.",
);
container.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight("#f4f5f7", "#0d111a", 1.65));
const keyLight = new THREE.DirectionalLight("#FFB81C", 2.75);
keyLight.position.set(-5, 10, 7);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -11;
keyLight.shadow.camera.right = 11;
keyLight.shadow.camera.top = 11;
keyLight.shadow.camera.bottom = -7;
keyLight.shadow.bias = -0.0003;
scene.add(keyLight);
const fillLight = new THREE.PointLight("#8a909e", 26, 24);
fillLight.position.set(6, 5, -5);
scene.add(fillLight);
const rimLight = new THREE.PointLight("#FFB81C", 28, 22);
rimLight.position.set(-6, 4, 2);
scene.add(rimLight);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({
    color: "#0D111A",
    roughness: 0.86,
    metalness: 0.22,
  }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.12;
floor.receiveShadow = true;
scene.add(floor);

// Grand Architectural Observatory Window overlooking the Cosmic Starfield
const studioWallMat = new THREE.MeshStandardMaterial({
  color: "#0D111A",
  roughness: 0.92,
  metalness: 0.18,
});
// Flanking architectural walls
const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(10.5, 14), studioWallMat);
leftWall.position.set(-13.25, 6.8, -9.4);
leftWall.receiveShadow = true;
const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(10.5, 14), studioWallMat);
rightWall.position.set(13.25, 6.8, -9.4);
rightWall.receiveShadow = true;
// Lower sill and upper ceiling bulkhead
const lowerSill = new THREE.Mesh(new THREE.PlaneGeometry(16.5, 1.8), studioWallMat);
lowerSill.position.set(0, 0.78, -9.4);
lowerSill.receiveShadow = true;
const upperBulkhead = new THREE.Mesh(new THREE.PlaneGeometry(16.5, 2.8), studioWallMat);
upperBulkhead.position.set(0, 12.4, -9.4);
upperBulkhead.receiveShadow = true;
scene.add(leftWall, rightWall, lowerSill, upperBulkhead);

// Tinted Observatory Window Glass Pane
const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: "#0d111a",
  transparent: true,
  opacity: 0.28,
  roughness: 0.14,
  metalness: 0.35,
  depthWrite: false,
});
const windowGlass = new THREE.Mesh(new THREE.PlaneGeometry(16.2, 9.6), glassMaterial);
windowGlass.position.set(0, 6.4, -9.38);
scene.add(windowGlass);

// Observatory Window Mullions & Framing
const frameMat = new THREE.MeshStandardMaterial({
  color: "#1e2736",
  metalness: 0.74,
  roughness: 0.32,
});
const frameGoldMat = new THREE.MeshStandardMaterial({
  color: "#FFB81C",
  emissive: "#FFB81C",
  emissiveIntensity: 0.35,
  metalness: 0.85,
  roughness: 0.25,
});

// Vertical astragals / mullions dividing the panoramic glass into 3 grand bays
for (const x of [-8.05, -2.7, 2.7, 8.05]) {
  const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.12, 9.6, 0.16), frameMat);
  mullion.position.set(x, 6.4, -9.32);
  scene.add(mullion);
  // Elegant slim amber pinstripe along inner mullions
  if (Math.abs(x) < 5) {
    const pinstripe = new THREE.Mesh(new THREE.BoxGeometry(0.02, 9.6, 0.18), frameGoldMat);
    pinstripe.position.set(x, 6.4, -9.31);
    scene.add(pinstripe);
  }
}
// Horizontal transoms
for (const y of [1.68, 6.4, 11.18]) {
  const transom = new THREE.Mesh(new THREE.BoxGeometry(16.3, 0.12, 0.16), frameMat);
  transom.position.set(0, y, -9.32);
  scene.add(transom);
}

// Deep Cosmic Starfield & Celestial Nebula behind the observatory window
const starCount = 650;
const starPositions = new Float32Array(starCount * 3);
const starColors = new Float32Array(starCount * 3);
const starPalette = [
  new THREE.Color("#ffffff"),
  new THREE.Color("#f4f5f7"),
  new THREE.Color("#f4f5f7"),
  new THREE.Color("#8a909e"),
  new THREE.Color("#f4f5f7"),
  new THREE.Color("#FFB81C"),
  new THREE.Color("#FFB81C"),
];

for (let i = 0; i < starCount; i++) {
  // Broad celestial arc spanning behind the observatory
  const angle = (Math.random() - 0.5) * 1.68;
  const dist = 14 + Math.random() * 14; // 14 to 28 depth
  starPositions[i * 3] = Math.sin(angle) * dist;
  starPositions[i * 3 + 1] = 1.0 + Math.random() * 12.5;
  starPositions[i * 3 + 2] = -dist * Math.cos(angle);

  const col = starPalette[Math.floor(Math.random() * starPalette.length)];
  starColors[i * 3] = col.r;
  starColors[i * 3 + 1] = col.g;
  starColors[i * 3 + 2] = col.b;
}

const starGeometry = new THREE.BufferGeometry();
starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
starGeometry.setAttribute("color", new THREE.BufferAttribute(starColors, 3));
const starMaterial = new THREE.PointsMaterial({
  size: 0.088,
  vertexColors: true,
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
});
const cosmicStarfield = new THREE.Points(starGeometry, starMaterial);
scene.add(cosmicStarfield);

// Distant soft nebula glow in deep space
for (const [x, y, z, color, opacity, radius] of [
  [-4.5, 7.2, -22, "#8a909e", 0.07, 7.5],
  [5.2, 5.8, -24, "#FFB81C", 0.06, 8.2],
  [0.2, 8.8, -25, "#8a909e", 0.05, 6.8],
] as const) {
  const nebulaGlow = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 48),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    }),
  );
  nebulaGlow.position.set(x, y, z);
  scene.add(nebulaGlow);
}

const dais = new THREE.Mesh(
  new THREE.CylinderGeometry(7.7, 8.05, 0.2, 96, 1, false),
  new THREE.MeshStandardMaterial({ color: "#0d111a", metalness: 0.48, roughness: 0.46 }),
);
dais.position.set(0, -0.015, -0.25);
dais.receiveShadow = true;
dais.castShadow = true;
scene.add(dais);
for (const [radius, tube, color] of [
  [7.74, 0.035, "#FFB81C"],
  [7.48, 0.012, "#262A33"],
] as const) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 8, 128),
    new THREE.MeshStandardMaterial({ color, metalness: 0.76, roughness: 0.32 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, 0.1, -0.25);
  scene.add(ring);
}

const glowDisc = new THREE.Mesh(
  new THREE.CircleGeometry(6.2, 80),
  new THREE.MeshBasicMaterial({
    color: "#FFB81C",
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
  }),
);
glowDisc.rotation.x = -Math.PI / 2;
glowDisc.position.set(0, 0.102, -0.4);
scene.add(glowDisc);

// Studio Furniture & Architectural Details (G-III Twin-Star Sanctuary)
for (const [innerR, tubeR, ringColor, emissiveHex] of [
  [4.85, 0.018, "#262A33", "#1E2736"],
  [2.95, 0.015, "#FFB81C", "#B45309"],
] as const) {
  const innerRing = new THREE.Mesh(
    new THREE.TorusGeometry(innerR, tubeR, 8, 96),
    new THREE.MeshStandardMaterial({
      color: ringColor,
      emissive: emissiveHex,
      emissiveIntensity: 0.65,
      metalness: 0.7,
      roughness: 0.28,
    }),
  );
  innerRing.rotation.x = Math.PI / 2;
  innerRing.position.set(0, 0.105, -0.25);
  scene.add(innerRing);
}

// 12 radial turntable compass ticks on the dais floor
const tickMaterial = new THREE.MeshStandardMaterial({
  color: "#FFB81C",
  emissive: "#FFB81C",
  emissiveIntensity: 0.45,
});
for (let i = 0; i < 12; i++) {
  const angle = (i * Math.PI) / 6;
  const tick = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.01, 0.55), tickMaterial);
  tick.position.set(Math.sin(angle) * 6.2, 0.104, -0.25 + Math.cos(angle) * 6.2);
  tick.rotation.y = angle;
  scene.add(tick);
}

// Twin Neural Monolith Racks flanking the back studio corners
const monolithBodyMat = new THREE.MeshStandardMaterial({
  color: "#0d111a",
  metalness: 0.62,
  roughness: 0.34,
});
const monolithLedMats: THREE.MeshStandardMaterial[] = [];
for (const side of [-1, 1] as const) {
  const towerGroup = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.35, 5.6, 0.95), monolithBodyMat);
  body.position.y = 2.8;
  body.castShadow = true;
  body.receiveShadow = true;
  towerGroup.add(body);

  // Sleek side credenza / low cyber-console beside each monolith
  const consoleBox = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.85, 0.82), monolithBodyMat);
  consoleBox.position.set(side * -1.85, 0.425, 0.45);
  consoleBox.castShadow = true;
  consoleBox.receiveShadow = true;
  towerGroup.add(consoleBox);

  const consoleStrip = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.035, 0.04),
    new THREE.MeshStandardMaterial({
      color: side < 0 ? "#8a909e" : "#FFB81C",
      emissive: side < 0 ? "#8a909e" : "#FFB81C",
      emissiveIntensity: 0.9,
    }),
  );
  consoleStrip.position.set(side * -1.85, 0.72, 0.87);
  towerGroup.add(consoleStrip);

  for (let row = 0; row < 7; row++) {
    const isAmber = (row + (side > 0 ? 1 : 0)) % 2 === 0;
    const ledColor = isAmber ? "#FFB81C" : "#8a909e";
    const ledMat = new THREE.MeshStandardMaterial({
      color: ledColor,
      emissive: ledColor,
      emissiveIntensity: 0.85,
    });
    monolithLedMats.push(ledMat);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.045, 0.04), ledMat);
    blade.position.set(0, 1.15 + row * 0.62, 0.49);
    towerGroup.add(blade);
  }

  towerGroup.position.set(side * 8.6, 0, -6.5);
  towerGroup.rotation.y = side * -0.26;
  scene.add(towerGroup);
}

// Suspended Overhead Halo Chandelier Rig
const overheadHaloGroup = new THREE.Group();
const outerHalo = new THREE.Mesh(
  new THREE.TorusGeometry(5.4, 0.045, 12, 96),
  new THREE.MeshStandardMaterial({
    color: "#1e2736",
    emissive: "#8a909e",
    emissiveIntensity: 0.35,
    metalness: 0.82,
    roughness: 0.22,
  }),
);
outerHalo.rotation.x = Math.PI / 2;
overheadHaloGroup.add(outerHalo);

const innerHalo = new THREE.Mesh(
  new THREE.TorusGeometry(3.6, 0.03, 12, 96),
  new THREE.MeshStandardMaterial({
    color: "#14161b",
    emissive: "#FFB81C",
    emissiveIntensity: 0.55,
    metalness: 0.82,
    roughness: 0.22,
  }),
);
innerHalo.rotation.x = Math.PI / 2;
overheadHaloGroup.add(innerHalo);
overheadHaloGroup.position.set(0, 6.15, -0.35);
scene.add(overheadHaloGroup);

// Ambient Twin-Star Floating Data Motes
const moteCount = 56;
const motePositions = new Float32Array(moteCount * 3);
const moteColors = new Float32Array(moteCount * 3);
const emeraldColor = new THREE.Color("#8a909e");
const amberColor = new THREE.Color("#FFB81C");
for (let i = 0; i < moteCount; i++) {
  const angle = (i / moteCount) * Math.PI * 2;
  const radius = 5.2 + (i % 7) * 0.65;
  motePositions[i * 3] = Math.cos(angle) * radius;
  motePositions[i * 3 + 1] = 0.8 + (i % 9) * 0.58;
  motePositions[i * 3 + 2] = -1.2 + Math.sin(angle) * (radius * 0.55);
  const c = i % 2 === 0 ? emeraldColor : amberColor;
  moteColors[i * 3] = c.r;
  moteColors[i * 3 + 1] = c.g;
  moteColors[i * 3 + 2] = c.b;
}
const moteGeometry = new THREE.BufferGeometry();
moteGeometry.setAttribute("position", new THREE.BufferAttribute(motePositions, 3));
moteGeometry.setAttribute("color", new THREE.BufferAttribute(moteColors, 3));
const studioMotes = new THREE.Points(
  moteGeometry,
  new THREE.PointsMaterial({
    size: 0.065,
    vertexColors: true,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  }),
);
scene.add(studioMotes);

const CARD_WIDTH = 2.15;
const CARD_HEIGHT = 3.2;
const cardGeometry = new THREE.ShapeGeometry(roundedRectangle(CARD_WIDTH, CARD_HEIGHT, 0.13));
const uvAttr = cardGeometry.attributes.uv;
if (uvAttr) {
  for (let i = 0; i < uvAttr.count; i++) {
    const u = (uvAttr.getX(i) + CARD_WIDTH / 2) / CARD_WIDTH;
    const v = (uvAttr.getY(i) + CARD_HEIGHT / 2) / CARD_HEIGHT;
    uvAttr.setXY(i, u, v);
  }
  uvAttr.needsUpdate = true;
}
const edgeGeometry = new THREE.ExtrudeGeometry(roundedRectangle(CARD_WIDTH, CARD_HEIGHT, 0.13), {
  depth: 0.105,
  bevelEnabled: true,
  bevelSegments: 3,
  steps: 1,
  bevelSize: 0.025,
  bevelThickness: 0.025,
});
edgeGeometry.translate(0, 0, -0.0525);
edgeGeometry.computeBoundingBox();
const edgeBounds = edgeGeometry.boundingBox;
if (!edgeBounds) throw new Error("Unable to determine card body bounds.");
const frontFaceZ = edgeBounds.max.z + 0.005;
const backFaceZ = edgeBounds.min.z - 0.005;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const dragPoint = new THREE.Vector3();
const cards: SystemCard[] = [];
let selectedCard: SystemCard | null = null;
let selectedIndex = 2;
let cloneCounter = 1;
let guestRfb: RFB | undefined;
let guestServiceStatus: GuestServiceStatus | undefined;
let guestTargetCardId: string | undefined;
let guestTargetOs: GuestOS = "linux";
let secOpsMode = false;
let cardZoomed = false;
let studioGraphicsProfile: GraphicsProfile = "balanced";
const cameraLookTarget = new THREE.Vector3(0, 2.42, -0.25);

type MonetizationTier = "COMMUNITY" | "PRO" | "ENTERPRISE";

function getCardTier(card: SystemCard): MonetizationTier {
  if (card.id === "postcard-os" || card.id === "kali-red") return "ENTERPRISE";
  if (card.id === "windows" || card.id === "macos") return "PRO";
  return "COMMUNITY";
}

let tourActive = false;
let tourStartTime = 0;
let tourStage = 0;
let isTourRecording = false;
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];

let tourCameraOverridePos: THREE.Vector3 | null = null;
let tourCameraOverrideLook: THREE.Vector3 | null = null;

let tourPaperPlaneFired = false;
let tourPerformanceSwitched = false;
let tourSecOpsSwitched = false;
const rolodexRadius = 8.4;
const rolodexAngleStep = 0.44;
const INITIAL_CARD_INDEX = 2; // Linux · Dev Space starts in center
const BASE_SLOT_COUNT = 5;
function getSlotStep(): number {
  return (2 * Math.PI) / Math.max(cards.length, BASE_SLOT_COUNT);
}
let turntableAngle = -INITIAL_CARD_INDEX * ((2 * Math.PI) / BASE_SLOT_COUNT);
let targetTurntableAngle = turntableAngle;
let turntableVelocity = 0;
let dragStartTurntableAngle = turntableAngle;
let lastPointerX = 0;
let lastPointerTime = 0;
let wheelAccumulator = 0;
let lastWheelStepTime = 0;

function normalizeAngle(a: number): number {
  let res = (a + Math.PI) % (2 * Math.PI);
  if (res < 0) res += 2 * Math.PI;
  return res - Math.PI;
}

let drag:
  | {
      card?: SystemCard;
      pointerId: number;
      mode: "carousel" | "move" | "flip";
      offset?: THREE.Vector3;
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
      moved: boolean;
      hitUv?: THREE.Vector2;
    }
  | undefined;
let toastTimeout = 0;
let airplane:
  | {
      mesh: THREE.Group;
      from: THREE.Vector3;
      to: THREE.Vector3;
      startedAt: number;
      duration: number;
      fromCard: SystemCard;
      target?: SystemCard;
      remoteTarget?: string;
      rawMessage: string;
      message: string;
    }
  | undefined;
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let reduceMotion = reducedMotionQuery.matches;

reducedMotionQuery.addEventListener("change", (event) => {
  reduceMotion = event.matches;
});

const airplaneGeometry = new THREE.BufferGeometry();
airplaneGeometry.setAttribute(
  "position",
  new THREE.Float32BufferAttribute(
    [
      0, 0.09, 0,
      -0.17, -0.13, 0,
      0, -0.065, 0,
      0, 0.09, 0,
      0, -0.065, 0,
      0.17, -0.13, 0,
      0, 0.09, 0,
      0, -0.13, 0,
      0, -0.065, 0,
    ],
    3,
  ),
);
airplaneGeometry.computeVertexNormals();
const airplaneMaterial = new THREE.MeshStandardMaterial({
  color: "#FFB81C",
  emissive: "#FFB81C",
  emissiveIntensity: 1.7,
  side: THREE.DoubleSide,
});

const initialCards = [
  {
    id: "postcard-os",
    name: "Post Card · Spatial OS",
    os: "LINUX",
    detail: "Bare-metal Multiboot2 micro-kernel, Ring 3 isolation & spatial shell.",
    color: "#00E5FF",
    status: "STANDBY · READY",
  },
  {
    id: "android",
    name: "Android · Pocket Lab",
    os: "ANDROID",
    detail: "Your mobile world, brought into the room.",
    color: "#8a909e",
    status: "DEMO · DISCONNECTED",
  },
  {
    id: "windows",
    name: "Windows · Studio",
    os: "WINDOWS",
    detail: "A familiar world, with room to roam.",
    color: "#8a909e",
    status: "DEMO · DISCONNECTED",
  },
  {
    id: "linux",
    name: "Linux · Dev Space",
    os: "LINUX",
    detail: "Build, explore, make things happen.",
    color: "#FFB81C",
    status: "DEMO · DISCONNECTED",
  },
  {
    id: "macos",
    name: "macOS · Pure Studio",
    os: "MACOS",
    detail: "Darwin micro-kernel, Metal acceleration & Unix studio.",
    color: "#e2e8f0",
    status: "DEMO · DISCONNECTED",
  },
  {
    id: "agent-sandbox",
    name: "Agent · OpenSandbox",
    os: "LINUX",
    detail: "Apache-2.0 micro-sandbox, golden templates & credential vault.",
    color: "#FFB81C",
    status: "DEMO · DISCONNECTED",
  },
  {
    id: "kali-red",
    name: "Kali · Cyber Range",
    os: "LINUX",
    detail: "Offensive SecOps, AI recon & isolated VLAN lab.",
    color: "#8a909e",
    status: "DEMO · DISCONNECTED",
  },
];

for (const [index, definition] of initialCards.entries()) {
  cards.push(createCard(definition, index));
}
arrangeCards();
selectCard(cards[0]);
updateCardCount();
updateRecipientOptions();
resize();
void refreshGuestStatus().catch((error: unknown) => {
  setGuestError(error instanceof Error ? error.message : "The local guest service is unavailable.");
});
window.setInterval(() => {
  void refreshGuestStatus().catch((error: unknown) => {
    if (guestDialogElement.open) {
      setGuestError(error instanceof Error ? error.message : "The local guest service is unavailable.");
    }
  });
}, 5000);

window.setInterval(() => {
  if (!guestTargetCardId) return;
  const vncCanvas = guestDisplayElement.querySelector<HTMLCanvasElement>("canvas");
  if (!vncCanvas || vncCanvas.width < 16 || vncCanvas.height < 16) return;
  const card = cards.find((c) => c.id === guestTargetCardId);
  if (!card) return;
  if (!card.liveCanvas) {
    card.liveCanvas = document.createElement("canvas");
    card.liveCanvas.width = 556;
    card.liveCanvas.height = 390;
  }
  const ctx = card.liveCanvas.getContext("2d");
  if (ctx) {
    ctx.drawImage(vncCanvas, 0, 0, card.liveCanvas.width, card.liveCanvas.height);
    if (card.facet === "front") {
      refreshCardTexture(card);
    }
  }
}, 450);

const observer = new ResizeObserver(resize);
observer.observe(container);
window.addEventListener("resize", resize);

renderer.domElement.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());
renderer.domElement.addEventListener("pointermove", onPointerMove);
renderer.domElement.addEventListener("pointerup", onPointerUp);
renderer.domElement.addEventListener("pointercancel", onPointerUp);
renderer.domElement.addEventListener("dblclick", onDoubleClick);
renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
renderer.domElement.addEventListener("keydown", onCanvasKeyDown);
renderer.domElement.addEventListener("pointerleave", () => {
  if (!drag) renderer.domElement.style.cursor = "grab";
});
renderer.domElement.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
});
renderer.domElement.addEventListener("drop", (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  updatePointer(event);
  const hit = raycaster.intersectObjects(
    cards.flatMap((card) => card.group.children.slice(1)),
    false,
  )[0];
  const hitCard = hit
    ? cards.find((item) => item.id === hit.object.userData.cardId)
    : undefined;
  const targetCard = hitCard ?? selectedCard;
  const fromCard = selectedCard && selectedCard !== targetCard ? selectedCard : (cards[0] ?? targetCard);
  if (fromCard && targetCard) {
    void uploadFilePaperPlane(fromCard, targetCard, file);
  }
});

facetBarElement.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("[data-facet]");
  if (!target || !selectedCard) return;
  const facet = target.dataset.facet as CardFacet | undefined;
  if (facet && FACET_ORDER.includes(facet)) {
    flipCardTo(selectedCard, facet);
  }
});

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  const clickedButtonInMenu = target.closest(
    ".pulldown:not(.compass-pulldown) .pulldown-panel button",
  );
  if (clickedButtonInMenu) {
    const parentDetails = clickedButtonInMenu.closest<HTMLDetailsElement>("details.pulldown");
    if (parentDetails) parentDetails.open = false;
    return;
  }
  const openMenus = document.querySelectorAll<HTMLDetailsElement>(
    "details.pulldown:not(.compass-pulldown)[open]",
  );
  for (const menu of openMenus) {
    if (!menu.contains(target)) {
      menu.open = false;
    }
  }
});

flipCompassElement.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
    "[data-compass-facet]",
  );
  if (!target || !selectedCard) return;
  const facet = target.dataset.compassFacet as CardFacet | undefined;
  if (facet && FACET_ORDER.includes(facet)) {
    flipCardTo(selectedCard, facet);
  }
});

compassCycleButtonElement.addEventListener("click", () => {
  if (!selectedCard) return;
  flipCardTo(selectedCard, selectedCard.facet === "front" ? "back" : "front");
});

compassZoomButtonElement.addEventListener("click", () => {
  toggleCardZoom();
});

zoomButtonElement.addEventListener("click", () => {
  toggleCardZoom();
});

flipButton.addEventListener("click", () => {
  if (selectedCard) cycleCardFacet(selectedCard, 1);
});

cloneButtonElement.addEventListener("click", () => {
  if (selectedCard) void cloneSelectedCard(selectedCard);
});

resetButtonElement.addEventListener("click", () => {
  if (selectedCard) void resetSelectedCardOverlay(selectedCard);
});

guestButtonElement.addEventListener("click", () => {
  if (selectedCard) openOrStartSelectedGuest(selectedCard);
});

guestInstallButtonElement.addEventListener("click", () => {
  if (guestTargetCardId) void startGuest("installer", guestTargetCardId);
});

guestFinalizeBaseButtonElement.addEventListener("click", () => {
  if (window.confirm("Mark the installed Debian image as the shared read-only base for Linux cards?")) {
    void finalizeLinuxBase();
  }
});

guestBootDiskButtonElement.addEventListener("click", () => {
  if (guestTargetCardId) void startGuest("disk", guestTargetCardId);
});

guestCloneCardButtonElement.addEventListener("click", () => {
  const card = cards.find((item) => item.id === guestTargetCardId) ?? selectedCard;
  if (card) void cloneSelectedCard(card);
});

guestResetOverlayButtonElement.addEventListener("click", () => {
  const card = cards.find((item) => item.id === guestTargetCardId) ?? selectedCard;
  if (card) void resetSelectedCardOverlay(card);
});

guestInjectPlaneButtonElement.addEventListener("click", () => {
  void injectLatestPaperPlaneIntoVm();
});

guestSavepointButtonElement.addEventListener("click", () => {
  const card = cards.find((item) => item.id === guestTargetCardId) ?? selectedCard;
  if (card) void runTimeTravelSnapshot("save", card);
});

guestRewindButtonElement.addEventListener("click", () => {
  const card = cards.find((item) => item.id === guestTargetCardId) ?? selectedCard;
  if (card) void runTimeTravelSnapshot("rewind", card);
});

// Automatic Windows disk checkpoints (taken every 10 min by the backend watchdog).
guestRestoreCheckpointButton?.addEventListener("click", () => {
  if (guestTargetOs !== "windows" || !guestTargetCardId) {
    showToast("Automatic checkpoints are kept for Windows cards.");
    return;
  }
  if (!window.confirm("Roll this Windows disk back to its newest automatic checkpoint? Changes made after it will be lost.")) {
    return;
  }
  void (async () => {
    try {
      const status = await requestGuestApi("/api/guest/restore-checkpoint", { cardId: guestTargetCardId ?? "" });
      updateGuestCardStatus(status);
      const restored = (status as GuestServiceStatus & { restoredCheckpoint?: string }).restoredCheckpoint;
      showToast(`Disk restored to checkpoint ${restored ?? ""}. Boot Windows to continue.`);
    } catch (error) {
      reportGuestError(error);
    }
  })();
});

document.querySelector<HTMLButtonElement>("#guest-native-viewer")?.addEventListener("click", () => {
  if (!guestTargetCardId) return;
  void (async () => {
    try {
      const status = (await requestGuestApi("/api/guest/open-native-viewer", {
        cardId: guestTargetCardId ?? "linux",
        os: guestTargetOs,
      })) as GuestServiceStatus & {
        nativeViewerResult?: { vncEndpoint: string; launched: boolean };
      };
      updateGuestCardStatus(status);
      const res = status.nativeViewerResult;
      if (res?.launched) {
        showToast(`🖥️ Opened ${res.vncEndpoint} in native TurboVNC viewer.`);
      } else if (res?.vncEndpoint) {
        showToast(`🖥️ VNC ready at ${res.vncEndpoint} (install TurboVNC or set POSTCARD_VNC_VIEWER).`);
      }
    } catch (error) {
      reportGuestError(error);
    }
  })();
});

secopsToggleElement.addEventListener("click", () => {
  toggleSecOpsLabMode();
});

tourButtonElement.addEventListener("click", () => {
  if (tourActive) {
    stopGuidedTour();
    if (isTourRecording) stopTourRecording();
  } else {
    startGuidedTour();
  }
});

recordTourButtonElement.addEventListener("click", () => {
  if (isTourRecording) {
    stopTourRecording();
    stopGuidedTour();
  } else {
    startTourRecording();
    startGuidedTour();
  }
});

omniFormElement.addEventListener("submit", (event) => {
  event.preventDefault();
  const prompt = omniInputElement.value.trim();
  if (!prompt) return;
  omniInputElement.value = "";
  void runAiOrSecOpsCommand(prompt, selectedCard ?? undefined);
});

omniChipsElement.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
    "[data-omni-action]",
  );
  if (!button) return;
  const action = button.dataset.omniAction;
  if (!action) return;
  if (action === "snapshot-save") {
    if (selectedCard) void runTimeTravelSnapshot("save", selectedCard);
    return;
  }
  if (action === "snapshot-rewind") {
    if (selectedCard) void runTimeTravelSnapshot("rewind", selectedCard);
    return;
  }
  if (action === "swarm-fork") {
    if (selectedCard) void runSwarmFork(selectedCard);
    return;
  }
  if (action === "cycle-network") {
    if (selectedCard) void cycleCardNetworkMode(selectedCard);
    return;
  }
  if (action === "cycle-memory") {
    if (selectedCard) void cycleCardMemoryProfile(selectedCard);
    return;
  }
  if (action === "file-drop") {
    quickFileInput?.click();
    return;
  }
  if (action === "serial-exec") {
    if (selectedCard) void runSerialExec(selectedCard);
    return;
  }
  void runAiOrSecOpsCommand(action, selectedCard ?? undefined);
});

quickFileInput?.addEventListener("change", () => {
  const file = quickFileInput.files?.[0];
  quickFileInput.value = "";
  if (!file || !selectedCard) return;
  const fromCard = cards.find((c) => c !== selectedCard) ?? selectedCard;
  void uploadFilePaperPlane(fromCard, selectedCard, file);
});

window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    omniInputElement.focus();
    omniInputElement.select();
    return;
  }
  const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
  if (
    activeTag === "INPUT" ||
    activeTag === "TEXTAREA" ||
    activeTag === "SELECT" ||
    activeTag === "BUTTON" ||
    guestDialogElement.open ||
    shareDialog.open ||
    performanceDialogElement.open ||
    helpDialog.open ||
    (pricingDialogElement && pricingDialogElement.open)
  ) {
    return;
  }
  if (event.key === "/") {
    event.preventDefault();
    omniInputElement.focus();
    return;
  }
  if (event.key === "?") {
    event.preventDefault();
    helpDialog.showModal();
    return;
  }
  if (document.activeElement !== renderer.domElement) {
    onCanvasKeyDown(event);
  }
});

guestShutdownButtonElement.addEventListener("click", () => {
  void shutdownGuest();
});

guestForceStopButtonElement.addEventListener("click", () => {
  if (window.confirm("Force stop QEMU now? Unsaved guest changes may be lost.")) {
    void forceStopGuest();
  }
});

guestCloseButton.addEventListener("click", () => {
  guestDialogElement.close();
});

guestDialogElement.addEventListener("close", disconnectGuestDisplay);

sendButton.addEventListener("click", () => {
  openShareDialog();
});

addButton.addEventListener("click", () => {
  const index = cards.length;
  const definitions = [
    {
      id: `windows-${index}`,
      name: "Windows · New Space",
      os: "WINDOWS",
      detail: "A new card for another Windows world.",
      color: "#8a909e",
      status: "DEMO · DISCONNECTED",
    },
    {
      id: `linux-${index}`,
      name: "Linux · New Space",
      os: "LINUX",
      detail: "A new card for another Linux world.",
      color: "#FFB81C",
      status: "DEMO · DISCONNECTED",
    },
    {
      id: `android-${index}`,
      name: "Android · New Space",
      os: "ANDROID",
      detail: "A new card for another Android world.",
      color: "#8a909e",
      status: "DEMO · DISCONNECTED",
    },
    {
      id: `agent-${index}`,
      name: "Agent · OpenSandbox",
      os: "LINUX",
      detail: "A new lightweight OpenSandbox agent card.",
      color: "#FFB81C",
      status: "DEMO · DISCONNECTED",
    },
  ];
  const definition = definitions[(index - initialCards.length) % definitions.length];
  const card = createCard(definition, index);
  cards.push(card);
  selectCard(card);
  updateCardCount();
  updateRecipientOptions();
  showToast(`${card.name} added to your space.`);
});

shareForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!selectedCard) return;

  const isRemoteOnly = recipientSelect.value === "remote-peer";
  const target = isRemoteOnly
    ? undefined
    : cards.find((card) => card.id === recipientSelect.value);
  const remoteTarget = remoteTargetInputElement.value.trim();
  const message = messageInput.value.trim();
  const attachedFile = fileDropInput?.files?.[0];
  if ((!target && !isRemoteOnly) || (!message && !attachedFile)) return;

  const from = selectedCard;
  shareDialog.close();
  messageInput.value = "";
  remoteTargetInputElement.value = "";
  if (fileDropInput) fileDropInput.value = "";
  if (attachedFile && target) {
    void uploadFilePaperPlane(from, target, attachedFile);
  }
  if (message) {
    sendPaperPlane(from, target, message, remoteTarget);
  }
});

document.querySelector("#cancel-share")?.addEventListener("click", () => {
  shareDialog.close();
});

document.querySelector("#pairdrop-key-button")?.addEventListener("click", () => {
  if (!selectedCard) return;
  void (async () => {
    try {
      const status = await requestGuestApi("/api/guest/pairdrop", {
        action: "pair-initiate",
        cardId: selectedCard?.id ?? "linux",
      });
      updateGuestCardStatus(status);
      if (status.pairdropResult?.remoteTarget) {
        remoteTargetInputElement.value = status.pairdropResult.remoteTarget;
        showToast(`🔗 PairDrop 6-Digit Key generated: ${status.pairdropResult.pairKey}`);
      }
    } catch (error) {
      reportGuestError(error);
    }
  })();
});

document.querySelector("#pairdrop-room-button")?.addEventListener("click", () => {
  if (!selectedCard) return;
  void (async () => {
    try {
      const status = await requestGuestApi("/api/guest/pairdrop", {
        action: "public-room",
        cardId: selectedCard?.id ?? "linux",
      });
      updateGuestCardStatus(status);
      if (status.pairdropResult?.remoteTarget) {
        remoteTargetInputElement.value = status.pairdropResult.remoteTarget;
        showToast(`🌐 PairDrop 5-Letter Room active: ${status.pairdropResult.roomId}`);
      }
    } catch (error) {
      reportGuestError(error);
    }
  })();
});

for (const modal of [shareDialog, helpDialog, pricingDialogElement].filter(Boolean) as HTMLDialogElement[]) {
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      modal.close();
    }
  });
}

function openPricingModal(): void {
  if (pricingDialogElement && !pricingDialogElement.open) {
    pricingDialogElement.showModal();
  }
}

function updatePriceDisplays(): void {
  const isAnnual = intervalAnnualElement?.checked;
  if (proPriceDisplayElement) {
    proPriceDisplayElement.innerHTML = isAnnual
      ? "$190<span class=\"price-period\"> / yr ($15.83/mo)</span>"
      : "$19<span class=\"price-period\"> / mo</span>";
  }
  if (enterprisePriceDisplayElement) {
    enterprisePriceDisplayElement.innerHTML = isAnnual
      ? "$1,990<span class=\"price-period\"> / seat / yr</span>"
      : "$199<span class=\"price-period\"> / seat / mo</span>";
  }
}

intervalMonthlyElement?.addEventListener("change", updatePriceDisplays);
intervalAnnualElement?.addEventListener("change", updatePriceDisplays);

pricingButtonElement?.addEventListener("click", openPricingModal);
selectedTierElement?.addEventListener("click", openPricingModal);
if (selectedTierElement) {
  selectedTierElement.title = "Click to view edition features and upgrade options";
}

cancelPricingElement?.addEventListener("click", () => {
  pricingDialogElement?.close();
});

pricingDialogElement?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    pricingDialogElement.close();
  }
});

document.querySelectorAll<HTMLButtonElement>(".button-upgrade-pro, .button-upgrade-enterprise").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const tier = btn.getAttribute("data-tier") || "pro";
    const interval = intervalAnnualElement?.checked ? "year" : "month";
    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = "Connecting to Stripe...";
    try {
      const res = await fetch("/api/stripe/checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, interval }),
      });
      const data = await res.json();
      if (data.ok && (data.checkoutUrl || data.url)) {
        const checkoutUrl = data.checkoutUrl || data.url;
        if (data.mode === "live") {
          window.location.href = checkoutUrl;
        } else {
          pricingDialogElement?.close();
          showToast(`✦ Upgraded to ${tier.toUpperCase()} Edition (Demo Simulation)!`);
          selectedTierElement.textContent = tier.toUpperCase();
          selectedTierElement.className = `tier-badge tier-badge-${tier.toLowerCase()}`;
        }
      } else {
        showToast(`❌ Checkout error: ${data.error || "Unable to start checkout"}`);
      }
    } catch (err: any) {
      showToast(`❌ Connection failed: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  });
});

const searchParams = new URLSearchParams(window.location.search);
if (searchParams.get("upgrade_success") === "true") {
  const upgradedTier = searchParams.get("tier") || "pro";
  showToast(`🎉 Welcome to Post Card Spatial OS ${upgradedTier.toUpperCase()} Edition!`);
  window.history.replaceState({}, document.title, window.location.pathname);
}

document.querySelector("#help-button")?.addEventListener("click", () => {
  helpDialog.showModal();
});

performanceButtonElement.addEventListener("click", openPerformanceDialog);
performanceDialogElement.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    performanceDialogElement.close();
  }
});
performanceDialogElement.addEventListener("click", (event) => {
  if (event.target === performanceDialogElement) {
    performanceDialogElement.close();
  }
});
document.querySelector("#cancel-performance")?.addEventListener("click", () => {
  performanceDialogElement.close();
});
performanceFormElement.addEventListener("submit", (event) => {
  event.preventDefault();
  if (selectedCard) void saveCpuProfile(selectedCard);
});
graphicsProfileSelectElement.addEventListener("change", () => {
  const profile = graphicsProfileSelectElement.value;
  if (profile === "performance" || profile === "balanced" || profile === "quality") {
    applyStudioGraphicsProfile(profile);
  }
});

const manualCustomNotes = document.querySelector<HTMLTextAreaElement>("#manual-custom-notes");
const MANUAL_NOTES_STORAGE_KEY = "postcard.os.manual.notes.v1";
if (manualCustomNotes) {
  try {
    const savedNotes = window.localStorage.getItem(MANUAL_NOTES_STORAGE_KEY);
    if (savedNotes !== null) {
      manualCustomNotes.value = savedNotes;
    } else {
      manualCustomNotes.value =
        "• Welcome to Post Card Spatial OS.\n• Add your custom onboarding instructions, SOPs, or deck notes here — changes auto-save locally.";
    }
    manualCustomNotes.addEventListener("input", () => {
      try {
        window.localStorage.setItem(MANUAL_NOTES_STORAGE_KEY, manualCustomNotes.value);
      } catch {
        // Ignore storage quota errors
      }
    });
  } catch {
    // Ignore storage errors
  }
}

function openShareDialog(): void {
  if (!selectedCard) {
    showToast("Select a Post Card to send a paper airplane.");
    return;
  }
  updateRecipientOptions();
  shareDialogElement.showModal();
  messageInputElement.focus();
}

function openPerformanceDialog(): void {
  if (!selectedCard) {
    showToast("Select a Post Card before changing its performance profile.");
    return;
  }
  const cpuCapacity = guestServiceStatus?.cpuCapacity ?? navigator.hardwareConcurrency ?? 1;
  const balancedCores = Math.min(CPU_PROFILE_VCPUS.balanced, cpuCapacity);
  const gamingCores = Math.min(CPU_PROFILE_VCPUS.gaming, cpuCapacity);
  const balancedOption =
    cpuProfileSelectElement.querySelector<HTMLOptionElement>('[value="balanced"]');
  const gamingOption =
    cpuProfileSelectElement.querySelector<HTMLOptionElement>('[value="gaming"]');
  if (!balancedOption || !gamingOption) {
    throw new Error("Performance profile options are missing.");
  }
  balancedOption.textContent = `Balanced · ${balancedCores} vCPU`;
  gamingOption.textContent = `Gaming · ${gamingCores} vCPU${gamingCores < 4 ? " (host-limited)" : ""}`;
  cpuProfileSelectElement.value =
    guestServiceStatus?.cpuProfiles?.[selectedCard.id] ?? "balanced";
  graphicsProfileSelectElement.value = studioGraphicsProfile;
  performanceGpuInfoElement.textContent =
    selectedCard.os === "WINDOWS"
      ? "Virtual graphics: QEMU Standard VGA over VNC. Linux/other cards use virtual virtio-vga. Neither path exposes the host GPU."
      : "Virtual graphics: QEMU virtio-vga over VNC. This is a virtual display adapter, not direct access to your host GPU.";
  const guest = guestServiceStatus?.guests.find(
    (item) => item.cardId === selectedCard?.id && item.os === cardToGuestOs(selectedCard),
  );
  performanceNoticeElement.textContent =
    guest?.status === "running" || guest?.status === "starting"
      ? "A guest is active. The saved vCPU profile applies after you stop and restart it."
      : `Host reports ${cpuCapacity} logical CPU${cpuCapacity === 1 ? "" : "s"}; vCPU settings apply on the next launch.`;
  performanceDialogElement.showModal();
}

async function saveCpuProfile(card: SystemCard): Promise<void> {
  const cpuProfile = cpuProfileSelectElement.value as CpuProfile;
  if (!(cpuProfile in CPU_PROFILE_VCPUS)) {
    showToast("Choose a valid virtual CPU profile.");
    return;
  }
  const submitButton = performanceFormElement.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  );
  if (submitButton) submitButton.disabled = true;
  try {
    const status = await requestGuestApi("/api/guest/cpu-profile", {
      cardId: card.id,
      cpuProfile,
    });
    updateGuestCardStatus(status);
    performanceDialogElement.close();
    const requestedCores = CPU_PROFILE_VCPUS[cpuProfile];
    const actualCores = Math.min(
      requestedCores,
      status.cpuCapacity ?? navigator.hardwareConcurrency ?? 1,
    );
    showToast(
      `${card.name} saved ${cpuProfile.toUpperCase()} CPU profile · ${actualCores} vCPU for next launch.`,
    );
  } catch (error) {
    reportGuestError(error);
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

function cardToGuestOs(card: SystemCard): GuestOS {
  if (card.os === "WINDOWS") return "windows";
  if (card.os === "ANDROID") return "android";
  if (card.os === "MACOS") return "macos";
  return "linux";
}

function openOrStartSelectedGuest(card: SystemCard): void {
  guestDialogElement.showModal();
  guestTargetCardId = card.id;
  guestTargetOs = cardToGuestOs(card);
  guestTitleElement.textContent = card.name;
  updateGuestDialogCopy();
  clearGuestError();
  void refreshGuestStatus()
    .then((status) => {
      const guest = status.guests.find((item) => item.os === guestTargetOs && item.cardId === card.id);
      if (guest?.status === "running" && guest.websocketPort !== null) {
        connectGuestDisplay(guest.websocketPort);
      } else if (guest?.status === "starting" || guest?.status === "stopping") {
        setGuestState(`This ${card.os.toLowerCase()} card is ${guest.status}.`);
      } else {
        const alreadyInstalled =
          guestTargetOs === "windows"
            ? (status.installedWindowsCardIds?.includes(card.id) ?? false)
            : status.baseReady;
        void startGuest(alreadyInstalled ? "disk" : "installer", card.id);
      }
    })
    .catch(reportGuestError);
}

async function cloneSelectedCard(sourceCard: SystemCard): Promise<void> {
  const newId = `${sourceCard.id}-clone-${cloneCounter}`;
  cloneCounter += 1;
  const baseTitle = sourceCard.name.split(" · ")[0] ?? sourceCard.os;
  const newName = `${baseTitle} · Clone ${cloneCounter - 1}`;

  const os: GuestOS = cardToGuestOs(sourceCard);
  try {
    const status = await requestGuestApi("/api/guest/clone-overlay", {
      os,
      sourceCardId: sourceCard.id,
      targetCardId: newId,
    });
    guestServiceStatus = status;
  } catch (error) {
    reportGuestError(error);
    return;
  }

  const clonedCard = createCard(
    {
      id: newId,
      name: newName,
      os: sourceCard.os,
      detail: `Forked from ${sourceCard.name} (${sourceCard.id}).`,
      color: sourceCard.color,
      status: sourceCard.status,
      clonedFrom: sourceCard.id,
    },
    cards.length,
  );
  cards.push(clonedCard);
  if (guestServiceStatus) {
    updateGuestCardStatus(guestServiceStatus);
  }
  selectCard(clonedCard);
  updateCardCount();
  updateRecipientOptions();
  showToast(`Cloned ${sourceCard.name} → ${clonedCard.name}.`);
}

async function resetSelectedCardOverlay(card: SystemCard): Promise<void> {
  const os: GuestOS = cardToGuestOs(card);
  if (
    !window.confirm(
      `Reset the disk overlay for ${card.name} (${card.id})? Any unsaved changes inside this card's disk will be wiped.`,
    )
  ) {
    return;
  }

  try {
    const status = await requestGuestApi("/api/guest/reset-overlay", {
      os,
      cardId: card.id,
    });
    card.resetCount += 1;
    updateGuestCardStatus(status);
    refreshCardTexture(card);
    if (guestDialogElement.open && guestTargetCardId === card.id) {
      setGuestState(`Disk overlay for ${card.name} was reset to a clean state.`);
    }
    showToast(`Reset ${card.name} disk overlay (#${card.resetCount}).`);
  } catch (error) {
    reportGuestError(error);
  }
}

function roundedRectangle(width: number, height: number, radius: number): THREE.Shape {
  const left = -width / 2;
  const right = width / 2;
  const bottom = -height / 2;
  const top = height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(left + radius, bottom);
  shape.lineTo(right - radius, bottom);
  shape.quadraticCurveTo(right, bottom, right, bottom + radius);
  shape.lineTo(right, top - radius);
  shape.quadraticCurveTo(right, top, right - radius, top);
  shape.lineTo(left + radius, top);
  shape.quadraticCurveTo(left, top, left, top - radius);
  shape.lineTo(left, bottom + radius);
  shape.quadraticCurveTo(left, bottom, left + radius, bottom);
  return shape;
}

function createCard(
  definition: {
    id: string;
    name: string;
    os: string;
    detail: string;
    color: string;
    status: string;
    clonedFrom?: string;
  },
  index: number,
): SystemCard {
  const group = new THREE.Group();
  const edge = new THREE.Mesh(
    edgeGeometry,
    new THREE.MeshStandardMaterial({
      color: "#14161B",
      metalness: 0.82,
      roughness: 0.26,
    }),
  );
  edge.castShadow = true;
  edge.receiveShadow = true;
  group.add(edge);

  const card: SystemCard = {
    ...definition,
    group,
    receivedNotes: [],
    sentNotes: [],
    facet: "front",
    backFaceVisible: false,
    targetRotation: 0,
    tiltX: 0,
    tiltZ: 0,
    resetCount: 0,
    layoutOffset: new THREE.Vector3(),
    layoutPosition: wheelPosition(index),
    orbitAngle: cardTargetOrbitAngle(index),
  };

  const frontTexture = makeCardTexture(card, "front");
  const backTexture = makeCardTexture(card, "back");
  const front = new THREE.Mesh(
    cardGeometry,
    new THREE.MeshStandardMaterial({
      map: frontTexture,
      roughness: 0.88,
      metalness: 0.02,
      emissive: "#ffffff",
      emissiveMap: frontTexture,
      emissiveIntensity: 0.82,
      side: THREE.FrontSide,
    }),
  );
  front.position.z = frontFaceZ;
  front.userData.cardId = definition.id;
  front.userData.face = "front";
  front.castShadow = true;

  const back = new THREE.Mesh(
    cardGeometry,
    new THREE.MeshStandardMaterial({
      map: backTexture,
      roughness: 0.88,
      metalness: 0.02,
      emissive: "#ffffff",
      emissiveMap: backTexture,
      emissiveIntensity: 0.82,
      side: THREE.FrontSide,
    }),
  );
  back.position.z = backFaceZ;
  back.rotation.y = Math.PI;
  back.userData.cardId = definition.id;
  back.userData.face = "back";
  group.add(front, back);

  group.userData.card = card;
  group.position.copy(wheelPosition(index));
  scene.add(group);
  return card;
}

function makeCardTexture(card: SystemCard, facet: CardFacet): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 1920;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create Post Card canvas texture.");
  context.scale(2, 2);

  const meta = FACET_META[facet];
  const gradient = context.createLinearGradient(0, 0, 640, 960);
  gradient.addColorStop(0, facet === "front" ? "#14161B" : "#14161B");
  gradient.addColorStop(0.58, "#0D111A");
  gradient.addColorStop(1, "#0D111A");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 640, 960);

  context.fillStyle = `${card.color}16`;
  context.beginPath();
  context.arc(560, 85, 165, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = meta.accent;
  roundRect(context, 48, 49, 7, 30, 3.5);
  context.fill();

  context.strokeStyle = `${meta.accent}55`;
  context.lineWidth = 2;
  roundRect(context, 25, 24, 590, 912, 18);
  context.stroke();

  context.fillStyle = meta.accent;
  context.font = "700 25px Inter, Arial, sans-serif";
  context.fillText(meta.header, 72, 74);
  context.fillStyle = "#FFB81C";
  context.font = "700 21px Inter, Arial, sans-serif";
  context.textAlign = "right";
  context.fillText(meta.badge, 590, 74);
  context.textAlign = "left";

  switch (facet) {
    case "front":
      drawCardFront(context, card);
      break;
    case "back":
      drawCardSettings(context, card);
      break;
    case "left":
      drawCardSecurity(context, card);
      break;
    case "right":
      drawCardPlanes(context, card);
      break;
    case "top":
      drawCardQuickActions(context, card);
      break;
    case "bottom":
      drawCardTelemetry(context, card);
      break;
  }

  drawFacetCompassDots(context, facet, card.color);
  drawEdgeFlipGuides(context, facet);

  drawCompanyLogo(context, 46, 898, 22, false);
  context.fillStyle = meta.accent;
  context.font = "700 18px Inter, Arial, sans-serif";
  context.fillText("POST CARD · OS", 76, 915);
  context.fillStyle = "#c3c8d1";
  context.font = "600 16.5px Inter, Arial, sans-serif";
  context.textAlign = "right";
  context.fillText("CLICK TO ZOOM · DRAG TO FLIP", 592, 914);
  context.textAlign = "left";

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function drawCompanyLogo(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size = 54,
  withGlow = true,
): void {
  context.save();
  const radius = size * 0.16;
  const inset = size * 0.18;
  const innerSize = size * 0.64;
  const innerRadius = size * 0.1;

  // Outer base plate
  const plateGrad = context.createLinearGradient(x, y, x, y + size);
  plateGrad.addColorStop(0, "#1E2736");
  plateGrad.addColorStop(0.5, "#14161B");
  plateGrad.addColorStop(1, "#0d111a");
  context.fillStyle = plateGrad;
  roundRect(context, x, y, size, size, radius);
  context.fill();

  context.strokeStyle = "rgba(255, 255, 255, 0.13)";
  context.lineWidth = Math.max(1, size * 0.025);
  roundRect(context, x, y, size, size, radius);
  context.stroke();

  // Inner elevated core tile
  const coreX = x + inset;
  const coreY = y + inset;
  const coreGrad = context.createLinearGradient(coreX, coreY, coreX, coreY + innerSize);
  coreGrad.addColorStop(0, "#14161B");
  coreGrad.addColorStop(1, "#07090E");
  context.fillStyle = coreGrad;
  roundRect(context, coreX, coreY, innerSize, innerSize, innerRadius);
  context.fill();

  context.strokeStyle = "rgba(255, 184, 28, 0.35)";
  context.lineWidth = Math.max(1, size * 0.02);
  roundRect(context, coreX, coreY, innerSize, innerSize, innerRadius);
  context.stroke();

  // Amber Laser Filament & Head
  const beamY = coreY + innerSize * 0.5;
  const beamStartX = coreX;
  const beamLength = innerSize * 0.72;
  const headSize = Math.max(4, innerSize * 0.18);

  if (withGlow) {
    context.shadowColor = "#FFB81C";
    context.shadowBlur = Math.max(5, size * 0.22);
  }

  // Horizontal Beam line
  context.beginPath();
  context.moveTo(beamStartX, beamY);
  context.lineTo(beamStartX + beamLength, beamY);
  context.strokeStyle = "#FFB81C";
  context.lineWidth = Math.max(2, size * 0.055);
  context.lineCap = "square";
  context.stroke();

  // Glowing Square Terminal Head
  context.fillStyle = "#FDE047";
  context.fillRect(
    beamStartX + beamLength - headSize * 0.15,
    beamY - headSize * 0.5,
    headSize,
    headSize,
  );

  context.restore();
}

function drawEdgeFlipGuides(context: CanvasRenderingContext2D, activeFacet: CardFacet): void {
  context.save();
  context.font = "700 14px Inter, Arial, sans-serif";
  context.textAlign = "center";

  // Top edge tab -> 05 ACTIONS
  context.fillStyle = activeFacet === "top" ? "#8a909e" : "#8a909e99";
  context.fillText("▲ FLIP UP · 05 ACTIONS (W)", 320, 18);

  // Bottom edge tab -> 06 TELEMETRY
  context.fillStyle = activeFacet === "bottom" ? "#FFB81C" : "#FFB81C99";
  context.fillText("▼ FLIP DOWN · 06 TELEMETRY (S)", 320, 952);

  // Left edge vertical tab -> 03 SECURITY
  context.save();
  context.translate(15, 480);
  context.rotate(-Math.PI / 2);
  context.fillStyle = activeFacet === "left" ? "#8a909e" : "#8a909e99";
  context.fillText("◀ FLIP LEFT · 03 SECURITY (A)", 0, 0);
  context.restore();

  // Right edge vertical tab -> 04 PLANES
  context.save();
  context.translate(625, 480);
  context.rotate(Math.PI / 2);
  context.fillStyle = activeFacet === "right" ? "#FFB81C" : "#FFB81C99";
  context.fillText("▶ FLIP RIGHT · 04 PLANES (D)", 0, 0);
  context.restore();

  context.restore();
}

function drawFacetCompassDots(
  context: CanvasRenderingContext2D,
  activeFacet: CardFacet,
  cardColor: string,
): void {
  const startX = 266;
  const y = 909;
  for (const [idx, facet] of FACET_ORDER.entries()) {
    const x = startX + idx * 18;
    context.beginPath();
    context.arc(x, y, facet === activeFacet ? 5 : 3, 0, Math.PI * 2);
    context.fillStyle = facet === activeFacet ? cardColor : "#262a33";
    context.fill();
  }
}

function drawCardFront(context: CanvasRenderingContext2D, card: SystemCard): void {
  drawCompanyLogo(context, 534, 112, 54, true);
  context.fillStyle = card.color;
  context.font = "700 21px Inter, Arial, sans-serif";
  context.fillText(card.os, 48, 133);

  // Monetization Tier Badge
  const tier = getCardTier(card);
  const tierColor = tier === "ENTERPRISE" ? "#00E5FF" : tier === "PRO" ? "#FFB81C" : "#8a909e";
  context.save();
  context.font = "700 13px Inter, Arial, sans-serif";
  const tierText = `TIER · ${tier}`;
  const tierWidth = context.measureText(tierText).width + 16;
  const tierX = 520 - tierWidth;
  const tierY = 118;
  context.fillStyle = "rgba(20, 22, 27, 0.75)";
  context.strokeStyle = tierColor;
  context.lineWidth = 1.5;
  roundRect(context, tierX, tierY, tierWidth, 24, 6);
  context.fill();
  context.stroke();
  context.fillStyle = tierColor;
  context.fillText(tierText, tierX + 8, tierY + 16);
  context.restore();

  context.fillStyle = "#f4f5f7";
  context.font = "700 52px Inter, Arial, sans-serif";
  drawWrappedText(context, card.name.split(" · ")[1] ?? card.name, 48, 192, 530, 58, 2);

  context.fillStyle = "#c3c8d1";
  context.font = "500 25px Inter, Arial, sans-serif";
  drawWrappedText(context, card.detail, 48, 280, 530, 34, 2);

  drawMockDisplay(context, card);

  context.fillStyle = card.color;
  context.beginPath();
  context.arc(58, 818, 6, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#f4f5f7";
  context.font = "700 20px Inter, Arial, sans-serif";
  context.fillText(card.status, 76, 825);
  context.fillStyle = "#c3c8d1";
  context.font = "500 19px Inter, Arial, sans-serif";
  const previewNote =
    card.os === "ANDROID"
      ? "Illustrative preview — flip 6 ways for specs & sandbox."
      : card.status === "GUEST · CONNECTED" || card.status === "GUEST · INSTALLER"
        ? `Live ${card.os.toLowerCase()} guest active — click Start/Open to control.`
        : card.status === "GUEST · BASE READY"
          ? "Debian golden base ready — boot or clone this card."
          : card.status === "GUEST · OFFLINE"
            ? "Persistent disk ready — boot, clone, or reset overlay."
            : `Ready to launch ${card.os.toLowerCase()} in local QEMU.`;
  context.fillText(previewNote, 48, 864);
}

function drawMockDisplay(context: CanvasRenderingContext2D, card: SystemCard): void {
  const accent = card.color;
  const status = card.status;
  const x = 42;
  const y = 380;
  const width = 556;
  const height = 390;

  context.save();
  roundRect(context, x, y, width, height, 22);
  context.clip();

  if (card.liveCanvas) {
    context.drawImage(card.liveCanvas, x, y, width, height);
  } else {
    const wallpaper = context.createLinearGradient(x, y, x + width, y + height);
    if (card.os === "MACOS") {
      wallpaper.addColorStop(0, "#14161b");
      wallpaper.addColorStop(0.5, "#14161b");
      wallpaper.addColorStop(1, "#1e2736");
    } else {
      wallpaper.addColorStop(0, "#14161b");
      wallpaper.addColorStop(0.5, "#0d111a");
      wallpaper.addColorStop(1, "#14161b");
    }
    context.fillStyle = wallpaper;
    context.fillRect(x, y, width, height);

    context.fillStyle = `${accent}45`;
    context.beginPath();
    context.ellipse(428, 526, 178, 126, -0.42, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#FFB81C35";
    context.beginPath();
    context.ellipse(180, 615, 218, 94, -0.28, 0, Math.PI * 2);
    context.fill();

    if (card.os === "MACOS") {
      // Translucent macOS top menu bar
      context.fillStyle = "rgba(13, 17, 26, 0.78)";
      context.fillRect(x, y, width, 26);
      context.fillStyle = "#f4f5f7";
      context.font = "700 12px Inter, Arial, sans-serif";
      context.fillText("  Finder   File   Edit   View   Window   Help", x + 16, y + 17);

      // Floating macOS studio window with red/yellow/green traffic lights
      context.fillStyle = "rgba(13, 17, 26, 0.86)";
      roundRect(context, x + 58, y + 58, width - 116, 216, 14);
      context.fill();
      context.strokeStyle = "rgba(255, 184, 28, 0.42)";
      context.lineWidth = 1.5;
      roundRect(context, x + 58, y + 58, width - 116, 216, 14);
      context.stroke();

      const trafficColors = ["#ff5f56", "#ffbd2e", "#27c93f"];
      for (const [idx, dotColor] of trafficColors.entries()) {
        context.fillStyle = dotColor;
        context.beginPath();
        context.arc(x + 78 + idx * 18, y + 76, 5.5, 0, Math.PI * 2);
        context.fill();
      }
      context.fillStyle = "#f4f5f7";
      context.font = "600 13px monospace";
      context.fillText("darwin-studio — zsh — OpenCore UEFI", x + 148, y + 80);
      context.fillStyle = "#8a909e";
      context.font = "500 14px monospace";
      context.fillText("% uname -sr && sysctl machdep.cpu.brand_string", x + 78, y + 118);
      context.fillStyle = "#FFB81C";
      context.fillText("Darwin 24.1.0 · QEMU Virtual AppleSMC (Eco 2 GiB)", x + 78, y + 146);
    }
  }

  if (card.serialOutput && card.serialOutput.trim().length > 0) {
    context.fillStyle = "#07090ee0";
    context.fillRect(x, y + height - 114, width, 58);
    context.fillStyle = "#8a909e";
    context.font = "700 13px Inter, Arial, sans-serif";
    context.fillText("SERIAL PIPE (ttyS0 / COM1) · LIVE VM OUTPUT", x + 16, y + height - 94);
    context.fillStyle = "#f4f5f7";
    context.font = "500 14px monospace";
    const lastLines = card.serialOutput
      .trim()
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .slice(-2)
      .join("  |  ");
    drawWrappedText(context, lastLines, x + 16, y + height - 72, width - 32, 18, 1);
  }

  context.fillStyle = "#07090ee8";
  context.fillRect(x, y + height - 56, width, 56);
  for (const [index, color] of ["#8a909e", "#FFB81C", "#8a909e", "#FFB81C"].entries()) {
    context.fillStyle = color;
    roundRect(context, x + 168 + index * 50, y + height - 41, 25, 25, 7);
    context.fill();
  }

  context.fillStyle = "#f4f5f7";
  context.textAlign = "center";
  context.font = "700 17px Inter, Arial, sans-serif";
  context.fillText(
    card.liveCanvas
      ? "LIVE VNC FRAMEBUFFER MIRRORED ON 3D CARD"
      : status === "GUEST · CONNECTED"
        ? "LIVE QEMU GUEST ACTIVE"
        : "SPATIAL GUEST SURFACE",
    x + width / 2,
    y + 34,
  );
  context.textAlign = "left";
  context.restore();

  context.strokeStyle = "#8a909e69";
  context.lineWidth = 2;
  roundRect(context, x, y, width, height, 22);
  context.stroke();
}

function drawCardSettings(context: CanvasRenderingContext2D, card: SystemCard): void {
  drawCompanyLogo(context, 534, 112, 54, true);
  context.fillStyle = "#FFB81C";
  context.font = "700 20px Inter, Arial, sans-serif";
  context.fillText(`${card.os} · HARDWARE PERSONALITY`, 48, 137);
  context.fillStyle = "#f4f5f7";
  context.font = "700 44px Inter, Arial, sans-serif";
  context.fillText("Behind the card.", 48, 194);
  context.fillStyle = "#c3c8d1";
  context.font = "500 23px Inter, Arial, sans-serif";
  context.fillText("vCPU allocation, RAM profile & storage mount.", 48, 234);

  const isLinux = card.os === "LINUX";
  const isWindows = card.os === "WINDOWS";
  const isMacOs = card.os === "MACOS";
  const memProfile = guestServiceStatus?.memoryProfiles?.[card.id] ?? "eco";
  const cpuProfile = guestServiceStatus?.cpuProfiles?.[card.id] ?? "balanced";
  const vcpus = Math.min(
    CPU_PROFILE_VCPUS[cpuProfile],
    guestServiceStatus?.cpuCapacity ?? navigator.hardwareConcurrency ?? 1,
  );
  const ramMb =
    isWindows || isMacOs
      ? memProfile === "performance"
        ? 4096
        : memProfile === "balanced"
          ? 3072
          : 2048
      : memProfile === "performance"
        ? 2048
        : memProfile === "balanced"
          ? 1536
          : 1024;
  const rows: [string, string][] = [
    [
      "MACHINE & VIRTUAL CPU",
      isLinux
        ? `QEMU q35 · ${cpuProfile.toUpperCase()} (${vcpus} vCPU) · WHPX / TCG`
        : isWindows
          ? `WSL2 QEMU q35 · ${cpuProfile.toUpperCase()} (${vcpus} vCPU) · UEFI`
          : isMacOs
            ? `QEMU q35 · ${cpuProfile.toUpperCase()} (${vcpus} vCPU) · OpenCore UEFI`
            : `QEMU q35 · ${cpuProfile.toUpperCase()} (${vcpus} vCPU) · Android-x86`,
    ],
    [
      "STREAMLINED RAM PROFILE",
      `${memProfile.toUpperCase()} · ${ramMb} MiB + VirtIO Balloon`,
    ],
    [
      "STORAGE BACKING",
      isLinux
        ? `QCOW2 CoW overlay (${card.id}.qcow2)`
        : isWindows
          ? `Persistent 64 GiB QCOW2 (${card.id}.qcow2)`
          : `QCOW2 CoW overlay (${card.id}.qcow2)`,
    ],
    [
      "DISPLAY & STUDIO GPU",
      isWindows
        ? `VNC + Standard VGA · Studio 3D: ${studioGraphicsProfile.toUpperCase()}`
        : `VNC + virtio-vga · Studio 3D: ${studioGraphicsProfile.toUpperCase()}`,
    ],
    [
      "CARD LINEAGE",
      card.clonedFrom
        ? `Cloned from '${card.clonedFrom}' · Resets: ${card.resetCount}`
        : `Primary card (${card.id}) · Resets: ${card.resetCount}`,
    ],
    [
      "MONETIZATION TIER",
      `${getCardTier(card)} · ${getCardTier(card) === "ENTERPRISE" ? "Bare-Metal Microkernel & Vault VFIO Passthrough" : getCardTier(card) === "PRO" ? "4+ vCPU Gamer Suite & Time-Travel Savepoints" : "Open-Core Base Hypervisor"}`,
    ],
  ];

  drawKeyValueRows(context, rows, 298, 102);
  drawStatusFooter(context, card);
}

function drawCardSecurity(context: CanvasRenderingContext2D, card: SystemCard): void {
  drawCompanyLogo(context, 534, 112, 54, true);
  context.fillStyle = "#FFB81C";
  context.font = "700 20px Inter, Arial, sans-serif";
  context.fillText(`${card.os} · SANDBOX & ISOLATION`, 48, 137);
  context.fillStyle = "#f4f5f7";
  context.font = "700 44px Inter, Arial, sans-serif";
  context.fillText("Zero-trust boundary.", 48, 194);
  context.fillStyle = "#c3c8d1";
  context.font = "500 23px Inter, Arial, sans-serif";
  context.fillText("Per-card disk isolation & loopback guardrails.", 48, 234);

  const isLinux = card.os === "LINUX";
  const isWindows = card.os === "WINDOWS";
  const baseLocked = guestServiceStatus?.baseReady ?? false;
  const hasOverlay = isWindows
    ? (guestServiceStatus?.installedWindowsCardIds?.includes(card.id) ?? false)
    : (guestServiceStatus?.preparedCardIds.includes(card.id) ?? false);
  const checkpoint = guestServiceStatus?.checkpoints?.[card.id];
  const netMode = guestServiceStatus?.networkModes?.[card.id] ?? "nat";
  const netLabel =
    netMode === "airgap"
      ? "AIRGAP VAULT · Hardware NIC unplugged (-nic none)"
      : netMode === "cyber-range"
        ? "CYBER-RANGE · Private Card-to-Card VLAN (230.0.0.1:4550)"
        : "STANDARD NAT · Outbound internet, isolated from peers";

  const rows: [string, string][] = [
    [
      "ISOLATION BOUNDARY",
      isLinux
        ? "Dedicated QEMU process + private QCOW2 diff"
        : isWindows
          ? "Dedicated WSL2 QEMU + private UEFI & TPM 2.0"
          : "Sandboxed preview container",
    ],
    [
      "GOLDEN BASE LOCK",
      isLinux
        ? baseLocked
          ? "LOCKED · debian-golden.qcow2 is read-only"
          : "UNLOCKED · Awaiting base finalization"
        : isWindows
          ? "Dedicated 64 GiB volume + Microsoft Secure Boot"
          : "Immutable template",
    ],
    [
      "TIME-TRAVEL SAVEPOINT",
      checkpoint
        ? `Tag '${checkpoint.tag}' (${checkpoint.mode ?? "disk"}) · Saved ${checkpoint.savedAt.slice(11, 19)} UTC`
        : hasOverlay
          ? `Provisioned · ${card.resetCount} wipe(s) · Click ⏱️ Savepoint to snapshot`
          : "No savepoint yet · Click ⏱️ Savepoint in AI · OPS bar",
    ],
    [
      "PAPER PLANE DRIVE & AUDIT",
      "Hardware VVFAT mount (fat:rw) + SHA-256 hash chain",
    ],
    [
      "NETWORK TOPOLOGY",
      netLabel,
    ],
    [
      "SECURITY ENTITLEMENT",
      `${getCardTier(card)} · ${getCardTier(card) === "ENTERPRISE" ? "Air-Gapped Cyber Range VLAN & Hardware VFIO IOMMU" : getCardTier(card) === "PRO" ? "Hypervisor Memory Protection & Ephemeral Overlay Rollbacks" : "Standard Ring 3 Paging & Non-Root UID Sandboxing"}`,
    ],
  ];

  drawKeyValueRows(context, rows, 298, 102);
  drawStatusFooter(context, card);
}

function drawCardPlanes(context: CanvasRenderingContext2D, card: SystemCard): void {
  drawCompanyLogo(context, 534, 112, 54, true);
  context.fillStyle = "#FFB81C";
  context.font = "700 20px Inter, Arial, sans-serif";
  context.fillText(`${card.os} · PAPER AIRPLANE RELAY`, 48, 137);
  context.fillStyle = "#f4f5f7";
  context.font = "700 44px Inter, Arial, sans-serif";
  context.fillText("Cross-card notes.", 48, 194);
  context.fillStyle = "#c3c8d1";
  context.font = "500 23px Inter, Arial, sans-serif";
  context.fillText(
    `${card.receivedNotes.length} received · ${card.sentNotes.length} sent from this card`,
    48,
    234,
  );

  context.fillStyle = "#8a909e";
  context.font = "700 19px Inter, Arial, sans-serif";
  context.fillText("INBOX · RECEIVED PLANES", 48, 290);

  const recentReceived = card.receivedNotes.slice(-3).reverse();
  if (recentReceived.length === 0) {
    drawMessageBox(
      context,
      48,
      310,
      544,
      110,
      "#8a909e48",
      "No paper planes received yet. Use 'Send a paper plane' in the dock to flick a note here.",
    );
  } else {
    recentReceived.forEach((note, idx) => {
      drawMessageBox(context, 48, 310 + idx * 96, 544, 84, "#8a909e66", note);
    });
  }

  const outboxY = 620;
  context.fillStyle = "#FFB81C";
  context.font = "700 18px Inter, Arial, sans-serif";
  context.fillText("OUTBOX · RECENTLY SENT", 48, outboxY);

  const recentSent = card.sentNotes.slice(-2).reverse();
  if (recentSent.length === 0) {
    drawMessageBox(
      context,
      48,
      outboxY + 20,
      544,
      90,
      "#FFB81C48",
      "No outgoing planes sent from this card yet.",
    );
  } else {
    recentSent.forEach((note, idx) => {
      drawMessageBox(context, 48, outboxY + 20 + idx * 86, 544, 76, "#FFB81C66", note);
    });
  }

  drawStatusFooter(context, card);
}

function drawMessageBox(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  borderColor: string,
  text: string,
): void {
  context.fillStyle = "#07090ee8";
  roundRect(context, x, y, w, h, 12);
  context.fill();
  context.strokeStyle = borderColor;
  context.lineWidth = 1.5;
  roundRect(context, x, y, w, h, 12);
  context.stroke();
  context.fillStyle = "#f4f5f7";
  context.font = "500 21px Inter, Arial, sans-serif";
  drawWrappedText(context, text, x + 18, y + 34, w - 36, 26, 2);
}

function drawCardQuickActions(context: CanvasRenderingContext2D, card: SystemCard): void {
  drawCompanyLogo(context, 534, 112, 54, true);
  context.fillStyle = "#8a909e";
  context.font = "700 20px Inter, Arial, sans-serif";
  context.fillText(`${card.os} · SANDBOX DECK`, 48, 137);
  context.fillStyle = "#f4f5f7";
  context.font = "700 44px Inter, Arial, sans-serif";
  context.fillText("Quick actions.", 48, 194);
  context.fillStyle = "#c3c8d1";
  context.font = "500 23px Inter, Arial, sans-serif";
  context.fillText("Click a tile on this card or use the dock below.", 48, 234);

  const actions = [
    {
      title: "▣  BOOT / OPEN GUEST DISPLAY",
      subtitle:
        card.os === "ANDROID"
          ? "Launch Android QEMU guest or connect live VNC display"
          : "Launch QEMU guest or reconnect live noVNC display",
      accent: "#8a909e",
    },
    {
      title: "⧉  CLONE CARD & QCOW2 OVERLAY",
      subtitle: "Fork this card and its disk overlay into a new Rolodex card",
      accent: "#FFB81C",
    },
    {
      title: "↺  RESET DISK OVERLAY TO CLEAN BASE",
      subtitle: "Wipe this card's QCOW2 overlay back to pristine golden state",
      accent: "#8a909e",
    },
    {
      title: "➤  FOLD & SEND A PAPER AIRPLANE",
      subtitle: "Send a note or file across 3D space to another Post Card",
      accent: "#FFB81C",
    },
  ];

  actions.forEach((act, idx) => {
    const y = 278 + idx * 128;
    context.fillStyle = "#07090ee8";
    roundRect(context, 48, y, 544, 108, 14);
    context.fill();
    context.strokeStyle = `${act.accent}78`;
    context.lineWidth = 2;
    roundRect(context, 48, y, 544, 108, 14);
    context.stroke();

    context.fillStyle = act.accent;
    context.font = "700 22.5px Inter, Arial, sans-serif";
    context.fillText(act.title, 72, y + 44);
    context.fillStyle = "#f4f5f7";
    context.font = "500 19.5px Inter, Arial, sans-serif";
    context.fillText(act.subtitle, 72, y + 79);
  });

  drawStatusFooter(context, card);
}

function drawCardTelemetry(context: CanvasRenderingContext2D, card: SystemCard): void {
  drawCompanyLogo(context, 534, 112, 54, true);
  context.fillStyle = "#FFB81C";
  context.font = "700 20px Inter, Arial, sans-serif";
  context.fillText(`${card.os} · LIVE TELEMETRY`, 48, 137);
  context.fillStyle = "#f4f5f7";
  context.font = "700 44px Inter, Arial, sans-serif";
  context.fillText("Runtime & ports.", 48, 194);
  context.fillStyle = "#c3c8d1";
  context.font = "500 23px Inter, Arial, sans-serif";
  context.fillText("Loopback endpoints, vCPU profile & pool utilization.", 48, 234);

  const guestOs: GuestOS = cardToGuestOs(card);
  const guest = guestServiceStatus?.guests.find(
    (item) => item.os === guestOs && item.cardId === card.id,
  );
  const activeGuestsList =
    guestServiceStatus?.guests.filter(
      (g) => g.status === "running" || g.status === "starting" || g.status === "stopping",
    ) ?? [];
  const activeCount = activeGuestsList.length;
  const usedRamMb = activeGuestsList.reduce(
    (sum, g) => sum + (g.memoryMb ?? (g.os === "windows" ? 2048 : 1024)),
    0,
  );
  const cpuProfile = guestServiceStatus?.cpuProfiles?.[card.id] ?? "balanced";
  const hostCap = guestServiceStatus?.cpuCapacity ?? navigator.hardwareConcurrency ?? 1;
  const allocatedVcpus =
    guest?.vcpus ?? Math.min(CPU_PROFILE_VCPUS[cpuProfile], hostCap);

  const host = typeof window !== "undefined" ? (window.location.hostname || "127.0.0.1") : "127.0.0.1";
  const wsPort = guest?.websocketPort ? `ws://${host}:${guest.websocketPort}` : "Unbound (offline)";
  const slot = guest?.websocketPort ? guest.websocketPort - 5700 : null;
  const qmpPort = slot !== null ? `tcp://${host}:${4444 + slot}` : "Unbound (offline)";
  const serialPort =
    slot !== null
      ? `tcp://${host}:${4544 + slot} (ttyS0 / COM1)`
      : `Standby · ${host}:4544+slot (ttyS0)`;

  const rows: [string, string][] = [
    ["RUNTIME PHASE", guest ? `${guest.status.toUpperCase()} (${guest.bootMode ?? "disk"})` : card.status],
    ["VIRTUAL CPU & STUDIO GPU", `${cpuProfile.toUpperCase()} (${allocatedVcpus} / ${hostCap} vCPU) · 3D: ${studioGraphicsProfile.toUpperCase()}`],
    ["NOVNC & QMP SOCKETS", `${wsPort} · ${qmpPort}`],
    ["NEURAL SERIAL BRIDGE", serialPort],
    ["STREAMLINED GUEST POOL", `${activeCount} / 6 VMs active · ${usedRamMb} / 8192 MiB RAM`],
  ];

  drawKeyValueRows(context, rows, 298, 102);
  drawStatusFooter(context, card);
}

function drawKeyValueRows(
  context: CanvasRenderingContext2D,
  rows: [string, string][],
  startY: number,
  stepY: number,
  textScale = 1,
): void {
  rows.forEach(([label, value], index) => {
    const y = startY + index * stepY;
    context.fillStyle = "#07090ee8";
    const rowHeight = Math.min(
      stepY - 4,
      stepY - 10 + Math.max(0, textScale - 1) * 32,
    );
    roundRect(context, 42, y - 24, 556, rowHeight, 12);
    context.fill();
    context.strokeStyle = "#8a909e45";
    context.lineWidth = 1.5;
    roundRect(context, 42, y - 24, 556, rowHeight, 12);
    context.stroke();
    context.fillStyle = "#FFB81C";
    context.font = `700 ${18.5 * textScale}px Inter, Arial, sans-serif`;
    context.fillText(label, 60, y + 2);
    context.fillStyle = "#ffffff";
    context.font = `600 ${23 * textScale}px Inter, Arial, sans-serif`;
    drawWrappedText(context, value, 60, y + 34, 520, 26 * textScale, 2);
  });
}

function drawStatusFooter(context: CanvasRenderingContext2D, card: SystemCard): void {
  context.fillStyle = card.color;
  context.beginPath();
  context.arc(58, 852, 6, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#f4f5f7";
  context.font = "700 19.5px Inter, Arial, sans-serif";
  context.fillText(card.status, 76, 859);
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): void {
  const words = text.split(/\s+/);
  let line = "";
  let lineNumber = 0;

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width > maxWidth && line) {
      context.fillText(line, x, y + lineNumber * lineHeight);
      lineNumber += 1;
      line = word;
      if (lineNumber >= maxLines - 1) break;
    } else {
      line = next;
    }
  }

  if (lineNumber < maxLines && line) {
    context.fillText(line, x, y + lineNumber * lineHeight);
  }
}

function circularCardDiff(index: number): number {
  const count = Math.max(cards.length, 5);
  let diff = (index - selectedIndex) % count;
  if (diff > count / 2) diff -= count;
  if (diff < -count / 2) diff += count;
  return diff;
}

function cardTargetOrbitAngle(index: number): number {
  const slotStep = getSlotStep();
  return normalizeAngle(index * slotStep + turntableAngle);
}

function orbitPositionFromAngle(theta: number): THREE.Vector3 {
  // Graceful 3D Dais ellipse: keeps all 5 cards visibly framed in the room simultaneously
  const radiusX = 3.65;
  const radiusZ = 1.95;
  const x = radiusX * Math.sin(theta);
  const z = radiusZ * Math.cos(theta) - 0.75;
  // Selected card rises smoothly to hero height (+0.26), side cards rest lower in perspective
  const y = 2.45 + (Math.cos(theta) - 1) * 0.16;
  return new THREE.Vector3(x, y, z);
}

function wheelPosition(index: number): THREE.Vector3 {
  const slotStep = getSlotStep();
  return orbitPositionFromAngle(normalizeAngle(index * slotStep + turntableAngle));
}

function cycleCarousel(dir: 1 | -1, withAnticipation = true): void {
  const slotStep = getSlotStep();
  if (withAnticipation && !reduceMotion) {
    // Subtle negative anticipation pull: Nudge in opposite direction before swooping into the turn!
    turntableAngle += dir * 0.045;
    if (selectedCard) {
      selectedCard.tiltZ = -dir * 0.16;
      selectedCard.tiltX = -0.06;
    }
  }
  targetTurntableAngle -= dir * slotStep;
}

function resolveCardCollisions(activeCard?: SystemCard): void {
  const minSepX = 2.48;
  const minSepY = 3.36;
  const minSepZ = 0.72;

  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const cardA = cards[i];
        const cardB = cards[j];
        const posA = cardA.group.position;
        const posB = cardB.group.position;

        const dx = posA.x - posB.x;
        const dy = posA.y - posB.y;
        const dz = posA.z - posB.z;

        if (Math.abs(dy) >= minSepY || Math.abs(dz) >= minSepZ) continue;
        const nx = dx / minSepX;
        const nz = dz / minSepZ;
        const distSq = nx * nx + nz * nz;
        if (distSq >= 1) continue;

        const overlapX = minSepX - Math.abs(dx);
        const dirX = dx === 0 ? (i < j ? -1 : 1) : Math.sign(dx);

        if (activeCard === cardA) {
          posA.x = THREE.MathUtils.clamp(posB.x + dirX * minSepX, -7.2, 7.2);
        } else if (activeCard === cardB) {
          posB.x = THREE.MathUtils.clamp(posA.x - dirX * minSepX, -7.2, 7.2);
        } else {
          const push = overlapX * 0.52;
          posA.x = THREE.MathUtils.clamp(posA.x + dirX * push, -7.2, 7.2);
          posB.x = THREE.MathUtils.clamp(posB.x - dirX * push, -7.2, 7.2);
        }
      }
    }
  }
}

function arrangeCards(): void {
  for (const [index, card] of cards.entries()) {
    card.layoutPosition.copy(wheelPosition(index));
  }
}

function updateFacetBarUI(): void {
  const activeFacet = selectedCard?.facet ?? "front";
  const pills = facetBarElement.querySelectorAll<HTMLButtonElement>("[data-facet]");
  for (const pill of pills) {
    const isCurrent = pill.dataset.facet === activeFacet;
    pill.classList.toggle("active", isCurrent);
    pill.setAttribute("aria-pressed", String(isCurrent));
  }
  const pulldownLabel = document.querySelector<HTMLElement>("#facet-pulldown-label");
  if (pulldownLabel) {
    const meta = FACET_META[activeFacet];
    pulldownLabel.textContent = `${meta.badge.slice(0, 2)} · ${meta.shortLabel.toUpperCase()}`;
  }
}

function selectCard(card: SystemCard, withAnticipation = false): void {
  const targetIndex = cards.indexOf(card);
  if (targetIndex < 0) return;
  const slotStep = getSlotStep();
  const slotAngle = targetIndex * slotStep;
  const currentTheta = normalizeAngle(slotAngle + turntableAngle);

  if (withAnticipation && !reduceMotion && Math.abs(currentTheta) > 0.1) {
    const dir = currentTheta > 0 ? 1 : -1;
    turntableAngle += dir * 0.045;
    if (selectedCard) {
      selectedCard.tiltZ = -dir * 0.16;
      selectedCard.tiltX = -0.06;
    }
  }
  targetTurntableAngle = turntableAngle - currentTheta;

  selectedIndex = targetIndex;
  selectedCard = card;
  for (const item of cards) item.layoutOffset.set(0, 0, 0);
  updateGuestActionButton();
  updateFacetBarUI();
  const tier = getCardTier(card);
  selectedTierElement.textContent = tier;
  selectedTierElement.className = `tier-badge tier-badge-${tier.toLowerCase()}`;
  selectedNameElement.textContent = `${card.name} · ${FACET_META[card.facet].badge}`;
  sceneCardIndexElement.textContent = String(targetIndex + 1).padStart(2, "0");
  renderer.domElement.setAttribute(
    "aria-label",
    `${card.name}, ${card.status}, facet ${FACET_META[card.facet].shortLabel}. Use left and right arrow keys to browse, WASD or 1-6 to flip 6 ways, or drag to arrange.`,
  );
  for (const item of cards) {
    const edge = item.group.children[0];
    const material = edge instanceof THREE.Mesh ? edge.material : undefined;
    if (material instanceof THREE.MeshStandardMaterial) {
      material.emissive.set(item === card ? "#FFB81C" : "#000000");
      material.emissiveIntensity = item === card ? 0.45 : 0;
    }
  }
}

function updateGuestActionButton(status = guestServiceStatus): void {
  const card = selectedCard;
  const guestOs: GuestOS = card ? cardToGuestOs(card) : "linux";
  const isGuestCard = Boolean(card);
  guestButtonElement.hidden = !isGuestCard;
  resetButtonElement.disabled = !card;
  cloneButtonElement.disabled = !card;
  const guest = status?.guests.find((item) => item.os === guestOs && item.cardId === card?.id);
  const isRunningHere = guest?.status === "running";
  const isBusy = guest?.status === "starting" || guest?.status === "stopping";
  const label = guestButtonElement.querySelector<HTMLSpanElement>("span:last-child");
  const hasDisk = card
    ? guestOs === "windows"
      ? (status?.installedWindowsCardIds?.includes(card.id) ?? false) ||
        (/^windows[-_]/.test(card.id) && (status?.installedWindowsCardIds?.includes("windows") ?? false))
      : (status?.preparedCardIds.includes(card.id) ?? false)
    : false;
  if (label) {
    const osTitle =
      guestOs === "windows"
        ? "Windows"
        : guestOs === "android"
          ? "Android"
          : guestOs === "macos"
            ? "macOS"
            : "Linux";
    label.textContent = isRunningHere
      ? `Open ${osTitle}`
      : guest?.status === "starting"
        ? "Starting…"
        : guest?.status === "stopping"
          ? "Shutting down…"
          : guestOs === "windows"
            ? hasDisk
              ? "Resume Windows"
              : "Install Windows 11"
            : status?.baseReady && hasDisk
              ? `Resume ${osTitle}`
              : status?.baseReady
                ? `Launch ${osTitle}`
                : "Install Debian base";
  }
  guestButtonElement.setAttribute(
    "aria-label",
    isRunningHere
      ? `Open live ${guestOs} guest display`
      : guestOs === "windows"
        ? hasDisk
          ? "Boot this Windows card from its persistent disk"
          : "Launch the Windows 11 installer"
        : status?.baseReady
          ? "Launch this Linux card with its private disk overlay"
          : "Launch the Debian golden image installer",
  );
  guestButtonElement.disabled = !isGuestCard || isBusy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGuestServiceStatus(value: unknown): value is GuestServiceStatus {
  if (!isRecord(value)) return false;
  return (
    typeof value.baseReady === "boolean" &&
    typeof value.baseDiskExists === "boolean" &&
    typeof value.baseDiskPath === "string" &&
    Array.isArray(value.preparedCardIds) &&
    value.preparedCardIds.every((id) => typeof id === "string") &&
    Array.isArray(value.preparedWindowsCardIds) &&
    value.preparedWindowsCardIds.every((id) => typeof id === "string") &&
    Array.isArray(value.guests) &&
    value.guests.every(
      (guest) =>
        isRecord(guest) &&
        ["linux", "windows", "android", "macos"].includes(String(guest.os)) &&
        typeof guest.cardId === "string" &&
        ["offline", "starting", "running", "stopping", "error"].includes(String(guest.status)) &&
        (guest.websocketPort === null || typeof guest.websocketPort === "number") &&
        typeof guest.diskPath === "string",
    )
  );
}

async function requestGuestApi(
  endpoint: string,
  body?: Record<string, string>,
): Promise<GuestServiceStatus> {
  const response = await fetch(endpoint, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Guest service returned an invalid response (${response.status}).`);
  }
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : `Guest service request failed (${response.status}).`;
    throw new Error(message);
  }
  if (!isGuestServiceStatus(payload)) {
    throw new Error("Guest service returned an unexpected status response.");
  }
  return payload;
}

function updateGuestCardStatus(status: GuestServiceStatus): void {
  guestServiceStatus = status;
  if (Array.isArray(status.paperPlanes) && status.paperPlanes.length > 0) {
    for (const card of cards) {
      const incoming = status.paperPlanes
        .filter((plane) => plane.toCardId === card.id)
        .map((plane) => {
          const senderName =
            plane.fromCardId === "remote-peer"
              ? "Live Peer Computer"
              : (cards.find((c) => c.id === plane.fromCardId)?.name ?? plane.fromCardId);
          const badge = plane.deliveredToVm ? "[VM TYPED]" : "[SPOOL]";
          return `← ${senderName} ${badge}: ${plane.message}`;
        });
      const outgoing = status.paperPlanes
        .filter((plane) => plane.fromCardId === card.id)
        .map((plane) => {
          const targetName =
            plane.toCardId === "remote-peer"
              ? (plane.remoteDeliveryInfo ?? plane.remoteTarget ?? "Live Network")
              : (cards.find((c) => c.id === plane.toCardId)?.name ?? plane.toCardId);
          const badge = plane.deliveredToRemote
            ? `[LIVE NET · ${plane.remoteDeliveryInfo ?? "OK"}]`
            : plane.deliveredToVm
              ? "[VM TYPED]"
              : "[SPOOL / CATCH]";
          return `→ ${targetName} ${badge}: ${plane.message}`;
        });
      if (incoming.length > 0) card.receivedNotes = incoming;
      if (outgoing.length > 0) card.sentNotes = outgoing;
    }
  }
  for (const card of cards) {
    const os: GuestOS = cardToGuestOs(card);
    const guest = status.guests.find((item) => item.os === os && item.cardId === card.id);
    const hasDisk =
      os === "windows"
        ? (status.installedWindowsCardIds?.includes(card.id) ?? false) ||
          (/^windows[-_]/.test(card.id) && (status.installedWindowsCardIds?.includes("windows") ?? false))
        : status.preparedCardIds.includes(card.id);
    const displayStatus =
      guest?.status === "running"
        ? guest.bootMode === "installer"
          ? "GUEST · INSTALLER"
          : "GUEST · CONNECTED"
        : guest?.status === "starting"
          ? "GUEST · STARTING"
          : guest?.status === "stopping"
            ? "GUEST · SHUTTING DOWN"
            : guest?.status === "error"
              ? "GUEST · ERROR"
              : hasDisk
                ? "GUEST · OFFLINE"
                : os !== "windows" && status.baseReady
                  ? "GUEST · BASE READY"
                  : "DEMO · DISCONNECTED";
    if (card.status !== displayStatus) {
      card.status = displayStatus;
    }
    if (guest?.serialOutput !== undefined) {
      card.serialOutput = guest.serialOutput;
    }
    refreshCardTexture(card);
  }
  if (selectedCard) {
    renderer.domElement.setAttribute(
      "aria-label",
      `${selectedCard.name}, ${selectedCard.status}, facet ${FACET_META[selectedCard.facet].shortLabel}. Use left and right arrow keys to browse, WASD or 1-6 to flip 6 ways, or drag to arrange.`,
    );
  }
  updateGuestActionButton(status);
  const activeGuests = status.guests.filter(
    (guest) =>
      guest.status === "running" || guest.status === "starting" || guest.status === "stopping",
  );
  const targetGuest = status.guests.find(
    (guest) => guest.os === guestTargetOs && guest.cardId === guestTargetCardId,
  );
  const targetBusy = targetGuest?.status === "starting" || targetGuest?.status === "stopping";
  const targetRunning = targetGuest?.status === "running";
  const targetHasDisk =
    guestTargetOs === "windows"
      ? (status.installedWindowsCardIds?.includes(guestTargetCardId ?? "") ?? false)
      : status.baseReady;
  guestInstallButtonElement.disabled =
    targetBusy ||
    targetRunning ||
    (guestTargetOs === "linux" && (status.baseReady || activeGuests.length > 0));
  guestFinalizeBaseButtonElement.disabled =
    guestTargetOs !== "linux" ||
    !status.baseDiskExists ||
    status.baseReady ||
    activeGuests.length > 0;
  guestFinalizeBaseButtonElement.hidden = guestTargetOs !== "linux";
  guestBootDiskButtonElement.disabled = !targetHasDisk || targetBusy || targetRunning;
  guestCloneCardButtonElement.disabled = Boolean(targetBusy || targetRunning);
  guestResetOverlayButtonElement.disabled = Boolean(targetBusy || targetRunning);
  const targetHasPlanes = Boolean(
    status.paperPlanes?.some((plane) => plane.toCardId === guestTargetCardId) ||
      (cards.find((c) => c.id === guestTargetCardId)?.receivedNotes.length ?? 0) > 0,
  );
  guestInjectPlaneButtonElement.disabled = !targetRunning || !targetHasPlanes;
  guestShutdownButtonElement.disabled = !targetRunning;
  guestForceStopButtonElement.disabled = !targetRunning;
}

function computeCardTextureKey(card: SystemCard): string {
  const guestOs = cardToGuestOs(card);
  const guest = guestServiceStatus?.guests.find(
    (item) => item.os === guestOs && item.cardId === card.id,
  );
  const activeCount =
    guestServiceStatus?.guests.filter(
      (g) => g.status === "running" || g.status === "starting" || g.status === "stopping",
    ).length ?? 0;
  return [
    card.status,
    card.facet,
    card.backFaceVisible ? "B" : "F",
    card.resetCount,
    card.receivedNotes.length,
    card.receivedNotes.slice(-1)[0] ?? "",
    card.sentNotes.length,
    card.sentNotes.slice(-1)[0] ?? "",
    card.serialOutput ?? "",
    guest?.status ?? "",
    guest?.websocketPort ?? "",
    guest?.vcpus ?? "",
    guestServiceStatus?.baseReady ? "1" : "0",
    guestServiceStatus?.cpuProfiles?.[card.id] ?? "balanced",
    guestServiceStatus?.memoryProfiles?.[card.id] ?? "eco",
    guestServiceStatus?.networkModes?.[card.id] ?? "nat",
    guestServiceStatus?.checkpoints?.[card.id]?.savedAt ?? "",
    studioGraphicsProfile,
    activeCount,
  ].join("|");
}

function refreshCardTexture(card: SystemCard, force = false): void {
  const nextKey = computeCardTextureKey(card);
  if (!force && !card.liveCanvas && card.lastTextureKey === nextKey) {
    return;
  }
  card.lastTextureKey = nextKey;

  const visibleFaceName = card.backFaceVisible ? "back" : "front";
  const hiddenFaceName = card.backFaceVisible ? "front" : "back";
  const nextCycleFacet =
    FACET_ORDER[(FACET_ORDER.indexOf(card.facet) + 1) % FACET_ORDER.length];

  for (const child of card.group.children.slice(1)) {
    if (!(child instanceof THREE.Mesh) || !(child.material instanceof THREE.MeshStandardMaterial)) {
      continue;
    }
    const facetForMesh =
      child.userData.face === visibleFaceName
        ? card.facet
        : child.userData.face === hiddenFaceName
          ? nextCycleFacet
          : card.facet;
    const nextTexture = makeCardTexture(card, facetForMesh);
    child.material.map?.dispose();
    child.material.map = nextTexture;
    child.material.emissiveMap = nextTexture;
    child.material.needsUpdate = true;
  }
}

async function refreshGuestStatus(): Promise<GuestServiceStatus> {
  const status = await requestGuestApi("/api/guest/status");
  updateGuestCardStatus(status);
  const targetGuest = status.guests.find(
    (guest) => guest.os === guestTargetOs && guest.cardId === guestTargetCardId,
  );
  if (targetGuest?.status === "error" && targetGuest.error) {
    setGuestError(targetGuest.error);
  } else {
    clearGuestError();
  }
  return status;
}

function setGuestState(message: string): void {
  guestStateElement.textContent = message;
}

function setGuestError(message: string): void {
  guestErrorElement.textContent = message;
  guestErrorElement.hidden = false;
  setGuestState(`The ${guestTargetOs} guest needs attention.`);
}

function clearGuestError(): void {
  guestErrorElement.textContent = "";
  guestErrorElement.hidden = true;
}

function reportGuestError(error: unknown): void {
  const message = error instanceof Error ? error.message : "The guest request failed.";
  setGuestError(message);
  showToast(message);
}

function updateGuestDialogCopy(): void {
  const isWindows = guestTargetOs === "windows";
  const isAndroid = guestTargetOs === "android";
  const isMacOs = guestTargetOs === "macos";
  const kicker = guestDialogElement.querySelector<HTMLElement>(".dialog-kicker");
  const footer = guestDialogElement.querySelector<HTMLElement>(".guest-window-footer > p");
  if (kicker) {
    kicker.textContent = isWindows
      ? "WINDOWS GUEST · WSL QEMU · TPM 2.0 · ECO RAM"
      : isAndroid
        ? "ANDROID GUEST · QEMU · ECO RAM"
        : isMacOs
          ? "MACOS / DARWIN GUEST · OPENCORE UEFI · ECO RAM"
          : "LINUX GUEST · QEMU · ECO RAM";
  }
  if (footer) {
    footer.textContent = isWindows
      ? "Windows uses a persistent 64 GiB disk, UEFI firmware, a per-card software TPM 2.0, and a virtio-balloon device."
      : isAndroid
        ? "Android cards include a virtio-balloon device (1 GiB Eco default). Multiple Android, Windows, macOS, and Linux cards can run side-by-side."
        : isMacOs
          ? "macOS / Darwin cards use a q35 + OpenCore UEFI + AppleSMC profile with 2 GiB Eco RAM and a virtio-balloon device on a private QCOW2 overlay."
          : "Install Debian once as the golden base, shut it down, then finish the base. Up to six cards can run at once with virtio-balloon devices and independent QCOW2 overlays.";
  }
  guestInstallButtonElement.textContent = isWindows
    ? "Install Windows 11"
    : isAndroid
      ? "Install Android base"
      : isMacOs
        ? "Install macOS / Darwin"
        : "Install Debian base";
  guestBootDiskButtonElement.textContent = isWindows
    ? "Boot Windows"
    : isAndroid
      ? "Boot Android"
      : isMacOs
        ? "Boot macOS"
        : "Boot this card";
  guestFinalizeBaseButtonElement.hidden = guestTargetOs !== "linux";
}

function connectGuestDisplay(websocketPort: number): void {
  if (guestRfb) guestRfb.disconnect();
  guestDisplayElement.replaceChildren();
  setGuestState(`Connecting to the ${guestTargetOs} display…`);
  clearGuestError();
  const host = window.location.hostname || "127.0.0.1";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const rfb = new RFB(guestDisplayElement, `${protocol}//${host}:${websocketPort}`);
  rfb.viewOnly = false;
  rfb.scaleViewport = true;
  rfb.resizeSession = false;
  rfb.focusOnClick = true;
  rfb.clipViewport = true;
  rfb.addEventListener("connect", () => {
    setGuestState("Live display connected. Click the screen to use guest keyboard and pointer.");
  });
  rfb.addEventListener("disconnect", () => {
    if (guestRfb === rfb) guestRfb = undefined;
    if (guestDialogElement.open) {
      setGuestState("Display disconnected. The guest may still be running.");
    }
  });
  rfb.addEventListener("securityfailure", () => {
    setGuestError("QEMU rejected the local display connection.");
  });
  guestRfb = rfb;
}

function disconnectGuestDisplay(): void {
  if (guestRfb) {
    const connection = guestRfb;
    guestRfb = undefined;
    connection.disconnect();
  }
  guestDisplayElement.replaceChildren();
}

async function startGuest(bootMode: GuestBootMode, cardId: string): Promise<void> {
  if (!guestDialogElement.open) guestDialogElement.showModal();
  guestTargetCardId = cardId;
  guestTitleElement.textContent =
    cards.find((card) => card.id === cardId)?.name ?? "Linux guest";
  clearGuestError();
  const guestName =
    guestTargetOs === "windows"
      ? "Windows 11"
      : guestTargetOs === "android"
        ? "Android"
        : guestTargetOs === "macos"
          ? "macOS / Darwin"
          : "Debian/Linux";
  setGuestState(
    bootMode === "installer"
      ? `Launching ${guestName} installer…`
      : `Booting installed ${guestName}…`,
  );
  guestInstallButtonElement.disabled = true;
  guestFinalizeBaseButtonElement.disabled = true;
  guestBootDiskButtonElement.disabled = true;
  guestCloneCardButtonElement.disabled = true;
  guestResetOverlayButtonElement.disabled = true;
  guestInjectPlaneButtonElement.disabled = true;
  guestShutdownButtonElement.disabled = true;
  guestForceStopButtonElement.disabled = true;
  guestButtonElement.disabled = true;
  try {
    const status = await requestGuestApi("/api/guest/start", {
      os: guestTargetOs,
      bootMode,
      cardId,
    });
    updateGuestCardStatus(status);
    const guest = status.guests.find(
      (item) => item.os === guestTargetOs && item.cardId === cardId,
    );
    if (!guest || guest.websocketPort === null) {
      throw new Error("Guest started without a display port.");
    }
    connectGuestDisplay(guest.websocketPort);
  } catch (error) {
    reportGuestError(error);
    try {
      updateGuestCardStatus(await requestGuestApi("/api/guest/status"));
    } catch (statusError) {
      reportGuestError(statusError);
    }
  } finally {
    updateGuestActionButton();
  }
}

async function finalizeLinuxBase(): Promise<void> {
  guestFinalizeBaseButtonElement.disabled = true;
  setGuestState("Finalizing the Debian golden base…");
  clearGuestError();
  try {
    const status = await requestGuestApi("/api/guest/finalize-base", {});
    updateGuestCardStatus(status);
    setGuestState(
      "Debian base finalized. Each Linux card now receives its own persistent overlay.",
    );
  } catch (error) {
    reportGuestError(error);
    try {
      updateGuestCardStatus(await requestGuestApi("/api/guest/status"));
    } catch (statusError) {
      reportGuestError(statusError);
    }
  }
}

async function shutdownGuest(): Promise<void> {
  guestShutdownButtonElement.disabled = true;
  setGuestState(`Requesting a graceful ${guestTargetOs} shutdown…`);
  clearGuestError();
  try {
    if (!guestTargetCardId) return;
    const status = await requestGuestApi("/api/guest/stop", {
      os: guestTargetOs,
      cardId: guestTargetCardId,
    });
    disconnectGuestDisplay();
    updateGuestCardStatus(status);
    setGuestState(`${guestTargetOs} guest is shut down.`);
  } catch (error) {
    reportGuestError(error);
    guestShutdownButtonElement.disabled = false;
  }
}

async function forceStopGuest(): Promise<void> {
  guestShutdownButtonElement.disabled = true;
  guestForceStopButtonElement.disabled = true;
  setGuestState(`Force stopping the ${guestTargetOs} guest…`);
  clearGuestError();
  try {
    if (!guestTargetCardId) return;
    const status = await requestGuestApi("/api/guest/force-stop", {
      os: guestTargetOs,
      cardId: guestTargetCardId,
    });
    disconnectGuestDisplay();
    updateGuestCardStatus(status);
    setGuestState(`${guestTargetOs} guest was force stopped.`);
  } catch (error) {
    reportGuestError(error);
    guestForceStopButtonElement.disabled = false;
  }
}

async function injectLatestPaperPlaneIntoVm(): Promise<void> {
  if (!guestTargetCardId) return;
  guestInjectPlaneButtonElement.disabled = true;
  setGuestState("Typing latest paper airplane into the live guest via QMP send-key…");
  clearGuestError();
  try {
    const status = await requestGuestApi("/api/guest/paper-plane/inject", {
      os: guestTargetOs,
      cardId: guestTargetCardId,
    });
    updateGuestCardStatus(status);
    setGuestState("Paper airplane typed into the active guest window via QMP.");
    showToast("Paper airplane typed into live VM via QMP send-key.");
  } catch (error) {
    reportGuestError(error);
  } finally {
    if (guestServiceStatus) updateGuestCardStatus(guestServiceStatus);
  }
}

function toggleSecOpsLabMode(): void {
  secOpsMode = !secOpsMode;
  secopsToggleElement.classList.toggle("active", secOpsMode);
  secopsToggleElement.setAttribute("aria-pressed", String(secOpsMode));
  secopsToggleElement.textContent = secOpsMode ? "🛡️ SECOPS ACTIVE" : "🛡️ SECOPS LAB";

  const eyebrow = document.querySelector<HTMLElement>(".eyebrow");
  if (eyebrow) {
    eyebrow.innerHTML = secOpsMode
      ? "CYBER RANGE <span>/</span> PEN-TEST &amp; NEURAL OPS"
      : "NEON DISTRICT <span>/</span> NIGHT GRID";
  }

  fillLight.color.set(secOpsMode ? "#FFB81C" : "#8a909e");
  rimLight.color.set(secOpsMode ? "#8a909e" : "#FFB81C");

  if (secOpsMode) {
    const secOpsDefinitions = [
      {
        id: "kali-red",
        name: "Kali · Red Team",
        os: "LINUX",
        detail: "Agentless QMP recon, exploit verification & hardening.",
        color: "#FFB81C",
        status: guestServiceStatus?.baseReady ? "GUEST · BASE READY" : "DEMO · DISCONNECTED",
      },
      {
        id: "ai-copilot",
        name: "G-III Copilot · Twin-Star",
        os: "LINUX",
        detail: "Day-one neural co-pilot synthesizing & flying Paper Airplanes.",
        color: "#8a909e",
        status: guestServiceStatus?.baseReady ? "GUEST · BASE READY" : "DEMO · DISCONNECTED",
      },
    ];
    for (const def of secOpsDefinitions) {
      if (!cards.some((c) => c.id === def.id)) {
        cards.push(createCard(def, cards.length));
      }
    }
    arrangeCards();
    updateCardCount();
    updateRecipientOptions();
    if (guestServiceStatus) updateGuestCardStatus(guestServiceStatus);
    const kaliCard = cards.find((c) => c.id === "kali-red");
    if (kaliCard) selectCard(kaliCard);
    showToast("SecOps & Pen-Test Cyber Range activated · Kali Red Team & AI Copilot added.");
  } else {
    showToast("Returned to Standard Spatial Studio mode.");
  }
}

async function runAiOrSecOpsCommand(prompt: string, targetCard?: SystemCard): Promise<void> {
  const card = targetCard ?? selectedCard ?? cards[0];
  if (!card) return;
  if (/^(gemini\s*3|g-?3|twin\s*star)$/i.test(prompt.trim())) {
    const peer = cards.find((c) => c !== card) ?? card;
    sendPaperPlane(peer, card, "✦ G-III Twin-Star Salute · Day-One Co-Pilot");
    showToast("✦ G-III Twin-Star Core: Riding shotgun with you from Day One. All systems yours!");
    return;
  }
  const os = cardToGuestOs(card);
  try {
    const status = await requestGuestApi("/api/guest/ai-command", {
      prompt,
      targetCardId: card.id,
      os,
    });
    updateGuestCardStatus(status);
    const aiCard = cards.find((c) => c.id === "ai-copilot") ?? card;
    const cmdText = status.aiResult?.command ?? prompt;
    const category = status.aiResult?.category ?? "AI · OPS";
    if (aiCard !== card) {
      sendPaperPlane(aiCard, card, cmdText);
    } else {
      card.tiltX = -0.35;
      refreshCardTexture(card);
    }
    showToast(`${category} → ${card.name}: ${cmdText}`);
  } catch (error) {
    reportGuestError(error);
  }
}

async function runTimeTravelSnapshot(
  action: "save" | "rewind",
  targetCard?: SystemCard,
): Promise<void> {
  const card = targetCard ?? selectedCard;
  if (!card) return;
  const os: GuestOS = cardToGuestOs(card);
  try {
    const status = await requestGuestApi("/api/guest/snapshot", {
      action,
      cardId: card.id,
      os,
      tag: "time-travel",
    });
    updateGuestCardStatus(status);
    card.tiltZ = action === "save" ? 0.35 : -0.45;
    refreshCardTexture(card);
    if (action === "save") {
      showToast(`⏱️ Time-Travel Savepoint captured for ${card.name}.`);
      if (guestDialogElement.open) {
        setGuestState(`Time-Travel Savepoint captured for ${card.name}.`);
      }
    } else {
      showToast(`⏪ Rewound ${card.name} to last Time-Travel Savepoint!`);
      if (guestDialogElement.open) {
        setGuestState(`Rewound ${card.name} to last Time-Travel Savepoint.`);
      }
    }
  } catch (error) {
    reportGuestError(error);
  }
}

async function cycleCardMemoryProfile(card: SystemCard): Promise<void> {
  const current = guestServiceStatus?.memoryProfiles?.[card.id] ?? "eco";
  const order: ("eco" | "balanced" | "performance")[] = ["eco", "balanced", "performance"];
  const next = order[(order.indexOf(current) + 1) % order.length];
  try {
    const status = await requestGuestApi("/api/guest/memory-profile", {
      cardId: card.id,
      memoryProfile: next,
    });
    updateGuestCardStatus(status);
    flipCardTo(card, "back");
    const isWin = card.os === "WINDOWS";
    const mb =
      next === "performance"
        ? isWin
          ? 4096
          : 2048
        : next === "balanced"
          ? isWin
            ? 3072
            : 1536
          : isWin
            ? 2048
            : 1024;
    showToast(
      `🍃 ${card.name} RAM profile set to ${next.toUpperCase()} (${mb} MiB + VirtIO Balloon).`,
    );
  } catch (error) {
    reportGuestError(error);
  }
}

async function cycleCardNetworkMode(card: SystemCard): Promise<void> {
  const current = guestServiceStatus?.networkModes?.[card.id] ?? "nat";
  const order: ("nat" | "cyber-range" | "airgap")[] = ["nat", "cyber-range", "airgap"];
  const next = order[(order.indexOf(current) + 1) % order.length];
  try {
    const status = await requestGuestApi("/api/guest/network-mode", {
      cardId: card.id,
      networkMode: next,
    });
    updateGuestCardStatus(status);
    flipCardTo(card, "left");
    const desc =
      next === "airgap"
        ? "AIRGAP VAULT (-nic none)"
        : next === "cyber-range"
          ? "CYBER-RANGE VLAN (Card-to-Card 230.0.0.1:4550)"
          : "STANDARD NAT (Internet)";
    showToast(`🔌 ${card.name} network topology set to ${desc}.`);
  } catch (error) {
    reportGuestError(error);
  }
}

async function runSwarmFork(sourceCard: SystemCard): Promise<void> {
  const os: GuestOS = cardToGuestOs(sourceCard);
  try {
    const status = await requestGuestApi("/api/guest/swarm-fork", {
      sourceCardId: sourceCard.id,
      os,
      count: "2",
    });
    const createdIds = status.swarmResult?.createdCardIds ?? [
      `${sourceCard.id}-swarm-${cloneCounter}`,
      `${sourceCard.id}-swarm-${cloneCounter + 1}`,
    ];
    for (const newId of createdIds) {
      if (cards.some((c) => c.id === newId)) continue;
      const idx = cards.length;
      const baseTitle = sourceCard.name.split(" · ")[0] ?? sourceCard.os;
      const swarmCard = createCard(
        {
          id: newId,
          name: `${baseTitle} · Swarm ${cloneCounter}`,
          os: sourceCard.os,
          detail: `Parallel Swarm clone of ${sourceCard.name}.`,
          color: sourceCard.color,
          status: sourceCard.status,
        },
        idx,
      );
      swarmCard.clonedFrom = sourceCard.id;
      cloneCounter += 1;
      cards.push(swarmCard);
    }
    arrangeCards();
    updateCardCount();
    updateRecipientOptions();
    updateGuestCardStatus(status);
    showToast(`🐝 Forked ${createdIds.length} parallel Swarm cards from ${sourceCard.name}!`);
  } catch (error) {
    reportGuestError(error);
  }
}

async function uploadFilePaperPlane(
  fromCard: SystemCard,
  targetCard: SystemCard,
  file: File,
): Promise<void> {
  if (file.size > 512 * 1024) {
    showToast("File is larger than 512 KB limit for Heavy Paper Airplanes.");
    return;
  }
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  const contentBase64 = window.btoa(binary);
  const os = cardToGuestOs(targetCard);

  sendPaperPlane(fromCard, targetCard, `[FILE DROP] ${file.name} (${bytes.byteLength} B)`);
  try {
    const status = await requestGuestApi("/api/guest/file-drop", {
      fromCardId: fromCard.id,
      toCardId: targetCard.id,
      os,
      fileName: file.name,
      contentBase64,
    });
    updateGuestCardStatus(status);
    showToast(`📎 Dropped '${file.name}' (${bytes.byteLength} B) into ${targetCard.name}'s VVFAT drive!`);
  } catch (error) {
    reportGuestError(error);
  }
}

async function runSerialExec(card: SystemCard, customCommand?: string): Promise<void> {
  const os = cardToGuestOs(card);
  if (!os) {
    showToast(`${card.name} is an illustrative preview card.`);
    return;
  }
  const command =
    customCommand ??
    (omniInputElement.value.trim() ||
      (os === "windows" ? "whoami & hostname & ipconfig" : "uname -a; id; ip -br a"));
  if (omniInputElement.value.trim()) {
    omniInputElement.value = "";
  }
  try {
    showToast(`📡 Sending '${command}' over Serial Pipe (ttyS0/COM1) to ${card.name}…`);
    const status = await requestGuestApi("/api/guest/serial-exec", {
      cardId: card.id,
      os,
      command,
    });
    updateGuestCardStatus(status);
    const out = status.serialExecResult?.output?.trim();
    if (out) {
      card.serialOutput = out;
      refreshCardTexture(card);
      const preview = out.split(/\r?\n/).slice(-1)[0] ?? out;
      showToast(`📡 Serial response (${card.name}): ${preview.slice(0, 72)}`);
    } else {
      showToast(`📡 Command sent to ${card.name} serial pipe (awaiting guest ttyS0 login/console).`);
    }
  } catch (error) {
    reportGuestError(error);
  }
}

function updateCardCount(): void {
  const total = String(cards.length).padStart(2, "0");
  cardCountElement.textContent = total;
  sceneCardTotalElement.textContent = total;
}

function updateRecipientOptions(): void {
  recipientSelectElement.replaceChildren();
  for (const card of cards) {
    if (card === selectedCard) continue;
    const option = document.createElement("option");
    option.value = card.id;
    option.textContent = card.name;
    recipientSelectElement.append(option);
  }
  const remoteOption = document.createElement("option");
  remoteOption.value = "remote-peer";
  remoteOption.textContent = "🌐 Any Live Computer (Network / Webhook / TCP)";
  recipientSelectElement.append(remoteOption);
}

function flipCardTo(card: SystemCard, targetFacet: CardFacet, preferredDir?: 1 | -1): void {
  if (card.facet === targetFacet) {
    targetFacet = card.facet === "front" ? "back" : "front";
  }

  // Pre-render upcoming target facet onto hidden face mesh before rotation starts
  const upcomingFaceName = card.backFaceVisible ? "front" : "back";
  for (const child of card.group.children.slice(1)) {
    if (child instanceof THREE.Mesh && child.userData.face === upcomingFaceName) {
      const nextTexture = makeCardTexture(card, targetFacet);
      child.material.map?.dispose();
      child.material.map = nextTexture;
      child.material.emissiveMap = nextTexture;
      child.material.needsUpdate = true;
    }
  }

  const dir: 1 | -1 = preferredDir ?? (targetFacet === "left" ? -1 : 1);
  const startRot = card.group.rotation.y;
  const targetRot = card.targetRotation + dir * Math.PI;
  card.targetRotation = targetRot;

  card.flipAnim = {
    startRotationY: startRot,
    targetRotationY: targetRot,
    startTime: performance.now(),
    duration: 520, // 520ms smooth ease-in-out S-curve
    midpointPassed: false,
    targetFacet,
    tiltDir: dir,
    tiltAxis: targetFacet === "top" || targetFacet === "bottom" ? "x" : "z",
  };

  const meta = FACET_META[targetFacet];
  showToast(`${card.name} · ${meta.badge} ${meta.shortLabel}`);
}

function toggleCardZoom(force?: boolean): void {
  cardZoomed = typeof force === "boolean" ? force : !cardZoomed;
  compassZoomButtonElement.classList.toggle("active", cardZoomed);
  compassZoomButtonElement.textContent = cardZoomed
    ? "🔍 Zoom Out to Studio (Z / Esc)"
    : "🔍 Zoom Into Card (Z)";
  zoomButtonLabelElement.textContent = cardZoomed ? "Zoom out" : "Zoom card";
  if (selectedCard) {
    showToast(
      cardZoomed
        ? `Zoomed into ${selectedCard.name} · Use edges or compass to 6-way flip.`
        : "Zoomed out to full 3D studio.",
    );
  }
}

function cycleCardFacet(card: SystemCard, step = 1): void {
  const currentIdx = FACET_ORDER.indexOf(card.facet);
  const nextIdx = (currentIdx + step + FACET_ORDER.length) % FACET_ORDER.length;
  flipCardTo(card, FACET_ORDER[nextIdx]);
}

function handleCardClick(card: SystemCard, uv?: THREE.Vector2): void {
  if (!uv) return;

  // Clicking near any of the 4 outer edges performs a directional 6-way flip.
  if (uv.x < 0.14) {
    flipCardTo(card, "left");
    return;
  }
  if (uv.x > 0.86) {
    flipCardTo(card, "right");
    return;
  }
  if (uv.y > 0.89) {
    flipCardTo(card, "top");
    return;
  }
  if (uv.y < 0.11) {
    flipCardTo(card, "bottom");
    return;
  }

  // On the Quick Actions facet (05 / 06), clicking one of the 4 tiles triggers it.
  if (card.facet === "top" && uv.x >= 0.15 && uv.x <= 0.85) {
    const canvasY = (1 - uv.y) * 960;
    if (canvasY >= 278 && canvasY <= 386) {
      openOrStartSelectedGuest(card);
      return;
    } else if (canvasY >= 406 && canvasY <= 514) {
      void cloneSelectedCard(card);
      return;
    } else if (canvasY >= 534 && canvasY <= 642) {
      void resetSelectedCardOverlay(card);
      return;
    } else if (canvasY >= 662 && canvasY <= 770) {
      openShareDialog();
      return;
    }
  }

  // Clicking the body of the selected card zooms in/out for up-close inspection!
  toggleCardZoom();
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 && event.button !== 2) return;
  updatePointer(event);
  const hit = raycaster.intersectObjects(
    cards.flatMap((card) => card.group.children.slice(1)),
    false,
  )[0];
  const hitCard = hit ? cards.find((item) => item.id === hit.object.userData.cardId) : undefined;

  if (event.shiftKey || event.button === 2) {
    if (!hitCard) return;
    dragPlane.setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(new THREE.Vector3()),
      hitCard.group.position,
    );
    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
    drag = {
      card: hitCard,
      pointerId: event.pointerId,
      mode: "move",
      offset: hitCard.group.position.clone().sub(dragPoint),
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
      hitUv: hit?.uv ? hit.uv.clone() : undefined,
    };
  } else {
    // If grabbing the top (uv.y >= 0.55) or bottom (uv.y <= 0.45) of the center card:
    // initiate direct vertical card flip!
    const isCenter = hitCard && hitCard === selectedCard;
    const isTopOrBottom = isCenter && hit?.uv && (hit.uv.y >= 0.55 || hit.uv.y <= 0.45);

    drag = {
      card: hitCard,
      pointerId: event.pointerId,
      mode: isTopOrBottom ? "flip" : "carousel",
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
      hitUv: hit?.uv ? hit.uv.clone() : undefined,
    };
    dragStartTurntableAngle = turntableAngle;
    lastPointerX = event.clientX;
    lastPointerTime = performance.now();
    turntableVelocity = 0;
  }
  renderer.domElement.setPointerCapture(event.pointerId);
  renderer.domElement.style.cursor = "grabbing";
}

function onPointerMove(event: PointerEvent): void {
  if (!drag || drag.pointerId !== event.pointerId) {
    updatePointer(event);
    const hit = raycaster.intersectObjects(
      cards.flatMap((card) => card.group.children.slice(1)),
      false,
    )[0];
    renderer.domElement.style.cursor = hit ? "grab" : "default";
    return;
  }
  updatePointer(event);
  const now = performance.now();
  const dt = Math.max(0.001, (now - lastPointerTime) / 1000);
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  if (Math.hypot(dx, dy) > 5) {
    drag.moved = true;
  }
  if (!drag.moved) return;

  if (drag.mode === "move" && drag.card) {
    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
    drag.card.group.position.copy(dragPoint.add(drag.offset ?? new THREE.Vector3()));
    drag.card.group.position.x = THREE.MathUtils.clamp(drag.card.group.position.x, -7.2, 7.2);
    drag.card.group.position.y = THREE.MathUtils.clamp(drag.card.group.position.y, 2.18, 5.2);
    drag.card.group.position.z = THREE.MathUtils.clamp(drag.card.group.position.z, -4.2, 2.5);
    resolveCardCollisions(drag.card);
    drag.card.group.rotation.y = drag.card.targetRotation;
  } else if (drag.mode === "flip" && drag.card) {
    // 3D Vertical Peel: Grabbing top or bottom edge physically tilts card along X axis
    // Dragging downward (dy > 0): tilts top toward viewer
    // Dragging upward (dy < 0): tilts bottom toward viewer
    const tilt = THREE.MathUtils.clamp((dy / 140) * (Math.PI * 0.75), -Math.PI * 0.75, Math.PI * 0.75);
    drag.card.tiltX = tilt;
    drag.card.group.rotation.x = tilt;
    drag.card.layoutOffset.z = Math.abs(tilt) * 0.55;
  } else if (drag.mode === "carousel") {
    // If pointer started on center card and pulls vertically, switch into flip mode!
    if (drag.card === selectedCard && Math.abs(dy) > Math.abs(dx) * 1.2 && Math.abs(dy) > 10) {
      drag.mode = "flip";
      return;
    }

    // 1:1 Direct Tactile Turntable Rotation:
    const slotStep = getSlotStep();
    const anglePerPixel = slotStep / 280;

    const instantVel = ((event.clientX - drag.lastX) * anglePerPixel) / dt;
    turntableVelocity = turntableVelocity * 0.35 + instantVel * 0.65;
    lastPointerX = event.clientX;
    lastPointerTime = now;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;

    targetTurntableAngle = dragStartTurntableAngle + dx * anglePerPixel;
    turntableAngle = targetTurntableAngle; // Immediate solid 1:1 lock under pointer!
  }
}

function onPointerUp(event: PointerEvent): void {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const completedDrag = drag;
  drag = undefined;
  const dx = event.clientX - completedDrag.startX;
  const dy = event.clientY - completedDrag.startY;

  if (completedDrag.moved) {
    if (completedDrag.mode === "move" && completedDrag.card) {
      resolveCardCollisions(completedDrag.card);
      completedDrag.card.layoutOffset
        .copy(completedDrag.card.group.position)
        .sub(wheelPosition(cards.indexOf(completedDrag.card)));
    } else if (completedDrag.mode === "flip" && completedDrag.card) {
      completedDrag.card.layoutOffset.set(0, 0, 0);
      const threshold = 26;
      if (dy > threshold) {
        // Dragged downward: flip to top facet!
        flipCardTo(completedDrag.card, "top");
      } else if (dy < -threshold) {
        // Dragged upward: flip to bottom facet!
        flipCardTo(completedDrag.card, "bottom");
      } else {
        // Released without threshold: spring back flat!
        completedDrag.card.tiltX = 0;
      }
    } else if (completedDrag.mode === "carousel") {
      const slotStep = getSlotStep();
      const flingOffset = THREE.MathUtils.clamp(turntableVelocity * 0.16, -slotStep * 1.5, slotStep * 1.5);
      const projected = turntableAngle + flingOffset;
      targetTurntableAngle = Math.round(projected / slotStep) * slotStep;

      if (completedDrag.card === selectedCard && Math.abs(dy) > 36 && Math.abs(dy) > Math.abs(dx)) {
        flipCardTo(completedDrag.card, dy > 0 ? "top" : "bottom");
      }
    }
  } else {
    // Clean click / tap without dragging
    if (completedDrag.card) {
      if (completedDrag.card !== selectedCard) {
        // Clicking any flanking card smoothly glides it to center!
        selectCard(completedDrag.card, true);
      } else if (completedDrag.hitUv) {
        const uv = completedDrag.hitUv;
        // Directional edge clicks:
        if (uv.y >= 0.72) {
          flipCardTo(completedDrag.card, "top");
        } else if (uv.y <= 0.28) {
          flipCardTo(completedDrag.card, "bottom");
        } else if (uv.x <= 0.16) {
          flipCardTo(completedDrag.card, "left");
        } else if (uv.x >= 0.84) {
          flipCardTo(completedDrag.card, "right");
        } else {
          handleCardClick(completedDrag.card, uv);
        }
      }
    } else if (cardZoomed) {
      toggleCardZoom(false);
    }
  }
  renderer.domElement.style.cursor = "grab";
  if (renderer.domElement.hasPointerCapture(event.pointerId)) {
    renderer.domElement.releasePointerCapture(event.pointerId);
  }
}

function onWheel(event: WheelEvent): void {
  if (!event.deltaY || cards.length < 2) return;
  event.preventDefault();
  const now = performance.now();
  wheelAccumulator += event.deltaY;

  // Smooth wheel debounce & accumulator: steps exactly 1 card slot cleanly per stroke
  const threshold = 36;
  if (Math.abs(wheelAccumulator) >= threshold && now - lastWheelStepTime > 140) {
    const dir: 1 | -1 = wheelAccumulator > 0 ? 1 : -1;
    wheelAccumulator = 0;
    lastWheelStepTime = now;
    cycleCarousel(dir, false);
  }
}

function onCanvasKeyDown(event: KeyboardEvent): void {
  if (event.altKey || event.ctrlKey || event.metaKey || cards.length === 0) return;
  if (tourActive && event.key !== "Escape" && event.key.toLowerCase() !== "t") {
    return;
  }

  if (selectedCard && event.shiftKey) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      flipCardTo(selectedCard, "top");
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      flipCardTo(selectedCard, "bottom");
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      flipCardTo(selectedCard, "left");
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      flipCardTo(selectedCard, "right");
      return;
    }
  }

  if (selectedCard) {
    const lower = event.key.toLowerCase();
    if (lower === "w") {
      event.preventDefault();
      flipCardTo(selectedCard, "top");
      return;
    }
    if (lower === "s") {
      event.preventDefault();
      flipCardTo(selectedCard, "bottom");
      return;
    }
    if (lower === "a") {
      event.preventDefault();
      flipCardTo(selectedCard, "left");
      return;
    }
    if (lower === "d") {
      event.preventDefault();
      flipCardTo(selectedCard, "right");
      return;
    }
    if (lower === "f") {
      event.preventDefault();
      cycleCardFacet(selectedCard, 1);
      return;
    }
    if (lower === "z") {
      event.preventDefault();
      toggleCardZoom();
      return;
    }
    if (lower === "t") {
      event.preventDefault();
      if (tourActive) {
        stopGuidedTour();
        if (isTourRecording) stopTourRecording();
      } else {
        startGuidedTour();
      }
      return;
    }
    if (event.key === "Escape" && (cardZoomed || tourActive)) {
      event.preventDefault();
      if (tourActive) {
        stopGuidedTour();
        if (isTourRecording) stopTourRecording();
      } else {
        toggleCardZoom(false);
      }
      return;
    }
    if (event.key >= "1" && event.key <= "6") {
      event.preventDefault();
      const idx = Number(event.key) - 1;
      flipCardTo(selectedCard, FACET_ORDER[idx]);
      return;
    }
  }

  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    event.preventDefault();
    cycleCarousel(1, true);
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    event.preventDefault();
    cycleCarousel(-1, true);
  } else if (event.key === "Home") {
    event.preventDefault();
    selectCard(cards[0], true);
  } else if (event.key === "End") {
    event.preventDefault();
    selectCard(cards[cards.length - 1], true);
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (selectedCard) cycleCardFacet(selectedCard, 1);
  }
}

function onDoubleClick(event: MouseEvent): void {
  updatePointer(event);
  const hit = raycaster.intersectObjects(
    cards.flatMap((card) => card.group.children.slice(1)),
    false,
  )[0];
  if (!hit) return;
  const card = cards.find((item) => item.id === hit.object.userData.cardId);
  if (card) cycleCardFacet(card, 1);
}

function updatePointer(event: Pick<PointerEvent, "clientX" | "clientY"> | MouseEvent): void {
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function sendPaperPlane(
  from: SystemCard,
  target: SystemCard | undefined,
  message: string,
  remoteTarget = "",
): void {
  if (airplane) {
    scene.remove(airplane.mesh);
    airplane = undefined;
  }

  const destinationLabel = target
    ? remoteTarget
      ? `${target.name} + ${remoteTarget}`
      : target.name
    : remoteTarget || "Live Network Catch";
  from.sentNotes.push(`→ ${destinationLabel}: ${message}`);
  refreshCardTexture(from);

  const mesh = new THREE.Group();
  const paper = new THREE.Mesh(airplaneGeometry, airplaneMaterial);
  mesh.add(paper);
  mesh.add(new THREE.PointLight("#FFB81C", 1.6, 3));
  scene.add(mesh);

  const start = from.group.position.clone();
  start.z += 0.5;
  const end = target
    ? target.group.position.clone().add(new THREE.Vector3(0, 0, 0.5))
    : new THREE.Vector3(0, 4.8, -5.5);
  airplane = {
    mesh,
    from: start,
    to: end,
    startedAt: performance.now(),
    duration: reduceMotion ? 1 : 1050,
    fromCard: from,
    target,
    remoteTarget: remoteTarget || undefined,
    rawMessage: message,
    message: `← ${from.name}: ${message}`,
  };
  showToast(`Paper plane folded for ${destinationLabel}…`);
}

async function deliverPaperPlaneToBackend(
  fromCard: SystemCard,
  targetCard: SystemCard | undefined,
  rawMessage: string,
  remoteTarget = "",
): Promise<void> {
  const os = !targetCard ? "remote" : cardToGuestOs(targetCard);
  const toCardId = targetCard ? targetCard.id : "remote-peer";
  const targetLabel = targetCard ? targetCard.name : remoteTarget || "Live Network";
  try {
    const status = await requestGuestApi("/api/guest/paper-plane", {
      fromCardId: fromCard.id,
      toCardId,
      os,
      message: rawMessage,
      remoteTarget,
    });
    updateGuestCardStatus(status);
    const latest = status.paperPlanes
      ?.filter((plane) => plane.toCardId === toCardId)
      .slice(-1)[0];
    if (latest?.deliveredToRemote && latest?.deliveredToVm) {
      showToast(
        `Delivered to live computer (${latest.remoteDeliveryInfo}) & typed into ${targetLabel} VM!`,
      );
    } else if (latest?.deliveredToRemote) {
      showToast(
        `Paper plane delivered across network to live computer (${latest.remoteDeliveryInfo})!`,
      );
    } else if (latest?.deliveredToVm) {
      showToast(
        `Paper plane landed on ${targetLabel} & typed into live VM via QMP!`,
      );
    } else if (!targetCard) {
      showToast(
        "Paper plane spooled for any live computer via /api/guest/paper-plane/catch!",
      );
    } else {
      showToast(
        `Paper plane spooled to ${targetLabel} (facet 04 · PLANES).`,
      );
    }
  } catch (error) {
    reportGuestError(error);
  }
}

function updateAirplane(now: number): void {
  if (!airplane) return;
  const progress = THREE.MathUtils.clamp((now - airplane.startedAt) / airplane.duration, 0, 1);
  const eased = progress * progress * (3 - 2 * progress);
  const position = airplane.from.clone().lerp(airplane.to, eased);
  position.y += Math.sin(progress * Math.PI) * 1.15;
  airplane.mesh.position.copy(position);
  airplane.mesh.rotation.z = -Math.atan2(
    airplane.to.y - airplane.from.y,
    airplane.to.x - airplane.from.x,
  );
  airplane.mesh.rotation.y = Math.sin(progress * Math.PI) * 0.32;

  if (progress >= 1) {
    const deliveredFrom = airplane.fromCard;
    const deliveredTarget = airplane.target;
    const deliveredRemote = airplane.remoteTarget ?? "";
    const rawMessage = airplane.rawMessage;
    if (deliveredTarget) {
      deliveredTarget.receivedNotes.push(airplane.message);
      refreshCardTexture(deliveredTarget);
    }
    scene.remove(airplane.mesh);
    airplane = undefined;
    void deliverPaperPlaneToBackend(
      deliveredFrom,
      deliveredTarget,
      rawMessage,
      deliveredRemote,
    );
  }
}

function showToast(message: string): void {
  toastElement.textContent = message;
  toastElement.classList.add("visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toastElement.classList.remove("visible"), 2700);
}

function resize(): void {
  const width = sceneElement.clientWidth;
  const height = sceneElement.clientHeight;
  if (width < 1 || height < 1) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  const pixelRatioCap =
    studioGraphicsProfile === "performance"
      ? 0.85
      : studioGraphicsProfile === "balanced"
        ? width < 720
          ? 1.25
          : 1.5
        : 1.75;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
  renderer.setSize(width, height, false);
}

function applyStudioGraphicsProfile(profile: GraphicsProfile): void {
  studioGraphicsProfile = profile;
  renderer.shadowMap.enabled = profile !== "performance";
  resize();
  for (const card of cards) {
    refreshCardTexture(card);
  }
  showToast(
    profile === "performance"
      ? "Studio performance mode enabled · lower render resolution, shadows off."
      : profile === "quality"
        ? "Studio high-fidelity mode enabled · full render resolution and shadows."
        : "Studio balanced graphics enabled.",
  );
}

function startGuidedTour(): void {
  tourActive = true;
  tourStartTime = performance.now();
  tourStage = 0;
  tourPaperPlaneFired = false;
  tourPerformanceSwitched = false;
  tourSecOpsSwitched = false;
  tourButtonElement.classList.add("active");
  tourButtonElement.textContent = "⏹️ STOP TOUR";
  tourOverlayElement.hidden = false;
  tourStatusLabelElement.textContent = isTourRecording ? "RECORDING 60FPS" : "AUTONOMOUS DEMO";
  showToast("🎬 Launching Autonomous Guided Tour (62s)…");
}

function stopGuidedTour(): void {
  tourActive = false;
  tourCameraOverridePos = null;
  tourCameraOverrideLook = null;
  tourButtonElement.classList.remove("active");
  tourButtonElement.textContent = "🎬 GUIDED TOUR";
  tourOverlayElement.hidden = true;
  if (cardZoomed) toggleCardZoom(false);
  if (selectedCard && selectedCard.facet !== "front") flipCardTo(selectedCard, "front");
  if (secOpsMode) toggleSecOpsLabMode();
}

let activeCaptureStream: MediaStream | null = null;

function startTourRecording(): void {
  const canvas = renderer.domElement as HTMLCanvasElement & {
    captureStream?: (fps?: number) => MediaStream;
  };
  if (typeof MediaRecorder === "undefined" || !canvas.captureStream) {
    showToast("Media recording is not supported in this browser environment.");
    return;
  }
  
  try {
    activeCaptureStream = canvas.captureStream(60);
  } catch {
    showToast("Failed to initialize canvas capture stream.");
    return;
  }

  recordedChunks = [];
  const stream = activeCaptureStream;

  try {
    mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
  } catch {
    try {
      mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    } catch {
      mediaRecorder = new MediaRecorder(stream);
    }
  }

  mediaRecorder.onerror = (event: Event) => {
    console.error("MediaRecorder pipeline error:", event);
    showToast("⚠️ Recording error occurred; stopping capture.");
    stopTourRecording();
  };

  mediaRecorder.ondataavailable = (event: BlobEvent) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = () => {
    if (activeCaptureStream) {
      activeCaptureStream.getTracks().forEach((track) => track.stop());
      activeCaptureStream = null;
    }
    if (recordedChunks.length > 0) {
      const blob = new Blob(recordedChunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `postcard-spatial-os-tour-${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("🎥 Tour video recording saved & downloaded! (60 FPS WebM)");
    }
    isTourRecording = false;
    recordTourButtonElement.classList.remove("recording");
    recordTourButtonElement.textContent = "🎥 RECORD TOUR";
  };

  mediaRecorder.start(250);
  isTourRecording = true;
  recordTourButtonElement.classList.add("recording");
  recordTourButtonElement.textContent = "⏹️ STOP RECORDING";
}

function stopTourRecording(): void {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  if (activeCaptureStream) {
    activeCaptureStream.getTracks().forEach((track) => track.stop());
    activeCaptureStream = null;
  }
  isTourRecording = false;
  recordTourButtonElement.classList.remove("recording");
  recordTourButtonElement.textContent = "🎥 RECORD TOUR";
}

function updateTour(now: number, dt: number): void {
  if (!tourActive) return;
  const elapsed = (now - tourStartTime) / 1000;
  const totalDuration = 62;

  const progressPercent = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
  tourProgressFillElement.style.width = `${progressPercent.toFixed(1)}%`;

  if (elapsed < 8) {
    // Stage 1: Sanctuary & Dais Reveal
    if (tourStage !== 1) {
      tourStage = 1;
      tourStepBadgeElement.textContent = "TOUR 01 / 07 · SANCTUARY & DAIS";
      tourStepTitleElement.textContent = "The Spatial Sanctuary & Dais";
      tourStepDescElement.textContent = "Twin Neural Monoliths, Cosmic Dais & Overhead Chandelier with ambient motes.";
      showToast("✦ Tour 1/7: Sanctuary Architecture & Dais Reveal");
    }
    const t = elapsed / 8;
    const camX = Math.sin(t * Math.PI * 0.5) * 5.0;
    const camY = 6.8 - t * 3.6;
    const camZ = 16.0 - t * 3.8;
    tourCameraOverridePos = new THREE.Vector3(camX, camY, camZ);
    tourCameraOverrideLook = new THREE.Vector3(0, 2.68, 0.25);
  } else if (elapsed < 18) {
    // Stage 2: 3D Spatial Carousel Orbit
    if (tourStage !== 2) {
      tourStage = 2;
      tourCameraOverridePos = null;
      tourCameraOverrideLook = null;
      tourStepBadgeElement.textContent = "TOUR 02 / 07 · MULTI-OS MATRIX";
      tourStepTitleElement.textContent = "3D Spatial Multi-OS Carousel";
      tourStepDescElement.textContent = "Continuous turntable hosting Windows 11, Linux, Android, macOS, Kali & Post Card OS.";
      showToast("✦ Tour 2/7: 3D Spatial Carousel Orbit");
    }
    targetTurntableAngle += dt * 0.85;
  } else if (elapsed < 27) {
    // Stage 3: Zoom-in Inspection & 6-Way Flips
    if (tourStage !== 3) {
      tourStage = 3;
      const inspectCard = cards.find((c) => c.id === "linux") ?? cards[0];
      selectCard(inspectCard);
      toggleCardZoom(true);
      tourStepBadgeElement.textContent = "TOUR 03 / 07 · 6-WAY FACETS";
      tourStepTitleElement.textContent = "Hexagonal Facets & Telemetry Inspection";
      tourStepDescElement.textContent = "Live Display (01), Hardware Settings (02), Security Isolation (03) & Telemetry (06).";
      showToast("✦ Tour 3/7: Zoom-in Inspection & 6-Way Card Flips");
    }
    if (selectedCard) {
      if (elapsed >= 18.5 && elapsed < 21.0 && selectedCard.facet !== "back") {
        flipCardTo(selectedCard, "back");
      } else if (elapsed >= 21.0 && elapsed < 23.5 && selectedCard.facet !== "left") {
        flipCardTo(selectedCard, "left");
      } else if (elapsed >= 23.5 && elapsed < 26.5 && selectedCard.facet !== "bottom") {
        flipCardTo(selectedCard, "bottom");
      }
    }
  } else if (elapsed < 36) {
    // Stage 4: 3D Paper Airplane Courier & SHA-256 Hash Delivery
    if (tourStage !== 4) {
      tourStage = 4;
      if (cardZoomed) toggleCardZoom(false);
      if (selectedCard && selectedCard.facet !== "front") flipCardTo(selectedCard, "front");
      tourStepBadgeElement.textContent = "TOUR 04 / 07 · 3D COURIER";
      tourStepTitleElement.textContent = "3D Paper Airplane Courier & SHA-256 Provenance";
      tourStepDescElement.textContent = "Cryptographic payload flight across isolated VMs with SHA-256 hash-chain receipt.";
      showToast("✦ Tour 4/7: 3D Paper Airplane Courier Flight");
    }
    if (!tourPaperPlaneFired && elapsed >= 28.0) {
      tourPaperPlaneFired = true;
      const senderCard = cards.find((c) => c.id === "linux") ?? cards[0];
      const targetCard = cards.find((c) => c.id === "postcard-os") ?? cards[1];
      sendPaperPlane(senderCard, targetCard, "DEPLOY_KERNEL_IMAGE: SHA256_e85250d6a4c21980");
    }
  } else if (elapsed < 45) {
    // Stage 5: Gamer Performance Suite
    if (tourStage !== 5) {
      tourStage = 5;
      tourStepBadgeElement.textContent = "TOUR 05 / 07 · GAMER PERFORMANCE";
      tourStepTitleElement.textContent = "Gamer Performance Suite & Ray-Casting";
      tourStepDescElement.textContent = "High-Fidelity 3D shadows, 4 vCPU Hyper-Threading & dynamic GPU profiling.";
      showToast("✦ Tour 5/7: Gamer Performance Suite Activated");
    }
    if (!tourPerformanceSwitched && elapsed >= 37.0) {
      tourPerformanceSwitched = true;
      applyStudioGraphicsProfile("quality");
    }
  } else if (elapsed < 53) {
    // Stage 6: SecOps Cyber Range
    if (tourStage !== 6) {
      tourStage = 6;
      tourStepBadgeElement.textContent = "TOUR 06 / 07 · SECOPS CYBER RANGE";
      tourStepTitleElement.textContent = "SecOps Cyber Range & Penetration Lab";
      tourStepDescElement.textContent = "Isolated VLAN lab, automated port enumeration, privilege posture & audit playbooks.";
      showToast("✦ Tour 6/7: SecOps Cyber Range Activated");
    }
    if (!tourSecOpsSwitched && elapsed >= 46.0) {
      tourSecOpsSwitched = true;
      if (!secOpsMode) toggleSecOpsLabMode();
      const kaliCard = cards.find((c) => c.id === "kali-red");
      if (kaliCard) selectCard(kaliCard);
    }
  } else if (elapsed < totalDuration) {
    // Stage 7: Post Card Spatial OS & Bare-Metal Vault
    if (tourStage !== 7) {
      tourStage = 7;
      if (secOpsMode) toggleSecOpsLabMode();
      const postcardCard = cards.find((c) => c.id === "postcard-os") ?? cards[0];
      selectCard(postcardCard);
      toggleCardZoom(true);
      tourStepBadgeElement.textContent = "TOUR 07 / 07 · POST CARD SPATIAL OS";
      tourStepTitleElement.textContent = "Bare-Metal Microkernel & Secure Vault";
      tourStepDescElement.textContent = "Ring 0 Multiboot2 microkernel, Ring 3 isolation & VFIO Secure Vault hardware passthrough.";
      showToast("✦ Tour 7/7: Post Card Spatial OS & Bare-Metal Vault");
    }
  } else {
    stopGuidedTour();
    if (isTourRecording) stopTourRecording();
    showToast("🎬 Guided Tour complete! Enjoy exploring Post Card Spatial OS.");
  }
}

let lastFrameTime = 0;

function animate(now = 0): void {
  requestAnimationFrame(animate);
  const dt = lastFrameTime > 0 ? Math.min(0.05, (now - lastFrameTime) / 1000) : 1 / 60;
  lastFrameTime = now;

  // Smoothly damp turntable towards target with organic spring ease
  if (drag?.mode === "carousel") {
    // Locked 1:1 under pointer while dragging
  } else {
    turntableAngle = THREE.MathUtils.damp(turntableAngle, targetTurntableAngle, 8.5, dt);
  }

  const slotStep = getSlotStep();
  let closestCard: SystemCard = cards[0];
  let minAbsAngle = Infinity;

  for (const [index, card] of cards.entries()) {
    if (drag?.card === card && drag.mode === "move") continue;

    const slotAngle = index * slotStep;
    card.orbitAngle = normalizeAngle(slotAngle + turntableAngle);

    if (Math.abs(card.orbitAngle) < minAbsAngle) {
      minAbsAngle = Math.abs(card.orbitAngle);
      closestCard = card;
    }

    const targetPosition = orbitPositionFromAngle(card.orbitAngle).add(card.layoutOffset);

    // Physical depth scaling: foreground hero card is 100% scale, flanking cards scale to 88%
    const depthFactor = 0.5 + 0.5 * Math.cos(card.orbitAngle);
    const targetScale = 0.88 + 0.12 * depthFactor;
    card.group.scale.set(targetScale, targetScale, targetScale);

    // Handle smooth physical flip animation (520ms S-curve ease-in-out)
    if (card.flipAnim) {
      const elapsed = now - card.flipAnim.startTime;
      const t = Math.min(1, Math.max(0, elapsed / card.flipAnim.duration));
      // Cubic ease-in-out S-curve: starts at 0 speed, peaks at 90 deg, eases softly into rest
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      card.group.rotation.y = card.flipAnim.startRotationY + (card.flipAnim.targetRotationY - card.flipAnim.startRotationY) * eased;

      // Dynamic physical arc lift during turn (floats toward viewer)
      const arc = Math.sin(t * Math.PI);
      targetPosition.z += arc * 0.48;
      targetPosition.y += arc * 0.12;

      // Human corner flex / tilt
      if (card.flipAnim.tiltAxis === "x") {
        const pitchDirection = card.flipAnim.targetFacet === "top" ? -1 : 1;
        // Dramatic 3D vertical coin/card tumble peaking at 90 deg edge-on!
        card.group.rotation.x = Math.sin(t * Math.PI) * pitchDirection * (Math.PI * 0.5);
      } else {
        card.group.rotation.z = arc * (card.flipAnim.tiltDir * 0.22);
      }

      if (t >= 0.5 && !card.flipAnim.midpointPassed) {
        card.flipAnim.midpointPassed = true;
        card.facet = card.flipAnim.targetFacet;
        card.backFaceVisible = !card.backFaceVisible;
        if (card === selectedCard) {
          updateFacetBarUI();
          selectedNameElement.textContent = `${card.name} · ${FACET_META[card.facet].badge}`;
        }
      }

      if (t >= 1) {
        card.group.rotation.y = card.flipAnim.targetRotationY;
        card.flipAnim = undefined;
      }
    } else {
      const targetRotationY = -0.55 * Math.sin(card.orbitAngle) + card.targetRotation;
      if (reduceMotion) {
        card.group.rotation.y = targetRotationY;
        card.tiltX = 0;
        card.tiltZ = 0;
      } else {
        card.group.rotation.y = THREE.MathUtils.damp(card.group.rotation.y, targetRotationY, 8.5, dt);
        card.tiltX = THREE.MathUtils.damp(card.tiltX, 0, 7, dt);
        card.tiltZ = THREE.MathUtils.damp(card.tiltZ, 0, 7, dt);
        card.group.rotation.x = THREE.MathUtils.damp(card.group.rotation.x, card.tiltX, 11, dt);
        card.group.rotation.z = THREE.MathUtils.damp(card.group.rotation.z, card.tiltZ, 11, dt);
      }
    }

    if (reduceMotion) {
      card.group.position.copy(targetPosition);
    } else {
      card.group.position.x = THREE.MathUtils.damp(card.group.position.x, targetPosition.x, 9.0, dt);
      card.group.position.y = THREE.MathUtils.damp(card.group.position.y, targetPosition.y, 9.0, dt);
      card.group.position.z = THREE.MathUtils.damp(card.group.position.z, targetPosition.z, 9.0, dt);
    }
    card.group.position.y = Math.max(card.group.position.y, 2.05);
  }

  // Update front-center selection when the carousel rotates to a new front card
  if (closestCard !== selectedCard && minAbsAngle < 0.28) {
    selectedCard = closestCard;
    selectedIndex = cards.indexOf(closestCard);
    updateGuestActionButton();
    updateFacetBarUI();
    const tier = getCardTier(closestCard);
    selectedTierElement.textContent = tier;
    selectedTierElement.className = `tier-badge tier-badge-${tier.toLowerCase()}`;
    selectedNameElement.textContent = `${closestCard.name} · ${FACET_META[closestCard.facet].badge}`;
    sceneCardIndexElement.textContent = String(selectedIndex + 1).padStart(2, "0");
    for (const item of cards) {
      const edge = item.group.children[0];
      const material = edge instanceof THREE.Mesh ? edge.material : undefined;
      if (material instanceof THREE.MeshStandardMaterial) {
        material.emissive.set(item === closestCard ? "#FFB81C" : "#000000");
        material.emissiveIntensity = item === closestCard ? 0.45 : 0;
      }
    }
  }

  if (drag?.mode === "move") {
    resolveCardCollisions(drag.card);
  }

  updateTour(now, dt);

  const desiredCamPos =
    tourActive && tourCameraOverridePos
      ? tourCameraOverridePos
      : cardZoomed && selectedCard
        ? new THREE.Vector3(
            selectedCard.group.position.x,
            selectedCard.group.position.y + 0.12,
            selectedCard.group.position.z + 3.55,
          )
        : new THREE.Vector3(0, 3.18, 12.2);
  const desiredLookAt =
    tourActive && tourCameraOverrideLook
      ? tourCameraOverrideLook
      : cardZoomed && selectedCard
        ? new THREE.Vector3(
            selectedCard.group.position.x,
            selectedCard.group.position.y + 0.12,
            selectedCard.group.position.z,
          )
        : new THREE.Vector3(0, 2.68, 0.25);

  if (reduceMotion) {
    camera.position.copy(desiredCamPos);
    cameraLookTarget.copy(desiredLookAt);
  } else {
    camera.position.x = THREE.MathUtils.damp(camera.position.x, desiredCamPos.x, 8.5, dt);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, desiredCamPos.y, 8.5, dt);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, desiredCamPos.z, 8.5, dt);
    cameraLookTarget.x = THREE.MathUtils.damp(cameraLookTarget.x, desiredLookAt.x, 9.5, dt);
    cameraLookTarget.y = THREE.MathUtils.damp(cameraLookTarget.y, desiredLookAt.y, 9.5, dt);
    cameraLookTarget.z = THREE.MathUtils.damp(cameraLookTarget.z, desiredLookAt.z, 9.5, dt);
  }
  camera.lookAt(cameraLookTarget);

  updateAirplane(now);
  overheadHaloGroup.rotation.y = now * 0.00012;
  studioMotes.rotation.y = -now * 0.00008;
  cosmicStarfield.rotation.y = -now * 0.00002;
  starMaterial.size = 0.088 + 0.012 * Math.sin(now * 0.0016);
  for (const [idx, mat] of monolithLedMats.entries()) {
    mat.emissiveIntensity = 0.55 + 0.4 * Math.sin(now * 0.0022 + idx * 0.7);
  }
  renderer.render(scene, camera);
}

animate();
