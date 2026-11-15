//! Keeps Crate's own WebKit child processes at normal priority.
//!
//! Shortly after launch WebKitGTK's JavaScriptCore asks RTKit
//! (`MakeThreadHighPriorityWithPID`) for nice -15 on the web process's main
//! thread, its "EventDispatcher" and "Core: Scrolling" threads (measured on
//! WebKitGTK 2.54). The page then runs above the desktop shell and the
//! compositor (nice 0) and starves them while it is busy. WebKitGTK has no
//! switch for it, so a watcher puts those threads back at nice 0. Raising the
//! nice value of one's own processes needs no privilege.
//!
//! Only `SCHED_OTHER` threads below nice 0 are touched: realtime threads RTKit
//! may grant for audio (`SCHED_RR`/`SCHED_FIFO`) keep their policy, and
//! threads at nice >= 0 are left alone.

use std::path::Path;
use std::time::Duration;

/// `/proc/<pid>/comm` prefixes (comm is truncated to 15 bytes).
const WEBKIT_COMMS: &[&str] = &["WebKitWebProces", "WebKitNetworkPr"];

const SCHED_OTHER: u32 = 0;
const NORMAL_NICE: i32 = 0;

const FIRST_PASS_DELAY: Duration = Duration::from_secs(3);
const PASS_INTERVAL: Duration = Duration::from_secs(10);

/// Scheduling fields of one `/proc/<pid>/task/<tid>/stat` line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ThreadSched {
    pub nice: i32,
    pub policy: u32,
}

/// Fields after the `)` that closes the comm: index 0 is field 3 (state).
const PPID_INDEX: usize = 4 - 3;
const NICE_INDEX: usize = 19 - 3;
const POLICY_INDEX: usize = 41 - 3;

pub fn install() {
    let spawned = std::thread::Builder::new()
        .name("crate-webkit-priority".into())
        .spawn(|| {
            std::thread::sleep(FIRST_PASS_DELAY);
            loop {
                normalize_webkit_children(std::process::id());
                std::thread::sleep(PASS_INTERVAL);
            }
        });
    if let Err(err) = spawned {
        debug_log(format_args!(
            "failed to start the WebKit priority watcher: {err}"
        ));
    }
}

/// Comm (between the first `(` and the last `)`) and the fields after it.
fn split_stat(stat: &str) -> Option<(&str, Vec<&str>)> {
    let open = stat.find('(')?;
    let close = stat.rfind(')')?;
    if close < open {
        return None;
    }
    let comm = &stat[open + 1..close];
    let rest = stat[close + 1..].split_whitespace().collect();
    Some((comm, rest))
}

/// Nice value and scheduling policy of a thread, or `None` when the line is
/// malformed. The comm may hold spaces and parentheses ("Core: Scrolling"),
/// so fields are counted after its closing `)`.
pub fn parse_thread_sched(stat: &str) -> Option<ThreadSched> {
    let (_, fields) = split_stat(stat)?;
    let nice = fields.get(NICE_INDEX)?.parse().ok()?;
    let policy = fields.get(POLICY_INDEX)?.parse().ok()?;
    Some(ThreadSched { nice, policy })
}

/// Comm and parent pid of a process.
pub fn parse_process(stat: &str) -> Option<(String, u32)> {
    let (comm, fields) = split_stat(stat)?;
    let ppid = fields.get(PPID_INDEX)?.parse().ok()?;
    Some((comm.to_owned(), ppid))
}

pub fn is_webkit_child(comm: &str) -> bool {
    WEBKIT_COMMS.iter().any(|prefix| comm.starts_with(prefix))
}

pub fn should_renice(sched: ThreadSched) -> bool {
    sched.policy == SCHED_OTHER && sched.nice < NORMAL_NICE
}

/// Threads to put back at nice 0, from `(tid, stat line)` pairs. Malformed
/// lines are skipped.
pub fn threads_to_renice<'a>(threads: impl IntoIterator<Item = (u32, &'a str)>) -> Vec<u32> {
    threads
        .into_iter()
        .filter(|(_, stat)| parse_thread_sched(stat).is_some_and(should_renice))
        .map(|(tid, _)| tid)
        .collect()
}

/// WebKit processes among the descendants of `root`, from
/// `(pid, comm, ppid)` rows of every process. WebKitGTK may start them under
/// a sandbox helper (bwrap), so they are not always direct children.
pub fn webkit_descendants(processes: &[(u32, String, u32)], root: u32) -> Vec<u32> {
    let mut ancestors = vec![root];
    let mut found = Vec::new();
    let mut index = 0;
    while let Some(&parent) = ancestors.get(index) {
        index += 1;
        for (pid, comm, ppid) in processes {
            if *ppid != parent || *pid == root || ancestors.contains(pid) {
                continue;
            }
            ancestors.push(*pid);
            if is_webkit_child(comm) {
                found.push(*pid);
            }
        }
    }
    found
}

fn normalize_webkit_children(root: u32) {
    let processes = match list_processes() {
        Ok(processes) => processes,
        Err(err) => {
            debug_log(format_args!("cannot list /proc: {err}"));
            return;
        }
    };
    for pid in webkit_descendants(&processes, root) {
        let task_dir = format!("/proc/{pid}/task");
        let stats: Vec<(u32, String)> = numeric_entries(Path::new(&task_dir))
            .into_iter()
            .filter_map(|tid| {
                let stat = std::fs::read_to_string(format!("{task_dir}/{tid}/stat")).ok()?;
                Some((tid, stat))
            })
            .collect();
        let pending = threads_to_renice(stats.iter().map(|(tid, stat)| (*tid, stat.as_str())));
        for tid in pending {
            renice(tid);
        }
    }
}

