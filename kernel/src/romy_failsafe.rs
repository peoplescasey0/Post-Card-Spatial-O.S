//! PA-Romy failsafe: the learning half.
//!
//! PA-Romy is only as useful as the subsystems she mirrors, so this watches the
//! four she depends on and, when one breaks, walks a bounded repair ladder
//! rather than leaving the operator at a dead prompt.
//!
//! Which step fixed which failure is remembered against a signature of the
//! failure, so the next occurrence of the same fault starts at the step that
//! worked last time. A step that stops working is demoted and re-learned from
//! the next one. That is the whole "recursive" part: the ledger is rewritten by
//! the outcomes of its own repairs, not by a table someone typed.
//!
//! Nothing here touches hardware or kernel state. The caller supplies probe
//! results and applies the steps, which keeps the learning rules inspectable
//! and lets `romy selftest` exercise them without a working disk.

pub const MAX_LEDGER: usize = 16;
pub const MAX_REASON: usize = 24;
/// Stop repairing one signature after this many rounds in a boot; past that the
/// fault is not a glitch and the operator is told instead.
pub const MAX_ROUNDS_PER_SIG: u8 = 4;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Probe {
    Vault,
    Storage,
    Trust,
    Telemetry,
}

impl Probe {
    pub const ALL: [Probe; 4] = [Probe::Vault, Probe::Storage, Probe::Trust, Probe::Telemetry];

    pub fn name(self) -> &'static str {
        match self {
            Probe::Vault => "vault",
            Probe::Storage => "storage",
            Probe::Trust => "trust",
            Probe::Telemetry => "telemetry",
        }
    }

    pub fn by_name(name: &str) -> Option<Probe> {
        let name = name.trim();
        for p in Probe::ALL {
            if name == p.name() {
                return Some(p);
            }
        }
        None
    }

    /// Which repairs this probe may legally use.
    ///
    /// A quarantined card is a security finding rather than a glitch, so the
    /// trust probe gets no automatic action beyond a retry: the failsafe must
    /// never quietly un-quarantine anything or clear volatile card state.
    pub fn allows(self, step: Step) -> bool {
        match step {
            Step::Retry | Step::Escalate => true,
            Step::SafeMode => !matches!(self, Probe::Trust),
            Step::RelockVault => matches!(self, Probe::Vault),
            Step::FlushBuffers | Step::RescanDevices => matches!(self, Probe::Storage),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Step {
    Retry,
    FlushBuffers,
    RescanDevices,
    RelockVault,
    SafeMode,
    Escalate,
}

impl Step {
    /// Cheapest and least invasive first; `Escalate` is always last.
    pub const ALL: [Step; 6] = [
        Step::Retry,
        Step::FlushBuffers,
        Step::RescanDevices,
        Step::RelockVault,
        Step::SafeMode,
        Step::Escalate,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Step::Retry => "Retry",
            Step::FlushBuffers => "FlushBuffers",
            Step::RescanDevices => "RescanDevices",
            Step::RelockVault => "RelockVault",
            Step::SafeMode => "SafeMode",
            Step::Escalate => "Escalate",
        }
    }

    fn index(self) -> usize {
        match self {
            Step::Retry => 0,
            Step::FlushBuffers => 1,
            Step::RescanDevices => 2,
            Step::RelockVault => 3,
            Step::SafeMode => 4,
            Step::Escalate => 5,
        }
    }
}

/// The first allowed step after `after` (or the first allowed step when `after`
/// is `None`), so one ladder definition serves every probe.
pub fn next_allowed(probe: Probe, after: Option<Step>) -> Option<Step> {
    let start = match after {
        Some(s) => s.index() + 1,
        None => 0,
    };
    let mut i = start;
    while i < Step::ALL.len() {
        let s = Step::ALL[i];
        if probe.allows(s) {
            return Some(s);
        }
        i += 1;
    }
    None
}

#[derive(Clone, Copy)]
pub struct Incident {
    pub sig: u64,
    pub probe: Probe,
    pub step: Step,
    pub fixes: u8,
    pub misses: u8,
    /// Repair rounds this signature has been through, cap-checked separately
    /// from the individual step outcomes.
    pub seen: u8,
    /// Set once this signature has been escalated, so an unfixable fault is
    /// announced once instead of on every scan.
    pub reported: bool,
}

pub struct Stats {
    pub scans: u32,
    pub healed: u32,
    pub escalated: u32,
    pub tracked: usize,
}

pub struct Failsafe {
    ledger: [Option<Incident>; MAX_LEDGER],
    scans: u32,
    healed: u32,
    escalated: u32,
    last_probe: Probe,
    last_step: Option<Step>,
    last_learned: bool,
    last_repaired: bool,
}

fn fnv1a(seed: u64, bytes: &[u8]) -> u64 {
    let mut h = seed;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01B3);
    }
    h
}

