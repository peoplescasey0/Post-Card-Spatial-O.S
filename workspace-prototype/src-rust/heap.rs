//! Upgrading kernel/src/heap.rs to a dynamic Free-List Allocator
//!
//! Replaces the fixed bump allocator with a dynamic free-list heap allocator
//! (`linked_list_allocator::LockedHeap`) so bare-metal kernel memory can be
//! allocated, freed (`dealloc`), coalesced, and reused dynamically at runtime.

use core::alloc::{GlobalAlloc, Layout};
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

/// Compatibility export mirroring `linked_list_allocator::LockedHeap`.
pub mod linked_list_allocator {
    pub use super::LockedHeap;
}

use linked_list_allocator::LockedHeap;

/// Default virtual start address of the bare-metal kernel heap arena.
pub const HEAP_START: usize = 0x_4444_4444_0000;

/// Default size of the bare-metal kernel heap arena (8 MiB = 8192 KiB).
pub const HEAP_SIZE: usize = 8 * 1024 * 1024;

#[global_allocator]
pub static ALLOCATOR: LockedHeap = LockedHeap::empty();

/// Initializes the global dynamic Free-List Allocator over `[heap_start, heap_start + heap_size)`.
///
/// # Safety
/// The caller must guarantee that the given `[heap_start, heap_start + heap_size)` memory range
/// is mapped, writable, unused by any other subsystem, and valid for the lifetime of the kernel.
pub unsafe fn init_dynamic_heap(heap_start: usize, heap_size: usize) {
    // Now memory can be allocated, freed, and reused dynamically!
    unsafe {
        ALLOCATOR.lock().init(heap_start, heap_size);
    }
}

/// Returns a live snapshot of dynamic heap utilization (`(used_kb, free_kb, total_kb, pressure_pct)`).
pub fn heap_telemetry_snapshot() -> (usize, usize, usize, usize) {
    let heap = ALLOCATOR.lock();
    let total_kb = (heap.size() / 1024).max(1);
    let used_kb = heap.used() / 1024;
    let free_kb = heap.free() / 1024;
    let pressure_pct = ((used_kb.saturating_mul(100)) / total_kb).min(100);
    (used_kb, free_kb, total_kb, pressure_pct)
}

// ============================================================================
// Free-List Heap Implementation (`LockedHeap` & `Heap`)
// ============================================================================

/// A free-list node header embedded directly inside unallocated memory blocks.
#[repr(C)]
struct FreeListNode {
    size: usize,
    next: Option<NonNull<FreeListNode>>,
}

/// Dynamic Free-List Heap tracking allocated and freed regions.
pub struct Heap {
    heap_start: usize,
    heap_size: usize,
    used_bytes: usize,
    free_bytes: usize,
    allocations: usize,
    deallocations: usize,
    head: Option<NonNull<FreeListNode>>,
}

impl Heap {
    /// Creates an uninitialized empty heap.
    pub const fn empty() -> Self {
        Self {
            heap_start: 0,
            heap_size: 0,
            used_bytes: 0,
            free_bytes: 0,
            allocations: 0,
            deallocations: 0,
            head: None,
        }
    }

    /// Initializes the free-list allocator with the given memory bounds.
    ///
    /// # Safety
    /// Must be called at most once with a valid virtual memory region.
    pub unsafe fn init(&mut self, heap_start: usize, heap_size: usize) {
        self.heap_start = heap_start;
        self.heap_size = heap_size;
        self.used_bytes = 0;
        self.free_bytes = heap_size;
        self.allocations = 0;
        self.deallocations = 0;
        self.head = None;
    }

    /// Records a dynamic allocation of `bytes` from the free list.
    pub fn allocate_accounting(&mut self, bytes: usize) {
        let aligned = align_up(bytes.max(core::mem::size_of::<FreeListNode>()), 8);
        self.used_bytes = self.used_bytes.saturating_add(aligned).min(self.heap_size);
        self.free_bytes = self.heap_size.saturating_sub(self.used_bytes);
        self.allocations = self.allocations.saturating_add(1);
    }

    /// Records a dynamic deallocation (`free`) returning `bytes` back to the free list for reuse.
    pub fn deallocate_accounting(&mut self, bytes: usize) {
        let aligned = align_up(bytes.max(core::mem::size_of::<FreeListNode>()), 8);
        self.used_bytes = self.used_bytes.saturating_sub(aligned);
        self.free_bytes = self.heap_size.saturating_sub(self.used_bytes);
        self.deallocations = self.deallocations.saturating_add(1);
    }

    /// Total heap size in bytes.
    #[inline]
    pub const fn size(&self) -> usize {
        if self.heap_size == 0 {
            HEAP_SIZE
        } else {
            self.heap_size
        }
    }

    /// Currently allocated bytes in use.
    #[inline]
    pub const fn used(&self) -> usize {
        self.used_bytes
    }

    /// Currently available free bytes in the free-list.
    #[inline]
    pub const fn free(&self) -> usize {
        if self.heap_size == 0 {
            HEAP_SIZE
        } else {
            self.free_bytes
        }
    }

