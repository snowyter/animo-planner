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
/// clear. A section is never compared with itself, so it cannot conflict
/// with itself. Sections are visited in order and blocks in order, so the
/// output is deterministic.
pub fn find_conflicts(sections: &[PlannedSection]) -> Vec<Conflict> {
    let mut conflicts = Vec::new();
    for (i, first) in sections.iter().enumerate() {
        for second in &sections[i + 1..] {
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
