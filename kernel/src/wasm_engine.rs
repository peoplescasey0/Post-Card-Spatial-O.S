// ============================================================================
// POST CARD OS: EMBEDDED WEBASSEMBLY (WASM) MICRO-SANDBOX & FUEL METER
// Supporting Double-Enclosed Isolation within Dual-View EPT / Micro-VM Capsules
// Based on W3C WebAssembly Core 1.0 & US 2026/0100856 A1 Verification Model
// ============================================================================

#![allow(dead_code)]

pub const WASM_MAGIC: [u8; 4] = [0x00, 0x61, 0x73, 0x6D]; // "\0asm"
pub const WASM_VERSION: [u8; 4] = [0x01, 0x00, 0x00, 0x00]; // Version 1
pub const WASM_PAGE_SIZE: usize = 65536; // 64 KiB standard WebAssembly memory page

/// Execution Trap conditions for the sandboxed WebAssembly runtime
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum WasmTrap {
    None = 0,
    InvalidMagic = 1,
    UnsupportedVersion = 2,
    MalformedSection = 3,
    StackOverflow = 4,
    StackUnderflow = 5,
    MemoryOutOfBounds = 6,
    OutOfFuel = 7,
    UnreachableReached = 8,
    IntegerDivideByZero = 9,
}

pub fn trap_str(t: WasmTrap) -> &'static str {
    match t {
        WasmTrap::None => "NONE (Execution Successful)",
        WasmTrap::InvalidMagic => "TRAP: INVALID_MAGIC (Not a \\0asm binary)",
        WasmTrap::UnsupportedVersion => "TRAP: UNSUPPORTED_VERSION",
        WasmTrap::MalformedSection => "TRAP: MALFORMED_SECTION",
        WasmTrap::StackOverflow => "TRAP: STACK_OVERFLOW",
        WasmTrap::StackUnderflow => "TRAP: STACK_UNDERFLOW",
        WasmTrap::MemoryOutOfBounds => "TRAP: MEMORY_OUT_OF_BOUNDS (Linear Heap Fault)",
        WasmTrap::OutOfFuel => "TRAP: OUT_OF_FUEL (Deterministic Gas Exhausted)",
        WasmTrap::UnreachableReached => "TRAP: UNREACHABLE_OPCODE_EXECUTED",
        WasmTrap::IntegerDivideByZero => "TRAP: INTEGER_DIVIDE_BY_ZERO",
    }
}

/// WebAssembly Value Stack Element
#[derive(Clone, Copy, Debug)]
pub struct WasmValue {
    pub raw: i64,
}

impl WasmValue {
    pub const fn from_i32(v: i32) -> Self {
        Self { raw: v as i64 }
    }

    pub const fn from_i64(v: i64) -> Self {
        Self { raw: v }
    }

    pub fn as_i32(&self) -> i32 {
        self.raw as i32
    }

    pub fn as_i64(&self) -> i64 {
        self.raw
    }
}

/// Linear Memory Sandbox with strict 64 KiB boundary checks
#[repr(C)]
pub struct WasmLinearMemory {
    pub pages: u32,
    pub data: [u8; WASM_PAGE_SIZE],
}

impl WasmLinearMemory {
    pub const fn new() -> Self {
        Self {
            pages: 1,
            data: [0; WASM_PAGE_SIZE],
        }
    }

    pub fn read_i32(&self, offset: usize) -> Result<i32, WasmTrap> {
        if offset + 4 > WASM_PAGE_SIZE {
            return Err(WasmTrap::MemoryOutOfBounds);
        }
        let bytes: [u8; 4] = [
            self.data[offset],
            self.data[offset + 1],
            self.data[offset + 2],
            self.data[offset + 3],
        ];
        Ok(i32::from_le_bytes(bytes))
    }

    pub fn write_i32(&mut self, offset: usize, val: i32) -> Result<(), WasmTrap> {
        if offset + 4 > WASM_PAGE_SIZE {
            return Err(WasmTrap::MemoryOutOfBounds);
        }
        let bytes = val.to_le_bytes();
        self.data[offset..offset + 4].copy_from_slice(&bytes);
        Ok(())
    }
}

