use serde::{Deserialize, Serialize};

/// Represents the execution and lifecycle state of a spatial node in 3D memory.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NodeState {
    /// Inactive or standby node waiting in the turntable arc.
    Standby,
    /// Live virtual guest or active QEMU compute process running.
    Active,
    /// Folded into an ephemeral paper plane in flight.
    InFlight,
    /// Binned into the 3D paper recycling target.
    Binned,
    /// Locked by an enterprise golden image or cryptographic audit chain.
    Protected,
}

/// A 3D spatial node within Post Card Spatial OS.
/// Bridges Freeplane mind-map hierarchies, OPML outline trees, and WebGL Three.js card coordinates.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpatialNode {
    pub id: u64,
    pub title: String,
    pub details: Option<String>,
    pub position: [f32; 3], // X, Y, Z coordinates in the 3D spatial environment
    pub children: Vec<u64>, // IDs of connected sub-nodes or child cards
    pub state: NodeState,
}

impl SpatialNode {
    /// Creates a new spatial node positioned in the 3D studio.
    pub fn new(id: u64, title: impl Into<String>, position: [f32; 3]) -> Self {
        Self {
            id,
            title: title.into(),
            details: None,
            position,
            children: Vec::new(),
            state: NodeState::Standby,
        }
    }

    /// Attaches child nodes by ID.
    pub fn with_child(mut self, child_id: u64) -> Self {
        self.children.push(child_id);
        self
    }

    /// Sets optional rich text or calculation details.
    pub fn with_details(mut self, details: impl Into<String>) -> Self {
        self.details = Some(details.into());
        self
    }

    /// Converts this node into a Freeplane-compatible XML node fragment.
    pub fn to_freeplane_xml(&self) -> String {
        let details_xml = match &self.details {
            Some(d) => format!("<detail><richcontent TYPE=\"DETAILS\"><html><body><p>{}</p></body></html></richcontent></detail>", d),
            None => String::new(),
        };

        format!(
            "<node ID=\"ID_{}\" TEXT=\"{}\" POSITION=\"{}\">\n  <attribute NAME=\"spatial_x\" VALUE=\"{:.2}\"/>\n  <attribute NAME=\"spatial_y\" VALUE=\"{:.2}\"/>\n  <attribute NAME=\"spatial_z\" VALUE=\"{:.2}\"/>\n  {}\n</node>",
            self.id,
            self.title,
            if self.position[0] >= 0.0 { "right" } else { "left" },
            self.position[0],
            self.position[1],
            self.position[2],
            details_xml
        )
    }
}
