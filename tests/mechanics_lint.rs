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

/// Scan a line for float numeric literals in every Rust surface form: an integer
/// part with optional `_` grouping, an optional `.fraction` (the fraction digits
/// may be empty — a trailing dot `2.`), and an optional `[eE][+-]?exponent`. A
/// token is a *float* only if it carries a fraction dot or an exponent (a bare
/// integer is not a coefficient). Underscores are stripped from the returned
/// literal before the caller's allowlist compare, so `1_000.5` normalizes to
/// `1000.5`. Tuple/field access (`w.1`), method calls chained on an int, and range
/// `..` are excluded so they never masquerade as literals.
fn float_literals(code: &str) -> Vec<String> {
    let b = code.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        // A literal starts at a digit that does not continue an identifier or follow
        // a `.` (which would make it the fraction/index of a prior token).
        let starts = b[i].is_ascii_digit()
            && !(i > 0
                && (b[i - 1].is_ascii_alphanumeric() || b[i - 1] == b'_' || b[i - 1] == b'.'));
        if !starts {
            i += 1;
            continue;
        }
        let start = i;
        // Integer part (digits + `_` grouping).
        while i < b.len() && (b[i].is_ascii_digit() || b[i] == b'_') {
            i += 1;
        }
        let mut is_float = false;
        // Fraction: a single `.` that is not a range `..` and not a method/field
        // access chained on the int (`.` followed by a letter or `_`).
        if i < b.len() && b[i] == b'.' {
            let after = b.get(i + 1).copied();
            let is_range = after == Some(b'.');
            let is_access = matches!(after, Some(c) if c.is_ascii_alphabetic() || c == b'_');
            if !is_range && !is_access {
                is_float = true;
                i += 1;
                while i < b.len() && (b[i].is_ascii_digit() || b[i] == b'_') {
                    i += 1;
                }
            }
        }
        // Exponent: [eE] [+-]? digit (digit | _)*.
        if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
            let mut j = i + 1;
            if j < b.len() && (b[j] == b'+' || b[j] == b'-') {
                j += 1;
            }
            if j < b.len() && b[j].is_ascii_digit() {
                is_float = true;
                i = j;
                while i < b.len() && (b[i].is_ascii_digit() || b[i] == b'_') {
                    i += 1;
                }
            }
        }
        if is_float {
            out.push(code[start..i].replace('_', ""));
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
    // Evasion forms are caught: scientific notation, trailing dot, and
    // underscore-grouped literals (underscores stripped before the compare).
    assert_eq!(float_literals("let a = 1e-2;"), vec!["1e-2".to_string()]);
    assert_eq!(float_literals("let b = 2.;"), vec!["2.".to_string()]);
    assert_eq!(
        float_literals("let c = 1_000.5;"),
        vec!["1000.5".to_string()]
    );
    assert_eq!(
        float_literals("let d = 6.02E23;"),
        vec!["6.02E23".to_string()]
    );
    // Ranges and field access are not literals.
    assert_eq!(
        float_literals("for t in 0..horizon { w.1 }"),
        Vec::<String>::new()
    );
}
