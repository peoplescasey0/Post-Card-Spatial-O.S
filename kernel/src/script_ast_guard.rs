//! # Tala Security AST & GAST Script Structure Guard (US 11,314,862 B2)
//!
// Method for Detecting Malicious Scripts Through Modeling of Script Structure.
// Compares unclassified scripts against Generalized Abstract Syntax Trees (GAST)
// using Tree Edit Distance (TED) to identify benign vs malicious/tampered code.

#![allow(dead_code)]

pub const MAX_AST_NODES: usize = 16;
pub const MAX_GAST_CLUSTERS: usize = 4;

/// Semantic type of an AST syntactic node (FIG. 4)
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum AstNodeType {
    Root,
    FunctionStart,
    UserCredentialField,
    DataTransferNetwork,
    MathComputeLoop,
    DomElementQuery,
    ObfuscatedEval,
    ExfiltrationEndpoint,
}

/// A node within an Abstract Syntax Tree (AST)
#[derive(Copy, Clone, Debug)]
pub struct AstNode {
    pub node_id: u8,
    pub parent_id: u8,
    pub node_type: AstNodeType,
}

impl AstNode {
    pub const fn new(node_id: u8, parent_id: u8, node_type: AstNodeType) -> Self {
        Self {
            node_id,
            parent_id,
            node_type,
        }
    }
}

/// A complete Abstract Syntax Tree representation
#[derive(Copy, Clone)]
pub struct ScriptAst {
    pub nodes: [AstNode; MAX_AST_NODES],
    pub node_count: usize,
}

impl ScriptAst {
    pub const fn empty() -> Self {
        Self {
            nodes: [AstNode::new(0, 0, AstNodeType::Root); MAX_AST_NODES],
            node_count: 0,
        }
    }

    pub fn push_node(&mut self, parent_id: u8, node_type: AstNodeType) -> Result<u8, &'static str> {
        if self.node_count >= MAX_AST_NODES {
            return Err("AST node capacity exceeded");
        }
        let id = self.node_count as u8;
        self.nodes[self.node_count] = AstNode::new(id, parent_id, node_type);
        self.node_count += 1;
        Ok(id)
    }
}

/// Generalized Abstract Syntax Tree (GAST) Cluster (FIG. 3 & FIG. 4)
#[derive(Copy, Clone)]
pub struct GastCluster {
    pub cluster_id: u8,
    pub name: [u8; 16],
    pub name_len: usize,
    pub template: ScriptAst,
    pub max_allowed_ted: u32,
}

impl GastCluster {
    pub const fn empty() -> Self {
        Self {
            cluster_id: 0,
            name: [0u8; 16],
            name_len: 0,
            template: ScriptAst::empty(),
            max_allowed_ted: 3,
        }
    }

    pub fn new(cluster_id: u8, name_str: &str, template: ScriptAst, max_allowed_ted: u32) -> Self {
        let mut name = [0u8; 16];
        let bytes = name_str.as_bytes();
        let len = if bytes.len() > 16 { 16 } else { bytes.len() };
        let mut i = 0;
        while i < len {
            name[i] = bytes[i];
            i += 1;
        }
        Self {
            cluster_id,
            name,
            name_len: len,
            template,
            max_allowed_ted,
        }
    }
}

/// Result of classification against GAST baseline (FIG. 5)
#[derive(Debug, PartialEq, Eq)]
pub enum ScriptSecurityVerdict {
    Benign { matched_cluster_id: u8, tree_edit_distance: u32 },
    MaliciousBlocked { min_tree_edit_distance: u32, reason: &'static str },
}

/// The Tala Security Script AST Guard Subsystem
pub struct TalaScriptAstGuard {
    pub clusters: [GastCluster; MAX_GAST_CLUSTERS],
    pub cluster_count: usize,
    pub total_scripts_inspected: u64,
    pub malicious_scripts_blocked: u64,
}

impl TalaScriptAstGuard {
    pub const fn new() -> Self {
        Self {
            clusters: [
                GastCluster::empty(),
                GastCluster::empty(),
                GastCluster::empty(),
                GastCluster::empty(),
            ],
            cluster_count: 0,
            total_scripts_inspected: 0,
            malicious_scripts_blocked: 0,
        }
    }