/// The Embedded WebAssembly Virtual Machine Instance
pub struct WasmEngine {
    pub stack: [WasmValue; 128],
    pub stack_top: usize,
    pub locals: [i32; 16],
    pub memory: WasmLinearMemory,
    pub fuel_remaining: u64,
    pub fuel_consumed: u64,
    pub instructions_executed: u64,
    pub last_trap: WasmTrap,
    pub last_return_value: i32,
}

impl WasmEngine {
    pub const fn new() -> Self {
        Self {
            stack: [WasmValue { raw: 0 }; 128],
            stack_top: 0,
            locals: [0; 16],
            memory: WasmLinearMemory::new(),
            fuel_remaining: 100_000,
            fuel_consumed: 0,
            instructions_executed: 0,
            last_trap: WasmTrap::None,
            last_return_value: 0,
        }
    }

    pub fn reset(&mut self, fuel_budget: u64) {
        self.stack_top = 0;
        self.locals = [0; 16];
        self.fuel_remaining = fuel_budget;
        self.fuel_consumed = 0;
        self.instructions_executed = 0;
        self.last_trap = WasmTrap::None;
        self.last_return_value = 0;
    }

    #[inline(always)]
    fn push(&mut self, val: WasmValue) -> Result<(), WasmTrap> {
        if self.stack_top >= self.stack.len() {
            return Err(WasmTrap::StackOverflow);
        }
        self.stack[self.stack_top] = val;
        self.stack_top += 1;
        Ok(())
    }

    #[inline(always)]
    fn pop(&mut self) -> Result<WasmValue, WasmTrap> {
        if self.stack_top == 0 {
            return Err(WasmTrap::StackUnderflow);
        }
        self.stack_top -= 1;
        Ok(self.stack[self.stack_top])
    }

    #[inline(always)]
    fn burn_fuel(&mut self, cost: u64) -> Result<(), WasmTrap> {
        if self.fuel_remaining < cost {
            return Err(WasmTrap::OutOfFuel);
        }
        self.fuel_remaining -= cost;
        self.fuel_consumed += cost;
        self.instructions_executed += 1;
        Ok(())
    }

    /// Validates standard WebAssembly binary header (\0asm + version 1)
    pub fn validate_header(bytes: &[u8]) -> Result<(), WasmTrap> {
        if bytes.len() < 8 {
            return Err(WasmTrap::InvalidMagic);
        }
        if &bytes[0..4] != WASM_MAGIC {
            return Err(WasmTrap::InvalidMagic);
        }
        if &bytes[4..8] != WASM_VERSION {
            return Err(WasmTrap::UnsupportedVersion);
        }
        Ok(())
    }

