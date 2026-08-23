//! The campus and academic session options of Archer's Hub — the single
//! source of these names in the app (ticket 25).
//!
//! SPEC §2 verified the dropdown values; every other surface that needs a
//! campus or session *name* (`get_campus_options`, `get_session_options`,
//! plan summaries, the sample-data seed) reads them from here, so no second
//! copy can drift. Lookups are total over the offered options; an id outside
//! them is a loud error at the call site, never an invented name.

/// The campus options exactly as SPEC §2 verified them:
/// Manila=7, Laguna=8, Rufino=9.
pub const CAMPUS_OPTIONS: &[(i64, &str)] = &[(7, "Manila"), (8, "Laguna"), (9, "Rufino")];

/// The academic session options exactly as SPEC §2 verified them:
/// AY2026-27 T1=155, T2=156, T3=157, Annual=144, SHS=161.
pub const SESSION_OPTIONS: &[(i64, &str)] = &[
    (155, "AY2026-27 T1"),
    (156, "AY2026-27 T2"),
    (157, "AY2026-27 T3"),
    (144, "Annual"),
    (161, "SHS"),
];

/// The name of a campus id, or `None` when the id is not one of the options
/// the app offers. `const` so compile-time constants can derive from it.
pub const fn campus_name(campus_id: i64) -> Option<&'static str> {
    let mut index = 0;
    while index < CAMPUS_OPTIONS.len() {
        if CAMPUS_OPTIONS[index].0 == campus_id {
            return Some(CAMPUS_OPTIONS[index].1);
        }
        index += 1;
    }
    None
}

/// The name of an academic session id, or `None` when the id is not one of
/// the options the app offers.
pub const fn session_name(session_id: i64) -> Option<&'static str> {
    let mut index = 0;
    while index < SESSION_OPTIONS.len() {
        if SESSION_OPTIONS[index].0 == session_id {
            return Some(SESSION_OPTIONS[index].1);
        }
        index += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn campus_options_match_the_verified_spec_values() {
        assert_eq!(
            CAMPUS_OPTIONS,
            &[(7, "Manila"), (8, "Laguna"), (9, "Rufino")],
            "SPEC §2: #ddlSelectCampus"
        );
    }

    #[test]
    fn session_options_match_the_verified_spec_values() {
        assert_eq!(
            SESSION_OPTIONS,
            &[
                (155, "AY2026-27 T1"),
                (156, "AY2026-27 T2"),
                (157, "AY2026-27 T3"),
                (144, "Annual"),
                (161, "SHS"),
            ],
            "SPEC §2: #ddlSelectAcadSession"
        );
    }

    #[test]
    fn lookups_resolve_every_offered_id_and_nothing_else() {
        for (id, name) in CAMPUS_OPTIONS {
            assert_eq!(campus_name(*id), Some(*name));
        }
        for (id, name) in SESSION_OPTIONS {
            assert_eq!(session_name(*id), Some(*name));
        }
        assert_eq!(campus_name(10), None, "no combined-campus option is offered");
        assert_eq!(session_name(999), None);
    }

    #[test]
    fn the_sample_scope_names_derive_from_the_shared_source() {
        // sample_data.rs must not hold its own copy of these names; its
        // constants are compiled from this module's lookup.
        assert_eq!(campus_name(7), Some("Manila"));
        assert_eq!(session_name(155), Some("AY2026-27 T1"));
    }
}
