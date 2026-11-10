import * as THREE from "three";
import RFB from "@novnc/novnc";
import "./style.css";
import {
  attachCarouselWheelListener,
  createWheelCarouselHandler,
} from "./carousel-wheel";
import {
  getOnCardActionState,
  routeOnCardAction,
  runConfirmedCardDeletion,
  type OnCardAction,
} from "./card-actions";
import { carouselPoseFromAngle } from "./carousel-pose";
import { CARD_BUTTON_IDS, cardButtonRect, hitCardButton, type CardButtonId } from "./card-buttons";
import {
  BUTLER_CHOICE_LABELS,
  CHECK_IN_COOLDOWN_SECONDS,
  SNOOZE_SECONDS,
  butlerAnswer,
  butlerCheckIn,
  butlerGreeting,
  butlerInterpretPrompt,
  generateDeckOpml,
  type ButlerChoiceId,
  type ButlerContext,
} from "./butler";
import { BLUEPRINTS } from "./blueprints";
import { createFreeplaneTutorialMindMap, stringifyFreeplaneMap } from "./freeplane-engine";
import {
  DEFAULT_KERNEL_TELEMETRY,
  applyTelemetryToDom,
  renderNativeHudToCanvas,
  type KernelTelemetryPacket,
} from "./native-hud";

/**
 * Windows "Animation effects: off" makes browsers report prefers-reduced-motion,
 * which turned the 3D carousel into instant 2D-looking swaps. Motion is how the
 * studio communicates, so reduced motion is an explicit opt-in under Performance.
 */
const REDUCE_MOTION_KEY = "postcard-reduce-motion";
let reduceMotionOptIn = (() => {
  try {
    return localStorage.getItem(REDUCE_MOTION_KEY) === "1";
  } catch {
    return false;
  }
})();
function prefersReducedMotion(): boolean {
  return reduceMotionOptIn;
}

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
  stderr?: string;
  websocketPort: number | null;
  qmpPort: number | null;
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
  deletedCardIds: string[];
  allocatedCardId?: string;
  preparedCardIds: string[];
  preparedWindowsCardIds: string[];
  installedWindowsCardIds?: string[];
  guests: GuestStatus[];
  paperPlanes?: PaperPlaneRecord[];
  checkpoints?: Record<string, CheckpointRecord>;
  networkModes?: Record<string, "nat" | "cyber-range" | "airgap">;
  memoryProfiles?: Record<string, "eco" | "balanced" | "performance">;
  cpuProfiles?: Record<string, CpuProfile>;
  customIsos?: Record<string, string>;
  cpuCapacity?: number;
  aiResult?: AiCommandResult;
  swarmResult?: { sourceCardId: string; os: string; createdCardIds: string[] };
  serialExecResult?: { cardId: string; os: string; command: string; output: string };
  telemetry?: KernelTelemetryPacket;
};

let latestKernelTelemetry: KernelTelemetryPacket = { ...DEFAULT_KERNEL_TELEMETRY };

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
  statusLedMat?: THREE.MeshStandardMaterial;
  statusLedMesh?: THREE.Mesh;
  removable?: boolean;
  layoutOffset: THREE.Vector3;
  layoutPosition: THREE.Vector3;
  orbitAngle: number;
  lastTextureKey?: string;
  /** 0..1 corner-peel amount while the display corner is being pulled. */
  peel?: number;
  /** Whether this card's display port is twisted bigger while pulled to the front. */
  twisted?: boolean;
  /** 0..1 eased twist expansion amount in 3D space. */
  twistAmount?: number;
  /** Cards stay soft-focus until they settle at the front of the ring. */
  revealed?: boolean;
  /** 1 = fully blurred, 0 = sharp; eased every frame. */
  blurLevel?: number;
  /** Quantized blur step last rendered into the texture. */
  blurStep?: number;
  cachedContentKey?: string;
  cachedSharpTexture?: THREE.CanvasTexture;
  cachedBlurredTexture?: THREE.CanvasTexture;
  flipAnim?: {
    startRotationY: number;
    startRotationX?: number;
    targetRotationY: number;
    startTime: number;
    duration: number;
    midpointPassed: boolean;
    targetFacet: CardFacet;
    tiltDir: number;
    tiltAxis: "x" | "z";
  };
};

type CardDefinition = Pick<
  SystemCard,
  "id" | "name" | "os" | "detail" | "color" | "status" | "clonedFrom" | "removable"
>;
type BinnedCardRecord = CardDefinition & { index: number };
type BinnedCardEntry = {
  record: BinnedCardRecord;
  card?: SystemCard;
  restoreState?: TrashRestoreState;
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
    accent: "#62d8d0",
  },
  back: {
    badge: "02 / 06",
    header: "CARD SETTINGS",
    shortLabel: "settings",
    accent: "#c5a9ff",
  },
  left: {
    badge: "03 / 06",
    header: "SECURITY & ISOLATION",
    shortLabel: "security",
    accent: "#8caef4",
  },
  right: {
    badge: "04 / 06",
    header: "PAPER PLANES",
    shortLabel: "paper planes",
    accent: "#f0a7a3",
  },
  top: {
    badge: "05 / 06",
    header: "QUICK ACTIONS",
    shortLabel: "quick actions",
    accent: "#9b9eff",
  },
  bottom: {
    badge: "06 / 06",
    header: "TELEMETRY & PORTS",
    shortLabel: "telemetry",
    accent: "#77d2e8",
  },
};

const container = document.querySelector<HTMLDivElement>("#scene");
const sceneShell = document.querySelector<HTMLElement>("#room");
const studioView = document.querySelector<HTMLElement>("#studio-view");
const facetBar = document.querySelector<HTMLElement>("#facet-bar");
const roomCardNav = document.querySelector<HTMLElement>("#room-card-nav");
const roomCardSummary = document.querySelector<HTMLElement>("#room-card-summary");
const roomSelectedName = document.querySelector<HTMLElement>("#room-selected-name");
const roomSelectedStatus = document.querySelector<HTMLElement>("#room-selected-status");
const cardActionStrip = document.querySelector<HTMLElement>("#card-action-strip");
const cardGuestAction = document.querySelector<HTMLButtonElement>("#card-guest-action");
const cardShutdownAction = document.querySelector<HTMLButtonElement>("#card-shutdown-action");
const cardSettingsAction = document.querySelector<HTMLButtonElement>("#card-settings-action");
const cardBinAction = document.querySelector<HTMLButtonElement>("#card-bin-action");
const cardDeleteAction = document.querySelector<HTMLButtonElement>("#card-delete-action");
const benchToggle = document.querySelector<HTMLButtonElement>("#bench-toggle");
const secopsToggle = document.querySelector<HTMLButtonElement>("#secops-toggle");
const omniForm = document.querySelector<HTMLFormElement>("#omni-form");
const omniInput = document.querySelector<HTMLInputElement>("#omni-input");
const secopsChips = document.querySelector<HTMLDivElement>("#secops-chips");
const horizonChips = document.querySelector<HTMLDivElement>("#horizon-chips");
const omniChips = document.querySelector<HTMLDivElement>("#omni-chips") ?? horizonChips;
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
const cloneButton = document.querySelector<HTMLButtonElement>("#clone-button");
const resetButton = document.querySelector<HTMLButtonElement>("#reset-button");
const sendButton = document.querySelector<HTMLButtonElement>("#send-button");
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
const profileControl = document.querySelector<HTMLElement>("#profile-control");
const profileButton = document.querySelector<HTMLButtonElement>("#profile-button");
const profilePopover = document.querySelector<HTMLElement>("#profile-popover");
const profileMenuName = document.querySelector<HTMLElement>("#profile-menu-name");
const profileMenuInitials = document.querySelector<HTMLElement>("#profile-menu-initials");
const profileEditOption = document.querySelector<HTMLButtonElement>("#profile-edit-option");
const profilePerformanceOption = document.querySelector<HTMLButtonElement>("#profile-performance-option");
const profileHelpOption = document.querySelector<HTMLButtonElement>("#profile-help-option");
const profileAboutOption = document.querySelector<HTMLButtonElement>("#profile-about-option");
const profileEditDialog = document.querySelector<HTMLDialogElement>("#profile-edit-dialog");
const profileEditForm = document.querySelector<HTMLFormElement>("#profile-edit-form");
const profileNameInput = document.querySelector<HTMLInputElement>("#profile-name-input");
const profileInitialsInput = document.querySelector<HTMLInputElement>("#profile-initials-input");
const profileEditError = document.querySelector<HTMLElement>("#profile-edit-error");
const profileAboutDialog = document.querySelector<HTMLDialogElement>("#profile-about-dialog");
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
const guestWakeScreenButton = document.querySelector<HTMLButtonElement>("#guest-wake-screen");
const guestSavepointButton = document.querySelector<HTMLButtonElement>("#guest-savepoint");
const guestRewindButton = document.querySelector<HTMLButtonElement>("#guest-rewind");
const guestRestoreCheckpointButton = document.querySelector<HTMLButtonElement>("#guest-restore-checkpoint");
const guestCustomIsoButton = document.querySelector<HTMLButtonElement>("#guest-custom-iso");
const guestPasteClipboardButton = document.querySelector<HTMLButtonElement>("#guest-paste-clipboard");
const customIsoButton = document.querySelector<HTMLButtonElement>("#custom-iso-button");
const addCardDialog = document.querySelector<HTMLDialogElement>("#add-card-dialog");
const addCardForm = document.querySelector<HTMLFormElement>("#add-card-form");
const addCardTemplateSelect = document.querySelector<HTMLSelectElement>("#add-card-template");
const addCardNameInput = document.querySelector<HTMLInputElement>("#add-card-name");
const addCardIsoInput = document.querySelector<HTMLInputElement>("#add-card-iso");
const guestShutdownButton = document.querySelector<HTMLButtonElement>("#guest-shutdown");
const guestForceStopButton = document.querySelector<HTMLButtonElement>("#guest-force-stop");
const toast = document.querySelector<HTMLDivElement>("#toast");
const trashTarget = document.querySelector<HTMLButtonElement>("#trash-target");
const binCount = document.querySelector<HTMLElement>("#bin-count");
const binDialog = document.querySelector<HTMLDialogElement>("#bin-dialog");
const binList = document.querySelector<HTMLOListElement>("#bin-card-list");
const binEmpty = document.querySelector<HTMLElement>("#bin-empty");
const binCloseButton = document.querySelector<HTMLButtonElement>("#bin-close");
const trashDialog = document.querySelector<HTMLDialogElement>("#trash-dialog");
const trashCardName = document.querySelector<HTMLElement>("#trash-card-name");
const trashCardId = document.querySelector<HTMLElement>("#trash-card-id");
const trashError = document.querySelector<HTMLElement>("#trash-error");
const trashCancelButton = document.querySelector<HTMLButtonElement>("#trash-cancel");
const trashConfirmButton = document.querySelector<HTMLButtonElement>("#trash-confirm");

if (
  !container ||
  !sceneShell ||
  !studioView ||
  !facetBar ||
  !roomCardNav ||
  !roomCardSummary ||
  !roomSelectedName ||
  !roomSelectedStatus ||
  !cardActionStrip ||
  !cardGuestAction ||
  !cardShutdownAction ||
  !cardSettingsAction ||
  !cardBinAction ||
  !cardDeleteAction ||
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
  !cloneButton ||
  !resetButton ||
  !sendButton ||
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
  !profileControl ||
  !profileButton ||
  !profilePopover ||
  !profileMenuName ||
  !profileMenuInitials ||
  !profileEditOption ||
  !profilePerformanceOption ||
  !profileHelpOption ||
  !profileAboutOption ||
  !profileEditDialog ||
  !profileEditForm ||
  !profileNameInput ||
  !profileInitialsInput ||
  !profileEditError ||
  !profileAboutDialog ||
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
  !guestWakeScreenButton ||
  !guestSavepointButton ||
  !guestRewindButton ||
  !guestShutdownButton ||
  !guestForceStopButton ||
  !toast ||
  !trashTarget ||
  !binCount ||
  !binDialog ||
  !binList ||
  !binEmpty ||
  !binCloseButton ||
  !trashDialog ||
  !trashCardName ||
  !trashCardId ||
  !trashError ||
  !trashCancelButton ||
  !trashConfirmButton
) {
  throw new Error("Workspace UI is missing a required element.");
}

const sceneElement = container;
const sceneShellElement = sceneShell;
const studioViewElement = studioView;
const facetBarElement = facetBar;
const roomCardNavElement = roomCardNav;
const roomCardSummaryElement = roomCardSummary;
const roomSelectedNameElement = roomSelectedName;
const roomSelectedStatusElement = roomSelectedStatus;
const cardActionStripElement = cardActionStrip;
const cardGuestActionElement = cardGuestAction;
const cardShutdownActionElement = cardShutdownAction;
const cardSettingsActionElement = cardSettingsAction;
const cardBinActionElement = cardBinAction;
const cardDeleteActionElement = cardDeleteAction;
const secopsToggleElement = secopsToggle;
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
const profileControlElement = profileControl;
const profileButtonElement = profileButton;
const profilePopoverElement = profilePopover;
const profileMenuNameElement = profileMenuName;
const profileMenuInitialsElement = profileMenuInitials;
const profileEditOptionElement = profileEditOption;
const profilePerformanceOptionElement = profilePerformanceOption;
const profileHelpOptionElement = profileHelpOption;
const profileAboutOptionElement = profileAboutOption;
const profileEditDialogElement = profileEditDialog;
const profileEditFormElement = profileEditForm;
const profileNameInputElement = profileNameInput;
const profileInitialsInputElement = profileInitialsInput;
const profileEditErrorElement = profileEditError;
const profileAboutDialogElement = profileAboutDialog;
const cloneButtonElement = cloneButton;
const resetButtonElement = resetButton;
const recipientSelectElement = recipientSelect;
const remoteTargetInputElement = remoteTargetInput;
const toastElement = toast;
const trashTargetElement = trashTarget;
const binCountElement = binCount;
const binDialogElement = binDialog;
const binListElement = binList;
const binEmptyElement = binEmpty;
const binCloseButtonElement = binCloseButton;
const trashDialogElement = trashDialog;
const trashCardNameElement = trashCardName;
const trashCardIdElement = trashCardId;
const trashErrorElement = trashError;
const trashCancelButtonElement = trashCancelButton;
const trashConfirmButtonElement = trashConfirmButton;
const shareDialogElement = shareDialog;
const messageInputElement = messageInput;
const guestDisplayElement = guestDisplay;
const guestStateElement = guestState;
const guestErrorElement = guestError;
const guestTitleElement = guestTitle;
const guestDialogElement = guestDialog;
const guestInstallButtonElement = guestInstallButton;
const guestFinalizeBaseButtonElement = guestFinalizeBaseButton;
const guestBootDiskButtonElement = guestBootDiskButton;
const guestCloneCardButtonElement = guestCloneCardButton;
const guestResetOverlayButtonElement = guestResetOverlayButton;
const guestInjectPlaneButtonElement = guestInjectPlaneButton;
const guestWakeScreenButtonElement = guestWakeScreenButton;
const guestSavepointButtonElement = guestSavepointButton;
const guestRewindButtonElement = guestRewindButton;
const guestShutdownButtonElement = guestShutdownButton;
const guestForceStopButtonElement = guestForceStopButton;

const scene = new THREE.Scene();
scene.background = new THREE.Color("#0a1020");
scene.fog = new THREE.FogExp2("#101a30", 0.022);

const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 100);
camera.position.set(0, 4.48, 17.2);
camera.lookAt(0, 2.42, -0.25);
let sceneViewportWidth = 0;
let sceneViewportHeight = 0;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
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

scene.add(new THREE.HemisphereLight("#d9e7ff", "#11162d", 1.35));
const keyLight = new THREE.DirectionalLight("#8fe3e2", 2.2);
keyLight.position.set(-4, 9, 6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -11;
keyLight.shadow.camera.right = 11;
keyLight.shadow.camera.top = 11;
keyLight.shadow.camera.bottom = -7;
keyLight.shadow.bias = -0.0003;
scene.add(keyLight);
const fillLight = new THREE.PointLight("#a89bff", 34, 26);
fillLight.position.set(6, 5, -5);
scene.add(fillLight);
const rimLight = new THREE.PointLight("#54d6cf", 25, 24);
rimLight.position.set(-6, 4, 2);
const duskLight = new THREE.PointLight("#e495a4", 12, 18);
duskLight.position.set(0, 7, -7);
scene.add(duskLight);
scene.add(rimLight);

// Dynamic Card Neon Halo: casts a signature glow behind the active Post Card
const cardHaloLight = new THREE.PointLight("#ffb81c", 48, 16, 1.8);
cardHaloLight.position.set(0, 3, -1.8);
scene.add(cardHaloLight);

// Under-card specular floor pool light (Pillar 1 Atmosphere)
const cardFloorGlow = new THREE.PointLight("#70d5cf", 32, 7.5, 2.0);
cardFloorGlow.position.set(0, 0.2, 1.9);
scene.add(cardFloorGlow);

// Specular Obsidian Floor (Pillar 1 Atmosphere)
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({
    color: "#070b14",
    roughness: 0.16,
    metalness: 0.88,
  }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.12;
floor.receiveShadow = true;
scene.add(floor);

// The Paper Bin: a real 3D trash can standing in the far corner of the room.
const binGroup = new THREE.Group();
binGroup.position.set(-7.4, -0.12, -6.4);
binGroup.rotation.y = Math.PI / 5;
const binBodyMat = new THREE.MeshStandardMaterial({ color: "#5d6b82", roughness: 0.45, metalness: 0.7 });
const binBody = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.48, 1.7, 28, 1, true), binBodyMat);
binBody.position.y = 0.85;
binBody.castShadow = true;
binBody.material.side = THREE.DoubleSide;
const binBase = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.05, 28), binBodyMat);
binBase.position.y = 0.03;
const binRim = new THREE.Mesh(
  new THREE.TorusGeometry(0.62, 0.04, 10, 32),
  new THREE.MeshStandardMaterial({ color: "#8fe3e2", roughness: 0.3, metalness: 0.8, emissive: "#1d4f4e" }),
);
binRim.rotation.x = Math.PI / 2;
binRim.position.y = 1.7;
const binInside = new THREE.Mesh(
  new THREE.CircleGeometry(0.58, 28),
  new THREE.MeshBasicMaterial({ color: "#05070d" }),
);
binInside.rotation.x = -Math.PI / 2;
binInside.position.y = 1.5;
const binPaper = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.2, 0),
  new THREE.MeshStandardMaterial({ color: "#f2f5ff", roughness: 0.9, flatShading: true }),
);
binPaper.position.set(0.12, 1.55, -0.05);
binPaper.visible = false;
const binLabelCanvas = document.createElement("canvas");
binLabelCanvas.width = 256;
binLabelCanvas.height = 64;
const binLabelTexture = new THREE.CanvasTexture(binLabelCanvas);
binLabelTexture.colorSpace = THREE.SRGBColorSpace;
const binLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: binLabelTexture, transparent: true, depthTest: false }));
binLabel.scale.set(2.1, 0.52, 1);
binLabel.position.set(0, 2.5, 0);
binLabel.renderOrder = 5;
binGroup.add(binBody, binBase, binRim, binInside, binPaper, binLabel);
binGroup.traverse((object) => {
  object.userData.isPaperBin = true;
});
scene.add(binGroup);

function updatePaperBinModel(count: number): void {
  const context = binLabelCanvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, 256, 64);
    context.fillStyle = "rgba(10, 15, 25, 0.85)";
    context.fillRect(0, 8, 256, 48);
    context.strokeStyle = "#79ded8";
    context.strokeRect(1, 9, 254, 46);
    context.fillStyle = "#e8f1ff";
    context.font = "700 22px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(`PAPER BIN · ${count}`, 128, 32);
    binLabelTexture.needsUpdate = true;
  }
  binPaper.visible = count > 0;
}
updatePaperBinModel(0);

// Grand Architectural Observatory Window overlooking the Cosmic Starfield
const studioWallMat = new THREE.MeshStandardMaterial({
  color: "#111a31",
  roughness: 0.88,
  metalness: 0.24,
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
  color: "#121a35",
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
  color: "#273450",
  metalness: 0.74,
  roughness: 0.32,
});
const frameGoldMat = new THREE.MeshStandardMaterial({
  color: "#63d9d2",
  emissive: "#4ecac8",
  emissiveIntensity: 0.28,
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
  new THREE.Color("#e6f4ff"),
  new THREE.Color("#d9e7ff"),
  new THREE.Color("#f4eaff"),
  new THREE.Color("#94dfdc"),
  new THREE.Color("#d9e7ff"),
  new THREE.Color("#c6a9ff"),
  new THREE.Color("#e49aa4"),
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
  size: 0.075,
  vertexColors: true,
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
});
const cosmicStarfield = new THREE.Points(starGeometry, starMaterial);
scene.add(cosmicStarfield);

// Distant soft nebula glow in deep space
for (const [x, y, z, color, opacity, radius] of [
  [-4.5, 7.2, -22, "#6279d8", 0.09, 8.2],
  [5.2, 5.8, -24, "#67d8d1", 0.065, 8.2],
  [0.2, 8.8, -25, "#d08bb8", 0.055, 7.6],
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
  new THREE.MeshStandardMaterial({
    color: "#0a101f",
    metalness: 0.84,
    roughness: 0.22,
  }),
);
dais.position.set(0, -0.015, -0.25);
dais.receiveShadow = true;
dais.castShadow = true;
scene.add(dais);
for (const [radius, tube, color] of [
  [7.74, 0.028, "#65d9d3"],
  [7.48, 0.012, "#384568"],
] as const) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 8, 128),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.45,
      metalness: 0.85,
      roughness: 0.24,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, 0.1, -0.25);
  scene.add(ring);
}

const glowDisc = new THREE.Mesh(
  new THREE.CircleGeometry(6.2, 80),
  new THREE.MeshBasicMaterial({
    color: "#67d7d0",
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
  [4.85, 0.018, "#384568", "#293957"],
  [2.95, 0.014, "#b9a2ff", "#7666b8"],
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
  color: "#77d2e8",
  emissive: "#58c5d6",
  emissiveIntensity: 0.34,
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
  color: "#121b32",
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
      color: side < 0 ? "#68d7d2" : "#a99afa",
      emissive: side < 0 ? "#68d7d2" : "#a99afa",
      emissiveIntensity: 0.58,
    }),
  );
  consoleStrip.position.set(side * -1.85, 0.72, 0.87);
  towerGroup.add(consoleStrip);

  for (let row = 0; row < 7; row++) {
    const isCyan = (row + (side > 0 ? 1 : 0)) % 2 === 0;
    const ledColor = isCyan ? "#69d8d2" : "#a99afa";
    const ledMat = new THREE.MeshStandardMaterial({
      color: ledColor,
      emissive: ledColor,
      emissiveIntensity: 0.62,
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
    color: "#344360",
    emissive: "#79d7dc",
    emissiveIntensity: 0.42,
    metalness: 0.82,
    roughness: 0.22,
  }),
);
outerHalo.rotation.x = Math.PI / 2;
overheadHaloGroup.add(outerHalo);

const innerHalo = new THREE.Mesh(
  new THREE.TorusGeometry(3.6, 0.03, 12, 96),
  new THREE.MeshStandardMaterial({
    color: "#1c2440",
    emissive: "#b49eff",
    emissiveIntensity: 0.38,
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
const emeraldColor = new THREE.Color("#77d7d1");
const amberColor = new THREE.Color("#b69eff");
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
const GUEST_PREVIEW_WIDTH = 468;
const GUEST_PREVIEW_HEIGHT = 328;
const GUEST_PREVIEW_X = (640 - GUEST_PREVIEW_WIDTH) / 2;
const GUEST_PREVIEW_Y = 380;
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

// Pillar 2: Hardware chassis geometries (defined before initial card creation)
const fastenerGeometry = new THREE.CylinderGeometry(0.022, 0.022, 0.012, 6);
fastenerGeometry.rotateX(Math.PI / 2);
const fastenerMaterial = new THREE.MeshStandardMaterial({
  color: "#94a3b8",
  metalness: 0.94,
  roughness: 0.18,
});
const statusLedGeometry = new THREE.SphereGeometry(0.026, 12, 12);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const dragPoint = new THREE.Vector3();
const cards: SystemCard[] = [];
let selectedCard: SystemCard | null = null;
let selectedIndex = 2;
const CARD_STATE_STORAGE_KEY = "postcard.os.room-state.v1";
const protectedExistingCardIds = new Set(["windows-5"]);
function isBinnedCardRecord(value: unknown): value is BinnedCardRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.id) &&
    typeof value.name === "string" &&
    value.name.length <= 120 &&
    typeof value.os === "string" &&
    value.os.length <= 32 &&
    typeof value.detail === "string" &&
    value.detail.length <= 240 &&
    typeof value.color === "string" &&
    /^#[0-9a-f]{6}$/i.test(value.color) &&
    typeof value.status === "string" &&
    value.status.length <= 80 &&
    Number.isSafeInteger(value.index) &&
    Number(value.index) >= 0 &&
    (value.clonedFrom === undefined || typeof value.clonedFrom === "string") &&
    (value.removable === undefined || typeof value.removable === "boolean")
  );
}
const loadedCardState = (() => {
  try {
    const raw = window.localStorage.getItem(CARD_STATE_STORAGE_KEY);
    if (!raw) return { deletedIds: [] as string[], nextId: 1, binnedCards: [] as BinnedCardRecord[] };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { deletedIds: [] as string[], nextId: 1, binnedCards: [] as BinnedCardRecord[] };
    }
    const value = parsed as { deletedIds?: unknown; nextId?: unknown };
    return {
      deletedIds: Array.isArray(value.deletedIds)
        ? value.deletedIds.filter(
            (id): id is string => typeof id === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(id),
          )
        : [],
      nextId: typeof value.nextId === "number" && Number.isSafeInteger(value.nextId) && value.nextId > 0
        ? value.nextId
        : 1,
      binnedCards: Array.isArray((parsed as { binnedCards?: unknown }).binnedCards)
        ? (parsed as { binnedCards: unknown[] }).binnedCards.filter(isBinnedCardRecord)
        : [],
    };
  } catch {
    return { deletedIds: [] as string[], nextId: 1, binnedCards: [] as BinnedCardRecord[] };
  }
})();
// Older versions wrote this list before the delete request completed. Keep those
// IDs reserved, but only the guest service's durable registry is authoritative
// enough to hide a card after a reload.
const legacyDeletedCardIds = new Set(loadedCardState.deletedIds);
const deletedCardIds = new Set<string>();
const binnedCards = new Map<string, BinnedCardEntry>(
  loadedCardState.binnedCards.map((record) => [record.id, { record }]),
);
let nextCardIdNumber = loadedCardState.nextId;
let cardIdRegistryReady = false;
let guestRfb: RFB | undefined;
let displayedGuestCardId: string | undefined;
let guestServiceStatus: GuestServiceStatus | undefined;
let guestTargetCardId: string | undefined;
let guestTargetOs: GuestOS = "linux";
let secOpsMode = false;
let cardZoomed = false;
let benchCount: 1 | 2 | 3 = 1;

