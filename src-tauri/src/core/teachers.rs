//! Teacher identity — the normalized key a preference is keyed on.
//!
//! A teacher is the person named on a snapshot. The **teacher key** is the
//! normalized form of that name — trimmed, case-folded, inner whitespace
//! collapsed — and the only thing a ranking is ever keyed on. The verbatim
//! name is preserved for display; the key is what gets compared, so a change
//! in the site's capitalisation never splits one teacher into two.
//!
//! A blank or whitespace-only name has no key (`None`). This is the hinge of
//! the whole feature: unknown is not an identity, so it can never be ranked,
//! never be avoided, and never be matched.
//!
//! Deliberately not solved here: `"Lee, Bryant"` vs `"Bryant Lee"`, and
//! `"B. Lee"` vs `"Bryant Lee"`. Those are the same human and will produce
//! different keys. Do not attempt name parsing — a wrong merge is worse than
//! two entries, and the student can rank both.

/// Produces the normalized teacher key for a name, or `None` when the name
/// is blank or whitespace-only.
///
/// Normalization: trim, case-fold (Unicode), collapse inner whitespace runs
/// to a single space. `"  BRYANT   lee "` and `"Bryant Lee"` produce the
/// same key.
pub fn teacher_key(name: &str) -> Option<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut collapsed = String::with_capacity(trimmed.len());
    let mut prev_was_space = false;
    for ch in trimmed.chars() {
        if ch.is_whitespace() {
            if !prev_was_space {
                collapsed.push(' ');
            }
            prev_was_space = true;
        } else {
            for folded in ch.to_lowercase() {
                collapsed.push(folded);
            }
            prev_was_space = false;
        }
    }
    Some(collapsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_normal_name_produces_a_lowercased_key() {
        assert_eq!(teacher_key("Bryant Lee"), Some("bryant lee".into()));
    }

    #[test]
    fn leading_and_trailing_whitespace_is_trimmed() {
        assert_eq!(teacher_key("  Bryant Lee  "), Some("bryant lee".into()));
    }

    #[test]
    fn inner_whitespace_runs_are_collapsed_to_one_space() {
        assert_eq!(
            teacher_key("  BRYANT   lee "),
            Some("bryant lee".into()),
        );
    }

    #[test]
    fn casing_diffences_are_folded_away() {
        assert_eq!(
            teacher_key("BRYANT LEE"),
            teacher_key("bryant lee"),
        );
        assert_eq!(
            teacher_key("Bryant Lee"),
            teacher_key("bryant lee"),
        );
    }

    #[test]
    fn a_blank_name_has_no_key() {
        assert_eq!(teacher_key(""), None);
    }

    #[test]
    fn a_whitespace_only_name_has_no_key() {
        assert_eq!(teacher_key("   "), None);
    }

    #[test]
    fn a_tab_only_name_has_no_key() {
        assert_eq!(teacher_key("\t"), None);
    }

    #[test]
    fn names_that_are_one_human_still_produce_different_keys() {
        // "Lee, Bryant" vs "Bryant Lee" — same person, different keys.
        // A wrong merge is worse than two entries (module doc).
        let a = teacher_key("Lee, Bryant");
        let b = teacher_key("Bryant Lee");
        assert!(a.is_some());
        assert!(b.is_some());
        assert_ne!(a, b, "different spellings must not merge");
    }

    #[test]
    fn abbreviated_and_full_names_produce_different_keys() {
        // "B. Lee" vs "Bryant Lee" — same human, different keys.
        let a = teacher_key("B. Lee");
        let b = teacher_key("Bryant Lee");
        assert!(a.is_some());
        assert!(b.is_some());
        assert_ne!(a, b, "abbreviated and full names must not merge");
    }
}
