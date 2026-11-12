/**
 * TypeScript representation of the Rust SpatialNode struct
 * Synchronized with src-rust/spatial_node.rs
 */

export type NodeState = "Standby" | "Active" | "InFlight" | "Binned" | "Protected";

export interface SpatialNode {
  id: number;
  title: string;
  details?: string;
  position: [number, number, number]; // [X, Y, Z] in 3D studio coordinates
  children: number[];                 // IDs of connected sub-nodes
  state: NodeState;
}

/**
 * Transforms spatial cards or Freeplane branches into 3D SpatialNode coordinate graphs.
 */
export function createSpatialNode(
  id: number,
  title: string,
  position: [number, number, number],
  state: NodeState = "Standby"
): SpatialNode {
  return {
    id,
    title,
    position,
    children: [],
    state,
  };
}

