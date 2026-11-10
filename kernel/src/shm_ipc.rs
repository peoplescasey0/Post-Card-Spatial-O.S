//! # Beijing Voyager Shared Memory IPC (US 11,080,216 B2)
//!
// Lock-Free Shared Memory Ring Buffer Architecture for Real-Time Autonomous Vehicles.
// Implements a centralized Topic Registry with dual-offset synchronization
// (`tail_offset` and `pending_tail_offset`) and automatic reader overwrite recovery.

#![allow(dead_code)]

pub const MAX_TOPICS: usize = 8;
pub const BUFFER_CAPACITY: usize = 4096;
pub const MAX_MSG_SIZE: usize = 512;

/// A record stored in the centralized Topic Registry (FIG. 4, 410)
#[derive(Copy, Clone)]
pub struct TopicRecord {
    pub topic_id: u32,
    pub name: [u8; 16],
    pub name_len: usize,
    pub tail_offset: u32,
    pub pending_tail_offset: u32,
    pub total_messages_published: u64,
    pub expected_rate_hz: u32,
    pub buffer_capacity: u32,
}

impl TopicRecord {
    pub const fn empty() -> Self {
        Self {
            topic_id: 0,
            name: [0u8; 16],
            name_len: 0,
            tail_offset: 0,
            pending_tail_offset: 0,
            total_messages_published: 0,
            expected_rate_hz: 50,
            buffer_capacity: BUFFER_CAPACITY as u32,
        }
    }

    pub fn new(topic_id: u32, name_str: &str, expected_rate_hz: u32) -> Self {
        let mut name = [0u8; 16];
        let bytes = name_str.as_bytes();
        let len = if bytes.len() > 16 { 16 } else { bytes.len() };
        let mut i = 0;
        while i < len {
            name[i] = bytes[i];
            i += 1;
        }
        Self {
            topic_id,
            name,
            name_len: len,
            tail_offset: 0,
            pending_tail_offset: 0,
            total_messages_published: 0,
            expected_rate_hz,
            buffer_capacity: BUFFER_CAPACITY as u32,
        }
    }
}

/// A per-topic shared memory ring buffer storage component (FIG. 4, 420/425/430)
pub struct TopicMessageBuffer {
    pub storage: [u8; BUFFER_CAPACITY],
}

impl TopicMessageBuffer {
    pub const fn new() -> Self {
        Self {
            storage: [0u8; BUFFER_CAPACITY],
        }
    }
}

/// Status returned on subscriber read operations
#[derive(Debug, PartialEq, Eq)]
pub enum ShmReadStatus {
    Ok { bytes_read: usize },
    NoNewMessage,
    OverwrittenAndReset { new_head: u32 },
    InvalidTopic,
}

/// The Voyager Shared Memory IPC subsystem manager
pub struct VoyagerShmIpc {
    pub registry: [TopicRecord; MAX_TOPICS],
    pub buffers: [TopicMessageBuffer; MAX_TOPICS],
    pub topic_count: usize,
    pub overwrite_events_caught: u64,
}

impl VoyagerShmIpc {
    pub const fn new() -> Self {
        Self {
            registry: [TopicRecord::empty(); MAX_TOPICS],
            buffers: [
                TopicMessageBuffer::new(),
                TopicMessageBuffer::new(),
                TopicMessageBuffer::new(),
                TopicMessageBuffer::new(),
                TopicMessageBuffer::new(),
                TopicMessageBuffer::new(),
                TopicMessageBuffer::new(),
                TopicMessageBuffer::new(),
            ],
            topic_count: 0,
            overwrite_events_caught: 0,
        }
    }

    /// Registers a new vehicle sensor/controller communication topic
    pub fn register_topic(&mut self, name_str: &str, expected_rate_hz: u32) -> Option<u32> {
        if self.topic_count >= MAX_TOPICS {
            return None;
        }
        let id = self.topic_count as u32;
        self.registry[self.topic_count] = TopicRecord::new(id, name_str, expected_rate_hz);
        self.topic_count += 1;
        Some(id)
    }

    /// Publishes a message directly into shared memory without kernel syscalls (FIG. 7)
    pub fn publish_message(&mut self, topic_id: u32, payload: &[u8]) -> Result<u32, &'static str> {
        if (topic_id as usize) >= self.topic_count {
            return Err("Topic not found");
        }
        if payload.len() == 0 || payload.len() > MAX_MSG_SIZE {
            return Err("Payload size exceeds maximum allowed buffer entry");
        }

