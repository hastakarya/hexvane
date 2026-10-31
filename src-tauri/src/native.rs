//! Reads and patches the memory of a running native game, for games without a mod loader (e.g. CryEngine).
//! Same user, no elevation: only games started normally by this user can be opened.

use std::ffi::c_void;
use std::mem::{size_of, zeroed};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE, STILL_ACTIVE};
use windows_sys::Win32::System::Diagnostics::Debug::{FlushInstructionCache, ReadProcessMemory, WriteProcessMemory};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Module32FirstW, Module32NextW, Process32FirstW, Process32NextW, MODULEENTRY32W,
    PROCESSENTRY32W, TH32CS_SNAPMODULE, TH32CS_SNAPMODULE32, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Memory::{
    VirtualAllocEx, VirtualProtectEx, VirtualQueryEx, MEMORY_BASIC_INFORMATION, MEM_COMMIT, MEM_RESERVE,
    PAGE_EXECUTE_READ, PAGE_EXECUTE_READWRITE, PAGE_EXECUTE_WRITECOPY, PAGE_GUARD, PAGE_READONLY, PAGE_READWRITE,
    PAGE_WRITECOPY,
};
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_OPERATION, PROCESS_VM_READ, PROCESS_VM_WRITE,
};

fn wide_eq(name: &[u16], want: &str) -> bool {
    let len = name.iter().position(|&c| c == 0).unwrap_or(name.len());
    String::from_utf16_lossy(&name[..len]).eq_ignore_ascii_case(want)
}

/// The first running process whose exe file name is `exe` (case-insensitive).
pub fn find_pid(exe: &str) -> Option<u32> {
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut entry: PROCESSENTRY32W = zeroed();
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut found = None;
        let mut ok = Process32FirstW(snap, &mut entry) != 0;
        while ok {
            if wide_eq(&entry.szExeFile, exe) {
                found = Some(entry.th32ProcessID);
                break;
            }
            ok = Process32NextW(snap, &mut entry) != 0;
        }
        CloseHandle(snap);
        found
    }
}

pub struct Process {
    handle: HANDLE,
    pub pid: u32,
}

// The handle is only used behind a Mutex.
unsafe impl Send for Process {}

impl Drop for Process {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.handle) };
    }
}

impl Process {
    pub fn open(pid: u32) -> Result<Process, String> {
        let access = PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_VM_OPERATION | PROCESS_QUERY_INFORMATION;
        let handle = unsafe { OpenProcess(access, 0, pid) };
        if handle.is_null() {
            return Err("Couldn't open the game. Is it running as administrator?".into());
        }
        Ok(Process { handle, pid })
    }

    pub fn is_alive(&self) -> bool {
        let mut code = 0u32;
        unsafe { GetExitCodeProcess(self.handle, &mut code) != 0 && code == STILL_ACTIVE as u32 }
    }

