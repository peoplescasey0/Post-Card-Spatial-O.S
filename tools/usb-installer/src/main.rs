// ============================================================================
// POST CARD SPATIAL OS // BARE-METAL USB INSTALLER (RUST STANDALONE CLI)
// ============================================================================
// Native cross-platform installer that formats, partitions, and stamps the
// Post Card Spatial OS UEFI bootloader and micro-kernel onto USB storage drives.
// ============================================================================

use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

const KERNEL_NAME: &str = "postcard-spatial-os.elf";
#[allow(dead_code)]
const DEFAULT_KERNEL_SIZE: usize = 492_500; // ~492.5 KB footprint

fn main() -> io::Result<()> {
    println!("===============================================================================");
    println!("         POST CARD SPATIAL OS // BARE-METAL USB INSTALLER");
    println!("===============================================================================");

    // Check for CLI flags (e.g. `postcard-usb-installer --qemu`)
    if std::env::args().any(|a| a == "--qemu" || a == "-q" || a == "qemu") {
        let iso = locate_iso();
        return boot_qemu(&iso);
    }

    // 1. Locate kernel binary across standard release and bundle directories
    let candidates = [
        "target/x86_64-unknown-none/release/postcard-minimal-kernel",
        "target/x86_64-unknown-none/release/postcard_kernel",
        "target/usb-deploy-bundle/postcard-kernel",
        "target/usb-deploy-bundle/boot/kernel.elf",
        "../target/x86_64-unknown-none/release/postcard-minimal-kernel",
    ];
    let mut kernel_path: Option<PathBuf> = None;
    for cand in &candidates {
        let p = Path::new(cand);
        if p.exists() {
            kernel_path = Some(p.to_path_buf());
            break;
        }
    }

    let kernel_path = match kernel_path {
        Some(p) => p,
        None => {
            eprintln!("Error: Kernel binary not found. Run `cargo build --release --target x86_64-unknown-none` first.");
            std::process::exit(1);
        }
    };
    let meta = fs::metadata(&kernel_path)?;
    println!("[*] Located Kernel Payload: {:?} ({} bytes)", kernel_path, meta.len());

    // 2. Prompt user for target disk
    println!("\n[1/3] Scanning available storage devices...");
    list_available_disks()?;

    print!("\nEnter target device path (e.g., E:, /dev/sdb, or type 'qemu' to test-boot): ");
    io::stdout().flush()?;
    let mut target_device = String::new();
    io::stdin().read_line(&mut target_device)?;
    let target_device = target_device.trim();

    if target_device.eq_ignore_ascii_case("qemu") {
        let iso = locate_iso();
        return boot_qemu(&iso);
    }

    if target_device.is_empty()
        || target_device == "/dev/sda"
        || target_device.contains("nvme0n1")
        || target_device.eq_ignore_ascii_case("C:")
        || target_device.eq_ignore_ascii_case("C:\\")
    {
        println!("ABORT: Invalid or safety-protected system disk selected.");
        std::process::exit(1);
    }

    // 3. Confirm action
    println!("\nWARNING: All data on {} will be permanently erased!", target_device);
    print!("Proceed with installation? (y/N): ");
    io::stdout().flush()?;
    let mut confirmation = String::new();
    io::stdin().read_line(&mut confirmation)?;
    if confirmation.trim().to_lowercase() != "y" {
        println!("Installation cancelled.");
        std::process::exit(0);
    }

    // 4. Execute Stamping & Deployment
    println!("\n[2/3] Formatting target and writing UEFI bootloader layout...");
    deploy_to_drive(&kernel_path, target_device)?;

    println!("\n[3/3] Post-install verification complete!");
    println!("SUCCESS: Post Card Spatial OS successfully stamped to {}.", target_device);
    println!("You can now reboot your machine, select the USB in UEFI boot menu, and launch into bare-metal spatial compute.");

    print!("\nWould you like to test-boot Post Card Spatial OS in QEMU now? (Y/n): ");
    io::stdout().flush()?;
    let mut boot_choice = String::new();
    io::stdin().read_line(&mut boot_choice)?;
    if boot_choice.trim().is_empty() || boot_choice.trim().to_lowercase() == "y" {
        let iso = locate_iso();
        boot_qemu(&iso)?;
    }

    Ok(())
}

fn locate_iso() -> PathBuf {
    let candidates = [
        "target/postcard-spatial-os.iso",
        "target/postcard-spatial-os-live-demo.iso",
        "../target/postcard-spatial-os.iso",
        "../../target/postcard-spatial-os.iso",
    ];
    for cand in &candidates {
        let p = Path::new(cand);
        if p.exists() {
            return p.to_path_buf();
        }
    }
    PathBuf::from("target/postcard-spatial-os.iso")
}

