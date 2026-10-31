//! Developer tool for finding values in Ryse's player struct (e.g. focus), while Hexvane runs its cheats.
//! It reads the player pointer that Hexvane's health hook stores, so Hexvane must be connected in a campaign level.
//!
//!   cargo run --example ryse_probe -- snap <name>          save the player struct to <name>.bin
//!   cargo run --example ryse_probe -- diff <a> <b>         floats/ints that differ between two snapshots
//!   cargo run --example ryse_probe -- read <hex offset>    the value at an offset now
//!   cargo run --example ryse_probe -- write <hex offset> <float>
//!
//! Snapshots go to the current folder.

use hexvane_lib::native::{find_pid, parse_pattern, Process};
use hexvane_lib::ryse::{HEALTH_CAVE_START, PLAYER_SLOT};

const LEN: usize = 0x2000;

fn player(p: &Process) -> Result<usize, String> {
    let caves = p.scan_caves(&parse_pattern(HEALTH_CAVE_START));
    let cave = *caves.first().ok_or("Hexvane's health hook isn't installed (open a campaign level with Hexvane running)")?;
    match p.read_u64(cave + PLAYER_SLOT)? {
        0 => Err("No player seen yet: get hit once, or wait a moment".into()),
        ptr => Ok(ptr as usize),
    }
}

fn load(name: &str) -> Vec<u8> {
    std::fs::read(format!("{name}.bin")).unwrap_or_else(|e| panic!("{name}.bin: {e}"))
}

fn f32_at(b: &[u8], off: usize) -> f32 {
    f32::from_le_bytes(b[off..off + 4].try_into().unwrap())
}

fn i32_at(b: &[u8], off: usize) -> i32 {
    i32::from_le_bytes(b[off..off + 4].try_into().unwrap())
}

/// Candidates: (address, last value as raw 4 bytes), saved between runs in scan.bin.
fn save(c: &[(usize, u32)]) {
    let mut out = Vec::with_capacity(c.len() * 12);
    for (a, v) in c {
        out.extend((*a as u64).to_le_bytes());
        out.extend(v.to_le_bytes());
    }
    std::fs::write("scan.bin", out).expect("write scan.bin");
}

fn load_scan() -> Vec<(usize, u32)> {
    std::fs::read("scan.bin")
        .expect("run `scan start` first")
        .chunks_exact(12)
        .map(|c| (u64::from_le_bytes(c[..8].try_into().unwrap()) as usize, u32::from_le_bytes(c[8..].try_into().unwrap())))
        .collect()
}

/// Plausible as a game value: a sane float, or a smallish int.
fn plausible(v: u32) -> bool {
    let f = f32::from_bits(v);
    (f.is_finite() && f.abs() > 0.0001 && f.abs() < 100_000.0) || (v as i32) > 0 && (v as i32) < 1_000_000
}

fn compare(how: &str, old: u32, new: u32) -> bool {
    let (fo, fnew) = (f32::from_bits(old), f32::from_bits(new));
    let floats = fo.is_finite() && fnew.is_finite() && fo.abs() < 100_000.0 && fnew.abs() < 100_000.0;
    match how {
        "same" => old == new,
        "changed" => old != new,
        "up" => old != new && if floats { fnew > fo } else { (new as i32) > (old as i32) },
        "down" => old != new && if floats { fnew < fo } else { (new as i32) < (old as i32) },
        _ => panic!("unknown scan step {how}"),
    }
}

fn scan(p: &Process, how: &str) -> Result<(), String> {
    match how {
        "start" => {
            let mut c = Vec::new();
            p.for_each_writable(|start, bytes| {
                for (i, w) in bytes.chunks_exact(4).enumerate() {
                    let v = u32::from_le_bytes(w.try_into().unwrap());
                    if plausible(v) {
                        c.push((start + i * 4, v));
                    }
                }
            });
            println!("{} candidates", c.len());
            save(&c);
        }
        // scan frac <lo> <hi>: keep values that are lo..hi (e.g. 0.7 0.97) of a round maximum, as the bar shows them
        "frac" => {
            let args: Vec<f64> = std::env::args().skip(3).map(|a| a.parse().expect("fraction")).collect();
            let (lo, hi) = (args[0], args[1]);
            let fits = |v: f64| [1.0, 100.0, 1000.0, 10000.0].iter().any(|m| v >= lo * m && v <= hi * m);
            let kept: Vec<_> = load_scan()
                .into_iter()
                .filter(|&(_, v)| {
                    let f = f32::from_bits(v) as f64;
                    (f.is_finite() && fits(f)) || fits(v as i32 as f64)
                })
                .collect();
            println!("{} candidates left", kept.len());
            save(&kept);
        }
        "list" => {
            for (a, v) in load_scan().iter().take(40) {
                println!("{a:#x}  float {:<14} int {}", f32::from_bits(*v), *v as i32);
            }
        }
        _ => {
            // Candidates are in address order, like the memory blocks, so walk both together.
            let old = load_scan();
            let mut i = 0;
            let mut kept = Vec::new();
            p.for_each_writable(|start, bytes| {
                while i < old.len() && old[i].0 < start {
                    i += 1; // block gone since last step
                }
                while i < old.len() && old[i].0 + 4 <= start + bytes.len() {
                    let (a, before) = old[i];
                    let now = u32::from_le_bytes(bytes[a - start..a - start + 4].try_into().unwrap());
                    if compare(how, before, now) {
                        kept.push((a, now));
                    }
                    i += 1;
                }
            });
            println!("{} candidates left", kept.len());
            save(&kept);
        }
    }
    Ok(())
}