    /// Base address and size of a module (exe or dll) loaded in the process.
    pub fn module(&self, name: &str) -> Option<(usize, usize)> {
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, self.pid);
            if snap == INVALID_HANDLE_VALUE {
                return None;
            }
            let mut entry: MODULEENTRY32W = zeroed();
            entry.dwSize = size_of::<MODULEENTRY32W>() as u32;
            let mut found = None;
            let mut ok = Module32FirstW(snap, &mut entry) != 0;
            while ok {
                if wide_eq(&entry.szModule, name) {
                    found = Some((entry.modBaseAddr as usize, entry.modBaseSize as usize));
                    break;
                }
                ok = Module32NextW(snap, &mut entry) != 0;
            }
            CloseHandle(snap);
            found
        }
    }

    pub fn read(&self, addr: usize, len: usize) -> Result<Vec<u8>, String> {
        let mut buf = vec![0u8; len];
        let mut done = 0usize;
        let ok = unsafe { ReadProcessMemory(self.handle, addr as *const c_void, buf.as_mut_ptr().cast(), len, &mut done) };
        if ok == 0 || done != len {
            return Err(format!("Couldn't read game memory at {addr:#x}"));
        }
        Ok(buf)
    }

    pub fn read_u64(&self, addr: usize) -> Result<u64, String> {
        Ok(u64::from_le_bytes(self.read(addr, 8)?.try_into().unwrap()))
    }

    pub fn read_i32(&self, addr: usize) -> Result<i32, String> {
        Ok(i32::from_le_bytes(self.read(addr, 4)?.try_into().unwrap()))
    }

    /// Writes even to code pages: unprotects, writes, restores the protection and flushes the CPU's code cache.
    pub fn write(&self, addr: usize, bytes: &[u8]) -> Result<(), String> {
        unsafe {
            let mut old = 0u32;
            if VirtualProtectEx(self.handle, addr as *const c_void, bytes.len(), PAGE_EXECUTE_READWRITE, &mut old) == 0 {
                return Err(format!("Couldn't unprotect game memory at {addr:#x}"));
            }
            let mut done = 0usize;
            let ok = WriteProcessMemory(self.handle, addr as *const c_void, bytes.as_ptr().cast(), bytes.len(), &mut done);
            VirtualProtectEx(self.handle, addr as *const c_void, bytes.len(), old, &mut old);
            FlushInstructionCache(self.handle, addr as *const c_void, bytes.len());
            if ok == 0 || done != bytes.len() {
                return Err(format!("Couldn't write game memory at {addr:#x}"));
            }
        }
        Ok(())
    }

    /// Executable memory within ±2 GB of `near`, so a 5-byte `jmp rel32` can reach it.
    pub fn alloc_near(&self, near: usize, size: usize) -> Result<usize, String> {
        const STEP: usize = 0x10000; // allocation granularity
        for i in 1..(0x7000_0000 / STEP) {
            for candidate in [near.checked_sub(i * STEP), near.checked_add(i * STEP)].into_iter().flatten() {
                let at = candidate & !(STEP - 1);
                let p = unsafe {
                    VirtualAllocEx(self.handle, at as *const c_void, size, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE)
                };
                if !p.is_null() {
                    return Ok(p as usize);
                }
            }
        }
        Err("Couldn't find free memory near the game code".into())
    }

    /// Every address in the module where the pattern matches. Reads region by region, skipping unreadable pages.
    pub fn scan_module(&self, base: usize, size: usize, pattern: &[Option<u8>]) -> Vec<usize> {
        let mut hits = Vec::new();
        let mut addr = base;
        while addr < base + size {
            let mut info: MEMORY_BASIC_INFORMATION = unsafe { zeroed() };
            let got = unsafe {
                VirtualQueryEx(self.handle, addr as *const c_void, &mut info, size_of::<MEMORY_BASIC_INFORMATION>())
            };
            if got == 0 {
                break;
            }
            let start = info.BaseAddress as usize;
            let end = (start + info.RegionSize).min(base + size);
            let readable = PAGE_READONLY | PAGE_READWRITE | PAGE_WRITECOPY | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE
                | PAGE_EXECUTE_WRITECOPY;
            if info.State == MEM_COMMIT && info.Protect & readable != 0 && info.Protect & PAGE_GUARD == 0 {
                if let Ok(bytes) = self.read(start.max(addr), end - start.max(addr)) {
                    hits.extend(find_pattern(&bytes, pattern).into_iter().map(|i| start.max(addr) + i));
                }
            }
            addr = end;
        }
        hits
    }
}

/// "44 8B ?? 40" -> pattern bytes, `??` matching anything.
pub fn parse_pattern(text: &str) -> Vec<Option<u8>> {
    text.split_whitespace()
        .map(|b| if b.starts_with('?') { None } else { Some(u8::from_str_radix(b, 16).expect("bad pattern byte")) })
        .collect()
}

pub fn find_pattern(hay: &[u8], pattern: &[Option<u8>]) -> Vec<usize> {
    if pattern.is_empty() || hay.len() < pattern.len() {
        return vec![];
    }
    (0..=hay.len() - pattern.len())
        .filter(|&i| pattern.iter().enumerate().all(|(j, p)| p.map_or(true, |b| hay[i + j] == b)))
        .collect()
}

/// `jmp rel32` from `from` to `to` (5 bytes).
pub fn jmp(from: usize, to: usize) -> Vec<u8> {
    let rel = (to as i64 - (from as i64 + 5)) as i32;
    let mut b = vec![0xE9];
    b.extend_from_slice(&rel.to_le_bytes());
    b
}

/// A detour: the game's instructions at `addr` jump to our code cave, which ends by jumping back.
pub struct Hook {
    pub addr: usize,
    original: Vec<u8>,
    pub cave: usize,
}

impl Hook {
    /// `body(cave)` returns the cave code, which must include the replaced original instructions;
    /// the jump back is added here. `original` is what the hook overwrites (at least 5 bytes).
    pub fn install(p: &Process, addr: usize, original: &[u8], body: impl Fn(usize) -> Vec<u8>) -> Result<Hook, String> {
        if p.read(addr, original.len())? != original {
            return Err("The game code isn't what Hexvane expects (different game version?)".into());
        }
        let cave = p.alloc_near(addr, 0x1000)?;
        let mut code = body(cave);
        let back = jmp(cave + code.len(), addr + original.len());
        code.extend(back);
        p.write(cave, &code)?;
        let mut patch = jmp(addr, cave);
        patch.resize(original.len(), 0x90); // pad with NOPs
        p.write(addr, &patch)?;
        Ok(Hook { addr, original: original.to_vec(), cave })
    }