    /// Executes raw WebAssembly bytecode instructions with fuel metering and stack safety.
    pub fn execute_bytecode(&mut self, code: &[u8], fuel_budget: u64) -> Result<i32, WasmTrap> {
        self.reset(fuel_budget);
        let mut pc = 0usize;

        while pc < code.len() {
            self.burn_fuel(1)?;
            let op = code[pc];
            pc += 1;

            match op {
                0x00 => { // unreachable
                    self.last_trap = WasmTrap::UnreachableReached;
                    return Err(WasmTrap::UnreachableReached);
                }
                0x01 => { // nop
                    continue;
                }
                0x0B => { // end
                    break;
                }
                0x0F => { // return
                    break;
                }
                0x1A => { // drop
                    let _ = self.pop()?;
                }
                0x1B => { // select
                    let c = self.pop()?.as_i32();
                    let val2 = self.pop()?;
                    let val1 = self.pop()?;
                    if c != 0 {
                        self.push(val1)?;
                    } else {
                        self.push(val2)?;
                    }
                }
                0x20 => { // local.get <idx>
                    if pc >= code.len() {
                        return Err(WasmTrap::MalformedSection);
                    }
                    let idx = code[pc] as usize;
                    pc += 1;
                    if idx >= self.locals.len() {
                        return Err(WasmTrap::MalformedSection);
                    }
                    self.push(WasmValue::from_i32(self.locals[idx]))?;
                }
                0x21 => { // local.set <idx>
                    if pc >= code.len() {
                        return Err(WasmTrap::MalformedSection);
                    }
                    let idx = code[pc] as usize;
                    pc += 1;
                    if idx >= self.locals.len() {
                        return Err(WasmTrap::MalformedSection);
                    }
                    let val = self.pop()?.as_i32();
                    self.locals[idx] = val;
                }
                0x22 => { // local.tee <idx>
                    if pc >= code.len() {
                        return Err(WasmTrap::MalformedSection);
                    }
                    let idx = code[pc] as usize;
                    pc += 1;
                    if idx >= self.locals.len() {
                        return Err(WasmTrap::MalformedSection);
                    }
                    let val = self.pop()?.as_i32();
                    self.locals[idx] = val;
                    self.push(WasmValue::from_i32(val))?;
                }
                0x28 => { // i32.load <align> <offset>
                    if pc + 2 > code.len() {
                        return Err(WasmTrap::MalformedSection);
                    }
                    let _align = code[pc];
                    let offset = code[pc + 1] as usize;
                    pc += 2;
                    let base = self.pop()?.as_i32() as usize;
                    let val = self.memory.read_i32(base.saturating_add(offset))?;
                    self.push(WasmValue::from_i32(val))?;
                }
                0x36 => { // i32.store <align> <offset>
                    if pc + 2 > code.len() {
                        return Err(WasmTrap::MalformedSection);
                    }
                    let _align = code[pc];
                    let offset = code[pc + 1] as usize;
                    pc += 2;
                    let val = self.pop()?.as_i32();
                    let base = self.pop()?.as_i32() as usize;
                    self.memory.write_i32(base.saturating_add(offset), val)?;
                }
                0x41 => { // i32.const <val> (single-byte or simple LEB)
                    if pc >= code.len() {
                        return Err(WasmTrap::MalformedSection);
                    }
                    let val = code[pc] as i8 as i32;
                    pc += 1;
                    self.push(WasmValue::from_i32(val))?;
                }
                0x45 => { // i32.eqz
                    let a = self.pop()?.as_i32();
                    self.push(WasmValue::from_i32(if a == 0 { 1 } else { 0 }))?;
                }
                0x46 => { // i32.eq
                    let b = self.pop()?.as_i32();
                    let a = self.pop()?.as_i32();
                    self.push(WasmValue::from_i32(if a == b { 1 } else { 0 }))?;
                }
                0x47 => { // i32.ne
                    let b = self.pop()?.as_i32();
                    let a = self.pop()?.as_i32();
                    self.push(WasmValue::from_i32(if a != b { 1 } else { 0 }))?;
                }
                0x48 => { // i32.lt_s
                    let b = self.pop()?.as_i32();
                    let a = self.pop()?.as_i32();
                    self.push(WasmValue::from_i32(if a < b { 1 } else { 0 }))?;
                }
                0x4A => { // i32.gt_s
                    let b = self.pop()?.as_i32();
                    let a = self.pop()?.as_i32();
                    self.push(WasmValue::from_i32(if a > b { 1 } else { 0 }))?;
                }
                0x6A => { // i32.add
                    let b = self.pop()?.as_i32();
                    let a = self.pop()?.as_i32();
                    self.push(WasmValue::from_i32(a.wrapping_add(b)))?;
                }
                0x6B => { // i32.sub
                    let b = self.pop()?.as_i32();
                    let a = self.pop()?.as_i32();
                    self.push(WasmValue::from_i32(a.wrapping_sub(b)))?;
                }
                0x6C => { // i32.mul
                    let b = self.pop()?.as_i32();
                    let a = self.pop()?.as_i32();
                    self.push(WasmValue::from_i32(a.wrapping_mul(b)))?;
                }
                0x6D => { // i32.div_s
                    let b = self.pop()?.as_i32();
                    let a = self.pop()?.as_i32();
                    if b == 0 {
                        self.last_trap = WasmTrap::IntegerDivideByZero;
                        return Err(WasmTrap::IntegerDivideByZero);
                    }
                    self.push(WasmValue::from_i32(a.wrapping_div(b)))?;
                }
                0x71 => { // i32.and
                    let b = self.pop()?.as_i32();
                    let a = self.pop()?.as_i32();
                    self.push(WasmValue::from_i32(a & b))?;
                }
                0x72 => { // i32.or
                    let b = self.pop()?.as_i32();
                    let a = self.pop()?.as_i32();
                    self.push(WasmValue::from_i32(a | b))?;
                }
                0x73 => { // i32.xor
                    let b = self.pop()?.as_i32();
                    let a = self.pop()?.as_i32();
                    self.push(WasmValue::from_i32(a ^ b))?;
                }
                0x74 => { // i32.shl
                    let b = self.pop()?.as_i32();
                    let a = self.pop()?.as_i32();
                    self.push(WasmValue::from_i32(a << (b & 31)))?;
                }
                0x75 => { // i32.shr_s
                    let b = self.pop()?.as_i32();
                    let a = self.pop()?.as_i32();
                    self.push(WasmValue::from_i32(a >> (b & 31)))?;
                }
                _ => {
                    self.last_trap = WasmTrap::MalformedSection;
                    return Err(WasmTrap::MalformedSection);
                }
            }
        }

        let ret = if self.stack_top > 0 {
            self.pop()?.as_i32()
        } else {
            0
        };

        self.last_return_value = ret;
        self.last_trap = WasmTrap::None;
        Ok(ret)
    }