impl Failsafe {
    pub const fn new() -> Self {
        Failsafe {
            ledger: [None; MAX_LEDGER],
            scans: 0,
            healed: 0,
            escalated: 0,
            last_probe: Probe::Vault,
            last_step: None,
            last_learned: false,
            last_repaired: false,
        }
    }

    /// A stable name for "this probe failed this way". Case, punctuation and
    /// repeated separators are folded, because the same fault is worth learning
    /// from whether it arrives as "no device" or "No device.".
    pub fn signature(probe: Probe, reason: &str) -> u64 {
        let mut h = fnv1a(0xcbf2_9ce4_8422_2325, probe.name().as_bytes());
        // Fold to words: case, punctuation and runs of whitespace do not make a
        // new signature, and a separator is only emitted between two words.
        let mut pending_sep = false;
        let mut n = 0usize;
        for ch in reason.chars() {
            if n >= MAX_REASON {
                break;
            }
            if !ch.is_ascii_alphanumeric() {
                pending_sep = true;
                continue;
            }
            if pending_sep && n > 0 {
                if n >= MAX_REASON {
                    break;
                }
                h = fnv1a(h, &[b'_']);
                n += 1;
            }
            pending_sep = false;
            h = fnv1a(h, &[ch.to_ascii_lowercase() as u8]);
            n += 1;
        }
        h
    }

    /// The first free slot, else the entry that has earned the least: eviction
    /// keeps what actually repaired something over what merely happened often.
    fn slot_for(&self, sig: u64) -> usize {
        for (i, e) in self.ledger.iter().enumerate() {
            if let Some(inc) = e {
                if inc.sig == sig {
                    return i;
                }
            }
        }
        for (i, e) in self.ledger.iter().enumerate() {
            if e.is_none() {
                return i;
            }
        }
        let mut best = 0usize;
        let mut best_score = u16::MAX;
        for (i, e) in self.ledger.iter().enumerate() {
            if let Some(inc) = e {
                let score = inc.fixes as u16 * 4 + inc.seen as u16;
                if score < best_score {
                    best_score = score;
                    best = i;
                }
            }
        }
        best
    }

    pub fn incident(&self, idx: usize) -> Option<Incident> {
        if idx < MAX_LEDGER {
            self.ledger[idx]
        } else {
            None
        }
    }

    pub fn tracked(&self) -> usize {
        self.ledger.iter().filter(|e| e.is_some()).count()
    }

    /// Record one repair attempt. Two failures at the same step retire that step
    /// for this signature and promote the next allowed one, so a fix that stops
    /// working is replaced instead of retried forever.
    pub fn note(&mut self, probe: Probe, reason: &str, step: Step, fixed: bool) {
        let sig = Self::signature(probe, reason);
        let i = self.slot_for(sig);
        match self.ledger[i] {
            Some(mut inc) if inc.sig == sig => {
                if fixed {
                    inc.fixes = inc.fixes.saturating_add(1);
                    inc.misses = 0;
                    inc.step = step;
                } else {
                    inc.misses = inc.misses.saturating_add(1);
                    if inc.misses >= 2 {
                        if let Some(next) = next_allowed(probe, Some(inc.step)) {
                            inc.step = next;
                        }
                        inc.misses = 0;
                    }
                }
                self.ledger[i] = Some(inc);
            }
            _ => {
                self.ledger[i] = Some(Incident {
                    sig,
                    probe,
                    step,
                    fixes: if fixed { 1 } else { 0 },
                    misses: if fixed { 0 } else { 1 },
                    seen: 0,
                    reported: false,
                });
            }
        }
    }