    /// Takes over a hook an earlier Hexvane session left in the game: `cave` holds `code_len` bytes of our code and then
    /// the jump back, which tells where the hook sits. Checks that the hook really jumps to this cave.
    pub fn adopt(p: &Process, cave: usize, code_len: usize, original: &[u8]) -> Result<Hook, String> {
        let back = p.read(cave + code_len, 5)?;
        if back[0] != 0xE9 {
            return Err("Found an old Hexvane hook but couldn't read it. Restart the game.".into());
        }
        let target = (cave + code_len + 5) as i64 + i32::from_le_bytes(back[1..].try_into().unwrap()) as i64;
        let addr = target as usize - original.len();
        if p.read(addr, 5)? != jmp(addr, cave) {
            return Err("Found an old Hexvane hook that doesn't match. Restart the game.".into());
        }
        Ok(Hook { addr, original: original.to_vec(), cave })
    }

    /// Puts the game's own instructions back. The cave stays allocated in case a game thread is still inside it.
    pub fn remove(&self, p: &Process) -> Result<(), String> {
        p.write(self.addr, &self.original)
    }
}

impl Process {
    /// Calls `f(start, bytes)` for each block of the game's private read-write memory (its heap data), in address order.
    pub fn for_each_writable(&self, mut f: impl FnMut(usize, &[u8])) {
        use windows_sys::Win32::System::Memory::MEM_PRIVATE;
        let mut addr = 0usize;
        loop {
            let mut info: MEMORY_BASIC_INFORMATION = unsafe { zeroed() };
            let got = unsafe {
                VirtualQueryEx(self.handle, addr as *const c_void, &mut info, size_of::<MEMORY_BASIC_INFORMATION>())
            };
            if got == 0 {
                break;
            }
            let start = info.BaseAddress as usize;
            if info.State == MEM_COMMIT && info.Type == MEM_PRIVATE && info.Protect == PAGE_READWRITE {
                if let Ok(bytes) = self.read(start, info.RegionSize) {
                    f(start, &bytes);
                }
            }
            match start.checked_add(info.RegionSize) {
                Some(next) if next > addr => addr = next,
                _ => break,
            }
        }
    }

    /// Addresses in executable memory the game didn't load from a file (where code caves live) that match `pattern`.
    pub fn scan_caves(&self, pattern: &[Option<u8>]) -> Vec<usize> {
        use windows_sys::Win32::System::Memory::MEM_PRIVATE;
        let mut hits = Vec::new();
        let mut addr = 0usize;
        loop {
            let mut info: MEMORY_BASIC_INFORMATION = unsafe { zeroed() };
            let got = unsafe {
                VirtualQueryEx(self.handle, addr as *const c_void, &mut info, size_of::<MEMORY_BASIC_INFORMATION>())
            };
            if got == 0 {
                break;
            }
            let start = info.BaseAddress as usize;
            if info.State == MEM_COMMIT && info.Type == MEM_PRIVATE && info.Protect == PAGE_EXECUTE_READWRITE {
                if let Ok(bytes) = self.read(start, info.RegionSize) {
                    hits.extend(find_pattern(&bytes, pattern).into_iter().map(|i| start + i));
                }
            }
            match start.checked_add(info.RegionSize) {
                Some(next) if next > addr => addr = next,
                _ => break,
            }
        }
        hits
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_patterns_with_wildcards() {
        let hay = [0x00, 0x44, 0x8B, 0x71, 0x40, 0x4C, 0x44, 0x8B, 0x00, 0x40];
        assert_eq!(find_pattern(&hay, &parse_pattern("44 8B ?? 40")), vec![1, 6]);
        assert_eq!(find_pattern(&hay, &parse_pattern("44 8B 71")), vec![1]);
        assert!(find_pattern(&hay[..2], &parse_pattern("44 8B 71")).is_empty());
    }

    #[test]
    fn encodes_relative_jumps() {
        assert_eq!(jmp(0x1000, 0x1010), vec![0xE9, 0x0B, 0, 0, 0]);
        assert_eq!(jmp(0x1010, 0x1000), vec![0xE9, 0xEB, 0xFF, 0xFF, 0xFF]);
    }
}
