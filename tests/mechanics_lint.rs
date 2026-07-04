//! `src/mechanics/` numeric-literal lint (PLAN P3 gate, owned here).
//!
//! Every model coefficient must be read from `params.json` by id — a bare float
//! literal in the mechanics is a smuggled coefficient (S1/S5). Only the
//! structural identities below are allowed; anything else fails. Comments and
//! the `#[cfg(test)]` module (legitimately full of expected values) are excluded.

use std::path::Path;

/// Structural float identities the mechanics may spell out directly:
/// clamp/identity bounds, the pairwise-channel /2 and triangular-mean /3, the
/// SH→misalignment (7−SH)/9 scale, the /10 cohesion-coupling normalizer, and the
/// ×100 index scaling. NOT model coefficients (those all come from params.json).
const ALLOWED: &[&str] = &["0.0", "1.0", "2.0", "3.0", "7.0", "9.0", "10.0", "100.0"];

fn float_literals(code: &str) -> Vec<String> {
    let b = code.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if b[i].is_ascii_digit() {
            let prev_joins =
                i > 0 && (b[i - 1].is_ascii_alphanumeric() || b[i - 1] == b'_' || b[i - 1] == b'.');
            let start = i;
            while i < b.len() && b[i].is_ascii_digit() {
                i += 1;
            }
            if i + 1 < b.len() && b[i] == b'.' && b[i + 1].is_ascii_digit() {
                i += 1;
                while i < b.len() && b[i].is_ascii_digit() {
                    i += 1;
                }
                if !prev_joins {
                    out.push(code[start..i].to_string());
                }
            }
        } else {
            i += 1;
        }
    }
    out
}

/// Strip a trailing `//` line comment (mechanics has no `//` inside strings).
fn strip_comment(line: &str) -> &str {
    match line.find("//") {
        Some(idx) => &line[..idx],
        None => line,
    }
}

fn lint_file(path: &Path) {
    let src = std::fs::read_to_string(path).unwrap();
    // Exclude the test module (expected values are not coefficients).
    let code = match src.find("#[cfg(test)]") {
        Some(idx) => &src[..idx],
        None => &src[..],
    };
    for (n, line) in code.lines().enumerate() {
        for lit in float_literals(strip_comment(line)) {
            assert!(
                ALLOWED.contains(&lit.as_str()),
                "{}:{}: bare float coefficient `{lit}` in src/mechanics/ — read it from params.json (or add a documented structural identity to the allowlist)\n  {line}",
                path.display(),
                n + 1
            );
        }
    }
}

#[test]
fn mechanics_has_no_bare_coefficient_literals() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/mechanics");
    let mut linted = 0;
    for entry in std::fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().map(|e| e == "rs").unwrap_or(false) {
            lint_file(&path);
            linted += 1;
        }
    }
    assert!(linted >= 2, "expected to lint mechanics/mod.rs and org.rs");
}

#[test]
fn lint_scanner_self_check() {
    // Sanity: the scanner finds real floats, skips ints and tuple access.
    let found = float_literals("let x = 0.036 * a[0] + w.1 - 2;");
    assert_eq!(found, vec!["0.036".to_string()]);
}