    /// Registers a benign Generalized AST cluster
    pub fn register_cluster(&mut self, name_str: &str, template: ScriptAst, max_ted: u32) -> Option<u8> {
        if self.cluster_count >= MAX_GAST_CLUSTERS {
            return None;
        }
        let id = self.cluster_count as u8;
        self.clusters[self.cluster_count] = GastCluster::new(id, name_str, template, max_ted);
        self.cluster_count += 1;
        Some(id)
    }

    /// Computes Tree Edit Distance (TED) between a candidate AST and a GAST template (Zhang-Shasha metric simplified)
    pub fn compute_tree_edit_distance(&self, candidate: &ScriptAst, baseline: &ScriptAst) -> u32 {
        let mut distance: u32 = 0;

        // Size difference penalty (Insertions / Deletions)
        let count_diff = if candidate.node_count > baseline.node_count {
            (candidate.node_count - baseline.node_count) as u32
        } else {
            (baseline.node_count - candidate.node_count) as u32
        };
        distance += count_diff;

        // Compare overlapping nodes
        let min_nodes = if candidate.node_count < baseline.node_count {
            candidate.node_count
        } else {
            baseline.node_count
        };

        for i in 0..min_nodes {
            let c_node = &candidate.nodes[i];
            let b_node = &baseline.nodes[i];

            if c_node.node_type != b_node.node_type {
                // High penalty for suspicious syntactic changes (e.g. Eval or Exfiltration)
                if c_node.node_type == AstNodeType::ObfuscatedEval || c_node.node_type == AstNodeType::ExfiltrationEndpoint {
                    distance += 5;
                } else {
                    distance += 2;
                }
            }

            if c_node.parent_id != b_node.parent_id {
                distance += 1;
            }
        }

        distance
    }

    /// Inspects and classifies an unclassified script or bytecode AST (FIG. 5)
    pub fn inspect_and_classify(&mut self, candidate: &ScriptAst) -> ScriptSecurityVerdict {
        self.total_scripts_inspected = self.total_scripts_inspected.saturating_add(1);

        let mut _best_cluster = 0u8;
        let mut min_distance = u32::MAX;

        for i in 0..self.cluster_count {
            let cluster = &self.clusters[i];
            let dist = self.compute_tree_edit_distance(candidate, &cluster.template);
            if dist < min_distance {
                min_distance = dist;
                _best_cluster = cluster.cluster_id;
            }
            if dist <= cluster.max_allowed_ted {
                return ScriptSecurityVerdict::Benign {
                    matched_cluster_id: cluster.cluster_id,
                    tree_edit_distance: dist,
                };
            }
        }

        self.malicious_scripts_blocked = self.malicious_scripts_blocked.saturating_add(1);
        ScriptSecurityVerdict::MaliciousBlocked {
            min_tree_edit_distance: min_distance,
            reason: "Tree Edit Distance exceeds benign GAST policy threshold",
        }
    }
}

pub static mut TALA_AST_GUARD: TalaScriptAstGuard = TalaScriptAstGuard::new();

/// Initializes default baseline GAST clusters for Post Card OS
pub unsafe fn init_tala_ast_subsystem() {
    // 1. Benign Telemetry Script Template
    let mut tel_ast = ScriptAst::empty();
    let _ = tel_ast.push_node(0, AstNodeType::Root);
    let f1 = tel_ast.push_node(0, AstNodeType::FunctionStart).unwrap_or(0);
    let _ = tel_ast.push_node(f1, AstNodeType::MathComputeLoop);
    let _ = tel_ast.push_node(f1, AstNodeType::DataTransferNetwork);
    let _ = TALA_AST_GUARD.register_cluster("telemetry_loop", tel_ast, 2);

    // 2. Benign Login Form Script Template
    let mut login_ast = ScriptAst::empty();
    let _ = login_ast.push_node(0, AstNodeType::Root);
    let f2 = login_ast.push_node(0, AstNodeType::FunctionStart).unwrap_or(0);
    let _ = login_ast.push_node(f2, AstNodeType::DomElementQuery);
    let _ = login_ast.push_node(f2, AstNodeType::UserCredentialField);
    let _ = TALA_AST_GUARD.register_cluster("login_form", login_ast, 3);
}