    /// The step recorded for this signature, fixed or not.
    pub fn learned_step(&self, probe: Probe, reason: &str) -> Option<Step> {
        let sig = Self::signature(probe, reason);
        self.ledger
            .iter()
            .flatten()
            .find(|i| i.sig == sig)
            .map(|i| i.step)
    }

    /// The step to try first: whatever repaired this exact signature before.
    pub fn preferred(&self, probe: Probe, reason: &str) -> Option<Step> {
        let sig = Self::signature(probe, reason);
        self.ledger
            .iter()
            .flatten()
            .find(|i| i.sig == sig && i.fixes > 0)
            .map(|i| i.step)
    }

    /// Open a repair round for this signature. The cap counts rounds, not ladder
    /// steps, so a first thorough repair does not spend the whole budget.
    pub fn begin_round(&mut self, probe: Probe, reason: &str) {
        let sig = Self::signature(probe, reason);
        let i = self.slot_for(sig);
        match self.ledger[i] {
            Some(mut inc) if inc.sig == sig => {
                inc.seen = inc.seen.saturating_add(1);
                self.ledger[i] = Some(inc);
            }
            _ => {
                self.ledger[i] = Some(Incident {
                    sig,
                    probe,
                    step: next_allowed(probe, None).unwrap_or(Step::Escalate),
                    fixes: 0,
                    misses: 0,
                    seen: 1,
                    reported: false,
                });
            }
        }
    }

    /// Announce an escalation only once per signature: returns true the first
    /// time, so the caller knows whether to print it and count it.
    pub fn mark_reported(&mut self, probe: Probe, reason: &str) -> bool {
        let sig = Self::signature(probe, reason);
        let i = self.slot_for(sig);
        match self.ledger[i] {
            Some(mut inc) if inc.sig == sig => {
                let first = !inc.reported;
                inc.reported = true;
                self.ledger[i] = Some(inc);
                first
            }
            _ => {
                self.ledger[i] = Some(Incident {
                    sig,
                    probe,
                    step: next_allowed(probe, None).unwrap_or(Step::Escalate),
                    fixes: 0,
                    misses: 0,
                    seen: 0,
                    reported: true,
                });
                true
            }
        }
    }

    pub fn seen(&self, probe: Probe, reason: &str) -> u8 {
        let sig = Self::signature(probe, reason);
        self.ledger
            .iter()
            .flatten()
            .find(|i| i.sig == sig)
            .map(|i| i.seen)
            .unwrap_or(0)
    }

    pub fn exhausted(&self, probe: Probe, reason: &str) -> bool {
        self.seen(probe, reason) >= MAX_ROUNDS_PER_SIG
    }

    /// The ladder to walk: the learned step first, then everything allowed
    /// after it. Returns how many steps were written into `out`.
    pub fn plan(&self, probe: Probe, reason: &str, out: &mut [Step; 6]) -> usize {
        let mut n = 0usize;
        let mut cur = None;
        if let Some(s) = self.preferred(probe, reason) {
            if probe.allows(s) && n < out.len() {
                out[n] = s;
                n += 1;
                cur = Some(s);
            }
        }
        loop {
            match next_allowed(probe, cur) {
                Some(s) => {
                    if n < out.len() {
                        out[n] = s;
                        n += 1;
                    }
                    cur = Some(s);
                    if s == Step::Escalate {
                        break;
                    }
                }
                None => break,
            }
        }
        n
    }

    pub fn record_scan(&mut self) {
        self.scans = self.scans.saturating_add(1);
    }

    pub fn record_heal(&mut self, probe: Probe, step: Step, learned: bool, fixed: bool) {
        self.last_probe = probe;
        self.last_step = Some(step);
        self.last_learned = learned;
        self.last_repaired = fixed;
        if fixed {
            self.healed = self.healed.saturating_add(1);
        }
    }

    pub fn record_escalation(&mut self) {
        self.escalated = self.escalated.saturating_add(1);
    }

    pub fn stats(&self) -> Stats {
        Stats {
            scans: self.scans,
            healed: self.healed,
            escalated: self.escalated,
            tracked: self.tracked(),
        }
    }

