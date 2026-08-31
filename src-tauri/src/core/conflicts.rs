//! Conflict detection over a plan's schedule blocks.
//!
//! A conflict is two schedule blocks belonging to different sections that
//! overlap in time on the same day. Conflict is a query over a plan, never a
//! constraint on membership (ADR-0009): adding an overlapping section always
//! succeeds, and this module is what reports the overlap afterwards.
//!
//! Detection works per block, not per section (ADR-0007): a hybrid section
//! conflicts only on the day that actually overlaps, and a section can never
//! conflict with itself. Only day and times participate in overlap; location
//! and modality are display concerns and never branch the result.

use crate::core::ipc_types::{Conflict, Day, SectionRef};

/// The part of a schedule block that participates in overlap: day and times.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedBlock {
    pub day: Day,
    pub start_min: i64,
    pub end_min: i64,
}

/// A section as planned: its identity and its schedule blocks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedSection {
    pub course_id: i64,
    pub section_id: i64,
    pub blocks: Vec<PlannedBlock>,
}

/// Returns every overlapping block pair across the given plan sections.
///
/// Two blocks overlap when they share a day and their time ranges intersect
/// with positive length; blocks that merely touch (`a.end == b.start`) are
/// clear. A section is never compared with itself: pairs sharing a course
/// and section id are skipped, so a section passed twice — or one whose own
/// blocks overlap — cannot conflict with itself. Sections are visited in
/// order and blocks in order, so the output is deterministic.
///
/// The store's fold cannot hand this scanner a split section (its query
/// orders by `s.course_id, s.section_id, b.id` and `sections` carries
/// `UNIQUE (campus_id, session_id, course_id, section_id)`), so the skip
/// below is a second line of defence, matching the guard `findConflicts`
/// has always had in `src/core/conflicts.ts`.
pub fn find_conflicts(sections: &[PlannedSection]) -> Vec<Conflict> {
    let mut conflicts = Vec::new();
    for (i, first) in sections.iter().enumerate() {
        for second in &sections[i + 1..] {
            if first.course_id == second.course_id && first.section_id == second.section_id {
                continue;
            }
            for block_a in &first.blocks {
                for block_b in &second.blocks {
                    if block_a.day != block_b.day {
                        continue;
                    }
                    let start_min = block_a.start_min.max(block_b.start_min);
                    let end_min = block_a.end_min.min(block_b.end_min);
                    if start_min >= end_min {
                        continue;
                    }
                    conflicts.push(Conflict {
                        a: SectionRef {
                            course_id: first.course_id,
                            section_id: first.section_id,
                        },
                        b: SectionRef {
                            course_id: second.course_id,
                            section_id: second.section_id,
                        },
                        day: block_a.day,
                        start_min,
                        end_min,
                    });
                }
            }
        }
    }
    conflicts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(day: Day, start_min: i64, end_min: i64) -> PlannedBlock {
        PlannedBlock {
            day,
            start_min,
            end_min,
        }
    }

    fn planned(course_id: i64, section_id: i64, blocks: Vec<PlannedBlock>) -> PlannedSection {
        PlannedSection {
            course_id,
            section_id,
            blocks,
        }
    }

    fn ref_(course_id: i64, section_id: i64) -> SectionRef {
        SectionRef {
            course_id,
            section_id,
        }
    }

    #[test]
    fn an_empty_plan_has_no_conflicts() {
        assert!(find_conflicts(&[]).is_empty());
    }

    #[test]
    fn a_plan_without_overlapping_blocks_has_no_conflicts() {
        let sections = vec![
            planned(2923, 384, vec![block(Day::Mon, 450, 540), block(Day::Thu, 450, 540)]),
            planned(564, 737, vec![block(Day::Tue, 450, 540), block(Day::Fri, 450, 540)]),
            planned(564, 738, vec![block(Day::Mon, 600, 690)]),
        ];
        assert!(find_conflicts(&sections).is_empty());
    }

    #[test]
    fn two_sections_overlapping_on_one_day_of_two_report_exactly_that_block() {
        let sections = vec![
            planned(2923, 384, vec![block(Day::Mon, 450, 540), block(Day::Thu, 450, 540)]),
            planned(564, 737, vec![block(Day::Mon, 480, 570), block(Day::Fri, 480, 570)]),
        ];
        assert_eq!(
            find_conflicts(&sections),
            vec![Conflict {
                a: ref_(2923, 384),
                b: ref_(564, 737),
                day: Day::Mon,
                start_min: 480,
                end_min: 540,
            }],
            "the overlap is on Monday only; Thursday and Friday are clear"
        );
    }

    #[test]
    fn back_to_back_blocks_that_touch_are_clear() {
        let sections = vec![
            planned(2923, 384, vec![block(Day::Mon, 450, 540)]),
            planned(564, 737, vec![block(Day::Mon, 540, 630)]),
        ];
        assert!(
            find_conflicts(&sections).is_empty(),
            "a 15-minute break between blocks is not a conflict"
        );
    }

    #[test]
    fn a_section_cannot_conflict_with_itself() {
        let sections = vec![planned(2923, 384, vec![
            block(Day::Mon, 450, 540),
            // Its own second Monday block overlaps the first; self-pairs are
            // never compared.
            block(Day::Mon, 480, 570),
            block(Day::Thu, 450, 540),
        ])];
        assert!(find_conflicts(&sections).is_empty());
    }

    #[test]
    fn the_same_section_passed_twice_never_conflicts_with_itself() {
        // The duplicate-section input: the store's UNIQUE constraint keeps a
        // plan to one row per section, but the scanner must not manufacture
        // a conflict if that ever changes. `findConflicts` in
        // src/core/conflicts.ts returns no conflict for this input; the
        // shared fixture pins that both sides agree.
        let sections = vec![
            planned(2923, 384, vec![block(Day::Mon, 450, 540)]),
            planned(2923, 384, vec![block(Day::Mon, 450, 540)]),
        ];
        assert!(find_conflicts(&sections).is_empty());
    }

    // ---------- agreement with the TypeScript scanner (ticket 51) ----------

    /// The shared contract with `src/core/conflicts.ts`: the same planned
    /// sections through both scanners must produce the same conflicts in
    /// the same order. The fixture's `description` names what the set
    /// covers, including the duplicate-section input.
    #[test]
    fn the_shared_fixture_holds_for_the_rust_scanner() {
        let fixture = include_str!("../../tests/fixtures/conflict-agreement.json");
        let parsed: serde_json::Value = serde_json::from_str(fixture).expect("valid fixture json");

        let sections: Vec<PlannedSection> = parsed["sections"]
            .as_array()
            .expect("sections array")
            .iter()
            .map(|section| PlannedSection {
                course_id: section["courseId"].as_i64().expect("courseId"),
                section_id: section["sectionId"].as_i64().expect("sectionId"),
                blocks: section["blocks"]
                    .as_array()
                    .expect("blocks array")
                    .iter()
                    .map(|block| PlannedBlock {
                        day: day_from_fixture(block["day"].as_str().expect("day")),
                        start_min: block["startMin"].as_i64().expect("startMin"),
                        end_min: block["endMin"].as_i64().expect("endMin"),
                    })
                    .collect(),
            })
            .collect();

        let expected: Vec<ExpectedConflict> = parsed["expectedConflicts"]
            .as_array()
            .expect("expectedConflicts array")
            .iter()
            .map(|conflict| ExpectedConflict {
                a_course_id: conflict["aCourseId"].as_i64().expect("aCourseId"),
                a_section_id: conflict["aSectionId"].as_i64().expect("aSectionId"),
                b_course_id: conflict["bCourseId"].as_i64().expect("bCourseId"),
                b_section_id: conflict["bSectionId"].as_i64().expect("bSectionId"),
                day: day_from_fixture(conflict["day"].as_str().expect("day")),
                start_min: conflict["startMin"].as_i64().expect("startMin"),
                end_min: conflict["endMin"].as_i64().expect("endMin"),
            })
            .collect();

        let actual = find_conflicts(&sections);
        assert_eq!(
            actual.len(),
            expected.len(),
            "conflict count must agree: {actual:?}"
        );
        for (actual, expected) in actual.iter().zip(&expected) {
            assert_eq!(
                actual.a.course_id, expected.a_course_id,
                "a.courseId, day {:?}",
                actual.day
            );
            assert_eq!(actual.a.section_id, expected.a_section_id, "a.sectionId");
            assert_eq!(actual.b.course_id, expected.b_course_id, "b.courseId");
            assert_eq!(actual.b.section_id, expected.b_section_id, "b.sectionId");
            assert_eq!(actual.day, expected.day, "day");
            assert_eq!(actual.start_min, expected.start_min, "startMin");
            assert_eq!(actual.end_min, expected.end_min, "endMin");
        }
    }

    struct ExpectedConflict {
        a_course_id: i64,
        a_section_id: i64,
        b_course_id: i64,
        b_section_id: i64,
        day: Day,
        start_min: i64,
        end_min: i64,
    }

    fn day_from_fixture(day: &str) -> Day {
        match day {
            "MON" => Day::Mon,
            "TUE" => Day::Tue,
            "WED" => Day::Wed,
            "THU" => Day::Thu,
            "FRI" => Day::Fri,
            "SAT" => Day::Sat,
            other => panic!("unknown fixture day {other}"),
        }
    }

    #[test]
    fn hybrid_sections_conflict_only_on_the_day_that_actually_overlaps() {
        let sections = vec![
            planned(2923, 384, vec![block(Day::Tue, 450, 540), block(Day::Fri, 450, 540)]),
            planned(564, 737, vec![block(Day::Fri, 480, 570), block(Day::Sat, 450, 540)]),
        ];
        assert_eq!(
            find_conflicts(&sections),
            vec![Conflict {
                a: ref_(2923, 384),
                b: ref_(564, 737),
                day: Day::Fri,
                start_min: 480,
                end_min: 540,
            }],
            "conflict is per block: Tuesday and Saturday do not clash"
        );
    }

    #[test]
    fn the_reported_range_is_the_intersection_of_the_two_blocks() {
        let cases = vec![
            // Partial overlap.
            ((450, 540), (480, 570), (480, 540)),
            // Full containment.
            ((450, 600), (480, 540), (480, 540)),
        ];
        for ((a_start, a_end), (b_start, b_end), (start, end)) in cases {
            let sections = vec![
                planned(1, 10, vec![block(Day::Wed, a_start, a_end)]),
                planned(2, 20, vec![block(Day::Wed, b_start, b_end)]),
            ];
            assert_eq!(
                find_conflicts(&sections),
                vec![Conflict {
                    a: ref_(1, 10),
                    b: ref_(2, 20),
                    day: Day::Wed,
                    start_min: start,
                    end_min: end,
                }]
            );
        }
    }

    #[test]
    fn each_overlapping_pair_is_reported_exactly_once() {
        let sections = vec![
            planned(1, 10, vec![block(Day::Mon, 450, 540)]),
            planned(2, 20, vec![block(Day::Mon, 480, 600)]),
            planned(3, 30, vec![block(Day::Mon, 570, 660)]),
        ];
        let conflicts = find_conflicts(&sections);
        assert_eq!(conflicts.len(), 2, "1-2 and 2-3 clash; 1-3 does not");
        assert!(conflicts.contains(&Conflict {
            a: ref_(1, 10),
            b: ref_(2, 20),
            day: Day::Mon,
            start_min: 480,
            end_min: 540,
        }));
        assert!(conflicts.contains(&Conflict {
            a: ref_(2, 20),
            b: ref_(3, 30),
            day: Day::Mon,
            start_min: 570,
            end_min: 600,
        }));
    }
}