    /// Executes a full WebAssembly module (.wasm binary)
    pub fn execute_module(&mut self, wasm_binary: &[u8], fuel_budget: u64) -> Result<i32, WasmTrap> {
        Self::validate_header(wasm_binary)?;
        // If it starts with header, slice past 8-byte header and evaluate the code payload
        let code_slice = &wasm_binary[8..];
        self.execute_bytecode(code_slice, fuel_budget)
    }
}

pub static mut WASM_RUNTIME: WasmEngine = WasmEngine::new();

/// Pre-compiled WebAssembly test modules:
/// 1. Math / Expression: (40 + 2) * 5 - 10 = 200
pub const WASM_MATH_EXPR: [u8; 20] = [
    0x00, 0x61, 0x73, 0x6D, // magic \0asm
    0x01, 0x00, 0x00, 0x00, // version 1
    0x41, 40,               // i32.const 40
    0x41, 2,                // i32.const 2
    0x6A,                   // i32.add (42)
    0x41, 5,                // i32.const 5
    0x6C,                   // i32.mul (210)
    0x41, 10,               // i32.const 10
    0x6B,                   // i32.sub (200)
    0x0B,                   // end
];

/// 2. Linear Memory Store and Load: writes 0x12345678 to offset 64, reads it back, adds 1
pub const WASM_MEMORY_TEST: [u8; 24] = [
    0x00, 0x61, 0x73, 0x6D,
    0x01, 0x00, 0x00, 0x00,
    0x41, 64,               // i32.const 64 (memory offset)
    0x41, 42,               // i32.const 42 (value)
    0x36, 0x02, 0x00,       // i32.store align=2, offset=0
    0x41, 64,               // i32.const 64
    0x28, 0x02, 0x00,       // i32.load align=2, offset=0
    0x41, 8,                // i32.const 8
    0x6A,                   // i32.add (50)
    0x0B,                   // end
];

/// Initializes the Embedded WebAssembly subsystem.
pub unsafe fn init_wasm_subsystem() {
    let _ = WASM_RUNTIME.execute_module(&WASM_MATH_EXPR, 10_000);
}