function frontBenchSlot(index: number): -1 | 0 | 1 | undefined {
  const diff = circularCardDiff(index);
  if (benchCount === 1) return diff === 0 ? 0 : undefined;
  if (benchCount === 2) return diff === 0 ? 0 : diff === 1 ? 1 : undefined;
  return diff === -1 || diff === 0 || diff === 1 ? (diff as -1 | 0 | 1) : undefined;
}

function isCardPulledToFront(card: SystemCard): boolean {
  if (card === selectedCard || card.twisted) return true;
  if (card.layoutOffset.z > 0.35 || card.layoutOffset.length() > 0.5) return true;
  const idx = cards.indexOf(card);
  return idx >= 0 && frontBenchSlot(idx) !== undefined;
}

function setBenchCount(next: 1 | 2 | 3, announce = true): void {
  benchCount = next;
  if (benchToggle) {
    benchToggle.textContent = `▣ BENCH · ${benchCount} ${benchCount === 1 ? "CARD" : "CARDS"}`;
    benchToggle.classList.toggle("active", benchCount > 1);
  }
  for (const card of cards) refreshCardTexture(card, true);
  if (announce) {
    showToast(
      benchCount === 1
        ? "Front workbench: 1 card in focus."
        : `Front workbench: ${benchCount} cards pulled forward & unblurred · grab any corner to twist bigger.`,
    );
  }
}

function toggleCardTwist(card: SystemCard, force?: boolean): void {
  const next = typeof force === "boolean" ? force : !card.twisted;
  card.twisted = next;
  card.blurLevel = 0;
  card.blurStep = 0;
  card.revealed = true;
  refreshCardTexture(card, true);
  showToast(
    next
      ? `⤢ ${card.name} display twisted bigger at the front · pull corner or click ⤡ UNTWIST to shrink.`
      : `⤡ ${card.name} returned to standard card display.`,
  );
}
let studioGraphicsProfile: GraphicsProfile = "balanced";
const cameraLookTarget = new THREE.Vector3(0, 2.42, -0.25);
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

function normalizeAngle(a: number): number {
  let res = (a + Math.PI) % (2 * Math.PI);
  if (res < 0) res += 2 * Math.PI;
  return res - Math.PI;
}

let drag:
  | {
      card?: SystemCard;
      pointerId: number;
      mode: "carousel" | "move" | "flip" | "peel";
      /** Edge of the front card that was grabbed; that edge swings toward the viewer. */
      grabEdge?: "left" | "right" | "top" | "bottom";
      /** Display-side corner that was grabbed (screen-space signs: +1 = right / top). */
      cornerX?: 1 | -1;
      cornerY?: 1 | -1;
      baseRotationY?: number;
      grabProgress?: number;
      flipAxis?: "horizontal" | "vertical";
      offset?: THREE.Vector3;
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
      moved: boolean;
      freeMove?: boolean;
      hitUv?: THREE.Vector2;
      originalPosition?: THREE.Vector3;
      originalRotation?: THREE.Euler;
      originalScale?: THREE.Vector3;
      originalLayoutOffset?: THREE.Vector3;
      originalSelectedCard?: SystemCard | null;
      originalTurntableAngle?: number;
      originalTargetTurntableAngle?: number;
      originalCardZoomed?: boolean;
    }
  | undefined;
type TrashRestoreState = {
  card: SystemCard;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
  layoutOffset: THREE.Vector3;
  targetRotation: number;
  tiltX: number;
  tiltZ: number;
  selectedCard: SystemCard | null;
  turntableAngle: number;
  targetTurntableAngle: number;
  cardZoomed: boolean;
};
type TrashFlight = {
  kind: "delete" | "bin";
  card: SystemCard;
  from: THREE.Vector3;
  to: THREE.Vector3;
  fromScale: THREE.Vector3;
  toScale: THREE.Vector3;
  fromRotation: THREE.Euler;
  toRotation: THREE.Euler;
  startedAt: number;
  duration: number;
  plane?: THREE.Mesh;
  animationFinished?: boolean;
  completeAnimation?: () => void;
  restoreState: TrashRestoreState;
};
let pendingTrash: TrashRestoreState | undefined;
let trashFlight: TrashFlight | undefined;
let trashDeleteInProgress = false;
let trashReturnFocus: HTMLElement | undefined;
let reconcilingDeletedCards = false;

function persistCardState(): boolean {
  try {
    window.localStorage.setItem(
      CARD_STATE_STORAGE_KEY,
      JSON.stringify({
        deletedIds: [...new Set([...legacyDeletedCardIds, ...deletedCardIds])].sort(),
        binnedCards: [...binnedCards.values()]
          .map(({ record }) => record)
          .sort((a, b) => a.index - b.index),
        nextId: nextCardIdNumber,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

async function allocateCardId(prefix: string): Promise<string> {
  if (!cardIdRegistryReady) {
    updateGuestCardStatus(await requestGuestApi("/api/guest/status"));
  }
  const existingIds = [
    ...new Set([
      ...cards.map((card) => card.id),
      ...protectedExistingCardIds,
      ...legacyDeletedCardIds,
      ...deletedCardIds,
      ...binnedCards.keys(),
      ...(guestServiceStatus?.preparedCardIds ?? []),
      ...(guestServiceStatus?.preparedWindowsCardIds ?? []),
      ...(guestServiceStatus?.guests.map((guest) => guest.cardId) ?? []),
    ]),
  ];
  const status = await requestGuestApi("/api/guest/allocate-card-id", {
    prefix,
    existingIds,
  });
  if (!status.allocatedCardId) {
    throw new Error("The guest service did not reserve a new card ID.");
  }
  updateGuestCardStatus(status);
  const numericSuffix = Number(status.allocatedCardId.match(/-(\d+)$/)?.[1]);
  if (Number.isSafeInteger(numericSuffix)) {
    nextCardIdNumber = Math.max(nextCardIdNumber, numericSuffix + 1);
    persistCardState();
  }
  return status.allocatedCardId;
}

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

// --- Native Web Audio Synthesizer (Studio Sound FX) ---
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioCtx) {
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === "suspended") {
    void audioCtx.resume();
  }
  return audioCtx;
}

function getMasterStudioGain(): number {
  const toggle = document.querySelector<HTMLInputElement>("#ambient-audio-toggle");
  if (toggle && !toggle.checked) return 0;
  const slider = document.querySelector<HTMLInputElement>("#master-volume");
  const val = slider ? Number(slider.value) : 85;
  return Math.max(0, Math.min(1, val / 100));
}

function playCardFlipSound(): void {
  const gain = getMasterStudioGain();
  if (gain <= 0.001) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const amp = ctx.createGain();

  osc.type = "triangle";
  osc.frequency.setValueAtTime(220, now);
  osc.frequency.exponentialRampToValueAtTime(50, now + 0.035);

  filter.type = "bandpass";
  filter.frequency.setValueAtTime(950, now);
  filter.Q.setValueAtTime(2.5, now);

  amp.gain.setValueAtTime(0.28 * gain, now);
  amp.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

  osc.connect(filter);
  filter.connect(amp);
  amp.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.045);
}

function playAirplaneSound(): void {
  const gain = getMasterStudioGain();
  if (gain <= 0.001) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const bufferSize = Math.floor(ctx.sampleRate * 0.7);
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    output[i] = Math.random() * 2 - 1;
  }

  const whiteNoise = ctx.createBufferSource();
  whiteNoise.buffer = noiseBuffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  const now = ctx.currentTime;
  filter.frequency.setValueAtTime(240, now);
  filter.frequency.exponentialRampToValueAtTime(1350, now + 0.3);
  filter.frequency.exponentialRampToValueAtTime(280, now + 0.65);
  filter.Q.setValueAtTime(2.4, now);

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.001, now);
  amp.gain.linearRampToValueAtTime(0.35 * gain, now + 0.22);
  amp.gain.exponentialRampToValueAtTime(0.001, now + 0.68);

  whiteNoise.connect(filter);
  filter.connect(amp);
  amp.connect(ctx.destination);

  whiteNoise.start(now);
  whiteNoise.stop(now + 0.7);
}

function playBootChime(): void {
  const gain = getMasterStudioGain();
  if (gain <= 0.001) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  // Studio hypervisor boot chord: C4 (261.63Hz), G4 (392.00Hz), C5 (523.25Hz), E5 (659.25Hz)
  const freqs = [261.63, 392.0, 523.25, 659.25];
  const chordGain = ctx.createGain();
  chordGain.gain.setValueAtTime(0.24 * gain, now);
  chordGain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
  chordGain.connect(ctx.destination);

  freqs.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const startTime = now + idx * 0.035;
    osc.frequency.setValueAtTime(freq, startTime);
    const perOscGain = ctx.createGain();
    perOscGain.gain.setValueAtTime(0.25, startTime);
    perOscGain.gain.exponentialRampToValueAtTime(0.001, startTime + 1.05);
    osc.connect(perOscGain);
    perOscGain.connect(chordGain);
    osc.start(startTime);
    osc.stop(startTime + 1.15);
  });
}

let lastVolumePipTime = 0;
function playVolumeTone(volumeVal: number): void {
  const toggle = document.querySelector<HTMLInputElement>("#ambient-audio-toggle");
  if (toggle && !toggle.checked) return;
  const nowMs = performance.now();
  if (nowMs - lastVolumePipTime < 65) return;
  lastVolumePipTime = nowMs;

  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  const gain = Math.max(0.04, Math.min(1, volumeVal / 100));

  const freq = 360 + (volumeVal / 100) * 260;
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, now);

  amp.gain.setValueAtTime(0.12 * gain, now);
  amp.gain.exponentialRampToValueAtTime(0.001, now + 0.065);

  osc.connect(amp);
  amp.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.07);
}

// Reconcile durable deletion receipts before rendering built-in cards, so a
// successful delete cannot flash back into the room while startup catches up.
try {
  const startupStatus = await requestGuestApi("/api/guest/status");
  guestServiceStatus = startupStatus;
  cardIdRegistryReady = true;
  for (const id of startupStatus.deletedCardIds) {
    legacyDeletedCardIds.delete(id);
    deletedCardIds.add(id);
    binnedCards.delete(id);
  }
  persistCardState();
} catch {
  // Keep the room usable when the local service is unavailable. New IDs remain
  // disabled until a successful status/registry check prevents accidental reuse.
  cardIdRegistryReady = false;
}

export type MonetizationTier = "COMMUNITY" | "PRO" | "ENTERPRISE";

export function getCardTier(card: SystemCard): MonetizationTier {
  if (card.id === "postcard-os" || card.id === "kali-red") return "ENTERPRISE";
  if (card.id === "windows" || card.id === "macos") return "PRO";
  return "COMMUNITY";
}

const initialCards = [
  {
    id: "postcard-os",
    name: "Post Card · Spatial OS",
    os: "LINUX",
    detail: "Primary spatial hypervisor console · 3D slot turntable.",
    color: "#00E5FF",
    status: "DEMO · DISCONNECTED",
  },
  {
    id: "android",
    name: "Android · Pocket Lab",
    os: "ANDROID",
    detail: "Your mobile world, brought into the room.",
    color: "#70d5cf",
    status: "DEMO · DISCONNECTED",
  },
  {
    id: "windows",
    name: "Windows · Studio",
    os: "WINDOWS",
    detail: "A familiar world, with room to roam.",
    color: "#8baef0",
    status: "DEMO · DISCONNECTED",
  },
  {
    id: "linux",
    name: "Fedora · Workstation",
    os: "LINUX",
    detail: "Fedora 45 COSMIC · DirectLink 10.0.0.2 & KVM golden image.",
    color: "#bca8ff",
    status: "DEMO · DISCONNECTED",
  },
  {
    id: "macos",
    name: "macOS · Cupertino",
    os: "MACOS",
    detail: "Precision craft, OpenCore UEFI & Darwin studio.",
    color: "#eea3a6",
    status: "DEMO · DISCONNECTED",
  },
  {
    id: "kali-red",
    name: "Kali · Cyber Range",
    os: "LINUX",
    detail: "Offensive SecOps, AI recon & isolated VLAN lab.",
    color: "#929bf2",
    status: "DEMO · DISCONNECTED",
  },
];

for (const definition of initialCards) {
  if (deletedCardIds.has(definition.id) || binnedCards.has(definition.id)) continue;
  cards.push(createCard(definition, cards.length));
}
if (cards.length === 0) {
  cards.push(
    createCard(
      {
        id: "workspace-fallback",
        name: "Studio · Welcome Space",
        os: "LINUX",
        detail: "Your room is ready for a new Post Card.",
        color: "#bca8ff",
        status: "DEMO · DISCONNECTED",
        removable: false,
      },
      0,
    ),
  );
}
arrangeCards();
selectCard(cards.find((card) => card.id === "linux") ?? cards[Math.min(INITIAL_CARD_INDEX, cards.length - 1)]);
updateCardCount();
updateRecipientOptions();
resize();

roomCardNavElement.addEventListener("click", (event) => {
  if (pendingTrash || trashFlight) return;
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-room-card]");
  const card = button?.dataset.cardId
    ? cards.find((item) => item.id === button.dataset.cardId)
    : undefined;
  if (card && card !== selectedCard && turntableLocked()) return;
  if (card) selectCard(card, true);
});

cardActionStripElement.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-card-action]");
  const card = selectedCard;
  const action = button?.dataset.cardAction as OnCardAction | undefined;
  if (!card || !button || button.disabled || !action) return;
  routeOnCardAction(action, {
    guest: () => openOrStartSelectedGuest(card),
    shutdown: () => void shutdownGuest(card),
    settings: () => flipCardTo(card, "back"),
    bin: () => beginCardBinFlight(card),
    delete: () => beginCardDeleteConfirmation(card),
  });
});

void refreshGuestStatus().catch((error: unknown) => {
  setGuestError(error instanceof Error ? error.message : "The local guest service is unavailable.");
});

// ---- Card extras, display twist, and the AI butler ----
const guestTwistButton = document.querySelector<HTMLButtonElement>("#guest-twist");
const guestWindowElement = guestDialogElement.querySelector<HTMLElement>(".guest-window");

function setDisplayTwist(expanded: boolean): void {
  if (!guestTwistButton || !guestWindowElement) return;
  guestDialogElement.classList.toggle("is-twisted", expanded);
  guestTwistButton.setAttribute("aria-pressed", String(expanded));
  guestTwistButton.textContent = expanded ? "⤡ Twist smaller" : "⤢ Twist bigger";
  window.dispatchEvent(new Event("resize"));
}
guestTwistButton?.addEventListener("click", () => {
  setDisplayTwist(!guestDialogElement.classList.contains("is-twisted"));
});
guestDialogElement.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement;
  if (event.key.toLowerCase() === "t" && !event.ctrlKey && !event.metaKey && !event.altKey &&
      !/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) && !target.closest("canvas")) {
    setDisplayTwist(!guestDialogElement.classList.contains("is-twisted"));
  }
});

type CardExtra = "display" | "zoom" | "flip" | "clone" | "savepoint" | "performance" | "butler";
function runCardExtra(extra: CardExtra, card: SystemCard): void {
  switch (extra) {
    case "display":
      openOrStartSelectedGuest(card);
      setDisplayTwist(true);
      break;
    case "zoom":
      toggleCardZoom();
      break;
    case "flip":
      flipCardTo(card, card.facet === "front" ? "back" : "front");
      break;
    case "clone":
      void cloneSelectedCard(card);
      break;
    case "savepoint":
      void runTimeTravelSnapshot("save", card);
      break;
    case "performance":
      openPerformanceDialog();
      break;
    case "butler":
      butlerSay(butlerGreeting(butlerContext()));
      break;
  }
}
cardActionStripElement.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-card-extra]");
  const card = selectedCard;
  if (!card || !button || button.disabled || trashFlight || pendingTrash) return;
  runCardExtra(button.dataset.cardExtra as CardExtra, card);
});

const butlerElement = document.querySelector<HTMLElement>("#butler");
const butlerBubble = document.querySelector<HTMLElement>("#butler-bubble");
const butlerMessage = document.querySelector<HTMLElement>("#butler-message");
const butlerChoices = document.querySelector<HTMLElement>("#butler-choices");
const butlerAvatar = document.querySelector<HTMLButtonElement>("#butler-avatar");
const butlerClose = document.querySelector<HTMLButtonElement>("#butler-close");
let butlerHovered = false;
butlerClose?.addEventListener("click", () => {
  butlerHovered = false;
  if (butlerBubble) butlerBubble.hidden = true;
});
omniInputElement.addEventListener("focus", () => {
  window.clearTimeout(butlerHideTimer);
});
omniInputElement.addEventListener("blur", () => {
  if (!butlerHovered) {
    window.clearTimeout(butlerHideTimer);
    butlerHideTimer = window.setTimeout(() => {
      if (!butlerHovered && document.activeElement !== omniInputElement && butlerBubble) {
        butlerBubble.hidden = true;
      }
    }, 320);
  }
});
let lastUserActivity = performance.now();
let butlerLastKey = "";
let butlerHideTimer: number | undefined;
let butlerQuietUntil = 0;
let butlerLastSpoke = 0;

for (const type of ["pointerdown", "keydown", "wheel"]) {
  window.addEventListener(type, () => { lastUserActivity = performance.now(); }, { passive: true });
}

const butlerModelSelect = document.querySelector<HTMLSelectElement>("#butler-model-select");

function butlerContext(): ButlerContext {
  const errorText = guestErrorElement.hidden ? undefined : guestErrorElement.textContent?.trim() || undefined;
  const serviceUnavailable = Boolean(errorText && /unavailable|failed to fetch/i.test(errorText));
  const card = selectedCard;
  const os = card ? cardToGuestOs(card) : undefined;
  const model = (butlerModelSelect?.value as ButlerContext["model"]) || "auto";
  const guestRecord = card && os ? guestServiceStatus?.guests.find((g) => g.os === os && g.cardId === card.id) : undefined;
  return {
    idleSeconds: (performance.now() - lastUserActivity) / 1000,
    guestError: serviceUnavailable ? undefined : errorText,
    guestStderr: guestRecord?.stderr?.trim() || undefined,
    cardName: card?.name,
    guestRunning: Boolean(card && os && guestServiceStatus?.guests.some((g) => g.os === os && g.cardId === card.id && g.status === "running")),
    serviceUnavailable,
    displayOpen: guestDialogElement.open,
    needsInstall: card ? cardButtonStates(card).guest.label === "Install" : false,
    cardsList: cards.map((c) => c.name),
    model,
  };
}

function butlerSay(note: { message: string; choices: ButlerChoiceId[] }, autoHideMs = 0): void {
  if (!butlerBubble || !butlerMessage || !butlerChoices) return;
  butlerMessage.textContent = note.message;
  butlerChoices.replaceChildren();
  for (const id of note.choices) {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = "butler-choice";
    choice.textContent = BUTLER_CHOICE_LABELS[id];
    choice.addEventListener("click", () => butlerChoose(id));
    butlerChoices.append(choice);
  }
  butlerBubble.hidden = false;
  butlerLastSpoke = performance.now();
  window.clearTimeout(butlerHideTimer);
  if (autoHideMs > 0) butlerHideTimer = window.setTimeout(() => { butlerBubble.hidden = true; }, autoHideMs);
}

// ---- Architectural Blueprints Modal Controller ----
const blueprintDialog = document.querySelector<HTMLDialogElement>("#blueprint-dialog");
const blueprintNav = document.querySelector<HTMLElement>("#blueprint-nav");
const blueprintCloseBtn = document.querySelector<HTMLButtonElement>("#close-blueprint");
const blueprintDoneBtn = document.querySelector<HTMLButtonElement>("#btn-blueprint-done");
const blueprintSourceBtn = document.querySelector<HTMLButtonElement>("#btn-open-blueprint-source");
const bpActiveImg = document.querySelector<HTMLImageElement>("#blueprint-active-img");
const bpMetaKicker = document.querySelector<HTMLElement>("#bp-meta-kicker");
const bpMetaTitle = document.querySelector<HTMLElement>("#bp-meta-title");
const bpMetaDesc = document.querySelector<HTMLElement>("#bp-meta-desc");
const bpMetaHighlights = document.querySelector<HTMLUListElement>("#bp-meta-highlights");
let currentBlueprintId = "system-mindmap";

function openBlueprintHUD(blueprintId?: string): void {
  if (!blueprintDialog) return;
  const targetId = blueprintId || currentBlueprintId;
  selectBlueprintTab(targetId);
  if (!blueprintDialog.open) {
    blueprintDialog.showModal();
  }
}

function selectBlueprintTab(id: string): void {
  const item = BLUEPRINTS.find((b) => b.id === id) || BLUEPRINTS[0];
  currentBlueprintId = item.id;

  if (blueprintNav) {
    const tabs = blueprintNav.querySelectorAll<HTMLButtonElement>(".blueprint-tab");
    tabs.forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.bp === item.id);
    });
  }

  if (bpActiveImg) bpActiveImg.src = item.svgPath;
  if (bpMetaKicker) bpMetaKicker.textContent = item.kicker;
  if (bpMetaTitle) bpMetaTitle.textContent = item.title;
  if (bpMetaDesc) bpMetaDesc.textContent = item.description;

  if (bpMetaHighlights) {
    bpMetaHighlights.replaceChildren();
    for (const hl of item.highlights) {
      const li = document.createElement("li");
      li.textContent = hl;
      bpMetaHighlights.appendChild(li);
    }
  }
}

blueprintNav?.addEventListener("click", (e) => {
  const target = (e.target as HTMLElement)?.closest<HTMLButtonElement>(".blueprint-tab");
  if (target?.dataset.bp) {
    selectBlueprintTab(target.dataset.bp);
  }
});

blueprintCloseBtn?.addEventListener("click", () => blueprintDialog?.close());
blueprintDoneBtn?.addEventListener("click", () => blueprintDialog?.close());
blueprintSourceBtn?.addEventListener("click", () => {
  const item = BLUEPRINTS.find((b) => b.id === currentBlueprintId);
  if (item) window.open(item.svgPath, "_blank");
});

function downloadTextFile(filename: string, content: string, mimeType = "application/xml"): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function butlerChoose(id: ButlerChoiceId): void {
  const context = butlerContext();
  const card = selectedCard;
  if (id === "display" && card) runCardExtra("display", card);
  if (id === "settings" && card) flipCardTo(card, "back");
  if (id === "tour") toggleCardZoom(false);
  if (id === "blueprints") {
    openBlueprintHUD();
  }
  if (id === "opml") {
    const xml = generateDeckOpml(context.cardsList);
    downloadTextFile("postcard-deck-outline.opml", xml);
  }
  if (id === "freeplane") {
    const map = createFreeplaneTutorialMindMap();
    const xml = stringifyFreeplaneMap(map);
    downloadTextFile("basic-freeplane-functions.mm", xml, "application/x-freemind");
  }
  if (id === "snooze") butlerQuietUntil = performance.now() + SNOOZE_SECONDS * 1000;
  if (id === "dismiss") {
    if (butlerBubble) butlerBubble.hidden = true;
    return;
  }
  butlerSay({ message: butlerAnswer(id, context), choices: id === "stuck" ? ["blueprints", "tour", "dismiss"] : ["dismiss"] }, 20000);
}

function openButlerOnHover(): void {
  butlerHovered = true;
  window.clearTimeout(butlerHideTimer);
  if (butlerBubble?.hidden) {
    butlerSay(butlerGreeting(butlerContext()), 0);
  }
}

function scheduleButlerHideOnLeave(): void {
  butlerHovered = false;
  window.clearTimeout(butlerHideTimer);
  butlerHideTimer = window.setTimeout(() => {
    if (!butlerHovered && document.activeElement !== omniInputElement && butlerBubble) {
      butlerBubble.hidden = true;
    }
  }, 320);
}

butlerElement?.addEventListener("pointerenter", openButlerOnHover);
butlerElement?.addEventListener("mouseenter", openButlerOnHover);
butlerElement?.addEventListener("pointerleave", scheduleButlerHideOnLeave);
butlerElement?.addEventListener("mouseleave", scheduleButlerHideOnLeave);

butlerAvatar?.addEventListener("click", () => {
  if (butlerBubble && !butlerBubble.hidden && document.activeElement !== omniInputElement) {
    butlerSay(butlerGreeting(butlerContext()), 0);
    omniInputElement.focus();
  } else {
    butlerSay(butlerGreeting(butlerContext()), 0);
    omniInputElement.focus();
  }
});

// Keep the butler on top of the modal display, where trouble usually happens.
new MutationObserver(() => {
  if (!butlerElement) return;
  const host = guestDialogElement.open ? guestDialogElement : document.body;
  if (butlerElement.parentElement !== host) host.append(butlerElement);
}).observe(guestDialogElement, { attributes: true, attributeFilter: ["open"] });

window.setInterval(() => {
  if (!butlerBubble || !butlerBubble.hidden || drag) return;
  const nowMs = performance.now();
  const context = butlerContext();
  const urgent = Boolean(context.guestError || context.serviceUnavailable);
  if (!urgent && (nowMs < butlerQuietUntil || nowMs - butlerLastSpoke < CHECK_IN_COOLDOWN_SECONDS * 1000)) return;
  const note = butlerCheckIn(context);
  if (!note || note.key === butlerLastKey) return;
  butlerLastKey = note.key;
  butlerSay(note, 30000);
  lastUserActivity = performance.now();
}, 4000);

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
observer.observe(sceneShellElement);
observer.observe(sceneElement);
window.addEventListener("resize", resize);
resize();