    /// (probe, step, went straight to a learned fix, the step actually worked)
    pub fn last(&self) -> (Probe, Option<Step>, bool, bool) {
        (self.last_probe, self.last_step, self.last_learned, self.last_repaired)
    }

    pub fn forget(&mut self, only: Option<Probe>) {
        for e in self.ledger.iter_mut() {
            let drop_it = match (only, &*e) {
                (None, _) => true,
                (Some(p), Some(inc)) => inc.probe == p,
                (Some(_), None) => false,
            };
            if drop_it {
                *e = None;
            }
        }
    }

    /// Exercise the learning rules themselves. Runs on every boot from
    /// `romy selftest`; no hardware or kernel state involved.
    pub fn selftest() -> (u8, u8) {
        let mut passed = 0u8;
        let total = 10u8;

        let a = Failsafe::signature(Probe::Storage, "no device");
        if a == Failsafe::signature(Probe::Storage, "no device")
            && a != Failsafe::signature(Probe::Vault, "no device")
        {
            passed += 1;
        }
        if Failsafe::signature(Probe::Vault, "No  Device.") == Failsafe::signature(Probe::Vault, "no device")
        {
            passed += 1;
        }

        let fs = Failsafe::new();
        let mut plan = [Step::Retry; 6];
        let n = fs.plan(Probe::Storage, "cold", &mut plan);
        if n == 5 && plan[0] == Step::Retry && plan[4] == Step::Escalate {
            passed += 1;
        }
        let n = fs.plan(Probe::Trust, "cold", &mut plan);
        if n == 2 && plan[0] == Step::Retry && plan[1] == Step::Escalate {
            passed += 1;
        }

        let mut fs = Failsafe::new();
        fs.note(Probe::Storage, "cold", Step::Retry, false);
        fs.note(Probe::Storage, "cold", Step::FlushBuffers, false);
        fs.note(Probe::Storage, "cold", Step::RescanDevices, true);
        if fs.preferred(Probe::Storage, "cold") == Some(Step::RescanDevices) {
            let n = fs.plan(Probe::Storage, "cold", &mut plan);
            if n == 3 && plan[0] == Step::RescanDevices && plan[2] == Step::Escalate {
                passed += 1;
            }
        }

        let mut fs = Failsafe::new();
        fs.note(Probe::Vault, "lock lost", Step::RelockVault, false);
        fs.note(Probe::Vault, "lock lost", Step::RelockVault, false);
        if fs.preferred(Probe::Vault, "lock lost").is_none()
            && fs.learned_step(Probe::Vault, "lock lost") == Some(Step::SafeMode)
        {
            passed += 1;
        }

        let mut fs = Failsafe::new();
        for _ in 0..3 {
            fs.begin_round(Probe::Telemetry, "stalled");
        }
        if !fs.exhausted(Probe::Telemetry, "stalled") {
            fs.begin_round(Probe::Telemetry, "stalled");
            if fs.exhausted(Probe::Telemetry, "stalled") {
                passed += 1;
            }
        }

        let mut fs = Failsafe::new();
        fs.note(Probe::Vault, "one", Step::Retry, true);
        fs.note(Probe::Storage, "two", Step::Retry, true);
        let kept = fs.tracked();
        fs.forget(Some(Probe::Vault));
        if kept == 2 && fs.tracked() == 1 {
            fs.forget(None);
            if fs.tracked() == 0 {
                passed += 1;
            }
        }

        // A round must not be charged for every step it walks, or her first
        // thorough repair would spend the whole budget for that fault.
        let mut fs = Failsafe::new();
        fs.note(Probe::Storage, "cold", Step::Retry, false);
        fs.note(Probe::Storage, "cold", Step::FlushBuffers, false);
        fs.note(Probe::Storage, "cold", Step::RescanDevices, true);
        if fs.seen(Probe::Storage, "cold") == 0 && !fs.exhausted(Probe::Storage, "cold") {
            passed += 1;
        }

        // A fault she cannot fix is escalated once, not on every scan.
        let mut fs = Failsafe::new();
        if fs.mark_reported(Probe::Trust, "quarantined")
            && !fs.mark_reported(Probe::Trust, "quarantined")
        {
            passed += 1;
        }

        (passed, total)
    }
}