fn list_processes() -> std::io::Result<Vec<(u32, String, u32)>> {
    std::fs::metadata("/proc")?;
    Ok(numeric_entries(Path::new("/proc"))
        .into_iter()
        .filter_map(|pid| {
            let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
            let (comm, ppid) = parse_process(&stat)?;
            Some((pid, comm, ppid))
        })
        .collect())
}

fn numeric_entries(dir: &Path) -> Vec<u32> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .filter_map(|entry| entry.ok()?.file_name().to_str()?.parse().ok())
        .collect()
}

fn renice(tid: u32) {
    // On Linux, PRIO_PROCESS with a thread id sets that thread's nice value.
    // SAFETY: setpriority takes plain integers and touches no memory.
    let result = unsafe { libc::setpriority(libc::PRIO_PROCESS as _, tid as _, NORMAL_NICE) };
    if result != 0 {
        debug_log(format_args!(
            "cannot renice WebKit thread {tid}: {}",
            std::io::Error::last_os_error()
        ));
    }
}

fn debug_log(message: std::fmt::Arguments<'_>) {
    if cfg!(debug_assertions) {
        eprintln!("{message}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real `/proc/<pid>/task/<tid>/stat` line with nice and policy swapped in.
    fn stat_line(comm: &str, nice: i32, policy: u32) -> String {
        format!(
            "4242 ({comm}) S 4200 4242 4242 0 -1 4194560 135 0 0 0 7 3 0 0 {prio} {nice} 30 0 \
             5414242 9289728 597 18446744073709551615 1 1 0 0 0 0 0 4096 0 0 0 0 17 6 {rt} {policy} \
             0 0 0 0 0 0 0 0 0 0 0",
            prio = 20 + nice,
            rt = if policy == SCHED_OTHER { 0 } else { 10 },
        )
    }

    #[test]
    fn parses_nice_and_policy_after_the_comm() {
        let cases = [
            ("WebKitWebProces", -15, 0),
            ("Core: Scrolling", -15, 0),
            ("EventDispatcher", 0, 0),
            ("odd) (comm", 5, 0),
            ("AudioThread", 0, 2),
        ];
        for (comm, nice, policy) in cases {
            assert_eq!(
                parse_thread_sched(&stat_line(comm, nice, policy)),
                Some(ThreadSched { nice, policy }),
                "{comm}"
            );
        }
    }

    #[test]
    fn decides_which_threads_to_renice() {
        let cases: &[(&str, String, bool)] = &[
            ("negative nice", stat_line("WebKitWebProces", -15, 0), true),
            (
                "slightly negative",
                stat_line("EventDispatcher", -1, 0),
                true,
            ),
            ("nice 0", stat_line("WebKitWebProces", 0, 0), false),
            ("positive nice", stat_line("Core: Scrolling", 10, 0), false),
            ("SCHED_FIFO", stat_line("AudioThread", -15, 1), false),
            ("SCHED_RR", stat_line("AudioThread", -15, 2), false),
            ("SCHED_BATCH", stat_line("Worker", -5, 3), false),
            (
                "no closing paren",
                "4242 (WebKitWebProces S 1 2 3".into(),
                false,
            ),
            (
                "truncated",
                "4242 (WebKitWebProces) S 4200 4242".into(),
                false,
            ),
            (
                "non-numeric nice",
                stat_line("WebKitWebProces", -15, 0).replace(" -15 ", " x "),
                false,
            ),
            ("empty", String::new(), false),
        ];
        for (name, stat, expected) in cases {
            let picked = threads_to_renice([(7, stat.as_str())]);
            assert_eq!(picked == vec![7], *expected, "{name}");
        }
    }

    #[test]
    fn keeps_the_tids_of_threads_to_renice() {
        let main = stat_line("WebKitWebProces", -15, 0);
        let worker = stat_line("JSC Heap Collec", 0, 0);
        let scrolling = stat_line("Core: Scrolling", -15, 0);
        let audio = stat_line("AudioThread", -11, 2);
        let picked = threads_to_renice([
            (100, main.as_str()),
            (101, worker.as_str()),
            (102, scrolling.as_str()),
            (103, audio.as_str()),
        ]);
        assert_eq!(picked, vec![100, 102]);
    }

    #[test]
    fn matches_truncated_webkit_comms_only() {
        let cases = [
            ("WebKitWebProces", true),
            ("WebKitNetworkPr", true),
            ("WebKitGPUProces", false),
            ("crate-desktop", false),
            ("webkitwebproces", false),
            ("", false),
        ];
        for (comm, expected) in cases {
            assert_eq!(is_webkit_child(comm), expected, "{comm}");
        }
    }

    #[test]
    fn parses_comm_and_parent_pid() {
        assert_eq!(
            parse_process(&stat_line("WebKitWebProces", -15, 0)),
            Some(("WebKitWebProces".to_owned(), 4200))
        );
        assert_eq!(parse_process("4242 (bwrap"), None);
    }

    #[test]
    fn finds_webkit_descendants_through_sandbox_helpers_only() {
        let row = |pid: u32, comm: &str, ppid: u32| (pid, comm.to_owned(), ppid);
        let processes = vec![
            row(10, "crate-desktop", 1),
            row(11, "WebKitNetworkPr", 10),
            row(12, "bwrap", 10),
            row(13, "WebKitWebProces", 12),
            row(14, "xdg-dbus-proxy", 12),
            // Another app's web process is not ours.
            row(20, "epiphany", 1),
            row(21, "WebKitWebProces", 20),
        ];
        let mut found = webkit_descendants(&processes, 10);
        found.sort_unstable();
        assert_eq!(found, vec![11, 13]);
        assert!(webkit_descendants(&processes, 99).is_empty());
    }
}
