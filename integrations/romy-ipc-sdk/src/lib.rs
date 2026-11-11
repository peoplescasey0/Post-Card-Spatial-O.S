//! User-Space IPC Client SDK for Post Card OS
//! Provides ergonomic abstractions over our zero-copy ring buffers and /dev/custom_comm_device

use std::fs::File;
#[cfg(unix)]
use std::os::unix::io::AsRawFd;
#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
use std::io::{Read, Write};

pub struct IpcClientChannel {
    device_file: File,
    buffer_size: usize,
}

impl IpcClientChannel {
    /// Connects to the ring 0 kernel driver via our VFS communication node
    pub fn connect(device_path: &str) -> Result<Self, std::io::Error> {
        let device_file = File::options()
            .read(true)
            .write(true)
            .open(device_path)?;

        Ok(Self {
            device_file,
            buffer_size: 65536,
        })
    }

    /// Ergonomic method for Romy or spatial daemons to broadcast telemetry instantly
    pub fn send_telemetry(&mut self, payload: &[u8]) -> Result<usize, std::io::Error> {
        // Automatically handles writing across the zero-copy boundary without manual boilerplate
        self.device_file.write(payload)
    }

    /// Polls for incoming ring buffer events from ring 0
    pub fn poll_events(&mut self, buffer: &mut [u8]) -> Result<usize, std::io::Error> {
        self.device_file.read(buffer)
    }

    pub fn buffer_size(&self) -> usize {
        self.buffer_size
    }
}

#[cfg(unix)]
impl AsRawFd for IpcClientChannel {
    fn as_raw_fd(&self) -> std::os::unix::io::RawFd {
        self.device_file.as_raw_fd()
    }
}

#[cfg(windows)]
impl AsRawHandle for IpcClientChannel {
    fn as_raw_handle(&self) -> std::os::windows::io::RawHandle {
        self.device_file.as_raw_handle()
    }
}

// --- How Romy uses it in user space ---
pub struct RomyTelemetryDaemon {
    channel: IpcClientChannel,
}

impl RomyTelemetryDaemon {
    pub fn new(device_path: &str) -> Result<Self, std::io::Error> {
        let channel = IpcClientChannel::connect(device_path)?;
        Ok(Self { channel })
    }

    pub fn broadcast_state(&mut self, status_msg: &str) -> Result<usize, std::io::Error> {
        // Clean, high-level execution hiding all the raw ring buffer complexity
        self.channel.send_telemetry(status_msg.as_bytes())
    }

    pub fn poll_incoming(&mut self, buffer: &mut [u8]) -> Result<usize, std::io::Error> {
        self.channel.poll_events(buffer)
    }

    pub fn channel(&self) -> &IpcClientChannel {
        &self.channel
    }

    pub fn channel_mut(&mut self) -> &mut IpcClientChannel {
        &mut self.channel
    }
}

#[cfg(test)]
mod tests {
    use super::IpcClientChannel;

    #[test]
    fn test_ipc_types_defined() {
        assert_eq!(core::mem::size_of::<IpcClientChannel>(), core::mem::size_of::<usize>() * 2);
    }
}
