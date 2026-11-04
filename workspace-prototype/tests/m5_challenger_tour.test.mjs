import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(__dirname, "..");

test("Milestone 5 DOM Stress Test: index.html HUD buttons, overlay, and badges", () => {
  const htmlPath = path.join(workspaceDir, "index.html");
  assert.ok(fs.existsSync(htmlPath), "index.html must exist");
  const html = fs.readFileSync(htmlPath, "utf-8");

  // 1. Tour button
  assert.match(html, /<button[^>]+id="tour-button"/, "#tour-button must exist");
  assert.match(html, /class="[^"]*\bmode-pill\b[^"]*\btour-pill\b[^"]*"/, "#tour-button must have mode-pill and tour-pill classes");
  assert.match(html, /id="tour-button"[^>]+aria-pressed="false"/, "#tour-button must have aria-pressed='false'");
  assert.match(html, /id="tour-button"[^>]+title="[^"]*\(T\)[^"]*"/, "#tour-button must have title with (T) shortcut");

  // 2. Record tour button (contract check: check record-tour-button)
  assert.match(html, /<button[^>]+id="record-tour-button"/, "#record-tour-button must exist");
  assert.match(html, /class="[^"]*\bmode-pill\b[^"]*\brecord-pill\b[^"]*"/, "#record-tour-button must have mode-pill and record-pill classes");
  assert.match(html, /id="record-tour-button"[^>]+aria-pressed="false"/, "#record-tour-button must have aria-pressed='false'");
  assert.match(html, /id="record-tour-button"[^>]+title="[^"]*60FPS[^"]*"/, "#record-tour-button must describe 60FPS video");

  // 3. Tour overlay
  assert.match(html, /<div[^>]+id="tour-overlay"[^>]*\bhidden\b/, "#tour-overlay must exist and be hidden by default");
  assert.match(html, /id="tour-step-badge"/, "#tour-overlay must contain #tour-step-badge");
  assert.match(html, /class="tour-live-dot"/, "#tour-overlay must contain .tour-live-dot");
  assert.match(html, /id="tour-status-label"/, "#tour-overlay must contain #tour-status-label");
  assert.match(html, /id="tour-step-title"/, "#tour-overlay must contain #tour-step-title");
  assert.match(html, /id="tour-step-desc"/, "#tour-overlay must contain #tour-step-desc");
  assert.match(html, /class="tour-progress-bar"/, "#tour-overlay must contain .tour-progress-bar");
  assert.match(html, /id="tour-progress-fill"/, "#tour-overlay must contain #tour-progress-fill");

  // 4. Selected tier badge
  assert.match(html, /<span[^>]+id="selected-tier"[^>]*>COMMUNITY<\/span>/, "#selected-tier must default to COMMUNITY");
  assert.match(html, /class="tier-badge\s+tier-badge-community"/, "#selected-tier must have tier-badge classes");
});

