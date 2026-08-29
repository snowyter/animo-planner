//! The campus and academic session options of Archer's Hub — the single
//! source of these names in the app (ticket 25), plus the reserved scope of
//! the bundled sample data (ticket 27).
//!
//! SPEC §2 verified the dropdown values; every other surface that needs a
//! campus or session *name* (`get_campus_options`, `get_session_options`,
//! plan summaries) reads them from here, so no second copy can drift.
//! Lookups are total over the offered options *and* the reserved ids; an id
//! outside both is a loud error at the call site, never an invented name.
//!
//! **The sample-data feature these ids were reserved for is gone.** The ids
//! stay reserved and still resolve to names, because migration 5 relocates
//! legacy rows into them before migration 6 deletes those rows, and because
//! `create_plan` refuses them by name. Nothing writes here any more.

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

/// The reserved campus id, formerly the bundled sample data's (ticket 27).
///
/// Deliberately negative: SPEC §2 verified the site's dropdown ids are
/// positive integers, so nothing captured from Archer's Hub can ever land
/// in this scope, and — because [`is_offered_campus`] rejects it —
/// `create_plan` can never produce a plan in it. Isolation is structural,
/// with no filter to forget.
pub const SAMPLE_CAMPUS_ID: i64 = -1;

/// The reserved session id, formerly the bundled sample data's (ticket 27). See
/// [`SAMPLE_CAMPUS_ID`] for why it must stay outside every real id space.
pub const SAMPLE_SESSION_ID: i64 = -2;

const SAMPLE_CAMPUS_NAME: &str = "Sample Campus";
const SAMPLE_SESSION_NAME: &str = "Sample Term";

/// The name of a campus id, or `None` when the id is neither one of the
/// offered options nor the reserved sample id. `const` so compile-time
/// constants can derive from it. The reserved id resolves to an explicitly
/// sample-flavoured name so the sample plan renders its scope honestly,
/// without UI special-casing (ticket 27).
pub const fn campus_name(campus_id: i64) -> Option<&'static str> {
    if campus_id == SAMPLE_CAMPUS_ID {
        return Some(SAMPLE_CAMPUS_NAME);
    }
    let mut index = 0;
    while index < CAMPUS_OPTIONS.len() {
        if CAMPUS_OPTIONS[index].0 == campus_id {
            return Some(CAMPUS_OPTIONS[index].1);
        }
        index += 1;
    }
    None
}

/// The name of an academic session id, or `None` when the id is neither one
/// of the offered options nor the reserved sample id. See [`campus_name`].
pub const fn session_name(session_id: i64) -> Option<&'static str> {
    if session_id == SAMPLE_SESSION_ID {
        return Some(SAMPLE_SESSION_NAME);
    }
    let mut index = 0;
    while index < SESSION_OPTIONS.len() {
        if SESSION_OPTIONS[index].0 == session_id {
            return Some(SESSION_OPTIONS[index].1);
        }
        index += 1;
    }
    None
}

/// Whether the campus id is one the app offers for real plans. The reserved
/// sample id is `false` here, so plan creation can never target the sample
/// scope (ticket 27) even though [`campus_name`] can name it.
pub const fn is_offered_campus(campus_id: i64) -> bool {
    let mut index = 0;
    while index < CAMPUS_OPTIONS.len() {
        if CAMPUS_OPTIONS[index].0 == campus_id {
            return true;
        }
        index += 1;
    }
    false
}

/// Whether the session id is one the app offers for real plans. See
/// [`is_offered_campus`].
pub const fn is_offered_session(session_id: i64) -> bool {
    let mut index = 0;
    while index < SESSION_OPTIONS.len() {
        if SESSION_OPTIONS[index].0 == session_id {
            return true;
        }
        index += 1;
    }
    false
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
    fn the_ids_around_the_offered_terms_have_no_invented_names() {
        // A session id is a value the site hands out, never a position in a
        // sequence. AY2026-27 runs 155/156/157, which reads like an unbroken
        // three-per-year run and invites extrapolating the neighbouring
        // years from it. The site does not oblige: 144 is `Annual`, and 161
        // — the id that arithmetic assigns AY2028-29 T1 — is `SHS`.
        //
        // That is what makes the shortcut dangerous rather than merely
        // wrong. An invented id that lands on nothing is caught here; one
        // that lands on `SHS` is an *offered* session, so it satisfies
        // `is_offered_session`, resolves to a real name, and scopes a plan
        // to the wrong catalog with nothing anywhere to flag it.
        assert_eq!(session_name(154), None, "AY2025-26 T3 by arithmetic");
        assert_eq!(session_name(158), None, "AY2027-28 T1 by arithmetic");
        assert_eq!(session_name(162), None);
        assert_eq!(
            session_name(161),
            Some("SHS"),
            "the id arithmetic hands AY2028-29 T1 is a session in its own right"
        );
        for id in [149, 152, 154, 158, 159, 160, 162, 167] {
            assert!(
                !is_offered_session(id),
                "{id} is not an offered session and must never be plannable"
            );
        }
    }

    #[test]
    fn reserved_sample_ids_resolve_to_explicitly_sample_flavoured_names() {
        // Ticket 27: the sample data lives under reserved ids that are not
        // Archer's Hub ids. The generic lookups must name them honestly, so
        // the sample plan renders its scope without UI special-casing.
        assert_eq!(
            campus_name(SAMPLE_CAMPUS_ID),
            Some("Sample Campus"),
            "the reserved campus id must not read as a real campus"
        );
        assert_eq!(
            session_name(SAMPLE_SESSION_ID),
            Some("Sample Term"),
            "the reserved session id must not read as a real term"
        );
    }

    #[test]
    fn the_reserved_sample_ids_are_absent_from_every_offered_option_table() {
        // Ticket 27: nothing captured from the live site can land in the
        // sample scope, and create_plan can never target it, because the
        // reserved ids sit outside both option tables...
        assert!(!CAMPUS_OPTIONS.iter().any(|(id, _)| *id == SAMPLE_CAMPUS_ID));
        assert!(!SESSION_OPTIONS.iter().any(|(id, _)| *id == SAMPLE_SESSION_ID));
        // ...and outside every real Archer's Hub value (SPEC §2 verified
        // the site's ids are positive integers) — enforced at compile time.
        const {
            assert!(SAMPLE_CAMPUS_ID < 0, "the reserved campus id must not collide with a real id");
            assert!(
                SAMPLE_SESSION_ID < 0,
                "the reserved session id must not collide with a real id"
            );
            assert!(
                SAMPLE_CAMPUS_ID != SAMPLE_SESSION_ID,
                "the two reserved ids live in different id namespaces and must stay distinct"
            );
        }
        // Genuinely unknown ids still have no invented name.
        assert_eq!(campus_name(-2), None);
        assert_eq!(session_name(-999), None);
    }

    #[test]
    fn offered_lookups_accept_real_ids_and_reject_the_reserved_sample_ids() {
        for (id, _) in CAMPUS_OPTIONS {
            assert!(is_offered_campus(*id));
        }
        for (id, _) in SESSION_OPTIONS {
            assert!(is_offered_session(*id));
        }
        assert!(!is_offered_campus(SAMPLE_CAMPUS_ID), "plan creation must never target the sample scope");
        assert!(!is_offered_session(SAMPLE_SESSION_ID));
        assert!(!is_offered_campus(10));
        assert!(!is_offered_session(999));
    }

    #[test]
    fn real_scope_names_still_derive_from_the_shared_source() {
        assert_eq!(campus_name(7), Some("Manila"));
        assert_eq!(session_name(155), Some("AY2026-27 T1"));
    }
}