        let record = &mut self.registry[topic_id as usize];
        let msg_len = payload.len() as u32;
        let total_entry_size = msg_len + 4; // 4-byte header: payload length

        // 1. Advance pending_tail_offset to reserve space before writing
        let next_pending = record.tail_offset + total_entry_size;
        if next_pending > record.pending_tail_offset {
            record.pending_tail_offset = next_pending;
        }

        // 2. Write 4-byte header and payload into the ring buffer
        let buffer = &mut self.buffers[topic_id as usize];
        let start_offset = (record.tail_offset as usize) % BUFFER_CAPACITY;

        // Write 4-byte size header
        let size_bytes = msg_len.to_le_bytes();
        for i in 0..4 {
            let pos = (start_offset + i) % BUFFER_CAPACITY;
            buffer.storage[pos] = size_bytes[i];
        }

        // Write payload
        for i in 0..payload.len() {
            let pos = (start_offset + 4 + i) % BUFFER_CAPACITY;
            buffer.storage[pos] = payload[i];
        }

        // 3. Commit message by updating tail_offset
        record.tail_offset = record.tail_offset.wrapping_add(total_entry_size);
        record.total_messages_published = record.total_messages_published.saturating_add(1);

        Ok(record.tail_offset)
    }

    /// Reads a message as a subscriber using local head_offset (FIG. 8)
    pub fn subscribe_read(&mut self, topic_id: u32, head_offset: &mut u32, out_buf: &mut [u8]) -> ShmReadStatus {
        if (topic_id as usize) >= self.topic_count {
            return ShmReadStatus::InvalidTopic;
        }

        let record = &self.registry[topic_id as usize];

        // 1. Check if new message is available
        if *head_offset == record.tail_offset {
            return ShmReadStatus::NoNewMessage;
        }

        // 2. Overwrite check: If pending_tail_offset has wrapped beyond head_offset + BUFFER_CAPACITY,
        // the slow subscriber's unread data was overwritten by the publisher.
        let capacity = BUFFER_CAPACITY as u32;
        if record.pending_tail_offset > *head_offset + capacity {
            // Overwritten! Safely jump forward to known valid tail
            self.overwrite_events_caught = self.overwrite_events_caught.saturating_add(1);
            *head_offset = record.tail_offset;
            return ShmReadStatus::OverwrittenAndReset { new_head: *head_offset };
        }

        // 3. Read message header length
        let buffer = &self.buffers[topic_id as usize];
        let start_pos = (*head_offset as usize) % BUFFER_CAPACITY;
        let mut size_bytes = [0u8; 4];
        for i in 0..4 {
            size_bytes[i] = buffer.storage[(start_pos + i) % BUFFER_CAPACITY];
        }
        let msg_len = u32::from_le_bytes(size_bytes) as usize;

        if msg_len > MAX_MSG_SIZE || msg_len > out_buf.len() {
            // Corrupt or truncated; sync head
            *head_offset = record.tail_offset;
            return ShmReadStatus::OverwrittenAndReset { new_head: *head_offset };
        }

        // 4. Read payload bytes
        for i in 0..msg_len {
            out_buf[i] = buffer.storage[(start_pos + 4 + i) % BUFFER_CAPACITY];
        }

        // Advance subscriber head pointer
        *head_offset = head_offset.wrapping_add((msg_len + 4) as u32);

        ShmReadStatus::Ok { bytes_read: msg_len }
    }
}

pub static mut VOYAGER_SHM_IPC: VoyagerShmIpc = VoyagerShmIpc::new();
pub static mut DEMO_SUBSCRIBER_HEADS: [u32; MAX_TOPICS] = [0; MAX_TOPICS];

/// Initializes Voyager Shared Memory Topics for Post Card Spatial OS
pub unsafe fn init_voyager_shm_subsystem() {
    let _ = VOYAGER_SHM_IPC.register_topic("lidar_cloud", 50);
    let _ = VOYAGER_SHM_IPC.register_topic("hud_telemetry", 60);
    let _ = VOYAGER_SHM_IPC.register_topic("flight_capsule", 20);

    // Initial test seed
    let test_msg = b"VOYAGER_INITIAL_LIDAR_PACKET_LBA0";
    let _ = VOYAGER_SHM_IPC.publish_message(0, test_msg);
}