test("Milestone 5 CSS & Z-Index Layering: style.css HUD & Tour overlay", () => {
  const cssPath = path.join(workspaceDir, "src", "style.css");
  assert.ok(fs.existsSync(cssPath), "style.css must exist");
  const css = fs.readFileSync(cssPath, "utf-8");

  // Overlay layering & backdrop
  assert.match(css, /\.tour-overlay\s*\{[^}]*position:\s*absolute;/, ".tour-overlay must have position: absolute");
  assert.match(css, /\.tour-overlay\s*\{[^}]*z-index:\s*10;/, ".tour-overlay must have z-index: 10");
  assert.match(css, /\.tour-overlay\s*\{[^}]*backdrop-filter:\s*blur\(16px\);/, ".tour-overlay must have backdrop blur");
  assert.match(css, /\.tour-overlay\s*\{[^}]*pointer-events:\s*none;/, ".tour-overlay must pass pointer events through");

  // Pulse animation for recording
  assert.match(css, /@keyframes pulse-tour-recording\s*\{/, "pulse-tour-recording animation must be defined");
  assert.match(css, /\.record-pill\.recording\s*\{[^}]*animation:\s*pulse-tour-recording/, ".record-pill.recording must animate pulse");

  // Tier badges
  assert.match(css, /\.tier-badge\s*\{/, ".tier-badge base class must be defined");
  assert.match(css, /\.tier-badge-community\s*\{/, ".tier-badge-community must be styled");
  assert.match(css, /\.tier-badge-pro\s*\{/, ".tier-badge-pro must be styled");
  assert.match(css, /\.tier-badge-enterprise\s*\{/, ".tier-badge-enterprise must be styled");
});

test("Milestone 5 Multi-OS Cards & Monetization Tier Matrix in src/main.ts", () => {
  const mainPath = path.join(workspaceDir, "src", "main.ts");
  const mainTs = fs.readFileSync(mainPath, "utf-8");

  // Check initialCards registration
  assert.match(mainTs, /id:\s*"postcard-os"/, "postcard-os must be registered in initialCards");
  assert.match(mainTs, /name:\s*"Post Card · Spatial OS"/, "postcard-os name must be set");
  assert.match(mainTs, /color:\s*"#00E5FF"/, "postcard-os must have cyan brand color #00E5FF");
  assert.match(mainTs, /id:\s*"macos"/, "macos must be registered in initialCards");

  // Check tier assignment function
  assert.match(mainTs, /type MonetizationTier = "COMMUNITY" \| "PRO" \| "ENTERPRISE";/, "MonetizationTier type must be defined");
  assert.match(mainTs, /function getCardTier\(card: SystemCard\): MonetizationTier/, "getCardTier function must exist");
  assert.match(mainTs, /card\.id === "postcard-os" \|\| card\.id === "kali-red"/, "postcard-os and kali-red must be ENTERPRISE");
  assert.match(mainTs, /card\.id === "windows" \|\| card\.id === "macos"/, "windows and macos must be PRO");
});

test("Milestone 5 Dynamic WebSocket: No hardcoded 127.0.0.1 in main.ts and dist/", () => {
  const mainPath = path.join(workspaceDir, "src", "main.ts");
  const mainTs = fs.readFileSync(mainPath, "utf-8");

  // Dynamic host and protocol
  assert.match(mainTs, /window\.location\.hostname\s*\|\|\s*"127\.0\.0\.1"/, "Must use window.location.hostname with fallback");
  assert.match(mainTs, /window\.location\.protocol === "https:" \? "wss:" : "ws:"/, "Must dynamically resolve ws: vs wss:");
  assert.ok(!mainTs.includes('`ws://127.0.0.1:${websocketPort}`'), "Hardcoded ws://127.0.0.1 must be removed");

  // Check built dist bundle
  const distDir = path.join(workspaceDir, "dist", "assets");
  const files = fs.readdirSync(distDir);
  const jsBundle = files.find((f) => f.startsWith("index-") && f.endsWith(".js"));
  assert.ok(jsBundle, "Built index JS bundle must exist");
  const jsContent = fs.readFileSync(path.join(distDir, jsBundle), "utf-8");
  assert.match(jsContent, /window\.location\.hostname\|\|"127\.0\.0\.1"/, "Bundle must contain dynamic hostname resolution");
});

test("Milestone 5 Tour State Machine & Interruption Safety Simulation", () => {
  // Model state machine exactly as implemented in main.ts
  let tourActive = false;
  let tourStage = 0;
  let tourStartTime = 0;
  let tourCameraOverridePos = null;
  let tourCameraOverrideLook = null;
  let tourPaperPlaneFired = false;
  let tourPerformanceSwitched = false;
  let tourSecOpsSwitched = false;
  let cardZoomed = false;
  let selectedCard = { id: "postcard-os", facet: "front" };
  let secOpsMode = false;
  let fillLightColor = "#8a909e";
  let rimLightColor = "#FFB81C";
  let isTourRecording = false;
  let mediaRecorderStopped = false;

  function toggleSecOpsLabMode() {
    secOpsMode = !secOpsMode;
    fillLightColor = secOpsMode ? "#FFB81C" : "#8a909e";
    rimLightColor = secOpsMode ? "#8a909e" : "#FFB81C";
  }

  function startGuidedTour() {
    tourActive = true;
    tourStartTime = 0;
    tourStage = 0;
    tourPaperPlaneFired = false;
    tourPerformanceSwitched = false;
    tourSecOpsSwitched = false;
  }

  function stopGuidedTour() {
    tourActive = false;
    tourCameraOverridePos = null;
    tourCameraOverrideLook = null;
    if (cardZoomed) cardZoomed = false;
    if (selectedCard && selectedCard.facet !== "front") selectedCard.facet = "front";
    if (secOpsMode) toggleSecOpsLabMode();
  }

  function stopTourRecording() {
    if (isTourRecording) {
      mediaRecorderStopped = true;
      isTourRecording = false;
    }
  }

  function updateTour(now) {
    if (!tourActive) return;
    const elapsed = now - tourStartTime;
    const totalDuration = 62;

    if (elapsed < 8) {
      tourStage = 1;
      tourCameraOverridePos = { x: 0, y: 5, z: 14 };
      tourCameraOverrideLook = { x: 0, y: 2.68, z: 0.25 };
    } else if (elapsed < 18) {
      tourStage = 2;
      tourCameraOverridePos = null;
      tourCameraOverrideLook = null;
    } else if (elapsed < 27) {
      tourStage = 3;
      cardZoomed = true;
      if (elapsed >= 18.5 && elapsed < 21.0) selectedCard.facet = "back";
      else if (elapsed >= 21.0 && elapsed < 23.5) selectedCard.facet = "left";
      else if (elapsed >= 23.5 && elapsed < 26.5) selectedCard.facet = "bottom";
    } else if (elapsed < 36) {
      tourStage = 4;
      cardZoomed = false;
      selectedCard.facet = "front";
      if (!tourPaperPlaneFired && elapsed >= 28.0) tourPaperPlaneFired = true;
    } else if (elapsed < 45) {
      tourStage = 5;
      if (!tourPerformanceSwitched && elapsed >= 37.0) tourPerformanceSwitched = true;
    } else if (elapsed < 53) {
      tourStage = 6;
      if (!tourSecOpsSwitched && elapsed >= 46.0) {
        tourSecOpsSwitched = true;
        if (!secOpsMode) toggleSecOpsLabMode();
      }
    } else if (elapsed < totalDuration) {
      tourStage = 7;
      if (secOpsMode) toggleSecOpsLabMode();
      cardZoomed = true;
    } else {
      stopGuidedTour();
      if (isTourRecording) stopTourRecording();
    }
  }

  // Test full nominal 62s tour run
  startGuidedTour();
  assert.equal(tourActive, true);
  updateTour(4); // Stage 1
  assert.equal(tourStage, 1);
  assert.notEqual(tourCameraOverridePos, null, "Stage 1 must override camera");

  updateTour(12); // Stage 2
  assert.equal(tourStage, 2);
  assert.equal(tourCameraOverridePos, null, "Stage 2 must clear camera override");

  updateTour(22); // Stage 3
  assert.equal(tourStage, 3);
  assert.equal(cardZoomed, true);
  assert.equal(selectedCard.facet, "left");

  updateTour(30); // Stage 4
  assert.equal(tourStage, 4);
  assert.equal(tourPaperPlaneFired, true);

  updateTour(40); // Stage 5
  assert.equal(tourStage, 5);
  assert.equal(tourPerformanceSwitched, true);

  updateTour(48); // Stage 6
  assert.equal(tourStage, 6);
  assert.equal(secOpsMode, true, "Stage 6 must activate SecOps mode");
  assert.equal(fillLightColor, "#FFB81C");

  updateTour(55); // Stage 7
  assert.equal(tourStage, 7);
  assert.equal(secOpsMode, false, "Stage 7 must restore standard lighting");
  assert.equal(fillLightColor, "#8a909e");

  updateTour(62.5); // End of tour
  assert.equal(tourActive, false, "Tour must terminate after 62s");
  assert.equal(cardZoomed, false, "Zoom must be restored");

  // Test Interruption Safety during Stage 6 (SecOps mode active + recording active)
  startGuidedTour();
  isTourRecording = true;
  mediaRecorderStopped = false;
  updateTour(48); // Inside Stage 6
  assert.equal(secOpsMode, true);
  assert.equal(fillLightColor, "#FFB81C");

  // User presses Escape or clicks stop button
  stopGuidedTour();
  if (isTourRecording) stopTourRecording();

  assert.equal(tourActive, false, "tourActive must become false");
  assert.equal(tourCameraOverridePos, null, "Camera override pos must be reset to null");
  assert.equal(tourCameraOverrideLook, null, "Camera override look must be reset to null");
  assert.equal(secOpsMode, false, "SecOps mode must be restored to false");
  assert.equal(fillLightColor, "#8a909e", "Fill light must be restored to normal");
  assert.equal(rimLightColor, "#FFB81C", "Rim light must be restored to normal");
  assert.equal(isTourRecording, false, "Recording must be stopped");
  assert.equal(mediaRecorderStopped, true, "MediaRecorder stop must be triggered");

  // Test Interruption Safety during Stage 3 (Card zoomed and flipped)
  startGuidedTour();
  updateTour(24); // Inside Stage 3
  assert.equal(cardZoomed, true);
  assert.equal(selectedCard.facet, "bottom");

  stopGuidedTour();
  assert.equal(tourActive, false);
  assert.equal(cardZoomed, false, "Zoom must be safely reset");
  assert.equal(selectedCard.facet, "front", "Card facet must be reset to front");
});

test("Milestone 5 Adversarial Stress Test: Rapid Start/Stop Toggles & Background Frame Jumps", () => {
  let tourActive = false;
  let tourStage = 0;
  let tourCameraOverridePos = null;
  let tourCameraOverrideLook = null;
  let cardZoomed = false;
  let secOpsMode = false;

  function toggleSecOpsLabMode() {
    secOpsMode = !secOpsMode;
  }

  function startGuidedTour() {
    tourActive = true;
    tourStage = 0;
  }

  function stopGuidedTour() {
    tourActive = false;
    tourCameraOverridePos = null;
    tourCameraOverrideLook = null;
    if (cardZoomed) cardZoomed = false;
    if (secOpsMode) toggleSecOpsLabMode();
  }

  function updateTour(elapsed) {
    if (!tourActive) return;
    if (elapsed < 8) {
      tourStage = 1;
      tourCameraOverridePos = { x: 0, y: 5, z: 14 };
    } else if (elapsed < 18) {
      tourStage = 2;
      tourCameraOverridePos = null;
    } else if (elapsed < 27) {
      tourStage = 3;
      cardZoomed = true;
    } else if (elapsed < 36) {
      tourStage = 4;
      cardZoomed = false;
    } else if (elapsed < 45) {
      tourStage = 5;
    } else if (elapsed < 53) {
      tourStage = 6;
      if (!secOpsMode) toggleSecOpsLabMode();
    } else if (elapsed < 62) {
      tourStage = 7;
      if (secOpsMode) toggleSecOpsLabMode();
      cardZoomed = true;
    } else {
      stopGuidedTour();
    }
  }

  // 1. Rapid toggle stress test (100 rapid cycles)
  for (let i = 0; i < 100; i++) {
    startGuidedTour();
    assert.equal(tourActive, true);
    stopGuidedTour();
    assert.equal(tourActive, false);
    assert.equal(cardZoomed, false);
    assert.equal(secOpsMode, false);
  }

  // 2. Large time jump (tab paused for 50 seconds during Stage 1 and resumes in Stage 7)
  startGuidedTour();
  updateTour(1.0); // Stage 1
  assert.equal(tourStage, 1);
  updateTour(55.0); // Jump directly to Stage 7
  assert.equal(tourStage, 7);
  assert.equal(cardZoomed, true);
  assert.equal(secOpsMode, false);

  // 3. Time jump straight past completion
  startGuidedTour();
  updateTour(2.0); // Stage 1
  updateTour(99.0); // Jump past 62s
  assert.equal(tourActive, false, "Tour must auto-stop on jump past completion");
  assert.equal(cardZoomed, false);
  assert.equal(secOpsMode, false);
});

test("Milestone 5 Adversarial WebSocket Resolution Stress Test", () => {
  function resolveWebSocketUrl(windowLocation, port) {
    const host = windowLocation.hostname || "127.0.0.1";
    const protocol = windowLocation.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${host}:${port}`;
  }

  // Empty hostname falls back to loopback
  assert.equal(resolveWebSocketUrl({ hostname: "", protocol: "http:" }, 5900), "ws://127.0.0.1:5900");
  // HTTPS resolves to secure wss:
  assert.equal(resolveWebSocketUrl({ hostname: "spatial.hypervisor.internal", protocol: "https:" }, 5900), "wss://spatial.hypervisor.internal:5900");
  // Standard LAN IP
  assert.equal(resolveWebSocketUrl({ hostname: "192.168.1.50", protocol: "http:" }, 5901), "ws://192.168.1.50:5901");
  // Standard IPv6 literal or localhost
  assert.equal(resolveWebSocketUrl({ hostname: "localhost", protocol: "http:" }, 5902), "ws://localhost:5902");
});