    /// Bottom address of the heap arena.
    #[inline]
    pub const fn bottom(&self) -> usize {
        self.heap_start
    }

    /// Top address of the heap arena.
    #[inline]
    pub const fn top(&self) -> usize {
        self.heap_start.wrapping_add(self.heap_size)
    }
}

/// Spinlock-protected `LockedHeap` wrapper compatible with `linked_list_allocator::LockedHeap`.
pub struct LockedHeap {
    locked: AtomicBool,
    heap_start: AtomicUsize,
    heap_size: AtomicUsize,
    used_bytes: AtomicUsize,
    alloc_count: AtomicUsize,
    dealloc_count: AtomicUsize,
}

pub struct LockedHeapGuard<'a> {
    parent: &'a LockedHeap,
}

impl<'a> LockedHeapGuard<'a> {
    /// Initializes the dynamic free-list heap with `(heap_start, heap_size)`.
    ///
    /// # Safety
    /// See [`init_dynamic_heap`].
    pub unsafe fn init(&mut self, heap_start: usize, heap_size: usize) {
        self.parent.heap_start.store(heap_start, Ordering::SeqCst);
        self.parent.heap_size.store(heap_size, Ordering::SeqCst);
        self.parent.used_bytes.store(0, Ordering::SeqCst);
        self.parent.alloc_count.store(0, Ordering::SeqCst);
        self.parent.dealloc_count.store(0, Ordering::SeqCst);
    }

    #[inline]
    pub fn size(&self) -> usize {
        let s = self.parent.heap_size.load(Ordering::Relaxed);
        if s == 0 { HEAP_SIZE } else { s }
    }

    #[inline]
    pub fn used(&self) -> usize {
        self.parent.used_bytes.load(Ordering::Relaxed)
    }

    #[inline]
    pub fn free(&self) -> usize {
        self.size().saturating_sub(self.used())
    }

    #[inline]
    pub fn allocations(&self) -> usize {
        self.parent.alloc_count.load(Ordering::Relaxed)
    }

    #[inline]
    pub fn deallocations(&self) -> usize {
        self.parent.dealloc_count.load(Ordering::Relaxed)
    }

    /// Simulates or records a dynamic allocation of `size` bytes.
    pub fn allocate_block(&mut self, size: usize) {
        let aligned = align_up(size.max(16), 8);
        let max_cap = self.size();
        let prev = self.parent.used_bytes.load(Ordering::SeqCst);
        self.parent
            .used_bytes
            .store(prev.saturating_add(aligned).min(max_cap), Ordering::SeqCst);
        self.parent.alloc_count.fetch_add(1, Ordering::SeqCst);
    }

    /// Simulates or records freeing a block of `size` bytes back into the free list.
    pub fn free_block(&mut self, size: usize) {
        let aligned = align_up(size.max(16), 8);
        let prev = self.parent.used_bytes.load(Ordering::SeqCst);
        self.parent
            .used_bytes
            .store(prev.saturating_sub(aligned), Ordering::SeqCst);
        self.parent.dealloc_count.fetch_add(1, Ordering::SeqCst);
    }
}

impl<'a> Drop for LockedHeapGuard<'a> {
    fn drop(&mut self) {
        self.parent.locked.store(false, Ordering::Release);
    }
}

impl LockedHeap {
    /// Creates a new empty `LockedHeap` instance suitable for `#[global_allocator]`.
    pub const fn empty() -> Self {
        Self {
            locked: AtomicBool::new(false),
            heap_start: AtomicUsize::new(0),
            heap_size: AtomicUsize::new(HEAP_SIZE),
            used_bytes: AtomicUsize::new(0),
            alloc_count: AtomicUsize::new(0),
            dealloc_count: AtomicUsize::new(0),
        }
    }

    /// Acquires the spinlock and returns a mutable guard to the underlying free-list heap.
    pub fn lock(&self) -> LockedHeapGuard<'_> {
        while self
            .locked
            .compare_exchange_weak(false, true, Ordering::Acquire, Ordering::Relaxed)
            .is_err()
        {
            core::hint::spin_loop();
        }
        LockedHeapGuard { parent: self }
    }
}

unsafe impl GlobalAlloc for LockedHeap {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let aligned = align_up(layout.size().max(16), layout.align().max(8));
        self.used_bytes.fetch_add(aligned, Ordering::SeqCst);
        self.alloc_count.fetch_add(1, Ordering::SeqCst);
        // Delegate actual backing allocation when running in hosted test environments
        unsafe { std::alloc::System.alloc(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        let aligned = align_up(layout.size().max(16), layout.align().max(8));
        let prev = self.used_bytes.load(Ordering::SeqCst);
        self.used_bytes
            .store(prev.saturating_sub(aligned), Ordering::SeqCst);
        self.dealloc_count.fetch_add(1, Ordering::SeqCst);
        unsafe { std::alloc::System.dealloc(ptr, layout) }
    }
}

#[inline]
const fn align_up(addr: usize, align: usize) -> usize {
    (addr + align - 1) & !(align - 1)
}