fn main() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg = |i: usize| args.get(i).map(String::as_str).ok_or("missing argument (see the top of ryse_probe.rs)");
    let hex = |s: &str| usize::from_str_radix(s.trim_start_matches("0x"), 16).map_err(|e| e.to_string());
    let open = || -> Result<(Process, usize), String> {
        let p = Process::open(find_pid("Ryse.exe").ok_or("Ryse isn't running")?)?;
        let ptr = player(&p)?;
        Ok((p, ptr))
    };

    match arg(0)? {
        "snap" => {
            let (p, ptr) = open()?;
            std::fs::write(format!("{}.bin", arg(1)?), p.read(ptr, LEN)?).map_err(|e| e.to_string())?;
            println!("player at {ptr:#x}: saved {LEN:#x} bytes to {}.bin", arg(1)?);
        }
        "diff" => {
            let (a, b) = (load(arg(1)?), load(arg(2)?));
            for off in (0..LEN.min(a.len()).min(b.len())).step_by(4) {
                let (fa, fb) = (f32_at(&a, off), f32_at(&b, off));
                let (ia, ib) = (i32_at(&a, off), i32_at(&b, off));
                if ia == ib {
                    continue;
                }
                let sane = |f: f32| f.is_finite() && f.abs() < 100_000.0 && (f == 0.0 || f.abs() > 0.0001);
                let as_float = if sane(fa) && sane(fb) { format!("float {fa:>12.4} -> {fb:<12.4}") } else { String::new() };
                println!("+{off:#06x}  int {ia:>11} -> {ib:<11}  {as_float}");
            }
        }
        "read" => {
            let (p, ptr) = open()?;
            let off = hex(arg(1)?)?;
            let b = p.read(ptr + off, 4)?;
            println!("+{off:#x}: float {}  int {}", f32_at(&b, 0), i32_at(&b, 0));
        }
        "write" => {
            let (p, ptr) = open()?;
            let off = hex(arg(1)?)?;
            let v: f32 = arg(2)?.parse().map_err(|e: std::num::ParseFloatError| e.to_string())?;
            p.write(ptr + off, &v.to_le_bytes())?;
            println!("+{off:#x} = {v}");
        }
        // poke <hex address> <float>: write a float at an absolute address, to test a scan candidate
        "poke" => {
            let p = Process::open(find_pid("Ryse.exe").ok_or("Ryse isn't running")?)?;
            let addr = hex(arg(1)?)?;
            let v: f32 = arg(2)?.parse().map_err(|e: std::num::ParseFloatError| e.to_string())?;
            p.write(addr, &v.to_le_bytes())?;
            let (pl, now) = (player(&p).unwrap_or(0), f32_at(&p.read(addr, 4)?, 0));
            println!("{addr:#x} = {now}  (player struct {pl:#x}, offset {:+#x})", addr as i64 - pl as i64);
        }
        // pokei <hex address> <int>: the same for a 4-byte integer
        "pokei" => {
            let p = Process::open(find_pid("Ryse.exe").ok_or("Ryse isn't running")?)?;
            let addr = hex(arg(1)?)?;
            let v: i32 = arg(2)?.parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
            p.write(addr, &v.to_le_bytes())?;
            println!("{addr:#x} = {}", p.read_i32(addr)?);
        }
        // Value scan over all of the game's writable memory, narrowed step by step:
        //   scan start                       remember every 4-byte value
        //   scan up|down|same|changed        keep values that went up / down / stayed / changed since the last step
        //   scan list                        show what's left
        "scan" => {
            let p = Process::open(find_pid("Ryse.exe").ok_or("Ryse isn't running")?)?;
            scan(&p, arg(1)?)?;
        }
        other => return Err(format!("unknown command {other}")),
    }
    Ok(())
}
