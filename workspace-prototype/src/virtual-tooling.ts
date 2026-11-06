/**
 * SwiftShader, Vulkan EGL & Remote Tooling Controller
 * Derived from Desktop/Going over/code and vk_swiftshader_icd.json
 */

export type SwiftShaderProfile = {
  enabled: boolean;
  apiVersion: string;
  driverPath: string;
  eglPath: string;
  mode: "software" | "hybrid" | "hardware";
  description: string;
};

export const DEFAULT_SWIFTSHADER_PROFILE: SwiftShaderProfile = {
  enabled: false,
  apiVersion: "1.0.5",
  driverPath: "./libvk_swiftshader.so",
  eglPath: "./libEGL.so",
  mode: "hardware",
  description: "Native GPU acceleration (DirectLink / host OpenGL / WebGL2 context).",
};

export function getSwiftShaderStatus(): SwiftShaderProfile {
  try {
    const raw = localStorage.getItem("postcard_swiftshader_profile");
    if (raw) return JSON.parse(raw);
  } catch {
    // fallback
  }
  return DEFAULT_SWIFTSHADER_PROFILE;
}

export function setSwiftShaderMode(mode: "software" | "hardware" | "hybrid"): SwiftShaderProfile {
  const current = getSwiftShaderStatus();
  current.mode = mode;
  current.enabled = mode !== "hardware";
  current.description =
    mode === "software"
      ? "SwiftShader CPU software rasterizer (Headless / fallback rendering active, no hardware GPU required)."
      : mode === "hybrid"
      ? "Hybrid: Software EGL pipeline with hardware compositing."
      : "Native GPU acceleration (DirectLink / WebGL2).";

  try {
    localStorage.setItem("postcard_swiftshader_profile", JSON.stringify(current));
  } catch {
    // ignore storage errors
  }
  return current;
}

/**
 * Returns instructions or command hooks for VS Code remote CLI sessions on spatial cards.
 */
export function getVsCodeRemoteHook(cardName: string): { command: string; summary: string } {
  const safeName = cardName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    command: `code --remote ssh-remote+postcard-${safeName} /opt/postcard/workspace`,
    summary: `Launch a remote VS Code editor directly attached to ${cardName}'s isolated virtual filesystem.`,
  };
}