renderer.domElement.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());
renderer.domElement.addEventListener("pointermove", onPointerMove);
renderer.domElement.addEventListener("pointerup", onPointerUp);
renderer.domElement.addEventListener("pointercancel", onPointerUp);
renderer.domElement.addEventListener("dblclick", onDoubleClick);
attachCarouselWheelListener(sceneShellElement, onWheel);
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
  const clickedAction = target.closest(
    ".pulldown .pulldown-panel button, .pulldown .pulldown-panel a, .pulldown .pulldown-panel [data-facet]",
  );
  if (clickedAction) {
    const parentDetails = clickedAction.closest<HTMLDetailsElement>("details.pulldown");
    if (parentDetails) parentDetails.open = false;
    return;
  }
  const openMenus = document.querySelectorAll<HTMLDetailsElement>(
    "details.pulldown[open], details.studio-tools[open]",
  );
  for (const menu of openMenus) {
    if (!menu.contains(target) && !target.closest(`[aria-controls="${menu.id}"]`)) {
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

cloneButtonElement.addEventListener("click", () => {
  if (selectedCard) void cloneSelectedCard(selectedCard);
});

resetButtonElement.addEventListener("click", () => {
  if (selectedCard) void resetSelectedCardOverlay(selectedCard);
});

customIsoButton?.addEventListener("click", () => {
  if (selectedCard) void promptAndSetCustomIso(selectedCard);
});

guestCustomIsoButton?.addEventListener("click", () => {
  const card = cards.find((item) => item.id === guestTargetCardId) ?? selectedCard;
  if (card) void promptAndSetCustomIso(card);
});

guestPasteClipboardButton?.addEventListener("click", () => {
  void pasteHostClipboardToVm();
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

guestWakeScreenButtonElement.addEventListener("click", () => {
  void wakeGuestScreen();
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

benchToggle?.addEventListener("click", () => {
  const next: 1 | 2 | 3 = benchCount === 1 ? 2 : benchCount === 2 ? 3 : 1;
  setBenchCount(next, true);
});

secopsToggleElement.addEventListener("click", () => {
  toggleSecOpsLabMode();
});

document.getElementById("tour-button")?.addEventListener("click", () => {
  if (tourActive) {
    stopGuidedTour();
    if (isTourRecording) stopTourRecording();
  } else {
    startGuidedTour();
  }
});

document.getElementById("record-tour-button")?.addEventListener("click", () => {
  if (isTourRecording) {
    stopTourRecording();
    stopGuidedTour();
  } else {
    startTourRecording();
  }
});

omniFormElement.addEventListener("submit", (event) => {
  event.preventDefault();
  const prompt = omniInputElement.value.trim();
  if (!prompt) return;
  omniInputElement.value = "";
  const context = butlerContext();
  const interpreted = butlerInterpretPrompt(prompt, context);
  if (interpreted.actionPayload) {
    if (interpreted.actionPayload.type === "open-blueprint") {
      openBlueprintHUD(interpreted.actionPayload.blueprintId);
    } else if (interpreted.actionPayload.type === "download-opml" && interpreted.actionPayload.data) {
      downloadTextFile("postcard-deck-outline.opml", interpreted.actionPayload.data);
    } else if (interpreted.actionPayload.type === "download-freeplane") {
      const map = createFreeplaneTutorialMindMap();
      const xml = stringifyFreeplaneMap(map);
      downloadTextFile("basic-freeplane-functions.mm", xml, "application/x-freemind");
    }
  }
  if (interpreted.choice) {
    butlerChoose(interpreted.choice);
    return;
  }
  if (interpreted.reply) {
    butlerSay({ message: interpreted.reply, choices: ["tour", "dismiss"] });
    return;
  }
  const target = selectedCard ?? cards[0];
  butlerSay({
    message: `Right away — sending "${prompt}" to ${target?.name ?? "the selected card"}.`,
    choices: ["dismiss"],
  });
  void runAiOrSecOpsCommand(prompt, selectedCard ?? undefined);
});

function handleChipAction(event: MouseEvent): void {
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
}

secopsChips?.addEventListener("click", handleChipAction);
horizonChips?.addEventListener("click", handleChipAction);
if (omniChipsElement && omniChipsElement !== secopsChips && omniChipsElement !== horizonChips) {
  omniChipsElement.addEventListener("click", handleChipAction);
}

quickFileInput?.addEventListener("change", () => {
  const file = quickFileInput.files?.[0];
  quickFileInput.value = "";
  if (!file || !selectedCard) return;
  const fromCard = cards.find((c) => c !== selectedCard) ?? selectedCard;
  void uploadFilePaperPlane(fromCard, selectedCard, file);
});

window.addEventListener("keydown", (event) => {
  if (studioViewElement.hidden) return;
  if (profilePopoverOpen && event.key === "Escape") {
    event.preventDefault();
    closeProfilePopover(true);
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (butlerBubble?.hidden) butlerSay(butlerGreeting(butlerContext()));
    omniInputElement.focus();
    omniInputElement.select();
    return;
  }
  const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
  if (
    activeTag === "INPUT" ||
    activeTag === "TEXTAREA" ||
    activeTag === "SELECT" ||
    guestDialogElement.open ||
    trashDialogElement.open ||
    shareDialog.open ||
    performanceDialogElement.open ||
    helpDialog.open
  ) {
    return;
  }
  if (event.key === "/") {
    event.preventDefault();
    if (butlerBubble?.hidden) butlerSay(butlerGreeting(butlerContext()));
    omniInputElement.focus();
    return;
  }
  if (event.key === "?") {
    event.preventDefault();
    helpDialog.showModal();
    return;
  }
  if (event.key.toLowerCase() === "m") {
    event.preventDefault();
    const editionsDialog = document.getElementById("editions-dialog") as HTMLDialogElement | null;
    if (editionsDialog && !editionsDialog.open) editionsDialog.showModal();
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

trashCancelButtonElement.addEventListener("click", cancelTrashConfirmation);
trashConfirmButtonElement.addEventListener("click", () => {
  void confirmTrashDeletion();
});
trashDialogElement.addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelTrashConfirmation();
});
trashDialogElement.addEventListener("close", () => {
  if (pendingTrash && !trashDeleteInProgress) cancelTrashConfirmation();
});

trashTargetElement.addEventListener("click", () => {
  updateBinDialog();
  binDialogElement.showModal();
});
binCloseButtonElement.addEventListener("click", () => binDialogElement.close());
sendButton.addEventListener("click", () => {
  openShareDialog();
});

const ADD_CARD_TEMPLATES: Record<
  string,
  { name: string; os: string; detail: string; color: string; status: string }
> = {
  kernel: {
    name: "Post Card · Micro-Host Kernel",
    os: "LINUX",
    detail: "Bare-metal Rust micro-host kernel (postcard-minimal-kernel) · direct boot.",
    color: "#00E5FF",
    status: "DEMO · DISCONNECTED",
  },
  linux: {
    name: "Fedora · New Space",
    os: "LINUX",
    detail: "Fedora Cloud / Workstation QCOW2 overlay & DirectLink.",
    color: "#bca8ff",
    status: "DEMO · DISCONNECTED",
  },
  windows: {
    name: "Windows · New Space",
    os: "WINDOWS",
    detail: "A new card for another Windows world.",
    color: "#8baef0",
    status: "DEMO · DISCONNECTED",
  },
  kali: {
    name: "Kali · SecOps Lab",
    os: "LINUX",
    detail: "Offensive SecOps, recon & isolated cyber-range lab.",
    color: "#eaa27f",
    status: "DEMO · DISCONNECTED",
  },
  android: {
    name: "Android · New Space",
    os: "ANDROID",
    detail: "A new card for another Android world.",
    color: "#70d5cf",
    status: "DEMO · DISCONNECTED",
  },
  macos: {
    name: "macOS · New Space",
    os: "MACOS",
    detail: "A new card for another Darwin / Cupertino world.",
    color: "#eea3a6",
    status: "DEMO · DISCONNECTED",
  },
  "custom-linux": {
    name: "Custom OS · BYO Image",
    os: "LINUX",
    detail: "Custom bootable ISO / QCOW2 image on dedicated disk.",
    color: "#62d8d0",
    status: "DEMO · DISCONNECTED",
  },
  "custom-windows": {
    name: "Custom Windows · BYO ISO",
    os: "WINDOWS",
    detail: "Custom Windows ISO on WSL2 QEMU + TPM 2.0.",
    color: "#8baef0",
    status: "DEMO · DISCONNECTED",
  },
};

addCardTemplateSelect?.addEventListener("change", () => {
  const key = addCardTemplateSelect.value;
  if (key === "clone" && selectedCard && addCardNameInput) {
    addCardNameInput.value = `${selectedCard.name} · Clone`;
    return;
  }
  const tpl = ADD_CARD_TEMPLATES[key];
  if (tpl && addCardNameInput) {
    addCardNameInput.value = tpl.name;
  }
});

document.querySelector("#cancel-add-card")?.addEventListener("click", () => {
  addCardDialog?.close();
});

addCardDialog?.addEventListener("click", (event) => {
  if (event.target === addCardDialog) addCardDialog.close();
});

addButton.addEventListener("click", () => {
  if (addCardDialog && addCardTemplateSelect && addCardNameInput && addCardIsoInput) {
    const order = ["windows", "linux", "android", "macos"];
    const defaultKey = order[(nextCardIdNumber - 1) % order.length];
    addCardTemplateSelect.value = defaultKey;
    addCardNameInput.value = ADD_CARD_TEMPLATES[defaultKey].name;
    addCardIsoInput.value = "";
    addCardDialog.showModal();
    addCardNameInput.focus();
    addCardNameInput.select();
    return;
  }
});

addCardForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const templateKey = addCardTemplateSelect?.value ?? "linux";
  const customName = addCardNameInput?.value.trim();
  const customIsoPath = addCardIsoInput?.value.trim() ?? "";
  addCardDialog?.close();

  if (templateKey === "clone" && selectedCard) {
    await cloneSelectedCard(selectedCard);
    return;
  }

  const baseTpl = ADD_CARD_TEMPLATES[templateKey] ?? ADD_CARD_TEMPLATES.linux;
  const finalName = customName || baseTpl.name;
  try {
    const id = await allocateCardId(baseTpl.os.toLowerCase());
    const detail = customIsoPath
      ? `Custom OS image: ${customIsoPath.split(/[\\/]/).pop() || customIsoPath}`
      : baseTpl.detail;
    const card = createCard({ ...baseTpl, name: finalName, detail, id }, cards.length);
    cards.push(card);
    persistCardState();
    selectCard(card);
    updateCardCount();
    updateRecipientOptions();
    if (customIsoPath) {
      const status = await requestGuestApi("/api/guest/custom-iso", {
        cardId: id,
        isoPath: customIsoPath,
      });
      updateGuestCardStatus(status);
      showToast(`💿 ${card.name} created with custom OS image (${customIsoPath.split(/[\\/]/).pop()})!`);
    } else {
      showToast(`${card.name} added to your space.`);
    }
  } catch (error) {
    showToast(error instanceof Error ? `Could not add a card: ${error.message}` : "Could not reserve a safe card ID.");
  }
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

for (const modal of [shareDialog, helpDialog]) {
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      modal.close();
    }
  });
}

type LocalProfile = { name: string; initials: string };
const PROFILE_STORAGE_KEY = "postcard.os.profile.v1";
let localProfile: LocalProfile = readLocalProfile();
let profilePopoverOpen = false;
let profileFocusReturnPending = false;
renderLocalProfile();

profileButtonElement.addEventListener("click", () => {
  setProfilePopoverOpen(!profilePopoverOpen);
});
document.addEventListener("pointerdown", (event) => {
  if (!profileControlElement.contains(event.target as Node)) {
    closeProfilePopover();
  }
});
document.addEventListener("focusin", (event) => {
  if (profilePopoverOpen && !profileControlElement.contains(event.target as Node)) {
    closeProfilePopover();
  }
});
window.addEventListener("hashchange", () => closeProfilePopover());
profileEditOptionElement.addEventListener("click", () => {
  closeProfilePopover();
  profileNameInputElement.value = localProfile.name;
  profileInitialsInputElement.value = localProfile.initials;
  profileEditErrorElement.textContent = "";
  profileFocusReturnPending = true;
  profileEditDialogElement.showModal();
  profileNameInputElement.focus();
});
profilePerformanceOptionElement.addEventListener("click", () => {
  closeProfilePopover();
  profileFocusReturnPending = true;
  openPerformanceDialog();
  if (!performanceDialogElement.open) restoreProfileFocus();
});
profileHelpOptionElement.addEventListener("click", () => {
  closeProfilePopover();
  profileFocusReturnPending = true;
  helpDialog.showModal();
});
profileAboutOptionElement.addEventListener("click", () => {
  closeProfilePopover();
  profileFocusReturnPending = true;
  profileAboutDialogElement.showModal();
});
profileEditFormElement.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = profileNameInputElement.value.trim().replace(/\s+/g, " ");
  const initials = profileInitialsInputElement.value.trim().toLocaleUpperCase();
  if (!name) {
    profileEditErrorElement.textContent = "Enter a display name to continue.";
    profileNameInputElement.focus();
    return;
  }
  if (name.length > 40) {
    profileEditErrorElement.textContent = "Display names can be up to 40 characters.";
    profileNameInputElement.focus();
    return;
  }
  if (!/^\p{L}{1,2}$/u.test(initials)) {
    profileEditErrorElement.textContent = "Initials must be one or two letters.";
    profileInitialsInputElement.focus();
    return;
  }
  localProfile = { name, initials };
  renderLocalProfile();
  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(localProfile));
    showToast("Local profile saved on this device.");
  } catch {
    showToast("Profile updated for this session; browser storage is unavailable.");
  }
  profileEditDialogElement.close();
});
profileNameInputElement.addEventListener("input", () => {
  profileEditErrorElement.textContent = "";
});
profileInitialsInputElement.addEventListener("input", () => {
  profileEditErrorElement.textContent = "";
});
document.querySelector("#cancel-profile-edit")?.addEventListener("click", () => {
  profileEditDialogElement.close();
});
for (const dialog of [profileEditDialogElement, profileAboutDialogElement, performanceDialogElement, helpDialog]) {
  dialog.addEventListener("close", restoreProfileFocus);
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
document.querySelector<HTMLInputElement>("#reduce-motion-toggle")?.addEventListener("change", (event) => {
  reduceMotionOptIn = (event.target as HTMLInputElement).checked;
  try {
    localStorage.setItem(REDUCE_MOTION_KEY, reduceMotionOptIn ? "1" : "0");
  } catch {
    /* storage unavailable; setting lasts for this session */
  }
  showToast(reduceMotionOptIn ? "Reduced motion on · cards jump between positions." : "Full motion on · the carousel glides.");
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

function openShareDialog(targetCard?: SystemCard): void {
  if (!selectedCard) {
    showToast("Select a Post Card to send a paper airplane.");
    return;
  }
  updateRecipientOptions();
  if (targetCard && targetCard !== selectedCard) {
    recipientSelectElement.value = targetCard.id;
  }
  shareDialogElement.showModal();
  messageInputElement.focus();
}

function readLocalProfile(): LocalProfile {
  try {
    const stored = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<LocalProfile>;
      const name = typeof parsed.name === "string" ? parsed.name.trim().replace(/\s+/g, " ") : "";
      const initials = typeof parsed.initials === "string" ? parsed.initials.trim().toLocaleUpperCase() : "";
      return {
        name: name.slice(0, 40) || "Local profile",
        initials: /^\p{L}{1,2}$/u.test(initials) ? initials : "C",
      };
    }
  } catch {
    // Use the default local profile if storage is unavailable or malformed.
  }
  return { name: "Local profile", initials: "C" };
}

function renderLocalProfile(): void {
  profileButtonElement.textContent = localProfile.initials;
  profileButtonElement.title = `${localProfile.name} · Local profile options`;
  profileMenuNameElement.textContent = localProfile.name;
  profileMenuInitialsElement.textContent = localProfile.initials;
}

function setProfilePopoverOpen(open: boolean): void {
  profilePopoverOpen = open;
  profilePopoverElement.hidden = !open;
  profileButtonElement.setAttribute("aria-expanded", String(open));
  if (open) profileEditOptionElement.focus();
}

function closeProfilePopover(restoreFocus = false): void {
  if (!profilePopoverOpen) return;
  setProfilePopoverOpen(false);
  if (restoreFocus) profileButtonElement.focus();
}

function restoreProfileFocus(): void {
  if (!profileFocusReturnPending) return;
  profileFocusReturnPending = false;
  requestAnimationFrame(() => profileButtonElement.focus());
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
  const reduceMotionToggle = document.querySelector<HTMLInputElement>("#reduce-motion-toggle");
  if (reduceMotionToggle) reduceMotionToggle.checked = reduceMotionOptIn;
  const crtScanlineToggle = document.querySelector<HTMLInputElement>("#crt-scanline-toggle");
  if (crtScanlineToggle) crtScanlineToggle.checked = document.body.classList.contains("crt-scanlines");
  const masterVolumeInput = document.querySelector<HTMLInputElement>("#master-volume");
  const masterVolumeVal = document.querySelector<HTMLElement>("#master-volume-val");
  if (masterVolumeInput && masterVolumeVal) {
    masterVolumeInput.oninput = () => {
      masterVolumeVal.textContent = `${masterVolumeInput.value}%`;
      playVolumeTone(Number(masterVolumeInput.value));
    };
  }
  const colorGradeSelect = document.querySelector<HTMLSelectElement>("#color-grade-profile");
  if (colorGradeSelect) {
    colorGradeSelect.onchange = () => {
      const grade = colorGradeSelect.value;
      if (grade === "cyberpunk") {
        cardHaloLight.color.set("#00ffff");
        cardHaloLight.intensity = 60;
        cardFloorGlow.color.set("#ff007f");
        cardFloorGlow.intensity = 42;
        fillLight.color.set("#7928ca");
        rimLight.color.set("#00f0ff");
        duskLight.color.set("#ff007f");
        renderer.toneMappingExposure = 1.35;
      } else if (grade === "monochrome") {
        cardHaloLight.color.set("#00ff66");
        cardHaloLight.intensity = 52;
        cardFloorGlow.color.set("#00ff66");
        cardFloorGlow.intensity = 35;
        fillLight.color.set("#003311");
        rimLight.color.set("#00ff66");
        duskLight.color.set("#001a00");
        renderer.toneMappingExposure = 1.05;
      } else if (grade === "vintage") {
        cardHaloLight.color.set("#ffaa44");
        cardHaloLight.intensity = 40;
        cardFloorGlow.color.set("#e69138");
        cardFloorGlow.intensity = 26;
        fillLight.color.set("#b45f06");
        rimLight.color.set("#ffd966");
        duskLight.color.set("#783f04");
        renderer.toneMappingExposure = 0.98;
      } else {
        cardHaloLight.color.set("#ffb81c");
        cardHaloLight.intensity = 48;
        cardFloorGlow.color.set("#70d5cf");
        cardFloorGlow.intensity = 32;
        fillLight.color.set("#a89bff");
        rimLight.color.set("#54d6cf");
        duskLight.color.set("#e495a4");
        renderer.toneMappingExposure = 1.12;
      }
    };
  }
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
    const crtScanlineToggle = document.querySelector<HTMLInputElement>("#crt-scanline-toggle");
    if (crtScanlineToggle) {
      if (crtScanlineToggle.checked) {
        document.body.classList.add("crt-scanlines");
      } else {
        document.body.classList.remove("crt-scanlines");
      }
    }
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
  if (card === selectedCard) cardGuestActionElement.disabled = true;
  guestTargetCardId = card.id;
  guestTargetOs = cardToGuestOs(card);
  guestTitleElement.textContent = card.name;
  updateGuestDialogCopy();
  clearGuestError();
  void refreshGuestStatus()
    .then((status) => {
      const guest = status.guests.find((item) => item.os === guestTargetOs && item.cardId === card.id);
      if (guest?.status === "running" && guest.websocketPort !== null) {
        connectGuestDisplay(guest.websocketPort, card.id);
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
    .catch((error) => {
      reportGuestError(error);
      updateOnCardActions();
    });
}

async function cloneSelectedCard(sourceCard: SystemCard): Promise<void> {
  let newId: string;
  let newName: string;
  let status: GuestServiceStatus;
  const os: GuestOS = cardToGuestOs(sourceCard);
  try {
    newId = await allocateCardId("clone");
    const baseTitle = sourceCard.name.split(" · ")[0] ?? sourceCard.os;
    newName = `${baseTitle} · Clone ${newId.slice(newId.lastIndexOf("-") + 1)}`;
    status = await requestGuestApi("/api/guest/clone-overlay", {
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
  definition: CardDefinition,
  index: number,
): SystemCard {
  const group = new THREE.Group();
  const edge = new THREE.Mesh(
    edgeGeometry,
    new THREE.MeshStandardMaterial({
      color: "#19212d",
      emissive: "#152631",
      emissiveIntensity: 0.22,
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

  // 4 corner metallic hex fasteners (Pillar 2 Hardware Chassis)
  const cornerX = CARD_WIDTH / 2 - 0.088;
  const cornerY = CARD_HEIGHT / 2 - 0.088;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const fastener = new THREE.Mesh(fastenerGeometry, fastenerMaterial);
      fastener.position.set(sx * cornerX, sy * cornerY, frontFaceZ + 0.002);
      group.add(fastener);
    }
  }

  // Physical status LED bead on top-right chassis rim (Pillar 2 Activity LED)
  const ledMat = new THREE.MeshStandardMaterial({
    color: "#475569",
    emissive: "#1e293b",
    emissiveIntensity: 0.35,
    roughness: 0.12,
    metalness: 0.6,
  });
  const ledMesh = new THREE.Mesh(statusLedGeometry, ledMat);
  ledMesh.position.set(cornerX - 0.065, cornerY - 0.035, frontFaceZ + 0.004);
  group.add(ledMesh);
  card.statusLedMat = ledMat;
  card.statusLedMesh = ledMesh;

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

function drawChassisFastener(context: CanvasRenderingContext2D, cx: number, cy: number): void {
  context.save();
  context.translate(cx, cy);
  context.fillStyle = "#0a0e16";
  context.beginPath();
  context.arc(0, 0, 7.5, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "#334155";
  context.lineWidth = 1.2;
  context.stroke();

  context.fillStyle = "#64748b";
  context.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    const hx = Math.cos(angle) * 5;
    const hy = Math.sin(angle) * 5;
    if (i === 0) context.moveTo(hx, hy);
    else context.lineTo(hx, hy);
  }
  context.closePath();
  context.fill();

  context.strokeStyle = "#1e293b";
  context.lineWidth = 1.2;
  context.beginPath();
  context.moveTo(-2.4, 0);
  context.lineTo(2.4, 0);
  context.moveTo(0, -2.4);
  context.lineTo(0, 2.4);
  context.stroke();
  context.restore();
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
  context.fillStyle = meta.accent;
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

  // Pillar 2: 4 corner chassis fasteners on every facet
  drawChassisFastener(context, 38, 36);
  drawChassisFastener(context, 602, 36);
  drawChassisFastener(context, 38, 924);
  drawChassisFastener(context, 602, 924);

  const blurAmount = card.blurStep ?? 1;
  const texture = new THREE.CanvasTexture(blurAmount <= 0 ? canvas : blurCardCanvas(canvas, card, blurAmount));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

/** Soft-focus copy of a card face, shown until the card is chosen. */
function blurCardCanvas(source: HTMLCanvasElement, card: SystemCard, amount: number): HTMLCanvasElement {
  const blurred = document.createElement("canvas");
  blurred.width = 320;
  blurred.height = 480;
  const context = blurred.getContext("2d");
  if (!context) return source;
  const small = document.createElement("canvas");
  small.width = Math.round(THREE.MathUtils.lerp(140, 26, amount));
  small.height = Math.round(small.width * 1.5);
  const smallContext = small.getContext("2d");
  if (smallContext) {
    smallContext.imageSmoothingEnabled = true;
    smallContext.drawImage(source, 0, 0, small.width, small.height);
  }
  context.imageSmoothingEnabled = true;
  context.drawImage(smallContext ? small : source, 0, 0, blurred.width, blurred.height);
  context.fillStyle = `rgba(8, 11, 18, ${(0.28 * amount).toFixed(3)})`;
  context.fillRect(0, 0, blurred.width, blurred.height);
  if (amount >= 0.5) {
    context.fillStyle = "rgba(10, 15, 25, 0.82)";
    context.fillRect(35, 205, 250, 50);
    context.strokeStyle = "#79ded8";
    context.lineWidth = 1.5;
    context.strokeRect(35, 205, 250, 50);
    context.fillStyle = "#f4f5f7";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "700 16px Inter, Arial, sans-serif";
    context.fillText(card.name.split(" · ")[1] ?? card.name, 160, 222);
    context.font = "600 10px Inter, Arial, sans-serif";
    context.fillStyle = "#79ded8";
    context.fillText(card.os, 160, 241);
  }
  return blurred;
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
  context.fillStyle = activeFacet === "top" ? "#70d5cf" : "#70d5cf99";
  context.fillText("▲ FLIP UP · 05 ACTIONS (W)", 320, 18);

  // Bottom edge tab -> 06 TELEMETRY
  context.fillStyle = activeFacet === "bottom" ? "#bca8ff" : "#bca8ff99";
  context.fillText("▼ FLIP DOWN · 06 TELEMETRY (S)", 320, 952);

  // Left edge vertical tab -> 03 SECURITY
  context.save();
  context.translate(15, 480);
  context.rotate(-Math.PI / 2);
  context.fillStyle = activeFacet === "left" ? "#8baef0" : "#8baef099";
  context.fillText("◀ FLIP LEFT · 03 SECURITY (A)", 0, 0);
  context.restore();

  // Right edge vertical tab -> 04 PLANES
  context.save();
  context.translate(625, 480);
  context.rotate(Math.PI / 2);
  context.fillStyle = activeFacet === "right" ? "#eea3a6" : "#eea3a699";
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
  if (card.twisted) {
    // Compact single-line header when twisted so the display port gets maximum room on the card.
    context.fillStyle = card.color;
    context.font = "700 20px Inter, Arial, sans-serif";
    context.fillText(`${card.os} · ${card.name.split(" · ")[1] ?? card.name}`, 42, 116);
  } else {
    drawCompanyLogo(context, 534, 112, 54, true);
    context.fillStyle = card.color;
    context.font = "700 21px Inter, Arial, sans-serif";
    context.fillText(card.os, 48, 133);

    context.fillStyle = "#f4f5f7";
    context.font = "700 52px Inter, Arial, sans-serif";
    drawWrappedText(context, card.name.split(" · ")[1] ?? card.name, 48, 192, 530, 58, 2);

    context.fillStyle = "#c3c8d1";
    context.font = "500 25px Inter, Arial, sans-serif";
    drawWrappedText(context, card.detail, 48, 280, 530, 34, 2);
  }

  drawMockDisplay(context, card);
  drawCardButtons(context, card);

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

function cardButtonStates(card: SystemCard): Record<CardButtonId, { label: string; enabled: boolean }> {
  const os = cardToGuestOs(card);
  const status = guestServiceStatus;
  const guest = status?.guests.find((item) => item.os === os && item.cardId === card.id);
  const hasDisk =
    os === "windows"
      ? (status?.installedWindowsCardIds?.includes(card.id) ?? false) ||
        (/^windows[-_]/.test(card.id) && (status?.installedWindowsCardIds?.includes("windows") ?? false))
      : (status?.preparedCardIds.includes(card.id) ?? false);
  const actionState = getOnCardActionState({
    os,
    guestStatus: guest?.status,
    baseReady: status?.baseReady ?? false,
    hasDisk,
    canMoveToBin: card.removable !== false && cards.length > 1,
  });
  const running = guest?.status === "running";
  return {
    guest: { label: actionState.guestLabel, enabled: !actionState.guestDisabled },
    stop: { label: "Stop", enabled: running },
    zoom: { label: cardZoomed ? "Zoom out" : "Zoom", enabled: true },
    settings: { label: "Settings", enabled: true },
    clone: { label: "Clone", enabled: true },
    savepoint: { label: "Save", enabled: running },
    performance: { label: "Perf", enabled: true },
    bin: { label: "Bin", enabled: actionState.showBin },
  };
}

function drawCardButtons(context: CanvasRenderingContext2D, card: SystemCard): void {
  const states = cardButtonStates(card);
  context.save();
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const [index, id] of CARD_BUTTON_IDS.entries()) {
    const rect = cardButtonRect(index);
    const { label, enabled } = states[id];
    const danger = id === "bin" || id === "stop";
    const accent = danger ? "#e495a4" : id === "guest" ? card.color : "#79ded8";
    context.globalAlpha = enabled ? 1 : 0.38;
    context.fillStyle = id === "guest" && enabled ? `${card.color}33` : "#07090ee8";
    roundRect(context, rect.x, rect.y, rect.w, rect.h, 10);
    context.fill();
    context.strokeStyle = `${accent}b0`;
    context.lineWidth = 2;
    roundRect(context, rect.x, rect.y, rect.w, rect.h, 10);
    context.stroke();
    context.fillStyle = "#f4f5f7";
    context.font = "700 18px Inter, Arial, sans-serif";
    context.fillText(label.toUpperCase(), rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
  }
  context.restore();
}

function runCardButton(id: CardButtonId, card: SystemCard): void {
  if (trashFlight || pendingTrash) return;
  if (!cardButtonStates(card)[id].enabled) return;
  switch (id) {
    case "guest":
      openOrStartSelectedGuest(card);
      break;
    case "stop":
      void shutdownGuest(card);
      break;
    case "settings":
      flipCardTo(card, "back");
      break;
    case "bin":
      beginCardBinFlight(card);
      break;
    case "zoom":
      runCardExtra("zoom", card);
      refreshCardTexture(card, true);
      break;
    case "clone":
      runCardExtra("clone", card);
      break;
    case "savepoint":
      runCardExtra("savepoint", card);
      break;
    case "performance":
      runCardExtra("performance", card);
      break;
  }
}

function drawMockDisplay(context: CanvasRenderingContext2D, card: SystemCard): void {
  const accent = card.color;
  const status = card.status;
  const baseX = GUEST_PREVIEW_X;
  const baseY = GUEST_PREVIEW_Y;
  const width = GUEST_PREVIEW_WIDTH;
  const height = GUEST_PREVIEW_HEIGHT;
  const x = card.twisted ? 36 : baseX;
  const y = card.twisted ? 132 : baseY;
  const dispW = card.twisted ? 568 : width;
  const dispH = card.twisted ? 568 : height;
  const showLiveOnCard =
    (card.liveCanvas && card === selectedCard) ||
    Boolean(card.liveCanvas && isCardPulledToFront(card));

  // Pillar 2: Outer Chamfered Hardware Screen Bezel
  context.save();
  const bezelGrad = context.createLinearGradient(x - 5, y - 5, x + dispW + 5, y + dispH + 5);
  bezelGrad.addColorStop(0, "#2d3748");
  bezelGrad.addColorStop(0.5, "#141a24");
  bezelGrad.addColorStop(1, "#0a0d14");
  context.strokeStyle = bezelGrad;
  context.lineWidth = 5;
  roundRect(context, x - 2.5, y - 2.5, dispW + 5, dispH + 5, 24);
  context.stroke();
  context.restore();

  context.save();
  roundRect(context, x, y, dispW, dispH, 22);
  context.clip();

  if (showLiveOnCard && card.liveCanvas) {
    context.drawImage(card.liveCanvas, x, y, dispW, dispH);
  } else if (card.liveCanvas) {
    context.fillStyle = "#0D111A";
    context.fillRect(x, y, dispW, dispH);
    context.strokeStyle = `${accent}55`;
    context.lineWidth = 2;
    roundRect(context, x + 12, y + 12, dispW - 24, dispH - 24, 16);
    context.stroke();
    context.fillStyle = "#8A909E";
    context.textAlign = "center";
    context.font = "700 18px Inter, Arial, sans-serif";
    context.fillText("PRIVATE DISPLAY", x + dispW / 2, y + dispH / 2 - 7);
    context.font = "500 14px Inter, Arial, sans-serif";
    context.fillText("SELECT CARD TO REVEAL", x + dispW / 2, y + dispH / 2 + 19);
    context.textAlign = "left";
  } else {
    const wallpaper = context.createLinearGradient(x, y, x + dispW, y + dispH);
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
    context.fillRect(x, y, dispW, dispH);

    context.fillStyle = `${accent}45`;
    context.beginPath();
    context.ellipse(428, 526, 178, 126, -0.42, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#9c92e63c";
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
      context.strokeStyle = `${accent}70`;
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
      context.fillStyle = accent;
      context.fillText("Darwin 24.1.0 · QEMU Virtual AppleSMC (Eco 2 GiB)", x + 78, y + 146);
    } else if (card.id === "postcard-os" || card.os === "RUST KERNEL") {
      // Bare-Metal Rust Immediate-Mode HUD ("Post Card OS // Mission Control") + v1.0.4 Boot Console
      renderNativeHudToCanvas(
        context,
        x + 20,
        y + 46,
        dispW - 40,
        246,
        latestKernelTelemetry,
      );
    }
  }

  if (((card === selectedCard && card.serialOutput) || (isCardPulledToFront(card) && card.serialOutput)) && card.serialOutput.trim().length > 0) {
    context.fillStyle = "#07090ee0";
    context.fillRect(x, y + dispH - 114, dispW, 58);
    context.fillStyle = "#8a909e";
    context.font = "700 13px Inter, Arial, sans-serif";
    context.fillText("SERIAL PIPE (ttyS0 / COM1) · LIVE VM OUTPUT", x + 16, y + dispH - 94);
    context.fillStyle = "#f4f5f7";
    context.font = "500 14px monospace";
    const lastLines = card.serialOutput
      .trim()
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .slice(-2)
      .join("  |  ");
    drawWrappedText(context, lastLines, x + 16, y + dispH - 72, dispW - 32, 18, 1);
  }

  context.fillStyle = "#07090ee8";
  context.fillRect(x, y + dispH - 56, dispW, 56);
  for (const [index, color] of ["#8a909e", "#FFB81C", "#8a909e", "#FFB81C"].entries()) {
    context.fillStyle = color;
    roundRect(context, x + (dispW - 175) / 2 + index * 50, y + dispH - 41, 25, 25, 7);
    context.fill();
  }

  context.fillStyle = "#f4f5f7";
  context.textAlign = "center";
  context.font = "700 17px Inter, Arial, sans-serif";
  context.fillText(
    showLiveOnCard
      ? "LIVE VNC FRAMEBUFFER MIRRORED ON 3D CARD"
      : card.liveCanvas
        ? "PRIVATE GUEST DISPLAY"
        : status === "GUEST · CONNECTED"
          ? "LIVE QEMU GUEST ACTIVE"
          : "SPATIAL GUEST SURFACE",
    x + dispW / 2,
    y + 34,
  );
  context.textAlign = "left";

  // Pillar 2: Subtle CRT curvature vignette & glass specular reflection
  const vignette = context.createRadialGradient(
    x + dispW / 2, y + dispH / 2, Math.min(dispW, dispH) * 0.44,
    x + dispW / 2, y + dispH / 2, Math.max(dispW, dispH) * 0.72
  );
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.4)");
  context.fillStyle = vignette;
  context.fillRect(x, y, dispW, dispH);

  const gloss = context.createLinearGradient(x, y, x + dispW * 0.65, y + dispH * 0.45);
  gloss.addColorStop(0, "rgba(255, 255, 255, 0.08)");
  gloss.addColorStop(0.35, "rgba(255, 255, 255, 0.02)");
  gloss.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = gloss;
  context.fillRect(x, y, dispW, dispH * 0.52);

  context.restore();

  context.strokeStyle = card.twisted ? "#79ded8cc" : "#8a909e69";
  context.lineWidth = card.twisted ? 3 : 2;
  roundRect(context, x, y, dispW, dispH, 22);
  context.stroke();

  // Corner twist tab: shows clearly that any pulled-to-front card can be twisted bigger in place.
  const tabW = 166;
  const tabH = 34;
  const tabX = x + dispW - tabW - 10;
  const tabY = y + 10;
  context.save();
  context.fillStyle = card.twisted ? "rgba(121, 222, 216, 0.24)" : "rgba(10, 15, 25, 0.88)";
  roundRect(context, tabX, tabY, tabW, tabH, 9);
  context.fill();
  context.strokeStyle = "#79ded8";
  context.lineWidth = 1.8;
  roundRect(context, tabX, tabY, tabW, tabH, 9);
  context.stroke();
  context.fillStyle = "#e8ffff";
  context.font = "700 14px Inter, Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(card.twisted ? "⤡ UNTWIST SCREEN" : "⤢ TWIST BIGGER", tabX + tabW / 2, tabY + tabH / 2 + 1);
  context.restore();
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
  const customIso = guestServiceStatus?.customIsos?.[card.id];
  const customIsoBase = customIso ? (customIso.split(/[\\/]/).pop() ?? customIso) : "";
  const rows: [string, string][] = [
    [
      "MACHINE & VIRTUAL CPU",
      card.id === "linux"
        ? `DirectLink 10.0.0.2 + QEMU q35 · ${cpuProfile.toUpperCase()} (${vcpus} vCPU)`
        : isLinux
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
      "STORAGE & CUSTOM OS ISO",
      customIso
        ? `💿 Custom OS: ${customIsoBase} → ${card.id}.qcow2`
        : isLinux
          ? `QCOW2 CoW overlay (${card.id}.qcow2) · Click to load custom ISO`
          : isWindows
            ? `Persistent 64 GiB QCOW2 (${card.id}.qcow2) · Click to load ISO`
            : `QCOW2 CoW overlay (${card.id}.qcow2) · Click to load custom ISO`,
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

  const wsHost = window.location.hostname || "127.0.0.1";
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsPort = guest?.websocketPort ? `${wsProtocol}//${wsHost}:${guest.websocketPort}` : "Unbound (offline)";
  const slot = guest?.websocketPort ? guest.websocketPort - 5700 : null;
  const qmpPort = slot !== null ? `tcp://127.0.0.1:${4444 + slot}` : "Unbound (offline)";
  const serialPort =
    slot !== null
      ? `tcp://127.0.0.1:${4544 + slot} (ttyS0 / COM1)`
      : `Standby · 127.0.0.1:4544+slot (ttyS0)`;

  const rows: [string, string][] = [
    ["RUNTIME PHASE", guest ? `${guest.status.toUpperCase()} (${guest.bootMode ?? "disk"})` : card.status],
    ["VIRTUAL CPU & STUDIO GPU", `${cpuProfile.toUpperCase()} (${allocatedVcpus} / ${hostCap} vCPU) · 3D: ${studioGraphicsProfile.toUpperCase()}`],
    ["NOVNC & QMP SOCKETS", `${wsPort} · ${qmpPort}`],
    ["PA-ROMY COPROCESSOR VAULT", `${latestKernelTelemetry.romy_coprocessor_state} · HEAP: ${latestKernelTelemetry.heap_pressure}% (${latestKernelTelemetry.heap_usage_kb} KB)`],
    ["STREAMLINED GUEST POOL", `${activeCount} / 6 VMs active · ${usedRamMb} / 8192 MiB RAM · ${serialPort}`],
  ];

  drawKeyValueRows(context, rows, 286, 88);

  // Pillar 3: Realtime Sparkline Waveform & vCPU Grid on Facet 06
  const sparkX = 42;
  const sparkY = 730;
  const sparkW = 556;
  const sparkH = 70;
  context.fillStyle = "#07090ee8";
  roundRect(context, sparkX, sparkY, sparkW, sparkH, 12);
  context.fill();
  context.strokeStyle = "#8a909e45";
  context.lineWidth = 1.5;
  roundRect(context, sparkX, sparkY, sparkW, sparkH, 12);
  context.stroke();

  // Grid subdivisions
  context.strokeStyle = "rgba(138, 144, 158, 0.15)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(sparkX, sparkY + 24);
  context.lineTo(sparkX + sparkW, sparkY + 24);
  context.moveTo(sparkX, sparkY + 46);
  context.lineTo(sparkX + sparkW, sparkY + 46);
  context.stroke();

  // Live sparkline trace
  const isGuestActive = guest?.status === "running";
  context.strokeStyle = isGuestActive ? "#22c55e" : "#70d5cf";
  context.lineWidth = 2.2;
  context.beginPath();
  for (let i = 0; i < 22; i++) {
    const px = sparkX + 16 + (i * (sparkW - 32)) / 21;
    const wave = isGuestActive
      ? Math.sin(i * 1.4 + (guest?.websocketPort ?? 0)) * 14 + Math.cos(i * 2.3) * 7
      : Math.sin(i * 0.9) * 3.5;
    const py = sparkY + 38 + wave;
    if (i === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.stroke();

  context.fillStyle = isGuestActive ? "#22c55e" : "#70d5cf";
  context.font = "700 12.5px 'DM Mono', monospace";
  context.fillText(
    isGuestActive ? "LIVE vCPU WAVEFORM · REALTIME KVM BURST" : "STANDBY TELEMETRY · 0.0% vCPU",
    sparkX + 16,
    sparkY + 17,
  );

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
  const pose = carouselPoseFromAngle(theta);
  return new THREE.Vector3(pose.x, pose.y, pose.z);
}

function cardDisplayRotation(card: SystemCard): number {
  const cameraBearing = Math.atan2(
    camera.position.x - card.group.position.x,
    camera.position.z - card.group.position.z,
  );
  // Swivel continuously with distance from the front slot so cards turn
  // smoothly as they ride the ring instead of snapping when selection changes.
  // Side cards stay mostly facing the viewer (blur keeps them private) with a
  // gentle inward angle so the ring reads as a wheel, not a single card.
  const flatBench = Boolean(card.twisted || (benchCount > 1 && isCardPulledToFront(card)));
  const edgeOn = flatBench
    ? 0
    : THREE.MathUtils.smoothstep(Math.abs(card.orbitAngle) / (getSlotStep() * 0.95), 0, 1);
  return cameraBearing + card.targetRotation + Math.sign(card.orbitAngle) * edgeOn * (Math.PI * 0.12);
}

function wheelPosition(index: number): THREE.Vector3 {
  const slotStep = getSlotStep();
  return orbitPositionFromAngle(normalizeAngle(index * slotStep + turntableAngle));
}

/**
 * While zoomed into a card the turntable is locked: scrolling, dragging, arrow
 * keys and side-card clicks do nothing until you zoom back out.
 */
let lastLockHint = 0;
function turntableLocked(): boolean {
  if (!cardZoomed) return false;
  const now = performance.now();
  if (now - lastLockHint > 2500) {
    lastLockHint = now;
    showToast("Turntable locked while zoomed · press Z, Esc, or click empty space to zoom out.");
  }
  return true;
}

function cycleCarousel(dir: 1 | -1, withAnticipation = true): void {
  if (trashFlight || pendingTrash) return;
  if (turntableLocked()) return;
  if (prefersReducedMotion()) {
    const nextIndex = (selectedIndex + dir + cards.length) % cards.length;
    selectCard(cards[nextIndex]);
    return;
  }
  const slotStep = getSlotStep();
  if (withAnticipation && selectedCard) {
    // Gentle lean into the turn; the ring itself glides with no instant jump.
    selectedCard.tiltZ = -dir * 0.1;
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

function updateRoomCardNav(): void {
  roomCardNavElement.replaceChildren();
  for (const [index, card] of cards.entries()) {
    const button = document.createElement("button");
    button.className = "room-card-link";
    button.type = "button";
    button.dataset.roomCard = "";
    button.dataset.cardId = card.id;
    button.setAttribute("aria-label", `Select ${card.name}`);
    button.setAttribute("aria-pressed", String(card === selectedCard));
    const number = document.createElement("span");
    number.className = "room-card-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const name = document.createElement("span");
    name.className = "room-card-link-name";
    name.textContent = card.name;
    button.append(number, name);
    roomCardNavElement.append(button);
  }
}

function updateRoomSelection(): void {
  if (!selectedCard) return;
  roomSelectedNameElement.textContent = selectedCard.name;
  const guestOs = cardToGuestOs(selectedCard);
  const guest = guestServiceStatus?.guests.find(
    (item) => item.os === guestOs && item.cardId === selectedCard?.id,
  );
  const state =
    guest?.status === "running"
      ? "LOCAL GUEST · RUNNING"
      : guest?.status === "starting"
        ? "LOCAL GUEST · STARTING"
        : guest?.status === "stopping"
          ? "LOCAL GUEST · STOPPING"
          : guest?.status === "error"
            ? "LOCAL GUEST · ERROR"
            : guest?.status === "offline"
              ? "LOCAL GUEST · OFFLINE"
              : selectedCard.status.includes("OFFLINE")
                ? "DEMO · DISCONNECTED"
                : selectedCard.status;
  roomSelectedStatusElement.textContent = state;
  roomSelectedStatusElement.dataset.state = guest?.status ?? "demo";
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
  // Programmatic moves (clone, bin, restore) release the zoom lock first.
  if (cardZoomed && selectedCard && card !== selectedCard) toggleCardZoom(false);
  const previousCard = selectedCard;
  const slotStep = getSlotStep();
  const slotAngle = targetIndex * slotStep;
  const currentTheta = normalizeAngle(slotAngle + turntableAngle);

  if (withAnticipation && Math.abs(currentTheta) > 0.1) {
    const dir = currentTheta > 0 ? 1 : -1;
    if (selectedCard) selectedCard.tiltZ = -dir * 0.1;
  }
  targetTurntableAngle = turntableAngle - currentTheta;
  if (prefersReducedMotion()) {
    turntableAngle = targetTurntableAngle;
  }

  selectedIndex = targetIndex;
  selectedCard = card;
  refreshPrivateGuestPreview(previousCard, card);
  for (const item of cards) item.layoutOffset.set(0, 0, 0);
  updateGuestActionButton();
  updateFacetBarUI();
  updateRoomCardNav();
  updateRoomSelection();
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
      material.emissive.set(item === card ? "#70d5cf" : "#152631");
      material.emissiveIntensity = item === card ? 0.62 : 0.22;
    }
  }
}

function refreshPrivateGuestPreview(
  previousCard: SystemCard | null,
  nextCard: SystemCard | null,
): void {
  if (previousCard === nextCard) return;
  // Blur in/out is eased per frame in updateCardFocus(); live previews still need a redraw.
  for (const card of [previousCard, nextCard]) {
    if (card && cards.includes(card)) refreshCardTexture(card, true);
  }
}

function updateGuestActionButton(status = guestServiceStatus): void {
  updateRoomSelection();
  const card = selectedCard;
  resetButtonElement.disabled = !card;
  cloneButtonElement.disabled = !card;
  updateOnCardActions(status);
}

function updateOnCardActions(status = guestServiceStatus): void {
  const card = selectedCard;
  cardActionStripElement.hidden = !card || trashFlight?.card === card || pendingTrash?.card === card;
  if (!card) return;
  cardActionStripElement.setAttribute("aria-label", `Actions for ${card.name}`);

  const os = cardToGuestOs(card);
  const guest = status?.guests.find((item) => item.os === os && item.cardId === card.id);
  const hasDisk =
    os === "windows"
      ? (status?.installedWindowsCardIds?.includes(card.id) ?? false) ||
        (/^windows[-_]/.test(card.id) &&
          (status?.installedWindowsCardIds?.includes("windows") ?? false))
      : (status?.preparedCardIds.includes(card.id) ?? false);
  const actionState = getOnCardActionState({
    os,
    guestStatus: guest?.status,
    baseReady: status?.baseReady ?? false,
    hasDisk,
    canMoveToBin:
      card.removable !== false &&
      cards.length > 1 &&
      !trashFlight &&
      !pendingTrash,
  });
  const actionsLocked = Boolean(trashFlight || pendingTrash);
  const guestLabel = cardGuestActionElement.querySelector<HTMLElement>(".card-action-label");
  if (guestLabel) guestLabel.textContent = actionState.guestLabel;
  cardGuestActionElement.disabled = actionState.guestDisabled || actionsLocked;
  cardGuestActionElement.title =
    actionState.guestLabel === "Open"
      ? `Open ${card.name} guest display`
      : `${actionState.guestLabel} ${card.name}`;
  cardGuestActionElement.setAttribute("aria-label", cardGuestActionElement.title);
  cardShutdownActionElement.hidden = !actionState.showShutdown;
  cardShutdownActionElement.disabled = actionState.shutdownDisabled || actionsLocked;
  cardShutdownActionElement.title = `Request graceful shutdown for ${card.name}`;
  cardShutdownActionElement.setAttribute("aria-label", cardShutdownActionElement.title);
  const settingsLabel = cardSettingsActionElement.querySelector<HTMLElement>(".card-action-label");
  const isOnSettings = card.facet === "back";
  if (settingsLabel) settingsLabel.textContent = isOnSettings ? "Display" : "Settings";
  cardSettingsActionElement.title = isOnSettings
    ? `Flip ${card.name} back to its display`
    : `Flip ${card.name} to settings`;
  cardSettingsActionElement.setAttribute("aria-label", cardSettingsActionElement.title);
  cardSettingsActionElement.disabled = actionsLocked;
  cardBinActionElement.hidden = !actionState.showBin;
  cardBinActionElement.disabled = actionsLocked;
  cardBinActionElement.title = `Move ${card.name} to the paper bin`;
  cardBinActionElement.setAttribute("aria-label", cardBinActionElement.title);
  cardDeleteActionElement.hidden = !actionState.showDelete;
  cardDeleteActionElement.disabled = actionsLocked;
  cardDeleteActionElement.title = `Delete ${card.name} and its guest data permanently`;
  cardDeleteActionElement.setAttribute("aria-label", cardDeleteActionElement.title);
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
    Array.isArray(value.deletedCardIds) &&
    value.deletedCardIds.every((id) => typeof id === "string") &&
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
        (guest.qmpPort === null || typeof guest.qmpPort === "number") &&
        typeof guest.diskPath === "string",
    )
  );
}

async function requestGuestApi(
  endpoint: string,
  body?: Record<string, unknown>,
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
  const binnedCountBefore = binnedCards.size;
  guestServiceStatus = status;
  if (status.telemetry) {
    latestKernelTelemetry = status.telemetry;
    applyTelemetryToDom(latestKernelTelemetry);
  }
  cardIdRegistryReady = true;
  for (const id of status.deletedCardIds) {
    legacyDeletedCardIds.delete(id);
    deletedCardIds.add(id);
    binnedCards.delete(id);
  }
  persistCardState();
  if (binnedCards.size !== binnedCountBefore) updateBinDialog();
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
    if (card.statusLedMat) {
      if (displayStatus.includes("CONNECTED") || displayStatus.includes("INSTALLER")) {
        card.statusLedMat.color.set("#22c55e");
        card.statusLedMat.emissive.set("#16a34a");
        card.statusLedMat.emissiveIntensity = 1.35;
      } else if (displayStatus.includes("STARTING") || displayStatus.includes("SHUTTING")) {
        card.statusLedMat.color.set("#f59e0b");
        card.statusLedMat.emissive.set("#d97706");
        card.statusLedMat.emissiveIntensity = 1.1;
      } else if (displayStatus.includes("ERROR")) {
        card.statusLedMat.color.set("#ef4444");
        card.statusLedMat.emissive.set("#dc2626");
        card.statusLedMat.emissiveIntensity = 1.5;
      } else if (displayStatus.includes("READY") || displayStatus.includes("OFFLINE")) {
        card.statusLedMat.color.set("#06b6d4");
        card.statusLedMat.emissive.set("#0891b2");
        card.statusLedMat.emissiveIntensity = 0.55;
      } else {
        card.statusLedMat.color.set("#475569");
        card.statusLedMat.emissive.set("#1e293b");
        card.statusLedMat.emissiveIntensity = 0.25;
      }
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
  const targetCustomIso = status.customIsos?.[guestTargetCardId ?? ""];
  guestWakeScreenButtonElement.disabled =
    !targetRunning || !targetGuest?.qmpPort;
  if (guestPasteClipboardButton) {
    guestPasteClipboardButton.disabled = !targetRunning || !targetGuest?.qmpPort;
  }
  const targetHasDisk =
    guestTargetOs === "windows"
      ? (status.installedWindowsCardIds?.includes(guestTargetCardId ?? "") ?? false)
      : status.baseReady || status.preparedCardIds.includes(guestTargetCardId ?? "");
  guestInstallButtonElement.disabled =
    targetBusy ||
    (guestTargetOs === "linux" && !targetCustomIso && !targetRunning && (status.baseReady || activeGuests.length > 0));
  guestFinalizeBaseButtonElement.disabled =
    guestTargetOs !== "linux" ||
    Boolean(targetCustomIso) ||
    !status.baseDiskExists ||
    status.baseReady ||
    activeGuests.length > 0;
  guestFinalizeBaseButtonElement.hidden = guestTargetOs !== "linux" || Boolean(targetCustomIso);
  guestBootDiskButtonElement.disabled = !targetHasDisk || targetBusy;
  guestCloneCardButtonElement.disabled = Boolean(targetBusy || targetRunning);
  guestResetOverlayButtonElement.disabled = Boolean(targetBusy || targetRunning);
  const targetHasPlanes = Boolean(
    status.paperPlanes?.some((plane) => plane.toCardId === guestTargetCardId) ||
      (cards.find((c) => c.id === guestTargetCardId)?.receivedNotes.length ?? 0) > 0,
  );
  guestInjectPlaneButtonElement.disabled = !targetRunning || !targetHasPlanes;
  guestShutdownButtonElement.disabled = !targetRunning;
  guestForceStopButtonElement.disabled = !targetRunning;
  updateGuestDialogCopy();

  if (!reconcilingDeletedCards) {
    const confirmedDeletedCards = cards.filter((card) => deletedCardIds.has(card.id));
    if (confirmedDeletedCards.length > 0) {
      reconcilingDeletedCards = true;
      try {
        for (const card of confirmedDeletedCards) {
          if (pendingTrash?.card === card) {
            pendingTrash = undefined;
            trashFlight = undefined;
            trashDeleteInProgress = false;
            if (trashDialogElement.open) trashDialogElement.close();
          }
          removeCardFromRoom(card, status);
        }
      } finally {
        reconcilingDeletedCards = false;
      }
    }
  }
}

function computeCardContentKey(card: SystemCard): string {
  const guestOs = cardToGuestOs(card);
  const guest = guestServiceStatus?.guests.find(
    (item) => item.os === guestOs && item.cardId === card.id,
  );
  const activeCount =
    guestServiceStatus?.guests.filter(
      (g) => g.status === "running" || g.status === "starting" || g.status === "stopping",
    ).length ?? 0;
  const hasPrivateStream = Boolean(card.liveCanvas || card.serialOutput);
  return [
    card.status,
    card.facet,
    card.backFaceVisible ? "B" : "F",
    card.twisted ? "T1" : "T0",
    hasPrivateStream && isCardPulledToFront(card) ? "PF" : "PB",
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
    guestServiceStatus?.customIsos?.[card.id] ?? "",
    studioGraphicsProfile,
    activeCount,
    latestKernelTelemetry.romy_coprocessor_state,
    latestKernelTelemetry.heap_pressure,
  ].join("|");
}

function computeCardTextureKey(card: SystemCard): string {
  return `${computeCardContentKey(card)}|b${card.blurStep ?? 1}`;
}

function refreshCardTexture(card: SystemCard, force = false): void {
  const contentKey = computeCardContentKey(card);
  const nextKey = `${contentKey}|b${card.blurStep ?? 1}`;
  if (!card.liveCanvas && card.lastTextureKey === nextKey && !force) {
    return;
  }
  card.lastTextureKey = nextKey;

  if (card.cachedContentKey !== contentKey || card.liveCanvas) {
    card.cachedSharpTexture?.dispose();
    card.cachedBlurredTexture?.dispose();
    card.cachedSharpTexture = undefined;
    card.cachedBlurredTexture = undefined;
    card.cachedContentKey = contentKey;
  }

  const visibleFaceName = card.backFaceVisible ? "back" : "front";
  const isBlurred = (card.blurStep ?? 1) > 0;
  let visibleTexture = isBlurred ? card.cachedBlurredTexture : card.cachedSharpTexture;
  if (!visibleTexture) {
    visibleTexture = makeCardTexture(card, card.facet);
    if (!card.liveCanvas) {
      if (isBlurred) {
        card.cachedBlurredTexture = visibleTexture;
      } else {
        card.cachedSharpTexture = visibleTexture;
      }
    }
  }

  for (const child of card.group.children.slice(1)) {
    if (!(child instanceof THREE.Mesh) || !(child.material instanceof THREE.MeshStandardMaterial)) {
      continue;
    }
    if (child.userData.face !== visibleFaceName) {
      continue;
    }
    if (child.material.map !== visibleTexture) {
      if (
        child.material.map &&
        child.material.map !== card.cachedSharpTexture &&
        child.material.map !== card.cachedBlurredTexture
      ) {
        child.material.map.dispose();
      }
      child.material.map = visibleTexture;
      child.material.emissiveMap = visibleTexture;
      child.material.needsUpdate = true;
    }
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
  const customIso = guestServiceStatus?.customIsos?.[guestTargetCardId ?? ""];
  const customIsoBase = customIso ? (customIso.split(/[\\/]/).pop() ?? customIso) : "";
  if (guestCustomIsoButton) {
    guestCustomIsoButton.textContent = customIsoBase
      ? `💿 ISO: ${customIsoBase.slice(0, 22)}`
      : "💿 Custom OS ISO";
    guestCustomIsoButton.title = customIso
      ? `Attached custom OS image: ${customIso} (Click to change or clear)`
      : "Attach your own OS .iso, .img, or .qcow2 image to this card";
  }
  const kicker = guestDialogElement.querySelector<HTMLElement>(".dialog-kicker");
  const footer = guestDialogElement.querySelector<HTMLElement>(".guest-window-footer > p");
  if (kicker) {
    kicker.textContent = customIsoBase
      ? `CUSTOM OS IMAGE · ${customIsoBase.toUpperCase()} · QEMU`
      : isWindows
        ? "WINDOWS GUEST · WSL QEMU · TPM 2.0 · ECO RAM"
        : isAndroid
          ? "ANDROID GUEST · QEMU · ECO RAM"
          : isMacOs
            ? "MACOS / DARWIN GUEST · OPENCORE UEFI · ECO RAM"
            : "LINUX GUEST · QEMU · ECO RAM";
  }
  if (footer) {
    footer.textContent = customIso
      ? `Custom OS image attached (${customIso}). Booting the installer provisions an isolated standalone disk for this card without touching shared base images.`
      : isWindows
        ? "Windows uses a persistent 64 GiB disk, UEFI firmware, a per-card software TPM 2.0, and a virtio-balloon device."
        : isAndroid
          ? "Android cards boot the official Android-x86 Live/Install system with private persistent virtual disk and virtio-balloon."
          : isMacOs
            ? "macOS / Darwin cards use a q35 + OpenCore UEFI + AppleSMC profile with 2 GiB Eco RAM and a virtio-balloon device on a private QCOW2 overlay."
            : "Install Debian once as the golden base, shut it down, then finish the base. Up to six cards can run at once with virtio-balloon devices and independent QCOW2 overlays.";
  }
  const targetGuest = guestServiceStatus?.guests.find(
    (item) => item.os === guestTargetOs && item.cardId === guestTargetCardId,
  );
  const targetRunning = targetGuest?.status === "running";

  guestInstallButtonElement.textContent = customIsoBase
    ? (targetRunning ? `⟳ Reboot into ${customIsoBase.slice(0, 20)}` : `Boot / Install ${customIsoBase.slice(0, 24)}`)
    : isWindows
      ? (targetRunning ? "⟳ Reboot Windows" : "Install Windows (your ISO)")
      : isAndroid
        ? (targetRunning ? "⟳ Reboot Android Live/ISO" : "Boot Android Live / Install")
        : isMacOs
          ? (targetRunning ? "⟳ Reboot macOS / Darwin" : "Install macOS / Darwin")
          : (targetRunning ? "⟳ Reboot Debian base" : "Install Debian base");
  guestBootDiskButtonElement.textContent = isWindows
    ? (targetRunning ? "⟳ Reboot Windows" : "Boot Windows")
    : isAndroid
      ? (targetRunning ? "⟳ Reboot Android" : "Boot Android (Disk)")
      : isMacOs
        ? (targetRunning ? "⟳ Reboot macOS" : "Boot macOS")
        : (targetRunning ? "⟳ Reboot Linux" : "Boot this card");
}

function connectGuestDisplay(websocketPort: number, cardId: string): void {
  if (guestRfb) guestRfb.disconnect();
  guestDisplayElement.replaceChildren();
  displayedGuestCardId = cardId;
  setGuestState(`Connecting to the ${guestTargetOs} display…`);
  clearGuestError();
  const wsHost = window.location.hostname || "127.0.0.1";
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const rfb = new RFB(guestDisplayElement, `${wsProtocol}//${wsHost}:${websocketPort}`);
  rfb.viewOnly = false;
  rfb.scaleViewport = true;
  rfb.resizeSession = true;
  rfb.focusOnClick = true;
  rfb.clipViewport = true;
  rfb.addEventListener("connect", () => {
    setGuestState("Live display connected. Click the screen to use guest keyboard and pointer.");
    window.dispatchEvent(new Event("resize"));
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
  displayedGuestCardId = undefined;
  guestDisplayElement.replaceChildren();
}

async function startGuest(bootMode: GuestBootMode, cardId: string): Promise<void> {
  playBootChime();
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
  const isRunning = guestServiceStatus?.guests.some(
    (item) => item.os === guestTargetOs && item.cardId === cardId && item.status === "running",
  );
  if (isRunning) {
    setGuestState(`Stopping current ${guestName} instance to restart…`);
    try {
      await requestGuestApi("/api/guest/force-stop", {
        os: guestTargetOs,
        cardId,
      });
      if (displayedGuestCardId === cardId) disconnectGuestDisplay();
    } catch {
      // ignore stop error
    }
  }

  setGuestState(
    bootMode === "installer"
      ? `Launching ${guestName} installer…`
      : `Booting installed ${guestName}…`,
  );
  guestInstallButtonElement.disabled = true;
  if (selectedCard?.id === cardId) cardGuestActionElement.disabled = true;
  guestFinalizeBaseButtonElement.disabled = true;
  guestBootDiskButtonElement.disabled = true;
  guestCloneCardButtonElement.disabled = true;
  guestResetOverlayButtonElement.disabled = true;
  guestInjectPlaneButtonElement.disabled = true;
  guestShutdownButtonElement.disabled = true;
  guestForceStopButtonElement.disabled = true;
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
    connectGuestDisplay(guest.websocketPort, cardId);
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

async function shutdownGuest(card?: SystemCard): Promise<void> {
  if (card) {
    guestTargetCardId = card.id;
    guestTargetOs = cardToGuestOs(card);
    guestTitleElement.textContent = card.name;
  }
  const targetCardId = guestTargetCardId;
  guestShutdownButtonElement.disabled = true;
  if (card) cardShutdownActionElement.disabled = true;
  setGuestState(`Requesting a graceful ${guestTargetOs} shutdown…`);
  clearGuestError();
  try {
    if (!targetCardId) return;
    const status = await requestGuestApi("/api/guest/stop", {
      os: guestTargetOs,
      cardId: targetCardId,
    });
    if (displayedGuestCardId === targetCardId) disconnectGuestDisplay();
    updateGuestCardStatus(status);
    setGuestState(`${guestTargetOs} guest is shut down.`);
  } catch (error) {
    reportGuestError(error);
    guestShutdownButtonElement.disabled = false;
    if (card) cardShutdownActionElement.disabled = false;
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
    if (displayedGuestCardId === guestTargetCardId) disconnectGuestDisplay();
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

async function wakeGuestScreen(): Promise<void> {
  if (!guestTargetCardId) return;
  guestWakeScreenButtonElement.disabled = true;
  setGuestState(`Sending a harmless Shift wake key to the ${guestTargetOs} guest…`);
  clearGuestError();
  try {
    const status = await requestGuestApi("/api/guest/wake", {
      os: guestTargetOs,
      cardId: guestTargetCardId,
    });
    updateGuestCardStatus(status);
    setGuestState(`Wake key sent to the ${guestTargetOs} guest.`);
  } catch (error) {
    reportGuestError(error);
  } finally {
    if (guestServiceStatus) updateGuestActionButton();
  }
}

async function promptAndSetCustomIso(card: SystemCard): Promise<void> {
  const currentIso = guestServiceStatus?.customIsos?.[card.id] ?? "";
  const input = window.prompt(
    `Enter a custom OS image path (.iso, .img, .qcow2, .raw) for ${card.name} (Windows or WSL path, e.g. \\\\wsl.localhost\\Ubuntu\\home\\user\\my-os.iso). Leave blank to restore default OS image:`,
    currentIso,
  );
  if (input === null) return;
  const trimmed = input.trim();
  try {
    const status = await requestGuestApi("/api/guest/custom-iso", {
      cardId: card.id,
      isoPath: trimmed,
    });
    updateGuestCardStatus(status);
    if (trimmed) {
      const base = trimmed.split(/[\\/]/).pop() ?? trimmed;
      showToast(`💿 Custom OS image attached to ${card.name}: ${base}`);
      if (guestDialogElement.open) {
        const isRunning = status.guests.some(
          (g) => g.cardId === card.id && g.status === "running",
        );
        setGuestState(
          isRunning
            ? `Attached custom OS image: ${base}. Click Reboot to restart into the new image.`
            : `Attached custom OS image: ${base}. Click Boot / Install to launch.`,
        );
      }
    } else {
      showToast(`💿 Restored default OS image for ${card.name}.`);
    }
  } catch (error) {
    reportGuestError(error);
  }
}

async function pasteHostClipboardToVm(): Promise<void> {
  const cardId = guestTargetCardId ?? selectedCard?.id;
  const card = cards.find((c) => c.id === cardId) ?? selectedCard;
  if (!cardId || !card) return;
  const os = cardToGuestOs(card);
  let text = "";
  try {
    if (navigator.clipboard?.readText) {
      text = (await navigator.clipboard.readText()).trim();
    }
  } catch {
    // Fallback to prompt if clipboard permission is not granted
  }
  if (!text) {
    const fallback = window.prompt(`Paste or type text to send directly into ${card.name}:`);
    if (!fallback) return;
    text = fallback.trim();
  }
  if (!text) return;
  try {
    setGuestState(`Typing clipboard text into ${card.name} via QMP…`);
    const status = await requestGuestApi("/api/guest/paper-plane/inject", {
      os,
      cardId,
      message: text.slice(0, 160),
    });
    updateGuestCardStatus(status);
    setGuestState(`Typed ${Math.min(text.length, 160)} characters into ${card.name}.`);
    showToast(`📋 Pasted ${Math.min(text.length, 160)} chars into ${card.name} via QMP!`);
  } catch (error) {
    reportGuestError(error);
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

  fillLight.color.set(secOpsMode ? "#e59ba3" : "#a89bff");
  rimLight.color.set(secOpsMode ? "#a99afa" : "#54d6cf");

  if (secOpsMode) {
    const secOpsDefinitions = [
      {
        id: "kali-red",
        name: "Kali · Red Team",
        os: "LINUX",
        detail: "Agentless QMP recon, exploit verification & hardening.",
        color: "#eaa27f",
        status: guestServiceStatus?.baseReady ? "GUEST · BASE READY" : "DEMO · DISCONNECTED",
      },
      {
        id: "ai-copilot",
        name: "G-III Copilot · Twin-Star",
        os: "LINUX",
        detail: "Day-one neural co-pilot synthesizing & flying Paper Airplanes.",
        color: "#a99afa",
        status: guestServiceStatus?.baseReady ? "GUEST · BASE READY" : "DEMO · DISCONNECTED",
      },
    ];
    for (const def of secOpsDefinitions) {
      if (!deletedCardIds.has(def.id) && !binnedCards.has(def.id) && !cards.some((c) => c.id === def.id)) {
        cards.push(createCard(def, cards.length));
      }
    }
    arrangeCards();
    updateCardCount();
    updateRecipientOptions();
    if (guestServiceStatus) updateGuestCardStatus(guestServiceStatus);
    const kaliCard = cards.find((c) => c.id === "kali-red");
    if (kaliCard) selectCard(kaliCard);
    setBenchCount(3, false);
    showToast("SecOps Cyber Range activated · 3 cards pulled to the front bench (pull any corner to twist bigger).");
  } else {
    setBenchCount(1, false);
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
    const targetCardIds = [
      await allocateCardId("swarm"),
      await allocateCardId("swarm"),
    ];
    const status = await requestGuestApi("/api/guest/swarm-fork", {
      sourceCardId: sourceCard.id,
      os,
      count: "2",
      targetCardIds,
    });
    const createdIds = status.swarmResult?.createdCardIds ?? [
      ...targetCardIds,
    ];
    for (const newId of createdIds) {
      if (cards.some((c) => c.id === newId) || deletedCardIds.has(newId) || binnedCards.has(newId)) continue;
      const idx = cards.length;
      const baseTitle = sourceCard.name.split(" · ")[0] ?? sourceCard.os;
      const swarmCard = createCard(
        {
          id: newId,
          name: `${baseTitle} · Swarm ${newId.slice(newId.lastIndexOf("-") + 1)}`,
          os: sourceCard.os,
          detail: `Parallel Swarm clone of ${sourceCard.name}.`,
          color: sourceCard.color,
          status: sourceCard.status,
        },
        idx,
      );
      swarmCard.clonedFrom = sourceCard.id;
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
  roomCardSummaryElement.textContent = cards.length === 1
    ? "One system is gathered here."
    : `Your ${cards.length} systems are gathered here.`;
  updateRoomCardNav();
  updateOnCardActions();
  updateBinDialog();
}

function updateBinDialog(): void {
  binCountElement.textContent = String(binnedCards.size);
  updatePaperBinModel(binnedCards.size);
  trashTargetElement.setAttribute(
    "aria-label",
    binnedCards.size === 0
      ? "Open the empty paper bin"
      : `Open paper bin with ${binnedCards.size} ${binnedCards.size === 1 ? "card" : "cards"}`,
  );
  binListElement.replaceChildren();
  binEmptyElement.hidden = binnedCards.size > 0;
  for (const entry of [...binnedCards.values()].sort((a, b) => a.record.index - b.record.index)) {
    const item = document.createElement("li");
    item.className = "bin-card-entry";
    const identity = document.createElement("div");
    identity.className = "bin-card-identity";
    const name = document.createElement("strong");
    name.textContent = entry.record.name;
    const id = document.createElement("code");
    id.textContent = entry.record.id;
    identity.append(name, id);
    const restoreButton = document.createElement("button");
    restoreButton.className = "bin-restore-button";
    restoreButton.type = "button";
    restoreButton.textContent = "Restore";
    restoreButton.setAttribute("aria-label", `Restore ${entry.record.name} to the workspace`);
    restoreButton.addEventListener("click", () => restoreCardFromBin(entry.record.id));
    item.append(identity, restoreButton);
    binListElement.append(item);
  }
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

/** Focus pull: the card at the front of the ring sharpens; every other card softens. */
const FOCUS_SETTLE_ANGLE = 0.22;
const FOCUS_SECONDS = 0.18;
const FOCUS_STEPS = 1;
function updateCardFocus(card: SystemCard, dt: number, reduceMotion: boolean): void {
  // Blur tracks the wheel itself: a card sharpens as it rolls into the front
  // slot and softens as it rolls away, so focus and motion stay in step.
  const heldOrFlipping =
    Boolean(card.flipAnim) ||
    Boolean(card.twisted) ||
    (drag?.card === card && (drag.mode === "flip" || drag.mode === "peel"));
  const settleRadius =
    benchCount > 1 && isCardPulledToFront(card)
      ? getSlotStep() * (benchCount === 3 ? 1.18 : 1.12)
      : FOCUS_SETTLE_ANGLE;
  const distance = Math.max(0, Math.abs(card.orbitAngle) - settleRadius);
  const target =
    heldOrFlipping || card.layoutOffset.z > 0.35
      ? 0
      : THREE.MathUtils.smoothstep(distance / (getSlotStep() * 0.45), 0, 1);
  const current = card.blurLevel ?? 1;
  const next = reduceMotion
    ? target
    : current + Math.sign(target - current) * Math.min(Math.abs(target - current), dt / FOCUS_SECONDS);
  card.blurLevel = next;
  const step = Math.round(next * FOCUS_STEPS) / FOCUS_STEPS;
  if (step !== (card.blurStep ?? 1)) {
    card.blurStep = step;
    const wasRevealed = card.revealed;
    card.revealed = step === 0;
    refreshCardTexture(card, false);
    if (card === selectedCard && wasRevealed !== card.revealed) updateOnCardActions();
  }
  const visibleFaceName = card.backFaceVisible ? "back" : "front";
  for (const child of card.group.children.slice(1)) {
    if (
      child instanceof THREE.Mesh &&
      child.material instanceof THREE.MeshStandardMaterial &&
      child.userData.face === visibleFaceName
    ) {
      child.material.emissiveIntensity = THREE.MathUtils.lerp(0.84, 0.5, next);
    }
  }
}

function flipCardTo(card: SystemCard, targetFacet: CardFacet, preferredDir?: 1 | -1): void {
  playCardFlipSound();
  if (!card.revealed) {
    // Flipping always works; sharpen immediately so the new facet is readable.
    card.blurLevel = 0;
    card.blurStep = 0;
    card.revealed = true;
  }
  if (card.facet === targetFacet) {
    targetFacet = card.facet === "front" ? "back" : "front";
  }

  // Pre-render upcoming target facet onto hidden face mesh before rotation starts
  const upcomingFaceName = card.backFaceVisible ? "front" : "back";
  for (const child of card.group.children.slice(1)) {
    if (child instanceof THREE.Mesh && child.userData.face === upcomingFaceName) {
      const nextTexture = makeCardTexture(card, targetFacet);
      if (
        child.material.map &&
        child.material.map !== card.cachedSharpTexture &&
        child.material.map !== card.cachedBlurredTexture
      ) {
        child.material.map.dispose();
      }
      child.material.map = nextTexture;
      child.material.emissiveMap = nextTexture;
      child.material.needsUpdate = true;
    }
  }

  const dir: 1 | -1 = preferredDir ?? (targetFacet === "left" ? -1 : 1);
  const targetRot = card.targetRotation + dir * Math.PI;
  if (prefersReducedMotion()) {
    card.targetRotation = targetRot;
    card.facet = targetFacet;
    card.backFaceVisible = !card.backFaceVisible;
    card.flipAnim = undefined;
    refreshCardTexture(card, true);
    if (card === selectedCard) {
      updateFacetBarUI();
      updateOnCardActions();
      selectedNameElement.textContent = `${card.name} · ${FACET_META[card.facet].badge}`;
    }
    showToast(`${card.name} · ${FACET_META[targetFacet].badge} ${FACET_META[targetFacet].shortLabel}`);
    return;
  }
  const startRot = card.group.rotation.y;
  card.targetRotation = targetRot;

  card.flipAnim = {
    startRotationY: startRot,
    startRotationX: card.group.rotation.x,
    targetRotationY: targetRot,
    startTime: performance.now(),
    duration: 1300, // slow, deliberate ease-in-out S-curve
    midpointPassed: false,
    targetFacet,
    tiltDir: dir,
    tiltAxis: targetFacet === "top" || targetFacet === "bottom" ? "x" : "z",
  };

  const meta = FACET_META[targetFacet];
  showToast(`${card.name} · ${meta.badge} ${meta.shortLabel}`);
}

function flipCardToSide(card: SystemCard, targetFacet: "left" | "right", direction: 1 | -1): void {
  if (card.facet !== targetFacet) {
    flipCardTo(card, targetFacet, direction);
  }
}

function toggleCardZoom(force?: boolean): void {
  cardZoomed = typeof force === "boolean" ? force : !cardZoomed;
  if (cardZoomed && selectedCard) {
    // Lock: settle the wheel exactly on the zoomed card and stop any fling.
    targetTurntableAngle = turntableAngle - selectedCard.orbitAngle;
    turntableVelocity = 0;
  }
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

/**
 * Works out what part of the front card was grabbed. Display-side corners peel
 * the screen bigger; otherwise the nearest edge is the one that swings toward you.
 */
function classifyCardGrab(
  card: SystemCard,
  uv: THREE.Vector2,
): { edge: "left" | "right" | "top" | "bottom"; corner?: { x: 1 | -1; y: 1 | -1 }; centerMove?: boolean } {
  const nearX = uv.x < 0.2 ? -1 : uv.x > 0.8 ? 1 : 0;
  const nearY = uv.y < 0.14 ? -1 : uv.y > 0.86 ? 1 : 0;
  if (card.facet === "front" && nearX !== 0 && nearY !== 0) {
    return { edge: nearX > 0 ? "right" : "left", corner: { x: nearX as 1 | -1, y: nearY as 1 | -1 } };
  }
  const centerBody = uv.x >= 0.22 && uv.x <= 0.78 && uv.y >= 0.16 && uv.y <= 0.84;
  // Card is ~1.5x taller than wide; compare physical distances to each edge.
  const distances: Array<["left" | "right" | "top" | "bottom", number]> = [
    ["left", uv.x],
    ["right", 1 - uv.x],
    ["bottom", uv.y * 1.5],
    ["top", (1 - uv.y) * 1.5],
  ];
  distances.sort((a, b) => a[1] - b[1]);
  return { edge: distances[0][0], centerMove: centerBody };
}

function hitTwistBadge(card: SystemCard, uv: THREE.Vector2): boolean {
  if (card.facet !== "front") return false;
  const cx = uv.x * 640;
  const cy = (1 - uv.y) * 960;
  const dispX = card.twisted ? 36 : GUEST_PREVIEW_X;
  const dispY = card.twisted ? 132 : GUEST_PREVIEW_Y;
  const dispW = card.twisted ? 568 : GUEST_PREVIEW_WIDTH;
  const tabX = dispX + dispW - 176;
  const tabY = dispY + 10;
  return cx >= tabX - 12 && cx <= dispX + dispW + 8 && cy >= tabY - 8 && cy <= tabY + 46;
}

/** Corner-peel release: twist the card's display port bigger/smaller right at the front of the room! */
function openBigScreen(card: SystemCard): void {
  toggleCardTwist(card);
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

  const canvasY = (1 - uv.y) * 960;

  // On the Quick Actions facet (05 / 06), clicking one of the 4 tiles triggers it.
  if (card.facet === "top" && uv.x >= 0.15 && uv.x <= 0.85) {
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

  // On Settings (02 / 06), Security (03 / 06), and Telemetry (06 / 06), clicking any of the 5 printed rows (startY=298, stepY=102) triggers its live integration.
  if (
    (card.facet === "back" || card.facet === "left" || card.facet === "bottom") &&
    uv.x >= 0.15 &&
    uv.x <= 0.85 &&
    canvasY >= 274 &&
    canvasY <= 780
  ) {
    const rowIdx = Math.floor((canvasY - 274) / 102);
    if (card.facet === "back") {
      if (rowIdx === 0) {
        openPerformanceDialog();
        return;
      } else if (rowIdx === 1) {
        void cycleCardMemoryProfile(card);
        return;
      } else if (rowIdx === 2) {
        void promptAndSetCustomIso(card);
        return;
      } else if (rowIdx === 3) {
        const order: GraphicsProfile[] = ["performance", "balanced", "quality"];
        const next = order[(order.indexOf(studioGraphicsProfile) + 1) % order.length];
        applyStudioGraphicsProfile(next);
        return;
      } else if (rowIdx === 4) {
        void cloneSelectedCard(card);
        return;
      }
    } else if (card.facet === "left") {
      if (rowIdx === 0) {
        toggleSecOpsLabMode();
        return;
      } else if (rowIdx === 1) {
        if (card.os === "LINUX") {
          void finalizeLinuxBase();
        } else {
          openOrStartSelectedGuest(card);
        }
        return;
      } else if (rowIdx === 2) {
        void runTimeTravelSnapshot(uv.x < 0.5 ? "save" : "rewind", card);
        return;
      } else if (rowIdx === 3) {
        quickFileInput?.click();
        return;
      } else if (rowIdx === 4) {
        void cycleCardNetworkMode(card);
        return;
      }
    } else if (card.facet === "bottom") {
      if (rowIdx === 0) {
        openOrStartSelectedGuest(card);
        return;
      } else if (rowIdx === 1) {
        openPerformanceDialog();
        return;
      } else if (rowIdx === 2) {
        guestTargetCardId = card.id;
        guestTargetOs = cardToGuestOs(card);
        void wakeGuestScreen();
        return;
      } else if (rowIdx === 3) {
        void runSerialExec(card);
        return;
      } else if (rowIdx === 4) {
        void runSwarmFork(card);
        return;
      }
    }
  }

  // On Paper Planes facet (04 / 06), clicking the Inbox types the latest plane into the VM; clicking Outbox opens Send Paper Plane.
  if (card.facet === "right" && uv.x >= 0.15 && uv.x <= 0.85) {
    if (canvasY >= 280 && canvasY <= 600) {
      guestTargetCardId = card.id;
      guestTargetOs = cardToGuestOs(card);
      void injectLatestPaperPlaneIntoVm();
      return;
    } else if (canvasY > 600 && canvasY <= 820) {
      openShareDialog();
      return;
    }
  }

  // Clicking the body of the selected card zooms in/out for up-close inspection!
  toggleCardZoom();
}

function trashDestination(from: THREE.Vector3): THREE.Vector3 {
  // Fly into the mouth of the 3D paper bin in the far corner of the room.
  void from;
  return binGroup.localToWorld(new THREE.Vector3(0, 1.7, 0));
}

function isCardOverBinCan(card: SystemCard, clientX: number, clientY: number): boolean {
  if (card.removable === false || cards.length <= 1) return false;
  if (raycaster.intersectObject(binGroup, true).length > 0) return true;
  const rect = renderer.domElement.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    const binWorld = binGroup.localToWorld(new THREE.Vector3(0, 1.15, 0)).project(camera);
    const binScreenX = rect.left + (binWorld.x + 1) * 0.5 * rect.width;
    const binScreenY = rect.top + (-binWorld.y + 1) * 0.5 * rect.height;
    if (Math.hypot(clientX - binScreenX, clientY - binScreenY) < 95) return true;
  }
  const trashRect = trashTargetElement.getBoundingClientRect();
  if (
    trashRect.width > 0 &&
    clientX >= trashRect.left - 18 &&
    clientX <= trashRect.right + 18 &&
    clientY >= trashRect.top - 18 &&
    clientY <= trashRect.bottom + 18
  ) {
    return true;
  }
  return card.group.position.x < -3.9 && card.group.position.y < 3.4;
}

function findPeerCardAtPointer(draggedCard: SystemCard): SystemCard | undefined {
  const peerMeshes = cards
    .filter((item) => item !== draggedCard)
    .flatMap((item) => item.group.children.slice(1));
  const hit = raycaster.intersectObjects(peerMeshes, false)[0];
  if (hit) {
    return cards.find((item) => item.id === hit.object.userData.cardId);
  }
  return undefined;
}

function setBinCanHover(active: boolean): void {
  binGroup.scale.setScalar(active ? 1.22 : 1);
  (binRim.material as THREE.MeshStandardMaterial).emissiveIntensity = active ? 0.95 : 0.25;
  trashTargetElement.classList.toggle("drag-over", active);
}

function captureTrashRestoreState(card: SystemCard): TrashRestoreState {
  return {
    card,
    position: card.group.position.clone(),
    rotation: card.group.rotation.clone(),
    scale: card.group.scale.clone(),
    layoutOffset: card.layoutOffset.clone(),
    targetRotation: card.targetRotation,
    tiltX: card.tiltX,
    tiltZ: card.tiltZ,
    selectedCard,
    turntableAngle,
    targetTurntableAngle,
    cardZoomed,
  };
}

function beginCardBinFlight(card: SystemCard): void {
  if (
    trashFlight ||
    pendingTrash ||
    trashDialogElement.open ||
    binDialogElement.open ||
    card.removable === false ||
    cards.length <= 1 ||
    !cards.includes(card)
  ) {
    return;
  }
  const index = cards.indexOf(card);
  const restoreState = captureTrashRestoreState(card);
  const record: BinnedCardRecord = {
    id: card.id,
    name: card.name,
    os: card.os,
    detail: card.detail,
    color: card.color,
    status: card.status,
    ...(card.clonedFrom ? { clonedFrom: card.clonedFrom } : {}),
    ...(card.removable === undefined ? {} : { removable: card.removable }),
    index,
  };
  const entry: BinnedCardEntry = { record, card, restoreState };
  binnedCards.set(card.id, entry);
  if (!persistCardState()) {
    binnedCards.delete(card.id);
    showToast("This browser could not save the paper bin. The card stayed in the room.");
    return;
  }

  const reducedMotion = prefersReducedMotion();
  trashFlight = {
    card,
    from: card.group.position.clone(),
    to: trashDestination(card.group.position),
    fromScale: card.group.scale.clone(),
    toScale: card.group.scale.clone().multiplyScalar(0.06),
    fromRotation: card.group.rotation.clone(),
    toRotation: new THREE.Euler(
      card.group.rotation.x + Math.PI * 0.4,
      card.group.rotation.y + Math.PI * 1.8,
      card.group.rotation.z - 0.25,
    ),
    startedAt: performance.now(),
    duration: reducedMotion ? 0 : 820,
    kind: "bin",
    restoreState,
  };
  binDialogElement.close();
  updateOnCardActions();
}

function finishCardBinFlight(flight: TrashFlight): void {
  const entry = binnedCards.get(flight.card.id);
  if (!entry || !cards.includes(flight.card)) return;
  entry.card = flight.card;
  entry.restoreState = flight.restoreState;
  scene.remove(flight.card.group);
  flight.card.group.visible = false;
  const removedIndex = cards.indexOf(flight.card);
  const remainingPositions = new Map(
    cards.filter((item) => item !== flight.card).map((item) => [item, item.group.position.clone()]),
  );
  cards.splice(removedIndex, 1);
  arrangeCards();
  for (const [index, item] of cards.entries()) {
    const previousPosition = remainingPositions.get(item);
    if (previousPosition) item.layoutOffset.copy(previousPosition).sub(wheelPosition(index));
  }
  if (selectedCard === flight.card || !selectedCard || !cards.includes(selectedCard)) {
    cardZoomed = false;
    selectCard(cards[Math.min(removedIndex, cards.length - 1)]);
  } else {
    selectedIndex = cards.indexOf(selectedCard);
    updateGuestActionButton();
    updateRoomCardNav();
    updateOnCardActions();
    selectedNameElement.textContent = `${selectedCard.name} · ${FACET_META[selectedCard.facet].badge}`;
    sceneCardIndexElement.textContent = String(selectedIndex + 1).padStart(2, "0");
  }
  updateCardCount();
  updateRecipientOptions();
  showToast(`${flight.card.name} moved to the paper bin. Its guest files and data are unchanged.`);
}

function restoreCardFromBin(cardId: string): void {
  const entry = binnedCards.get(cardId);
  if (!entry || deletedCardIds.has(cardId) || trashFlight || pendingTrash) return;
  binnedCards.delete(cardId);
  if (!persistCardState()) {
    binnedCards.set(cardId, entry);
    showToast("This browser could not save the restore. The card remains in the paper bin.");
    return;
  }

  const insertionIndex = Math.min(entry.record.index, cards.length);
  const card = entry.card ?? createCard(entry.record, insertionIndex);
  card.group.visible = true;
  if (entry.restoreState) {
    card.group.position.copy(entry.restoreState.position);
    card.group.rotation.copy(entry.restoreState.rotation);
    card.group.scale.copy(entry.restoreState.scale);
    card.layoutOffset.copy(entry.restoreState.layoutOffset);
    card.targetRotation = entry.restoreState.targetRotation;
    card.tiltX = entry.restoreState.tiltX;
    card.tiltZ = entry.restoreState.tiltZ;
  } else {
    card.group.position.copy(wheelPosition(insertionIndex));
  }
  cards.splice(insertionIndex, 0, card);
  scene.add(card.group);
  arrangeCards();
  if (guestServiceStatus) updateGuestCardStatus(guestServiceStatus);
  selectCard(card);
  updateCardCount();
  updateRecipientOptions();
  updateBinDialog();
  binDialogElement.close();
  showToast(`${card.name} restored to the workspace. Its guest files and data were preserved.`);
}

function beginCardDeleteConfirmation(card: SystemCard): void {
  if (
    trashFlight ||
    pendingTrash ||
    trashDialogElement.open ||
    binDialogElement.open ||
    card.removable === false ||
    cards.length <= 1 ||
    !cards.includes(card)
  ) {
    return;
  }
  openTrashConfirmation(captureTrashRestoreState(card));
}

function openTrashConfirmation(state: TrashRestoreState): void {
  pendingTrash = state;
  trashCardNameElement.textContent = state.card.name;
  trashCardIdElement.textContent = state.card.id;
  trashErrorElement.textContent =
    state.card.removable === false
      ? "This is the room’s fallback card and cannot be removed."
      : cards.length <= 1
        ? "Keep at least one Post Card in the room. Add another card before removing this one."
        : "";
  trashConfirmButtonElement.disabled = state.card.removable === false || cards.length <= 1;
  trashCancelButtonElement.disabled = false;
  trashDeleteInProgress = false;
  trashDialogElement.removeAttribute("aria-busy");
  trashDialogElement.showModal();
  updateOnCardActions();
}

function restoreTrashCardState(state: TrashRestoreState): void {
  const { card } = state;
  scene.add(card.group);
  card.group.visible = true;
  card.group.position.copy(state.position);
  card.group.rotation.copy(state.rotation);
  card.group.scale.copy(state.scale);
  card.layoutOffset.copy(state.layoutOffset);
  card.targetRotation = state.targetRotation;
  card.tiltX = state.tiltX;
  card.tiltZ = state.tiltZ;
  turntableAngle = state.turntableAngle;
  targetTurntableAngle = state.targetTurntableAngle;
  cardZoomed = state.cardZoomed;
  const previousCard = selectedCard;
  selectedCard = state.selectedCard && cards.includes(state.selectedCard)
    ? state.selectedCard
    : cards[0] ?? null;
  refreshPrivateGuestPreview(previousCard, selectedCard);
  if (!selectedCard) return;
  selectedIndex = cards.indexOf(selectedCard);
  updateGuestActionButton();
  updateFacetBarUI();
  updateRoomCardNav();
  updateOnCardActions();
  selectedNameElement.textContent = `${selectedCard.name} · ${FACET_META[selectedCard.facet].badge}`;
  sceneCardIndexElement.textContent = String(selectedIndex + 1).padStart(2, "0");
}

function cancelTrashConfirmation(): void {
  if (!pendingTrash || trashDeleteInProgress) return;
  const restoreState = pendingTrash;
  pendingTrash = undefined;
  trashErrorElement.textContent = "";
  if (trashDialogElement.open) trashDialogElement.close();
  restoreTrashCardState(restoreState);
}

function updateTrashFlight(now: number): void {
  const flight = trashFlight;
  if (!flight || flight.animationFinished) return;
  const progress = THREE.MathUtils.clamp((now - flight.startedAt) / flight.duration, 0, 1);
  const eased = 1 - Math.pow(1 - progress, 3);
  const reducedMotion = prefersReducedMotion();
  if (flight.kind === "bin" && reducedMotion) {
      trashFlight = undefined;
      finishCardBinFlight(flight);
      return;
  }
  if (flight.kind === "delete" && reducedMotion) {
    flight.card.group.position.lerpVectors(flight.from, flight.to, eased);
    flight.card.group.scale.lerpVectors(flight.fromScale, flight.toScale, eased);
    if (progress < 1) return;
    flight.card.group.visible = false;
    flight.animationFinished = true;
    flight.completeAnimation?.();
    return;
  }
  if (flight.kind === "bin" || flight.kind === "delete") {
    const foldEnd = 0.22;
    if (progress < foldEnd) {
      const fold = progress / foldEnd;
      flight.card.group.scale.set(
        flight.fromScale.x * THREE.MathUtils.lerp(1, 0.44, fold),
        flight.fromScale.y * THREE.MathUtils.lerp(1, 0.035, fold),
        flight.fromScale.z * THREE.MathUtils.lerp(1, 0.14, fold),
      );
      flight.card.group.rotation.set(
        THREE.MathUtils.lerp(flight.fromRotation.x, flight.toRotation.x, fold),
        flight.fromRotation.y,
        THREE.MathUtils.lerp(flight.fromRotation.z, flight.toRotation.z, fold),
      );
    } else {
      if (!flight.plane) {
        scene.remove(flight.card.group);
        flight.card.group.visible = false;
        const material = new THREE.MeshStandardMaterial({
          color: "#e5e9ef",
          roughness: 0.82,
          side: THREE.DoubleSide,
        });
        flight.plane = new THREE.Mesh(airplaneGeometry, material);
        flight.plane.scale.setScalar(4.4);
        scene.add(flight.plane);
      }
      const travelProgress = THREE.MathUtils.clamp((progress - foldEnd) / (1 - foldEnd), 0, 1);
      const travelEased = 1 - Math.pow(1 - travelProgress, 3);
      flight.plane.position.lerpVectors(flight.from, flight.to, travelEased);
      flight.plane.position.y += Math.sin(travelProgress * Math.PI) * 0.82;
      flight.plane.rotation.set(
        -0.22 + Math.sin(travelProgress * Math.PI) * 0.16,
        Math.sin(travelProgress * Math.PI * 2) * 0.2,
        Math.atan2(flight.to.y - flight.from.y, flight.to.x - flight.from.x) +
          Math.sin(travelProgress * Math.PI * 2) * 0.28,
      );
    }
    if (progress < 1) return;
    if (flight.plane) {
      scene.remove(flight.plane);
      if (Array.isArray(flight.plane.material)) {
        for (const material of flight.plane.material) material.dispose();
      } else {
        flight.plane.material.dispose();
      }
    }
    if (flight.kind === "bin") {
      trashFlight = undefined;
      finishCardBinFlight(flight);
    } else {
      flight.animationFinished = true;
      flight.completeAnimation?.();
    }
    return;
  }
  trashFlight = undefined;
}

function disposeTrashFlightPlane(flight: TrashFlight): void {
  if (!flight.plane) return;
  scene.remove(flight.plane);
  if (Array.isArray(flight.plane.material)) {
    for (const material of flight.plane.material) material.dispose();
  } else {
    flight.plane.material.dispose();
  }
  flight.plane = undefined;
}

function beginPermanentDeleteFlight(state: TrashRestoreState): Promise<void> {
  const { card } = state;
  let completeAnimation!: () => void;
  const animationComplete = new Promise<void>((resolve) => {
    completeAnimation = resolve;
  });
  const from = card.group.position.clone();
  const fromRotation = card.group.rotation.clone();
  trashFlight = {
    card,
    from,
    to: trashDestination(from),
    kind: "delete",
    fromScale: card.group.scale.clone(),
    toScale: card.group.scale.clone().multiplyScalar(0.06),
    fromRotation,
    toRotation: new THREE.Euler(
      fromRotation.x + 0.24,
      fromRotation.y + Math.PI * 1.4,
      fromRotation.z - 0.4,
    ),
    startedAt: performance.now(),
    duration: prefersReducedMotion() ? 180 : 820,
    restoreState: state,
    completeAnimation,
  };
  updateOnCardActions();
  return animationComplete;
}

function removeCardFromRoom(card: SystemCard, status: GuestServiceStatus): void {
  const removedIndex = cards.indexOf(card);
  if (removedIndex < 0) throw new Error("The card is no longer in this room.");
  const remainingPositions = new Map(
    cards.filter((item) => item !== card).map((item) => [item, item.group.position.clone()]),
  );
  scene.remove(card.group);
  cards.splice(removedIndex, 1);
  if (cards.length === 0) {
    cards.push(
      createCard(
        {
          id: "workspace-fallback",
          name: "Studio · Welcome Space",
          os: "LINUX",
          detail: "Your room is ready for a new Post Card.",
          color: "#bca8ff",
          status: "DEMO · DISCONNECTED",
          removable: false,
        },
        0,
      ),
    );
  }
  arrangeCards();
  for (const [index, item] of cards.entries()) {
    const previousPosition = remainingPositions.get(item);
    if (previousPosition) item.layoutOffset.copy(previousPosition).sub(wheelPosition(index));
  }
  updateGuestCardStatus(status);
  if (selectedCard === card || !selectedCard || !cards.includes(selectedCard)) {
    cardZoomed = false;
    selectCard(cards[Math.min(removedIndex, cards.length - 1)]);
  } else {
    selectedIndex = cards.indexOf(selectedCard);
    updateGuestActionButton();
    updateRoomCardNav();
    selectedNameElement.textContent = `${selectedCard.name} · ${FACET_META[selectedCard.facet].badge}`;
    sceneCardIndexElement.textContent = String(selectedIndex + 1).padStart(2, "0");
  }
  updateCardCount();
  updateRecipientOptions();
}

async function confirmTrashDeletion(): Promise<void> {
  const state = pendingTrash;
  if (!state || trashDeleteInProgress || state.card.removable === false || cards.length <= 1) return;
  trashDeleteInProgress = true;
  trashDialogElement.setAttribute("aria-busy", "true");
  trashErrorElement.textContent = "Folding the card while the guest service permanently deletes its data…";
  trashConfirmButtonElement.disabled = true;
  trashCancelButtonElement.disabled = true;
  const flightComplete = beginPermanentDeleteFlight(state);
  await runConfirmedCardDeletion({
    deleteGuest: () => requestGuestApi("/api/guest/delete", {
      cardId: state.card.id,
      os: cardToGuestOs(state.card),
      confirm: true,
    }),
    waitForFlight: () => flightComplete,
    onSuccess: (status) => {
      const flight = trashFlight;
      if (flight?.card === state.card) {
        disposeTrashFlightPlane(flight);
        trashFlight = undefined;
      }
    deletedCardIds.add(state.card.id);
      persistCardState();
    pendingTrash = undefined;
    trashDeleteInProgress = false;
      trashDialogElement.removeAttribute("aria-busy");
    if (trashDialogElement.open) trashDialogElement.close();
    removeCardFromRoom(state.card, status);
    trashErrorElement.textContent = "";
    showToast(`${state.card.name} and its private guest state were removed.`);
    },
    onFailure: (error) => {
      const flight = trashFlight;
      if (flight?.card === state.card) {
        disposeTrashFlightPlane(flight);
        trashFlight = undefined;
      }
      restoreTrashCardState(state);
    trashDeleteInProgress = false;
    trashDialogElement.removeAttribute("aria-busy");
    trashConfirmButtonElement.disabled = false;
    trashCancelButtonElement.disabled = false;
    trashErrorElement.textContent = error instanceof Error
      ? `The card remains in the room. ${error.message}`
      : "The card remains in the room. The local guest service returned an unknown error.";
    },
  });
}

function onPointerDown(event: PointerEvent): void {
  if (pendingTrash || trashFlight || trashDialogElement.open) return;
  if (event.button !== 0 && event.button !== 2) return;
  updatePointer(event);
  const startTime = performance.now();
  const hit = raycaster.intersectObjects(
    cards.flatMap((card) => card.group.children.slice(1)),
    false,
  )[0];
  const hitCard = hit ? cards.find((item) => item.id === hit.object.userData.cardId) : undefined;

  if (!hitCard && event.button === 0) {
    const binHit = raycaster.intersectObject(binGroup, true)[0];
    if (binHit) {
      updateBinDialog();
      binDialogElement.showModal();
      return;
    }
  }

  const isFrontCard = Boolean(hitCard && isCardPulledToFront(hitCard));
  const grab = isFrontCard && hitCard && hit?.uv ? classifyCardGrab(hitCard, hit.uv) : undefined;
  const freeMove = Boolean(event.shiftKey || event.button === 2);

  if ((freeMove || grab?.centerMove) && hitCard) {
    dragPlane.setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(new THREE.Vector3()),
      hitCard.group.position,
    );
    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
    drag = {
      card: hitCard,
      pointerId: event.pointerId,
      mode: "move",
      freeMove,
      offset: hitCard.group.position.clone().sub(dragPoint),
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
      hitUv: hit?.uv ? hit.uv.clone() : undefined,
      originalPosition: hitCard.group.position.clone(),
      originalRotation: hitCard.group.rotation.clone(),
      originalScale: hitCard.group.scale.clone(),
      originalLayoutOffset: hitCard.layoutOffset.clone(),
      originalSelectedCard: selectedCard,
      originalTurntableAngle: turntableAngle,
      originalTargetTurntableAngle: targetTurntableAngle,
      originalCardZoomed: cardZoomed,
    };
  } else {
    // Clear split: grabbing the front card edges/corners flips or peels that card;
    // grabbing empty space or a side card always turns the turntable.
    drag = {
      card: hitCard,
      pointerId: event.pointerId,
      mode: !isFrontCard ? "carousel" : grab?.corner ? "peel" : "flip",
      flipAxis: undefined,
      grabEdge: grab?.edge,
      cornerX: grab?.corner?.x,
      cornerY: grab?.corner?.y,
      baseRotationY: hitCard ? hitCard.group.rotation.y : undefined,
      grabProgress: 0,
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
    const hoverCard = hit ? cards.find((item) => item.id === hit.object.userData.cardId) : undefined;
    // Hand over the front card (grab & flip it); left-right arrows everywhere else (turn the wheel).
    renderer.domElement.style.cursor = hoverCard && isCardPulledToFront(hoverCard) ? "grab" : "ew-resize";
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

  if (drag.card) {
    setBinCanHover(isCardOverBinCan(drag.card, event.clientX, event.clientY));
  }

  if (drag.mode === "move" && drag.card) {
    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
    drag.card.group.position.copy(dragPoint.add(drag.offset ?? new THREE.Vector3()));
    drag.card.group.position.x = THREE.MathUtils.clamp(drag.card.group.position.x, -7.8, 7.2);
    drag.card.group.position.y = THREE.MathUtils.clamp(drag.card.group.position.y, 0.6, 5.2);
    drag.card.group.position.z = THREE.MathUtils.clamp(drag.card.group.position.z, -6.6, 2.5);
    const overBin = isCardOverBinCan(drag.card, event.clientX, event.clientY);
    drag.card.tiltZ = overBin ? 0.22 : 0;
    resolveCardCollisions(drag.card);
    drag.card.group.rotation.y = cardDisplayRotation(drag.card);
  } else if (drag.mode === "peel" && drag.card) {
    // Pull the display corner outward: it peels toward you and the card swells.
    const cx = drag.cornerX ?? 1;
    const cy = drag.cornerY ?? 1;
    const outward = (dx * cx - dy * cy) / Math.SQRT2;
    const progress = THREE.MathUtils.clamp(outward / 170, 0, 1);
    drag.grabProgress = progress;
    drag.card.peel = progress;
    drag.card.group.rotation.y = (drag.baseRotationY ?? 0) - cx * progress * 0.42;
    drag.card.group.rotation.x = cy * progress * 0.3;
    drag.card.layoutOffset.z = progress * 0.9;
  } else if (drag.mode === "flip" && drag.card && drag.grabEdge) {
    // The grabbed edge swings toward the viewer around the card centre.
    const edge = drag.grabEdge;
    const inward =
      edge === "right" ? -dx : edge === "left" ? dx : edge === "top" ? dy : -dy;
    const progress = THREE.MathUtils.clamp(inward / 190, 0, 1);
    drag.grabProgress = progress;
    const angle = progress * Math.PI * 0.48;
    if (edge === "right" || edge === "left") {
      drag.card.group.rotation.y = (drag.baseRotationY ?? 0) + (edge === "right" ? -angle : angle);
    } else {
      const pitch = edge === "top" ? angle : -angle;
      drag.card.tiltX = pitch;
      drag.card.group.rotation.x = pitch;
    }
    drag.card.layoutOffset.z = progress * 0.6;
  } else if (drag.mode === "flip" && drag.card) {
    // Lock the flip axis from the first clear movement direction.
    drag.flipAxis ??= Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
    if (drag.flipAxis === "horizontal") {
      const tilt = THREE.MathUtils.clamp((-dx / 140) * (Math.PI * 0.45), -Math.PI * 0.45, Math.PI * 0.45);
      drag.card.tiltZ = tilt;
      drag.card.group.rotation.z = tilt;
      drag.card.layoutOffset.z = Math.abs(tilt) * 0.55;
    } else {
      const tilt = THREE.MathUtils.clamp((dy / 140) * (Math.PI * 0.75), -Math.PI * 0.75, Math.PI * 0.75);
      drag.card.tiltX = tilt;
      drag.card.group.rotation.x = tilt;
      drag.card.layoutOffset.z = Math.abs(tilt) * 0.55;
    }
  } else if (drag.mode === "carousel") {
    if (prefersReducedMotion() || cardZoomed) return;
    // If pointer started on center card and pulls vertically, switch into flip mode!
    if (drag.card === selectedCard && Math.abs(dy) > Math.abs(dx) * 1.2 && Math.abs(dy) > 10) {
      drag.mode = "flip";
      drag.flipAxis = "vertical";
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
  setBinCanHover(false);
  updatePointer(event);
  const dx = event.clientX - completedDrag.startX;
  const dy = event.clientY - completedDrag.startY;

  if (completedDrag.moved) {
    if (completedDrag.card && isCardOverBinCan(completedDrag.card, event.clientX, event.clientY)) {
      completedDrag.card.layoutOffset.set(0, 0, 0);
      completedDrag.card.tiltX = 0;
      completedDrag.card.tiltZ = 0;
      completedDrag.card.peel = 0;
      beginCardBinFlight(completedDrag.card);
    } else if (completedDrag.mode === "move" && completedDrag.card) {
      completedDrag.card.tiltZ = 0;
      const targetPeer = !completedDrag.freeMove ? findPeerCardAtPointer(completedDrag.card) : undefined;
      if (targetPeer) {
        completedDrag.card.layoutOffset.set(0, 0, 0);
        selectedCard = completedDrag.card;
        openShareDialog(targetPeer);
      } else if (completedDrag.freeMove) {
        resolveCardCollisions(completedDrag.card);
        completedDrag.card.layoutOffset
          .copy(completedDrag.card.group.position)
          .sub(wheelPosition(cards.indexOf(completedDrag.card)));
      } else {
        completedDrag.card.layoutOffset.set(0, 0, 0);
      }
    } else if (completedDrag.mode === "peel" && completedDrag.card) {
      const card = completedDrag.card;
      card.layoutOffset.set(0, 0, 0);
      card.tiltX = 0;
      if ((completedDrag.grabProgress ?? 0) > 0.32) openBigScreen(card);
    } else if (completedDrag.mode === "flip" && completedDrag.card && completedDrag.grabEdge) {
      const card = completedDrag.card;
      const edge = completedDrag.grabEdge;
      card.layoutOffset.set(0, 0, 0);
      if ((completedDrag.grabProgress ?? 0) > 0.32) {
        // Finish the turn in the same direction the edge was travelling.
        flipCardTo(card, edge, edge === "right" ? -1 : 1);
      } else {
        card.tiltX = 0;
        card.tiltZ = 0;
      }
    } else if (completedDrag.mode === "flip" && completedDrag.card) {
      completedDrag.card.layoutOffset.set(0, 0, 0);
      const threshold = 26;
      if (completedDrag.flipAxis === "horizontal" && dx > threshold) {
        completedDrag.card.tiltZ = 0;
        flipCardToSide(completedDrag.card, "right", 1);
      } else if (completedDrag.flipAxis === "horizontal" && dx < -threshold) {
        completedDrag.card.tiltZ = 0;
        flipCardToSide(completedDrag.card, "left", -1);
      } else if (completedDrag.flipAxis === "horizontal") {
        completedDrag.card.tiltZ = 0;
      } else if (dy > threshold) {
        // Dragged downward: flip to top facet!
        flipCardTo(completedDrag.card, "top");
      } else if (dy < -threshold) {
        // Dragged upward: flip to bottom facet!
        flipCardTo(completedDrag.card, "bottom");
      } else {
        // Released without threshold: spring back flat!
        completedDrag.card.tiltX = 0;
        completedDrag.card.tiltZ = 0;
      }
    } else if (completedDrag.mode === "carousel") {
      if (cardZoomed) {
        // Zoom-locked: a drag on empty space never spins the wheel.
        turntableLocked();
      } else if (prefersReducedMotion()) {
        targetTurntableAngle = turntableAngle;
      } else {
        const slotStep = getSlotStep();
        const flingOffset = THREE.MathUtils.clamp(turntableVelocity * 0.16, -slotStep * 1.5, slotStep * 1.5);
        const projected = turntableAngle + flingOffset;
        targetTurntableAngle = Math.round(projected / slotStep) * slotStep;

        if (completedDrag.card === selectedCard && Math.abs(dy) > 36 && Math.abs(dy) > Math.abs(dx)) {
          flipCardTo(completedDrag.card, dy > 0 ? "top" : "bottom");
        }
      }
    }
  } else {
    // Clean click / tap without dragging
    if (completedDrag.card) {
      if (!isCardPulledToFront(completedDrag.card)) {
        // Clicking a back-ring card smoothly glides it to center (unless zoom-locked).
        if (!turntableLocked()) selectCard(completedDrag.card, true);
      } else if (completedDrag.hitUv) {
        const uv = completedDrag.hitUv;
        const printedButton = completedDrag.card.facet === "front" ? hitCardButton(uv.x, uv.y) : undefined;
        if (hitTwistBadge(completedDrag.card, uv)) {
          toggleCardTwist(completedDrag.card);
        } else if (printedButton) {
          runCardButton(printedButton, completedDrag.card);
        } else if (
          completedDrag.card.twisted &&
          completedDrag.card.facet === "front" &&
          uv.x > 0.14 &&
          uv.x < 0.86 &&
          uv.y > 0.27 &&
          uv.y < 0.86
        ) {
          // Clicking inside the twisted screen opens the full-window live display if desired.
          openOrStartSelectedGuest(completedDrag.card);
          setDisplayTwist(true);
        } else if (uv.y >= (completedDrag.card.twisted ? 0.88 : 0.72)) {
          // Directional edge clicks:
          flipCardTo(completedDrag.card, "top");
        } else if (uv.y <= (completedDrag.card.facet === "front" ? 0.28 : 0.14)) {
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

const WHEEL_STEP_COOLDOWN_MS = 750;

function onWheel(event: WheelEvent): void {
  carouselWheelHandler(event);
}

const carouselWheelHandler = createWheelCarouselHandler(
  () => cards.length,
  (direction) => cycleCarousel(direction, false),
  undefined,
  // One card per scroll gesture: wait for the wheel (and its focus pull) to land.
  WHEEL_STEP_COOLDOWN_MS,
);

function onCanvasKeyDown(event: KeyboardEvent): void {
  if (event.altKey || event.ctrlKey || event.metaKey || cards.length === 0) return;

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
    if (lower === "z") {
      event.preventDefault();
      toggleCardZoom();
      return;
    }
    if (event.key === "Escape") {
      if (tourActive) {
        event.preventDefault();
        stopGuidedTour();
        if (isTourRecording) stopTourRecording();
        return;
      }
      if (cardZoomed) {
        event.preventDefault();
        toggleCardZoom(false);
        return;
      }
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
    if (!turntableLocked()) selectCard(cards[0], true);
  } else if (event.key === "End") {
    event.preventDefault();
    if (!turntableLocked()) selectCard(cards[cards.length - 1], true);
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
  playAirplaneSound();
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
  mesh.add(new THREE.PointLight("#e8a191", 1.25, 3));
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
    duration: 1050,
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
  const progress = THREE.MathUtils.clamp(
    (now - airplane.startedAt) / airplane.duration,
    0,
    1,
  );
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
  const width = sceneElement.clientWidth || sceneShellElement.clientWidth || window.innerWidth;
  const height = sceneElement.clientHeight || sceneShellElement.clientHeight || window.innerHeight;
  if (width < 1 || height < 1) return;
  sceneViewportWidth = width;
  sceneViewportHeight = height;
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

/**
 * Pull the overview camera back on narrow or short windows so the whole carousel
 * ring (including the side cards and top/bottom edges) fits cleanly at any window size.
 */
function overviewCameraPosition(): THREE.Vector3 {
  const aspect = Math.max(0.35, camera.aspect || 1.6);
  const halfFovTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const anyTwisted = cards.some((c) => c.twisted && isCardPulledToFront(c));
  const ringHalfWidth = (benchCount === 3 ? 6.6 : benchCount === 2 ? 5.9 : 5.5) + (anyTwisted ? 0.9 : 0);
  const ringHalfHeight = anyTwisted ? 3.2 : 2.85;
  const frontZ = 2.2;
  const fitWidthZ = frontZ + ringHalfWidth / (halfFovTan * aspect);
  const fitHeightZ = frontZ + ringHalfHeight / halfFovTan;
  const minZ = (benchCount > 1 ? 11.8 : 11.2) + (anyTwisted ? 1.0 : 0);
  const z = Math.max(minZ, fitWidthZ, fitHeightZ);
  return new THREE.Vector3(0, 2.95, z);
}

/**
 * Frame the entire zoomed card (3.2 × 2.15 at 1.04× scale, plus room for edge
 * flips and the top bar) so all four edges stay in view at any window ratio.
 */
function zoomedCameraPosition(card: SystemCard): THREE.Vector3 {
  const aspect = Math.max(0.35, camera.aspect || 1.6);
  const halfFovTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const twistedFactor = card.twisted ? 1.38 : 1;
  const fitHeightDistance = (2.15 * (card.twisted ? 1.18 : 1)) / halfFovTan;
  const fitWidthDistance = (1.68 * twistedFactor) / (halfFovTan * aspect);
  const distance = Math.max(6.35, fitHeightDistance, fitWidthDistance);
  const baseZ = card.group.position.z - card.layoutOffset.z;
  return new THREE.Vector3(card.group.position.x, card.group.position.y + 0.04, baseZ + distance);
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

let lastVuUpdate = 0;
function updateVuMeters(now: number): void {
  if (now - lastVuUpdate < 50) return; // 20 fps throttle for DOM VU meters
  lastVuUpdate = now;
  const meterL = document.getElementById("vu-meter-l");
  const meterR = document.getElementById("vu-meter-r");
  if (!meterL || !meterR) return;
  const isAnyRunning = cards.some(
    (c) => c.status.includes("CONNECTED") || c.status.includes("INSTALLER"),
  );
  const volSlider = document.querySelector<HTMLInputElement>("#master-volume");
  const volFactor = volSlider ? Math.max(0.1, Number(volSlider.value) / 100) : 0.85;

  const baseL = isAnyRunning
    ? 4 + Math.round(Math.sin(now * 0.008) * 2 + Math.cos(now * 0.013) * 1.5)
    : 1;
  const baseR = isAnyRunning
    ? 4 + Math.round(Math.cos(now * 0.009) * 2 + Math.sin(now * 0.011) * 1.5)
    : 1;
  const countL = Math.max(0, Math.min(9, Math.round(baseL * volFactor)));
  const countR = Math.max(0, Math.min(9, Math.round(baseR * volFactor)));

  const segsL = meterL.querySelectorAll<HTMLElement>(".vu-segment");
  const segsR = meterR.querySelectorAll<HTMLElement>(".vu-segment");
  segsL.forEach((seg, idx) => {
    seg.classList.toggle("lit", idx < countL);
  });
  segsR.forEach((seg, idx) => {
    seg.classList.toggle("lit", idx < countR);
  });

  const dbL = document.getElementById("vu-db-l");
  const dbR = document.getElementById("vu-db-r");
  if (dbL && dbR) {
    dbL.textContent = countL >= 8 ? "0 dB" : `-${Math.max(1, (9 - countL) * 3)} dB`;
    dbR.textContent = countR >= 8 ? "+1 dB" : `-${Math.max(1, (9 - countR) * 3)} dB`;
  }
}

// --- Guided 3D Spatial Tour & 60FPS Video Demo ---
let tourActive = false;
let tourStage = 0;
let tourStartTime = 0;
let tourCameraOverridePos: THREE.Vector3 | null = null;
let tourCameraOverrideLook: THREE.Vector3 | null = null;
let tourPaperPlaneFired = false;
let tourPerformanceSwitched = false;
let tourSecOpsSwitched = false;
let tourMediaRecorder: MediaRecorder | null = null;
let tourRecordedChunks: Blob[] = [];
let isTourRecording = false;

function startGuidedTour(): void {
  tourActive = true;
  tourStartTime = performance.now();
  tourStage = 0;
  tourPaperPlaneFired = false;
  tourPerformanceSwitched = false;
  tourSecOpsSwitched = false;
  const tourBtn = document.getElementById("tour-button");
  if (tourBtn) {
    tourBtn.setAttribute("aria-pressed", "true");
    tourBtn.textContent = "⏹ STOP TOUR";
  }
  showToast("▷ Starting Guided 3D Spatial Demo Tour…");
}

function stopGuidedTour(): void {
  tourActive = false;
  tourCameraOverridePos = null;
  tourCameraOverrideLook = null;
  if (cardZoomed) cardZoomed = false;
  if (selectedCard && selectedCard.facet !== "front") flipCardTo(selectedCard, "front");
  if (secOpsMode) toggleSecOpsLabMode();
  const tourOverlay = document.getElementById("tour-overlay");
  if (tourOverlay) tourOverlay.hidden = true;
  const tourBtn = document.getElementById("tour-button");
  if (tourBtn) {
    tourBtn.setAttribute("aria-pressed", "false");
    tourBtn.textContent = "▷ TOUR";
  }
  const perfDialog = document.getElementById("performance-dialog") as HTMLDialogElement | null;
  if (perfDialog && perfDialog.open) perfDialog.close();
}

function startTourRecording(): void {
  try {
    const stream = renderer.domElement.captureStream(60);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    tourMediaRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8000000 });
    tourRecordedChunks = [];
    tourMediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) tourRecordedChunks.push(e.data);
    };
    tourMediaRecorder.onstop = () => {
      const blob = new Blob(tourRecordedChunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `postcard-spatial-os-demo-60fps-${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast("🎬 60FPS AI Tour Demo Video saved to downloads!");
    };
    tourMediaRecorder.start(250);
    isTourRecording = true;
    const recBtn = document.getElementById("record-tour-button");
    if (recBtn) {
      recBtn.classList.add("recording");
      recBtn.setAttribute("aria-pressed", "true");
      recBtn.textContent = "⏹ STOP REC";
    }
    startGuidedTour();
    showToast("⏺ Recording 60FPS Spatial Demo Video…");
  } catch {
    showToast("Canvas recording not supported in this browser.");
  }
}

function stopTourRecording(): void {
  if (isTourRecording && tourMediaRecorder && tourMediaRecorder.state !== "inactive") {
    tourMediaRecorder.stop();
  }
  isTourRecording = false;
  const recBtn = document.getElementById("record-tour-button");
  if (recBtn) {
    recBtn.classList.remove("recording");
    recBtn.setAttribute("aria-pressed", "false");
    recBtn.textContent = "⏺ 60FPS";
  }
}

function updateTour(now: number, dt: number): void {
  if (!tourActive) return;
  const elapsed = (now - tourStartTime) / 1000;
  const totalDuration = 62;

  const tourOverlay = document.getElementById("tour-overlay");
  const stepBadge = document.getElementById("tour-step-badge");
  const statusLabel = document.getElementById("tour-status-label");
  const stepTitle = document.getElementById("tour-step-title");
  const stepDesc = document.getElementById("tour-step-desc");
  const progressFill = document.getElementById("tour-progress-fill");

  if (tourOverlay) tourOverlay.hidden = false;
  if (progressFill) progressFill.style.width = `${Math.min(100, (elapsed / totalDuration) * 100)}%`;

  if (elapsed < 8) {
    tourStage = 1;
    tourCameraOverridePos = new THREE.Vector3(0, 5, 14);
    tourCameraOverrideLook = new THREE.Vector3(0, 2.68, 0.25);
    if (stepBadge) stepBadge.textContent = "STAGE 01";
    if (statusLabel) statusLabel.textContent = "SPATIAL OVERVIEW";
    if (stepTitle) stepTitle.textContent = "Obsidian Dais & 3D Spatial Turntable";
    if (stepDesc) stepDesc.textContent = "Up to six concurrent guest operating systems running on the high-speed orbital carousel.";
  } else if (elapsed < 18) {
    tourStage = 2;
    tourCameraOverridePos = null;
    tourCameraOverrideLook = null;
    targetTurntableAngle += dt * 0.45;
    if (stepBadge) stepBadge.textContent = "STAGE 02";
    if (statusLabel) statusLabel.textContent = "TURNTABLE ARC";
    if (stepTitle) stepTitle.textContent = "Multi-OS Slot Traversal";
    if (stepDesc) stepDesc.textContent = "Fluidly navigating Windows 11, Fedora COSMIC, macOS Cupertino, Kali Cyber Range & Android.";
  } else if (elapsed < 27) {
    tourStage = 3;
    cardZoomed = true;
    if (elapsed >= 18.5 && elapsed < 21.0) {
      if (selectedCard && selectedCard.facet !== "back") flipCardTo(selectedCard, "back");
    } else if (elapsed >= 21.0 && elapsed < 23.5) {
      if (selectedCard && selectedCard.facet !== "left") flipCardTo(selectedCard, "left");
    } else if (elapsed >= 23.5 && elapsed < 26.5) {
      if (selectedCard && selectedCard.facet !== "bottom") flipCardTo(selectedCard, "bottom");
    }
    if (stepBadge) stepBadge.textContent = "STAGE 03";
    if (statusLabel) statusLabel.textContent = "6-WAY CARD FACETS";
    if (stepTitle) stepTitle.textContent = "In-Depth Hardware & Telemetry";
    if (stepDesc) stepDesc.textContent = "Inspecting virtual CPU profiles, Eco RAM thinning, zero-trust security isolation & live sparklines.";
  } else if (elapsed < 36) {
    tourStage = 4;
    cardZoomed = false;
    if (selectedCard && selectedCard.facet !== "front") flipCardTo(selectedCard, "front");
    if (!tourPaperPlaneFired && elapsed >= 28.0) {
      tourPaperPlaneFired = true;
      if (selectedCard) {
        const other = cards.find((c) => c !== selectedCard) ?? cards[0];
        sendPaperPlane(selectedCard, other, "60FPS AI Tour Verified · Relay Active");
      }
    }
    if (stepBadge) stepBadge.textContent = "STAGE 04";
    if (statusLabel) statusLabel.textContent = "PAPER AIRPLANE RELAY";
    if (stepTitle) stepTitle.textContent = "Inter-VM Note Relay & File Drop";
    if (stepDesc) stepDesc.textContent = "Folding and launching encrypted notes across VMs, with live QMP keystroke injection.";
  } else if (elapsed < 45) {
    tourStage = 5;
    if (!tourPerformanceSwitched && elapsed >= 37.0) {
      tourPerformanceSwitched = true;
      const perfBtn = document.getElementById("performance-button");
      perfBtn?.click();
    }
    if (stepBadge) stepBadge.textContent = "STAGE 05";
    if (statusLabel) statusLabel.textContent = "PRO AV SUITE & VU RACK";
    if (stepTitle) stepTitle.textContent = "Dual-Channel Peak Stereo VU Meters";
    if (stepDesc) stepDesc.textContent = "Real-time audio monitoring, virtual DAC selection (Intel HDA / Sound Blaster) & 4-way color grading.";
  } else if (elapsed < 53) {
    tourStage = 6;
    if (!tourSecOpsSwitched && elapsed >= 46.0) {
      tourSecOpsSwitched = true;
      if (!secOpsMode) toggleSecOpsLabMode();
    }
    if (stepBadge) stepBadge.textContent = "STAGE 06";
    if (statusLabel) statusLabel.textContent = "SECOPS LAB & CYBER RANGE";
    if (stepTitle) stepTitle.textContent = "Air-Gapped Isolation & SecOps Playbooks";
    if (stepDesc) stepDesc.textContent = "Isolated VLAN cyber range, port enumeration, automated privilege auditing & golden base locks.";
  } else if (elapsed < totalDuration) {
    tourStage = 7;
    if (secOpsMode) toggleSecOpsLabMode();
    cardZoomed = true;
    if (stepBadge) stepBadge.textContent = "STAGE 07";
    if (statusLabel) statusLabel.textContent = "COMMERCIAL MATRIX";
    if (stepTitle) stepTitle.textContent = "Freemium Core, Enterprise & Add-On Marketplace";
    if (stepDesc) stepDesc.textContent = "Developer Open-Core, Air-Gapped Enterprise B2B, AI Butler Hybrid Subscription & Modular DLC Slots.";
  } else {
    stopGuidedTour();
    if (isTourRecording) stopTourRecording();
  }
}

async function startStripeCheckout(tier: "PRO" | "ENTERPRISE"): Promise<void> {
  const interval =
    document.querySelector<HTMLElement>(".billing-opt.active")?.dataset.interval === "year" ? "year" : "month";
  try {
    const response = await fetch("/api/stripe/checkout-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tier: tier.toLowerCase(), interval }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error ?? "Checkout is unavailable.");
    if (data.mode === "live" && (data.url ?? data.checkoutUrl)) {
      window.open(data.url ?? data.checkoutUrl, "_blank", "noopener");
      showToast("Opening secure Stripe checkout…");
    } else {
      showToast("Checkout is in preview mode · no payment is configured on this machine.");
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Checkout failed.");
  }
}

// --- Commercial Editions & Add-On Marketplace Controller ---
function initCommercialEditions(): void {
  const editionsDialog = document.getElementById("editions-dialog") as HTMLDialogElement | null;
  const editionsBtn = document.getElementById("editions-button");
  const profileEditionsOpt = document.getElementById("profile-editions-option");
  const profileRestoreOpt = document.getElementById("profile-restore-option");
  const restoreDialog = document.getElementById("restore-account-dialog") as HTMLDialogElement | null;
  const restoreLicenseForm = document.getElementById("restore-license-form") as HTMLFormElement | null;
  const restoreLicenseInput = document.getElementById("restore-license-input") as HTMLInputElement | null;
  const restoreStatusEl = document.getElementById("restore-account-status");
  const restoreStatusProfile = document.getElementById("restore-status-profile");
  const restoreStatusTier = document.getElementById("restore-status-tier");
  const restoreCurrentKey = document.getElementById("restore-current-key");
  const restoreCopyKeyBtn = document.getElementById("restore-copy-key-btn");
  const restoreResyncBtn = document.getElementById("restore-resync-btn");
  const restoreExportBtn = document.getElementById("restore-export-btn");
  const restoreImportBtn = document.getElementById("restore-import-btn");
  const restoreImportInput = document.getElementById("restore-import-input") as HTMLInputElement | null;
  const closeRestoreBtn = document.getElementById("close-restore-account");
  const selectedTierElement = document.getElementById("selected-tier");
  const activeTierDisplay = document.getElementById("editions-active-tier-display");
  const aiButlerSubBtn = document.getElementById("btn-subscribe-ai");

  const LICENSE_KEY_STORAGE = "postcard_license_key";
  const AI_BUTLER_STORAGE = "postcard_ai_butler_active";
  let currentActiveTier: MonetizationTier = "COMMUNITY";

  const setRestoreStatusMessage = (message: string, tone: "info" | "ok" | "error" = "info") => {
    if (!restoreStatusEl) return;
    restoreStatusEl.textContent = message;
    restoreStatusEl.dataset.tone = tone;
  };

  const refreshRestoreAccountSummary = () => {
    if (restoreStatusProfile) {
      restoreStatusProfile.textContent = `${localProfile.name} (${localProfile.initials})`;
    }
    const aiActive = localStorage.getItem(AI_BUTLER_STORAGE) === "true";
    if (restoreStatusTier) {
      restoreStatusTier.textContent = aiActive
        ? `${currentActiveTier} + AI BUTLER`
        : currentActiveTier;
    }
    const savedKey = localStorage.getItem(LICENSE_KEY_STORAGE) ?? "";
    if (restoreCurrentKey) {
      restoreCurrentKey.textContent = savedKey || "No license key stored on this device";
    }
    if (restoreCopyKeyBtn) {
      (restoreCopyKeyBtn as HTMLButtonElement).disabled = !savedKey;
    }
  };

  const openEditions = () => {
    if (editionsDialog && !editionsDialog.open) editionsDialog.showModal();
    if (profilePopoverElement) profilePopoverElement.hidden = true;
  };

  const openRestoreAccountDialog = () => {
    if (profilePopoverElement) profilePopoverElement.hidden = true;
    if (profileEditDialogElement.open) profileEditDialogElement.close();
    if (editionsDialog?.open) editionsDialog.close();
    refreshRestoreAccountSummary();
    setRestoreStatusMessage("");
    if (restoreDialog && !restoreDialog.open) {
      restoreDialog.showModal();
      restoreLicenseInput?.focus();
    }
  };

  editionsBtn?.addEventListener("click", openEditions);
  profileEditionsOpt?.addEventListener("click", openEditions);
  selectedTierElement?.addEventListener("click", openEditions);
  profileRestoreOpt?.addEventListener("click", openRestoreAccountDialog);
  document.querySelectorAll<HTMLElement>("[data-open-restore-account]").forEach((btn) => {
    btn.addEventListener("click", openRestoreAccountDialog);
  });
  closeRestoreBtn?.addEventListener("click", () => restoreDialog?.close());
  restoreDialog?.addEventListener("click", (event) => {
    if (event.target === restoreDialog) restoreDialog.close();
  });

  // The tier is never trusted from browser storage (it is user-editable). It always
  // comes from the licensing service, using the license key saved on this machine.
  const applyTier = (tier: MonetizationTier, announce = false) => {
    currentActiveTier = tier;
    if (selectedTierElement) {
      selectedTierElement.textContent = tier;
      selectedTierElement.className = `tier-badge tier-badge-${tier.toLowerCase()}`;
    }
    if (activeTierDisplay) activeTierDisplay.textContent = tier;
    document.querySelectorAll(".edition-card").forEach((card) => {
      card.classList.remove("active-edition");
    });
    const cardKey = tier === "PRO" ? "pro" : tier === "ENTERPRISE" ? "enterprise" : "";
    const activeCard = cardKey ? document.getElementById(`edition-card-${cardKey}`) : null;
    if (activeCard) activeCard.classList.add("active-edition");
    refreshRestoreAccountSummary();
    if (announce) showToast(`Post Card ${tier} is active. Thank you!`);
  };

  const applyAiButlerState = (active: boolean) => {
    if (!aiButlerSubBtn) return;
    aiButlerSubBtn.textContent = active ? "AI BUTLER ACTIVE ✓" : "Activate AI Butler Sub";
    aiButlerSubBtn.classList.toggle("active", active);
    refreshRestoreAccountSummary();
  };

  const postLicense = async (payload: Record<string, string>) => {
    const response = await fetch("/api/stripe/license", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  };

  const tierFromLicense = (data: { tier?: string; active?: boolean }): MonetizationTier =>
    data.active && (data.tier === "pro" || data.tier === "enterprise")
      ? (data.tier.toUpperCase() as MonetizationTier)
      : "COMMUNITY";

  const verifyStoredLicense = async (): Promise<boolean> => {
    const key = localStorage.getItem(LICENSE_KEY_STORAGE);
    if (!key) {
      refreshRestoreAccountSummary();
      return false;
    }
    try {
      const { status, data } = await postLicense({ licenseKey: key });
      if (status === 404) {
        localStorage.removeItem(LICENSE_KEY_STORAGE);
        applyTier("COMMUNITY");
        return false;
      }
      if (status === 200 && data.ok) {
        applyTier(tierFromLicense(data));
        return true;
      }
    } catch {
      // Offline: stay on Community until the licensing service is reachable.
    }
    refreshRestoreAccountSummary();
    return false;
  };

  const claimCheckout = async (sessionId: string) => {
    showToast("Confirming your purchase…");
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        const { status, data } = await postLicense({ sessionId });
        if (status === 200 && data.ok && typeof data.licenseKey === "string") {
          localStorage.setItem(LICENSE_KEY_STORAGE, data.licenseKey);
          applyTier(tierFromLicense(data), true);
          return;
        }
        if (status !== 202) break;
      } catch {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    showToast("We could not confirm your purchase yet. It will appear shortly; reopen the app to retry.");
  };

  applyTier("COMMUNITY");
  if (localStorage.getItem(AI_BUTLER_STORAGE) === "true") {
    applyAiButlerState(true);
  }
  void verifyStoredLicense();

  // --- Restore Account Handlers ---
  restoreCopyKeyBtn?.addEventListener("click", async () => {
    const savedKey = localStorage.getItem(LICENSE_KEY_STORAGE);
    if (!savedKey) {
      setRestoreStatusMessage("No license key is stored on this device yet.", "info");
      return;
    }
    try {
      await navigator.clipboard.writeText(savedKey);
      setRestoreStatusMessage("✓ Copied license key to clipboard.", "ok");
      showToast("🔑 License key copied to clipboard.");
    } catch {
      setRestoreStatusMessage(`License key: ${savedKey}`, "info");
    }
  });

  restoreLicenseForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const raw = restoreLicenseInput?.value.trim() ?? "";
    if (!raw) {
      setRestoreStatusMessage("Enter a license key (pcos-...) or Stripe session ID (cs_...) to restore.", "error");
      restoreLicenseInput?.focus();
      return;
    }
    setRestoreStatusMessage("Contacting licensing service to verify and restore your account…", "info");
    try {
      const payload: Record<string, string> =
        raw.startsWith("cs_") || raw.startsWith("sim_")
          ? { sessionId: raw }
          : { licenseKey: raw };
      const { status, data } = await postLicense(payload);
      if (status === 200 && data.ok) {
        const resolvedKey = typeof data.licenseKey === "string" && data.licenseKey ? data.licenseKey : raw;
        if (resolvedKey.startsWith("pcos-")) {
          localStorage.setItem(LICENSE_KEY_STORAGE, resolvedKey);
        }
        const restoredTier = tierFromLicense(data);
        applyTier(restoredTier, true);
        if (restoreLicenseInput) restoreLicenseInput.value = "";
        setRestoreStatusMessage(
          `✓ Account restored! Active tier: ${restoredTier} (${String(data.status ?? "active").toUpperCase()}).`,
          "ok",
        );
      } else if (status === 202) {
        setRestoreStatusMessage(
          "⏳ Purchase session found — payment confirmation is still syncing. Please retry in a few seconds.",
          "info",
        );
      } else {
        setRestoreStatusMessage(
          data.error ?? "No active license matched that key or session ID. Check the value and try again.",
          "error",
        );
      }
    } catch (error) {
      setRestoreStatusMessage(
        error instanceof Error ? error.message : "Could not reach the licensing service.",
        "error",
      );
    }
  });

  restoreResyncBtn?.addEventListener("click", async () => {
    setRestoreStatusMessage("Re-syncing device profile, saved license key, DLC modules & workspace cards…", "info");
    localProfile = readLocalProfile();
    renderLocalProfile();

    // Restore DLC toggles from storage
    document.querySelectorAll<HTMLButtonElement>("[data-dlc]").forEach((btn) => {
      if (btn.disabled) return;
      const dlcKey = btn.dataset.dlc!;
      const stored = localStorage.getItem(`postcard_dlc_${dlcKey}`);
      const isInstalled = stored !== null ? stored === "true" : true;
      localStorage.setItem(`postcard_dlc_${dlcKey}`, String(isInstalled));
      btn.classList.toggle("active", isInstalled);
      btn.textContent = isInstalled ? "ACTIVE" : "INSTALL";
    });

    // Restore AI Butler state
    const aiSaved = localStorage.getItem(AI_BUTLER_STORAGE) === "true";
    applyAiButlerState(aiSaved);

    // Restore any binned cards back into the active room
    let restoredCardsCount = 0;
    for (const binnedId of [...binnedCards.keys()]) {
      restoreCardFromBin(binnedId);
      restoredCardsCount += 1;
    }

    const licenseVerified = await verifyStoredLicense();
    refreshRestoreAccountSummary();
    const summaryParts = [
      `Profile: ${localProfile.name}`,
      `Tier: ${currentActiveTier}`,
      licenseVerified ? "License verified ✓" : "Community license",
      ...(restoredCardsCount > 0 ? [`Restored ${restoredCardsCount} binned card(s)`] : []),
    ];
    const msg = `✓ Account re-synced (${summaryParts.join(" · ")}).`;
    setRestoreStatusMessage(msg, "ok");
    showToast(msg);
  });

  restoreExportBtn?.addEventListener("click", () => {
    const dlcState: Record<string, boolean> = {};
    document.querySelectorAll<HTMLButtonElement>("[data-dlc]").forEach((btn) => {
      const key = btn.dataset.dlc;
      if (key) dlcState[key] = btn.classList.contains("active");
    });
    const snapshot = {
      schema: "postcard.os.account-backup.v1",
      exportedAt: new Date().toISOString(),
      profile: localProfile,
      licenseKey: localStorage.getItem(LICENSE_KEY_STORAGE) || null,
      aiButlerActive: localStorage.getItem(AI_BUTLER_STORAGE) === "true",
      dlc: dlcState,
      reduceMotion: reduceMotionOptIn,
      manualNotes: manualCustomNotes?.value ?? "",
    };
    downloadTextFile(
      "postcard-account-backup.json",
      JSON.stringify(snapshot, null, 2),
      "application/json",
    );
    setRestoreStatusMessage("✓ Downloaded postcard-account-backup.json.", "ok");
    showToast("⬇ Exported portable Account Backup (postcard-account-backup.json).");
  });

  restoreImportBtn?.addEventListener("click", () => {
    restoreImportInput?.click();
  });

  restoreImportInput?.addEventListener("change", async () => {
    const file = restoreImportInput.files?.[0];
    restoreImportInput.value = "";
    if (!file) return;
    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid backup file format.");
      }
      if (parsed.profile && typeof parsed.profile === "object") {
        const prof = parsed.profile as { name?: unknown; initials?: unknown };
        const name = typeof prof.name === "string" ? prof.name.trim().slice(0, 40) : "";
        const initials = typeof prof.initials === "string" ? prof.initials.trim().toLocaleUpperCase() : "";
        if (name) {
          localProfile = {
            name,
            initials: /^\p{L}{1,2}$/u.test(initials) ? initials : localProfile.initials,
          };
          localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(localProfile));
          renderLocalProfile();
        }
      }
      if (typeof parsed.aiButlerActive === "boolean") {
        localStorage.setItem(AI_BUTLER_STORAGE, String(parsed.aiButlerActive));
        applyAiButlerState(parsed.aiButlerActive);
      }
      if (parsed.dlc && typeof parsed.dlc === "object") {
        const dlcMap = parsed.dlc as Record<string, unknown>;
        document.querySelectorAll<HTMLButtonElement>("[data-dlc]").forEach((btn) => {
          const dlcKey = btn.dataset.dlc;
          if (dlcKey && typeof dlcMap[dlcKey] === "boolean") {
            const active = Boolean(dlcMap[dlcKey]);
            localStorage.setItem(`postcard_dlc_${dlcKey}`, String(active));
            btn.classList.toggle("active", active);
            btn.textContent = active ? "ACTIVE" : "INSTALL";
          }
        });
      }
      if (typeof parsed.manualNotes === "string" && manualCustomNotes) {
        manualCustomNotes.value = parsed.manualNotes;
        localStorage.setItem(MANUAL_NOTES_STORAGE_KEY, parsed.manualNotes);
      }
      if (typeof parsed.licenseKey === "string" && parsed.licenseKey.trim()) {
        localStorage.setItem(LICENSE_KEY_STORAGE, parsed.licenseKey.trim());
        await verifyStoredLicense();
      }
      refreshRestoreAccountSummary();
      setRestoreStatusMessage(
        `✓ Restored account backup for ${localProfile.name} (${currentActiveTier}).`,
        "ok",
      );
      showToast(`⬆ Account & preferences restored for ${localProfile.name}!`);
    } catch (error) {
      setRestoreStatusMessage(
        error instanceof Error ? `Import failed: ${error.message}` : "Could not parse backup file.",
        "error",
      );
    }
  });

  const returned = new URLSearchParams(window.location.search);
  const returnedSession = returned.get("session_id");
  if (returned.get("checkout") === "success" && returnedSession) {
    window.history.replaceState({}, "", window.location.pathname);
    void claimCheckout(returnedSession);
  } else if (returned.get("checkout") === "cancelled") {
    window.history.replaceState({}, "", window.location.pathname);
    showToast("Checkout cancelled. You have not been charged.");
  }

  document.querySelectorAll<HTMLButtonElement>(".billing-opt").forEach((opt) => {
    opt.addEventListener("click", () => {
      document.querySelectorAll(".billing-opt").forEach((o) => o.classList.toggle("active", o === opt));
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-select-tier]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tier = btn.dataset.selectTier as MonetizationTier | "AI_BUTLER";
      if (tier === "PRO" || tier === "ENTERPRISE") {
        void startStripeCheckout(tier);
      } else if (tier === "AI_BUTLER") {
        localStorage.setItem(AI_BUTLER_STORAGE, "true");
        applyAiButlerState(true);
        showToast("✦ AI Butler & Automation Co-Pilot Activated with 100% Local Privacy!");
        if (butlerBubble?.hidden) butlerSay(butlerGreeting(butlerContext()), 10000);
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-dlc]").forEach((btn) => {
    if (btn.disabled) return; // add-ons are not for sale yet
    const dlcKey = btn.dataset.dlc!;
    const isInstalled = localStorage.getItem(`postcard_dlc_${dlcKey}`) === "true" || btn.classList.contains("active");
    btn.classList.toggle("active", isInstalled);
    btn.textContent = isInstalled ? "ACTIVE" : "INSTALL";

    btn.addEventListener("click", () => {
      const active = btn.classList.toggle("active");
      btn.textContent = active ? "ACTIVE" : "INSTALL";
      localStorage.setItem(`postcard_dlc_${dlcKey}`, String(active));
      showToast(`${active ? "Activated" : "Deactivated"} add-on module: ${dlcKey.toUpperCase()}`);
    });
  });
}

let lastFrameTime = 0;

function animate(now = 0): void {
  requestAnimationFrame(animate);
  const dt = lastFrameTime > 0 ? Math.min(0.05, (now - lastFrameTime) / 1000) : 1 / 60;
  lastFrameTime = now;
  const reducePreviewMotion = prefersReducedMotion();

  // Smoothly damp turntable towards target with organic spring ease
  if (drag?.mode === "carousel") {
    // Locked 1:1 under pointer while dragging
  } else {
    turntableAngle = THREE.MathUtils.damp(turntableAngle, targetTurntableAngle, 3.2, dt);
  }

  const slotStep = getSlotStep();
  let closestCard: SystemCard = cards[0];
  let minAbsAngle = Infinity;

  if (reducePreviewMotion && drag?.mode !== "carousel") {
    turntableAngle = targetTurntableAngle;
  }

  for (const [index, card] of cards.entries()) {
    if (drag?.card === card && drag.mode === "move") continue;

    const slotAngle = index * slotStep;
    card.orbitAngle = normalizeAngle(slotAngle + turntableAngle);
    const frozenForTrash = trashFlight?.card === card || pendingTrash?.card === card;

    if (!frozenForTrash && Math.abs(card.orbitAngle) < minAbsAngle) {
      minAbsAngle = Math.abs(card.orbitAngle);
      closestCard = card;
    }
    if (frozenForTrash) continue;

    const benchSlot = frontBenchSlot(index);
    const anyFrontTwisted = cards.some((c) => c.twisted && isCardPulledToFront(c));
    const benchSpacing = anyFrontTwisted ? 3.55 : 2.75;
    const basePosition =
      benchCount > 1 && benchSlot !== undefined
        ? new THREE.Vector3(
            benchCount === 2 ? (benchSlot - 0.5) * benchSpacing : benchSlot * benchSpacing,
            2.64,
            benchSlot === 0 ? 2.22 : 2.04,
          )
        : orbitPositionFromAngle(card.orbitAngle);
    const targetPosition = basePosition.add(card.layoutOffset);

    // Strong perspective scaling + in-place 3D Twist expansion when pulled to the front.
    if (!(drag?.card === card && drag.mode === "peel")) {
      card.peel = reducePreviewMotion ? 0 : THREE.MathUtils.damp(card.peel ?? 0, 0, 9, dt);
    }
    const targetTwist = card.twisted ? 1 : 0;
    card.twistAmount = reducePreviewMotion
      ? targetTwist
      : THREE.MathUtils.damp(card.twistAmount ?? 0, targetTwist, 7.5, dt);
    const twistAmt = card.twistAmount ?? 0;
    targetPosition.z += twistAmt * 0.32;
    const targetScale = carouselPoseFromAngle(card.orbitAngle).scale;
    const baseScale =
      benchCount > 1 && benchSlot !== undefined
        ? benchSlot === 0
          ? 1.02
          : 0.96
        : targetScale;
    const peelScale = 1 + (card.peel ?? 0) * 0.3;
    const scaleX = baseScale * peelScale * (1 + twistAmt * 0.42);
    const scaleY = baseScale * peelScale * (1 + twistAmt * 0.18);
    card.group.scale.set(scaleX, scaleY, baseScale * peelScale);

    // Handle smooth physical flip animation (520ms S-curve ease-in-out)
    if (card.flipAnim && reducePreviewMotion) {
      const flip = card.flipAnim;
      card.group.rotation.y = flip.targetRotationY;
      card.group.rotation.x = 0;
      card.group.rotation.z = 0;
      if (!flip.midpointPassed) {
        card.facet = flip.targetFacet;
        card.backFaceVisible = !card.backFaceVisible;
        if (card === selectedCard) {
          updateFacetBarUI();
          updateOnCardActions();
          selectedNameElement.textContent = `${card.name} · ${FACET_META[card.facet].badge}`;
        }
      }
      card.flipAnim = undefined;
    }

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
        // Top edge tumbles toward the viewer for "top"; bottom edge for "bottom".
        const pitchDirection = card.flipAnim.targetFacet === "top" ? 1 : -1;
        const startX = card.flipAnim.startRotationX ?? 0;
        // Continue smoothly from any hand-held tilt into the 3D tumble.
        card.group.rotation.x =
          startX * (1 - eased) + Math.sin(t * Math.PI) * pitchDirection * (Math.PI * 0.5) * (1 - Math.abs(startX) / Math.PI);
      } else {
        card.group.rotation.z = arc * (card.flipAnim.tiltDir * 0.22);
      }

      if (t >= 0.5 && !card.flipAnim.midpointPassed) {
        card.flipAnim.midpointPassed = true;
        card.facet = card.flipAnim.targetFacet;
        card.backFaceVisible = !card.backFaceVisible;
        if (card === selectedCard) {
          updateFacetBarUI();
          updateOnCardActions();
          selectedNameElement.textContent = `${card.name} · ${FACET_META[card.facet].badge}`;
        }
      }

      if (t >= 1) {
        card.group.rotation.y = card.flipAnim.targetRotationY;
        card.flipAnim = undefined;
      }
    } else {
      const targetRotationY = cardDisplayRotation(card);
      const handHeld = drag?.card === card && drag.moved && (drag.mode === "flip" || drag.mode === "peel");
      if (handHeld) {
        // Hand-held: leave the card exactly where the pointer has it.
      } else {
        card.group.rotation.y = reducePreviewMotion
          ? targetRotationY
          : THREE.MathUtils.damp(card.group.rotation.y, targetRotationY, 8.5, dt);
      }
      if (handHeld && (drag?.mode === "peel" || drag?.grabEdge)) {
        // Rotation is fully pointer-driven during edge and corner grabs.
      } else if (reducePreviewMotion) {
        card.tiltX = 0;
        card.tiltZ = 0;
        card.group.rotation.x = 0;
        card.group.rotation.z = 0;
      } else {
        card.tiltX = THREE.MathUtils.damp(card.tiltX, 0, 7, dt);
        card.tiltZ = THREE.MathUtils.damp(card.tiltZ, 0, 7, dt);
        card.group.rotation.x = THREE.MathUtils.damp(card.group.rotation.x, card.tiltX, 11, dt);
        card.group.rotation.z = THREE.MathUtils.damp(card.group.rotation.z, card.tiltZ, 11, dt);
      }
    }

    if (reducePreviewMotion) {
      card.group.position.copy(targetPosition);
    } else {
      card.group.position.x = THREE.MathUtils.damp(card.group.position.x, targetPosition.x, 28, dt);
      card.group.position.y = THREE.MathUtils.damp(card.group.position.y, targetPosition.y, 28, dt);
      card.group.position.z = THREE.MathUtils.damp(card.group.position.z, targetPosition.z, 28, dt);
    }
    card.group.position.y = Math.max(card.group.position.y, 1.68);
  }

  // Update front-center selection when the carousel rotates to a new front card
  if (closestCard !== selectedCard && minAbsAngle < 0.28) {
    const previousCard = selectedCard;
    selectedCard = closestCard;
    selectedIndex = cards.indexOf(closestCard);
    refreshPrivateGuestPreview(previousCard, closestCard);
    updateGuestActionButton();
    updateFacetBarUI();
    updateRoomCardNav();
    updateRoomSelection();
    selectedNameElement.textContent = `${closestCard.name} · ${FACET_META[closestCard.facet].badge}`;
    sceneCardIndexElement.textContent = String(selectedIndex + 1).padStart(2, "0");
    for (const item of cards) {
      const edge = item.group.children[0];
      const material = edge instanceof THREE.Mesh ? edge.material : undefined;
      if (material instanceof THREE.MeshStandardMaterial) {
        material.emissive.set(item === closestCard ? "#70d5cf" : "#152631");
        material.emissiveIntensity = item === closestCard ? 0.62 : 0.22;
      }
    }
  }

  if (drag?.mode === "move") {
    resolveCardCollisions(drag.card);
  }
  for (const card of cards) updateCardFocus(card, dt, reducePreviewMotion);

  updateTour(now, dt);

  const desiredCamPos =
    tourActive && tourCameraOverridePos
      ? tourCameraOverridePos
      : cardZoomed && selectedCard
        ? zoomedCameraPosition(selectedCard)
        : overviewCameraPosition();
  const desiredLookAt =
    tourActive && tourCameraOverrideLook
      ? tourCameraOverrideLook
      : cardZoomed && selectedCard
        ? new THREE.Vector3(
            selectedCard.group.position.x,
            selectedCard.group.position.y + 0.04,
            selectedCard.group.position.z - selectedCard.layoutOffset.z,
          )
        : new THREE.Vector3(0, 2.68, 0.25);

  if (reducePreviewMotion) {
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
  camera.updateMatrixWorld();
  updateCardActionStripPosition();

  // Pillar 1: Dynamic Halo & Specular Floor Lighting tracking the active card
  if (selectedCard) {
    const brandTarget = new THREE.Color(selectedCard.color);
    cardHaloLight.color.lerp(brandTarget, Math.min(1, dt * 5.2));
    cardFloorGlow.color.lerp(brandTarget, Math.min(1, dt * 5.2));
    if (glowDisc.material instanceof THREE.MeshBasicMaterial) {
      glowDisc.material.color.lerp(brandTarget, Math.min(1, dt * 5.2));
      glowDisc.material.opacity = 0.08 + 0.025 * Math.sin(now * 0.0024);
    }
    cardHaloLight.position.x = THREE.MathUtils.damp(cardHaloLight.position.x, selectedCard.group.position.x, 7.5, dt);
    cardFloorGlow.position.x = THREE.MathUtils.damp(cardFloorGlow.position.x, selectedCard.group.position.x, 7.5, dt);
    cardFloorGlow.position.z = THREE.MathUtils.damp(cardFloorGlow.position.z, selectedCard.group.position.z + 0.15, 7.5, dt);
  }

  // Pillar 2: Activity LED subtle breathing for active cards
  for (const card of cards) {
    if (card.statusLedMat) {
      const isRunning = card.status.includes("CONNECTED") || card.status.includes("INSTALLER");
      const isStarting = card.status.includes("STARTING") || card.status.includes("SHUTTING");
      if (isRunning) {
        card.statusLedMat.emissiveIntensity = 1.1 + 0.35 * Math.sin(now * 0.004);
      } else if (isStarting) {
        card.statusLedMat.emissiveIntensity = 0.8 + 0.45 * Math.sin(now * 0.009);
      }
    }
  }

  // Pillar 3: Dynamic Audio VU Meters
  updateVuMeters(now);

  updateTrashFlight(now);
  updateAirplane(now);
  if (!reducePreviewMotion) {
    overheadHaloGroup.rotation.y = now * 0.00012;
    studioMotes.rotation.y = -now * 0.00008;
    cosmicStarfield.rotation.y = -now * 0.00002;
    starMaterial.size = 0.088 + 0.012 * Math.sin(now * 0.0016);
    for (const [idx, mat] of monolithLedMats.entries()) {
      mat.emissiveIntensity = 0.55 + 0.4 * Math.sin(now * 0.0022 + idx * 0.7);
    }
  }
  renderer.render(scene, camera);
}

function updateCardActionStripPosition(): void {
  const card = selectedCard;
  if (!card || cardActionStripElement.hidden) return;
  card.group.updateMatrixWorld(true);
  const anchor = new THREE.Vector3(0, -1.42, 0)
    .applyMatrix4(card.group.matrixWorld)
    .project(camera);
  cardActionStripElement.style.left = `${(anchor.x * 0.5 + 0.5) * sceneViewportWidth}px`;
  cardActionStripElement.style.top = `${(-anchor.y * 0.5 + 0.5) * sceneViewportHeight}px`;
}

function initKernelTelemetryBridge(): void {
  applyTelemetryToDom(latestKernelTelemetry);

  const toggleBtn = document.getElementById("romy-vault-toggle");
  toggleBtn?.addEventListener("click", async () => {
    const nextActive = !latestKernelTelemetry.romy_active;
    try {
      const response = await fetch("/api/guest/telemetry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ romy_active: nextActive }),
      });
      if (response.ok) {
        const packet = (await response.json()) as KernelTelemetryPacket;
        latestKernelTelemetry = packet;
        applyTelemetryToDom(packet);
        for (const card of cards) {
          if (card.id === "postcard-os" || card.facet === "bottom") {
            refreshCardTexture(card, true);
          }
        }
        showToast(
          nextActive
            ? "PA-Romy Coprocessor Vault: ACTIVE // ENCLAVE LOCKED"
            : "PA-Romy Coprocessor Vault: STANDBY // IDLE",
        );
      }
    } catch {
      // Fallback local toggle if offline
      latestKernelTelemetry = {
        ...latestKernelTelemetry,
        romy_active: nextActive,
        romy_coprocessor_state: nextActive ? "VAULT ACTIVE // ENCLAVE LOCKED" : "STANDBY // IDLE",
      };
      applyTelemetryToDom(latestKernelTelemetry);
    }
  });

  // Connect live WebSocket listener receiving kernel telemetry packets
  const connectTelemetryWs = (): void => {
    try {
      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsHost = window.location.host || `${window.location.hostname || "127.0.0.1"}:5173`;
      const ws = new WebSocket(`${wsProtocol}//${wsHost}/telemetry`);
      ws.onmessage = (event) => {
        try {
          const telemetry = JSON.parse(String(event.data)) as KernelTelemetryPacket;
          if (telemetry && typeof telemetry.romy_coprocessor_state === "string") {
            latestKernelTelemetry = telemetry;
            // Dynamically updates host-side command center view in real time
            const romyEl = document.getElementById("romy-status");
            if (romyEl) romyEl.innerText = telemetry.romy_coprocessor_state;
            const heapEl = document.getElementById("heap-meter");
            if (heapEl) heapEl.style.width = `${telemetry.heap_pressure}%`;
            applyTelemetryToDom(telemetry);
            for (const card of cards) {
              if (card.id === "postcard-os" || card.facet === "bottom") {
                refreshCardTexture(card);
              }
            }
          }
        } catch {
          // Ignore malformed frames
        }
      };
    } catch {
      // WebSocket unavailable in headless/non-browser environments
    }
  };
  connectTelemetryWs();
}

initCommercialEditions();
initKernelTelemetryBridge();
animate();