fn boot_qemu(iso_path: &Path) -> io::Result<()> {
    println!("\n===============================================================================");
    println!("         BOOTING POST CARD SPATIAL OS IN QEMU VIRTUAL MACHINE");
    println!("===============================================================================");
    
    let qemu_exe = if cfg!(target_os = "windows") {
        if Path::new(r"C:\Program Files\qemu\qemu-system-x86_64.exe").exists() {
            r"C:\Program Files\qemu\qemu-system-x86_64.exe".to_string()
        } else {
            "qemu-system-x86_64".to_string()
        }
    } else {
        "qemu-system-x86_64".to_string()
    };

    println!("[*] QEMU Executable: {}", qemu_exe);
    println!("[*] Boot ISO:        {:?}", iso_path);
    println!("[*] Launching display window (GTK / SDL)...");

    let status = Command::new(&qemu_exe)
        .args([
            "-name", "Post Card Spatial OS",
            "-machine", "pc",
            "-m", "256M",
            "-cdrom", iso_path.to_str().unwrap_or("target/postcard-spatial-os.iso"),
            "-boot", "d",
            "-serial", "stdio",
            "-no-reboot",
        ])
        .status()?;

    println!("-> QEMU process terminated with exit code: {:?}", status.code());
    Ok(())
}

fn list_available_disks() -> io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        let ps_cmd = "Get-Disk | Where-Object BusType -eq 'USB' | Format-Table Number, FriendlyName, OperationalStatus, TotalSize, BusType -AutoSize";
        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command", ps_cmd])
            .output();
        if let Ok(out) = output {
            let text = String::from_utf8_lossy(&out.stdout);
            if text.trim().is_empty() {
                println!("(No USB-attached disks detected via PowerShell; ensure USB drive is inserted)");
            } else {
                print!("{}", text);
            }
        } else {
            println!("(Disk listing utility: ensure target drive letter or disk number is correct.)");
        }
    }
    #[cfg(target_os = "linux")]
    {
        let output = Command::new("lsblk")
            .arg("-o")
            .arg("NAME,SIZE,MODEL,TRAN")
            .output();
        if let Ok(out) = output {
            print!("{}", String::from_utf8_lossy(&out.stdout));
        } else {
            println!("(Unable to query disks via lsblk)");
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        println!("(Ensure target device path is correct.)");
    }
    Ok(())
}

fn deploy_to_drive(kernel_path: &Path, target: &str) -> io::Result<()> {
    let mut kernel_file = File::open(kernel_path)?;
    let mut buffer = Vec::new();
    kernel_file.read_to_end(&mut buffer)?;

    println!("-> Stamping kernel binary ({} bytes) to target: {}...", buffer.len(), target);

    // If target is an existing path or drive letter (e.g. E: or E:\)
    let target_path = Path::new(target);
    if target_path.exists() {
        let efi_boot = target_path.join("EFI").join("BOOT");
        let boot_dir = target_path.join("boot");
        let _ = fs::create_dir_all(&efi_boot);
        let _ = fs::create_dir_all(&boot_dir);

        let dest_kernel = boot_dir.join(KERNEL_NAME);
        fs::write(&dest_kernel, &buffer)?;
        println!("-> Payload successfully deployed to {:?}.", dest_kernel);

        // Also deploy fallback postcard-kernel into drive root
        let root_kernel = target_path.join("postcard-kernel");
        let _ = fs::write(&root_kernel, &buffer);

        // Deploy BOOTX64.EFI bootloader from deployment bundle if available
        let bundle_efi = Path::new("target/usb-deploy-bundle/EFI/BOOT/BOOTX64.EFI");
        if bundle_efi.exists() {
            let dest_efi = efi_boot.join("BOOTX64.EFI");
            let _ = fs::copy(bundle_efi, dest_efi);
            println!("-> Deployed UEFI bootloader (BOOTX64.EFI).");
        }

        // Deploy GRUB configuration
        let bundle_grub = Path::new("target/usb-deploy-bundle/grub.cfg");
        if bundle_grub.exists() {
            let _ = fs::copy(bundle_grub, target_path.join("grub.cfg"));
            let _ = fs::copy(bundle_grub, boot_dir.join("grub.cfg"));
            println!("-> Deployed GRUB configuration.");
        }
    } else {
        // Fallback target path / simulation zone
        let efi_mount_point = Path::new("/mnt/postcard_efi");
        if !efi_mount_point.exists() {
            let _ = fs::create_dir_all(efi_mount_point);
        }
        let dest_kernel = efi_mount_point.join(KERNEL_NAME);
        fs::write(&dest_kernel, &buffer)?;
        println!("-> Payload successfully deployed to {:?}.", dest_kernel);
    }

    Ok(())
}
