//! Preset scoring and transition warnings for solved plans (ticket 15).
//!
//! One analysis pass walks a plan's schedule blocks once — sorted by day and
//! time — and produces both the per-preset score components and the advisory
//! transition warnings. A result is never walked twice (ADR-0010: ranking is
//! a scoring pass over surviving assignments).
//!
//! Warnings are advisory: they attach to solve results and, through
//! [`transition_warnings`], to the current plan alike, and they never filter
//! anything out. Constraints filter; warnings do not.
//!
//! Rules encoded here:
//! - A campus day is a day carrying at least one F2F block, counted per
//!   block (ADR-0007): a hybrid section puts the student on campus only on
//!   its F2F day.
//! - A lone F2F day is a day whose only campus commitment is a single
//!   90-minute class — online blocks are not a campus commitment.
//! - Back-to-back means the next block starts within 15 minutes of the
//!   previous one ending (the standard break between lattice slots),
//!   including touching. Overlapping blocks are conflict territory, not
//!   transitions.
//! - A building is the leading alphabetic run of a room code, uppercased
//!   (`J112` → `J`). A warning is only raised when both buildings are
//!   derivable and differ — an underivable building is never "different".

use crate::core::ipc_types::{
    BlockModality, Day, Preset, ScoreComponent, SectionRef, SolutionSection, TransitionWarning,
    WarningKind,
};
use serde::{Deserialize, Serialize};

/// The result of one evaluation pass: a total score, the components that sum
/// to it, and the advisory warnings found in the same walk.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Evaluation {
    pub score: f64,
    pub breakdown: Vec<ScoreComponent>,
    pub warnings: Vec<TransitionWarning>,
}

/// The gap, in minutes, at or below which two consecutive blocks on the same
/// day count as back-to-back: the standard 15-minute break between lattice
/// slots. Touching blocks (gap 0) are back-to-back too.
const BACK_TO_BACK_GAP_MIN: i64 = 15;

/// The observed class length: what makes a lone F2F block a lone
/// *90-minute* class rather than some other single commitment.
const CLASS_LENGTH_MIN: i64 = 90;

/// Weight of the lone-F2F-day penalty, applied under every preset. Small
/// enough that no preset's primary objective is ever overturned by it.
const LONE_F2F_DAY_WEIGHT: f64 = 0.1;

/// Index of a day within the Mon–Sat week, for ordering and tallies.
pub(crate) fn day_index(day: Day) -> usize {
    match day {
        Day::Mon => 0,
        Day::Tue => 1,
        Day::Wed => 2,
        Day::Thu => 3,
        Day::Fri => 4,
        Day::Sat => 5,
    }
}

/// One block with the identity and building it carries into the pass.
struct BlockEntry {
    day: Day,
    start_min: i64,
    end_min: i64,
    modality: BlockModality,
    building: Option<String>,
    course_id: i64,
    section_id: i64,
}

/// The leading alphabetic run of a room code, uppercased — the building
/// key (`J112` → `J`, `sj112` → `SJ`). `None` when nothing is derivable,
/// which means *unknown*, never "different".
fn building(location: &Option<String>) -> Option<String> {
    let room = location.as_deref()?;
    let prefix: String = room
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect();
    if prefix.is_empty() {
        None
    } else {
        Some(prefix.to_ascii_uppercase())
    }
}

/// Every block of every section, in deterministic `(day, start, end,
/// course, section)` order — the single walk order for the whole pass.
fn sorted_entries(sections: &[SolutionSection]) -> Vec<BlockEntry> {
    let mut entries: Vec<BlockEntry> = sections
        .iter()
        .flat_map(|section| {
            section.blocks.iter().map(|block| BlockEntry {
                day: block.day,
                start_min: block.start_min,
                end_min: block.end_min,
                modality: block.modality,
                building: building(&block.location),
                course_id: section.course_id,
                section_id: section.section_id,
            })
        })
        .collect();
    entries.sort_by_key(|entry| {
        (
            day_index(entry.day),
            entry.start_min,
            entry.end_min,
            entry.course_id,
            entry.section_id,
        )
    });
    entries
}

/// The per-day and per-block tallies the presets score on.
#[derive(Debug, Default)]
struct Stats {
    earliest_start_min: Option<i64>,
    online_blocks: usize,
    f2f_blocks: usize,
    campus_days: usize,
    lone_f2f_days: usize,
}

/// One pass over the sorted blocks: tallies the score inputs and detects
/// transition warnings in the same walk. The per-day lone-F2F fold happens
/// over the six day buckets afterwards — the assignment itself is never
/// walked twice.
fn analyze(sections: &[SolutionSection]) -> (Stats, Vec<TransitionWarning>) {
    let entries = sorted_entries(sections);

    let mut stats = Stats::default();
    let mut f2f_by_day: [Vec<(i64, i64)>; 6] = Default::default();
    let mut warnings = Vec::new();

    for (index, entry) in entries.iter().enumerate() {
        stats.earliest_start_min = Some(
            stats
                .earliest_start_min
                .map_or(entry.start_min, |earliest| earliest.min(entry.start_min)),
        );
        match entry.modality {
            BlockModality::F2F => {
                stats.f2f_blocks += 1;
                f2f_by_day[day_index(entry.day)].push((entry.start_min, entry.end_min));
            }
            BlockModality::Online => stats.online_blocks += 1,
        }

        if index == 0 {
            continue;
        }
        let previous = &entries[index - 1];
        if previous.day != entry.day {
            continue;
        }
        // A section is never warned against itself.
        if previous.course_id == entry.course_id && previous.section_id == entry.section_id {
            continue;
        }
        let gap = entry.start_min - previous.end_min;
        // Overlaps are conflict territory; a longer gap is a real break.
        if !(0..=BACK_TO_BACK_GAP_MIN).contains(&gap) {
            continue;
        }
        let transition = TransitionWarning {
            kind: WarningKind::F2FOnlineBackToBack,
            day: entry.day,
            start_min: previous.end_min,
            end_min: entry.start_min,
            from: SectionRef {
                course_id: previous.course_id,
                section_id: previous.section_id,
            },
            to: SectionRef {
                course_id: entry.course_id,
                section_id: entry.section_id,
            },
        };
        match (previous.modality, entry.modality) {
            (BlockModality::F2F, BlockModality::Online) => {
                warnings.push(transition);
            }
            (BlockModality::F2F, BlockModality::F2F) => {
                let differ = match (&previous.building, &entry.building) {
                    (Some(a), Some(b)) => a != b,
                    _ => false,
                };
                if differ {
                    warnings.push(TransitionWarning {
                        kind: WarningKind::F2FF2FDifferentBuildings,
                        ..transition
                    });
                }
            }
            _ => {}
        }
    }

    for blocks in &f2f_by_day {
        if blocks.is_empty() {
            continue;
        }
        stats.campus_days += 1;
        if blocks.len() == 1 && blocks[0].1 - blocks[0].0 == CLASS_LENGTH_MIN {
            stats.lone_f2f_days += 1;
        }
    }

    (stats, warnings)
}

fn component(label: &str, points: f64) -> ScoreComponent {
    ScoreComponent {
        label: label.to_string(),
        points,
    }
}

/// A cost component: zero stays a plain positive zero so no breakdown ever
/// shows `-0.0`.
fn penalty(count: usize, weight: f64) -> f64 {
    if count == 0 {
        0.0
    } else {
        -(count as f64) * weight
    }
}

/// The labelled components for one preset over one set of tallies. The
/// total score is their sum, so the breakdown always adds up to the score.
fn score_components(stats: &Stats, preset: Preset) -> (f64, Vec<ScoreComponent>) {
    let lone = penalty(stats.lone_f2f_days, LONE_F2F_DAY_WEIGHT);
    let components = match preset {
        Preset::FewestCampusDays => vec![
            component("Campus days", penalty(stats.campus_days, 1.0)),
            component("Lone F2F days", lone),
        ],
        Preset::NoEarlyMornings => vec![
            component(
                "Earliest start",
                stats
                    .earliest_start_min
                    .map_or(0.0, |earliest| earliest as f64 / 60.0),
            ),
            component("Lone F2F days", lone),
        ],
        Preset::MostOnline => vec![
            component("Online blocks", stats.online_blocks as f64),
            component("F2F blocks", penalty(stats.f2f_blocks, 1.0)),
            component("Lone F2F days", lone),
        ],
    };
    let score = components.iter().map(|component| component.points).sum();
    (score, components)
}

/// Scores one complete plan under a preset and finds its advisory warnings,
/// both in a single pass over the sorted schedule blocks.
pub fn evaluate(sections: &[SolutionSection], preset: Preset) -> Evaluation {
    let (stats, warnings) = analyze(sections);
    let (score, breakdown) = score_components(&stats, preset);
    Evaluation {
        score,
        breakdown,
        warnings,
    }
}

/// The advisory transition warnings of a plan as it currently stands — the
/// same computation `evaluate` runs, exposed for the current plan, which is
/// never scored by the solver but is warned about all the same.
pub fn transition_warnings(sections: &[SolutionSection]) -> Vec<TransitionWarning> {
    analyze(sections).1
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::ipc_types::{BlockModality, ScheduleBlock};

    fn block(
        day: Day,
        start_min: i64,
        end_min: i64,
        modality: BlockModality,
        location: Option<&str>,
    ) -> ScheduleBlock {
        ScheduleBlock {
            day,
            start_min,
            end_min,
            location: location.map(str::to_string),
            modality,
        }
    }

    fn f2f(day: Day, start_min: i64, end_min: i64, room: &str) -> ScheduleBlock {
        block(day, start_min, end_min, BlockModality::F2F, Some(room))
    }

    fn online(day: Day, start_min: i64, end_min: i64) -> ScheduleBlock {
        block(day, start_min, end_min, BlockModality::Online, None)
    }

    fn section(course_id: i64, section_id: i64, blocks: Vec<ScheduleBlock>) -> SolutionSection {
        SolutionSection {
            course_id,
            course_code: format!("C{course_id}"),
            section_id,
            section_code: format!("S{section_id}"),
            pinned: false,
            blocks,
        }
    }

    fn points(breakdown: &[ScoreComponent], label: &str) -> f64 {
        breakdown
            .iter()
            .find(|component| component.label == label)
            .unwrap_or_else(|| panic!("missing breakdown component {label:?}: {breakdown:?}"))
            .points
    }

    fn warning(
        kind: WarningKind,
        day: Day,
        start_min: i64,
        end_min: i64,
        from: (i64, i64),
        to: (i64, i64),
    ) -> TransitionWarning {
        TransitionWarning {
            kind,
            day,
            start_min,
            end_min,
            from: SectionRef {
                course_id: from.0,
                section_id: from.1,
            },
            to: SectionRef {
                course_id: to.0,
                section_id: to.1,
            },
        }
    }

    // ---------- campus days (per block, not per section) ----------

    #[test]
    fn campus_days_count_f2f_blocks_per_day_not_per_section() {
        // A hybrid section: F2F on Monday, online on Thursday. It puts the
        // student on campus only on Monday.
        let hybrid = section(
            1,
            1,
            vec![f2f(Day::Mon, 450, 540, "L226"), online(Day::Thu, 450, 540)],
        );
        let evaluation = evaluate(&[hybrid], Preset::FewestCampusDays);
        assert_eq!(points(&evaluation.breakdown, "Campus days"), -1.0);
        // Its one campus day is a single 90-minute class — a lone F2F day.
        assert_eq!(points(&evaluation.breakdown, "Lone F2F days"), -0.1);
        assert_eq!(evaluation.score, -1.1);

        // Two F2F blocks on one day still make one campus day.
        let two_blocks_one_day = vec![
            section(1, 1, vec![f2f(Day::Mon, 450, 540, "L226")]),
            section(2, 2, vec![f2f(Day::Mon, 570, 660, "G207")]),
        ];
        let evaluation = evaluate(&two_blocks_one_day, Preset::FewestCampusDays);
        assert_eq!(points(&evaluation.breakdown, "Campus days"), -1.0);

        // Fully online plans have no campus days.
        let fully_online = vec![
            section(1, 1, vec![online(Day::Mon, 450, 540)]),
            section(2, 2, vec![online(Day::Tue, 450, 540)]),
        ];
        let evaluation = evaluate(&fully_online, Preset::FewestCampusDays);
        assert_eq!(points(&evaluation.breakdown, "Campus days"), 0.0);
    }

    // ---------- lone F2F day ----------

    #[test]
    fn a_lone_f2f_day_is_a_single_90_minute_f2f_block_on_a_day() {
        let lone = section(1, 1, vec![f2f(Day::Mon, 450, 540, "L226")]);
        assert_eq!(
            points(&evaluate(&[lone], Preset::FewestCampusDays).breakdown, "Lone F2F days"),
            -0.1
        );

        // Online blocks are not campus commitments: one F2F block plus an
        // online block on the same day is still a lone F2F day.
        let with_online = vec![
            section(1, 1, vec![f2f(Day::Mon, 450, 540, "L226")]),
            section(2, 2, vec![online(Day::Mon, 570, 660)]),
        ];
        assert_eq!(
            points(
                &evaluate(&with_online, Preset::FewestCampusDays).breakdown,
                "Lone F2F days"
            ),
            -0.1
        );

        // Two F2F blocks on the same day are not a lone commitment.
        let busy_day = vec![
            section(1, 1, vec![f2f(Day::Mon, 450, 540, "L226")]),
            section(2, 2, vec![f2f(Day::Mon, 570, 660, "G207")]),
        ];
        assert_eq!(
            points(&evaluate(&busy_day, Preset::FewestCampusDays).breakdown, "Lone F2F days"),
            0.0
        );

        // A single F2F block that is not the observed 90-minute class is not
        // a lone F2F day.
        let short = section(1, 1, vec![f2f(Day::Mon, 450, 510, "L226")]);
        assert_eq!(
            points(&evaluate(&[short], Preset::FewestCampusDays).breakdown, "Lone F2F days"),
            0.0
        );
    }

    // ---------- presets ----------

    #[test]
    fn no_early_mornings_scores_later_earliest_starts_higher() {
        let early = vec![section(
            1,
            1,
            vec![f2f(Day::Mon, 450, 540, "L226"), online(Day::Thu, 870, 960)],
        )];
        let late = vec![section(1, 1, vec![online(Day::Mon, 870, 960)])];
        let early_eval = evaluate(&early, Preset::NoEarlyMornings);
        let late_eval = evaluate(&late, Preset::NoEarlyMornings);
        assert_eq!(points(&early_eval.breakdown, "Earliest start"), 7.5);
        assert_eq!(points(&late_eval.breakdown, "Earliest start"), 14.5);
        assert!(late_eval.score > early_eval.score);
    }

    #[test]
    fn most_online_scores_online_blocks_up_and_f2f_blocks_down() {
        let all_online = vec![section(
            1,
            1,
            vec![online(Day::Mon, 450, 540), online(Day::Thu, 450, 540)],
        )];
        let hybrid = vec![section(
            1,
            1,
            vec![f2f(Day::Mon, 450, 540, "L226"), online(Day::Thu, 450, 540)],
        )];
        let online_eval = evaluate(&all_online, Preset::MostOnline);
        let hybrid_eval = evaluate(&hybrid, Preset::MostOnline);
        assert_eq!(points(&online_eval.breakdown, "Online blocks"), 2.0);
        assert_eq!(points(&online_eval.breakdown, "F2F blocks"), 0.0);
        assert_eq!(points(&hybrid_eval.breakdown, "Online blocks"), 1.0);
        assert_eq!(points(&hybrid_eval.breakdown, "F2F blocks"), -1.0);
        assert!(online_eval.score > hybrid_eval.score);
    }

    // ---------- breakdown legibility ----------

    #[test]
    fn the_breakdown_sums_to_the_score_under_every_preset() {
        let sections = vec![
            section(
                1,
                1,
                vec![f2f(Day::Mon, 450, 540, "L226"), online(Day::Thu, 870, 960)],
            ),
            section(
                2,
                2,
                vec![online(Day::Tue, 450, 540), f2f(Day::Fri, 450, 540, "V501")],
            ),
            section(3, 3, vec![f2f(Day::Sat, 660, 750, "A1103")]),
        ];
        for preset in [
            Preset::FewestCampusDays,
            Preset::NoEarlyMornings,
            Preset::MostOnline,
        ] {
            let evaluation = evaluate(&sections, preset);
            let sum: f64 = evaluation.breakdown.iter().map(|c| c.points).sum();
            assert!(
                (evaluation.score - sum).abs() < 1e-9,
                "the breakdown must sum to the score under {preset:?}: {evaluation:?}"
            );
        }
    }

    #[test]
    fn a_zero_score_breakdown_never_serializes_negative_zero() {
        let evaluation = evaluate(&[], Preset::FewestCampusDays);
        assert_eq!(evaluation.score, 0.0);
        assert!(evaluation.breakdown.iter().all(|c| c.points == 0.0));
        assert!(!evaluation.score.is_sign_negative());
    }

    // ---------- transition warnings ----------

    #[test]
    fn f2f_then_online_back_to_back_raises_the_advisory_warning() {
        // 07:30–09:00 F2F, 09:15–10:45 online: the standard 15-minute break,
        // and nowhere to sit and connect.
        let sections = vec![
            section(1, 1, vec![f2f(Day::Mon, 450, 540, "L226")]),
            section(2, 2, vec![online(Day::Mon, 555, 645)]),
        ];
        let evaluation = evaluate(&sections, Preset::FewestCampusDays);
        assert_eq!(
            evaluation.warnings,
            vec![warning(
                WarningKind::F2FOnlineBackToBack,
                Day::Mon,
                540,
                555,
                (1, 1),
                (2, 2)
            )]
        );
        // The warning is advisory: it does not change the score.
        assert_eq!(points(&evaluation.breakdown, "Campus days"), -1.0);
    }

    #[test]
    fn blocks_that_touch_are_back_to_back() {
        let sections = vec![
            section(1, 1, vec![f2f(Day::Mon, 450, 540, "L226")]),
            section(2, 2, vec![online(Day::Mon, 540, 630)]),
        ];
        let evaluation = evaluate(&sections, Preset::FewestCampusDays);
        assert_eq!(
            evaluation.warnings,
            vec![warning(
                WarningKind::F2FOnlineBackToBack,
                Day::Mon,
                540,
                540,
                (1, 1),
                (2, 2)
            )]
        );
    }

    #[test]
    fn f2f_then_f2f_back_to_back_in_different_buildings_warns_from_the_room_prefix() {
        // J112 ends 09:00; V501 starts 09:15. That is not a 15-minute walk.
        let sections = vec![
            section(1, 1, vec![f2f(Day::Mon, 450, 540, "J112")]),
            section(2, 2, vec![f2f(Day::Mon, 555, 645, "V501")]),
        ];
        let evaluation = evaluate(&sections, Preset::FewestCampusDays);
        assert_eq!(
            evaluation.warnings,
            vec![warning(
                WarningKind::F2FF2FDifferentBuildings,
                Day::Mon,
                540,
                555,
                (1, 1),
                (2, 2)
            )]
        );
    }

    #[test]
    fn f2f_then_f2f_in_the_same_building_is_not_warned() {
        let sections = vec![
            section(1, 1, vec![f2f(Day::Mon, 450, 540, "J112")]),
            section(2, 2, vec![f2f(Day::Mon, 555, 645, "J302")]),
        ];
        assert!(evaluate(&sections, Preset::FewestCampusDays)
            .warnings
            .is_empty());
    }

    #[test]
    fn building_prefixes_compare_case_insensitively() {
        let sections = vec![
            section(1, 1, vec![f2f(Day::Mon, 450, 540, "j112")]),
            section(2, 2, vec![f2f(Day::Mon, 555, 645, "J302")]),
        ];
        assert!(evaluate(&sections, Preset::FewestCampusDays)
            .warnings
            .is_empty());
    }

    #[test]
    fn an_underivable_building_is_never_different() {
        // A numeric room code carries no building prefix; nothing to derive.
        let sections = vec![
            section(1, 1, vec![f2f(Day::Mon, 450, 540, "301")]),
            section(2, 2, vec![f2f(Day::Mon, 555, 645, "V501")]),
        ];
        assert!(evaluate(&sections, Preset::FewestCampusDays)
            .warnings
            .is_empty());
    }

    #[test]
    fn transitions_longer_than_the_standard_break_are_not_back_to_back() {
        let sections = vec![
            section(1, 1, vec![f2f(Day::Mon, 450, 540, "L226")]),
            section(2, 2, vec![online(Day::Mon, 600, 690)]),
        ];
        assert!(evaluate(&sections, Preset::FewestCampusDays)
            .warnings
            .is_empty());
    }

    #[test]
    fn overlapping_blocks_are_conflict_territory_not_transitions() {
        let sections = vec![
            section(1, 1, vec![f2f(Day::Mon, 450, 540, "L226")]),
            section(2, 2, vec![online(Day::Mon, 480, 570)]),
        ];
        assert!(evaluate(&sections, Preset::FewestCampusDays)
            .warnings
            .is_empty());
    }

    #[test]
    fn a_section_is_never_warned_against_itself() {
        let sections = vec![section(
            1,
            1,
            vec![f2f(Day::Mon, 450, 540, "L226"), online(Day::Mon, 555, 645)],
        )];
        assert!(evaluate(&sections, Preset::FewestCampusDays)
            .warnings
            .is_empty());
    }

    #[test]
    fn online_then_f2f_is_not_warned() {
        let sections = vec![
            section(1, 1, vec![online(Day::Mon, 450, 540)]),
            section(2, 2, vec![f2f(Day::Mon, 555, 645, "L226")]),
        ];
        assert!(evaluate(&sections, Preset::FewestCampusDays)
            .warnings
            .is_empty());
    }

    #[test]
    fn online_then_online_is_not_warned() {
        let sections = vec![
            section(1, 1, vec![online(Day::Mon, 450, 540)]),
            section(2, 2, vec![online(Day::Mon, 555, 645)]),
        ];
        assert!(evaluate(&sections, Preset::FewestCampusDays)
            .warnings
            .is_empty());
    }

    #[test]
    fn warnings_come_back_ordered_by_day_and_time() {
        let sections = vec![
            section(1, 1, vec![f2f(Day::Mon, 450, 540, "L226")]),
            section(2, 2, vec![online(Day::Mon, 555, 645)]),
            section(3, 3, vec![f2f(Day::Tue, 450, 540, "J112")]),
            section(4, 4, vec![f2f(Day::Tue, 555, 645, "V501")]),
        ];
        let evaluation = evaluate(&sections, Preset::FewestCampusDays);
        assert_eq!(
            evaluation.warnings,
            vec![
                warning(
                    WarningKind::F2FOnlineBackToBack,
                    Day::Mon,
                    540,
                    555,
                    (1, 1),
                    (2, 2)
                ),
                warning(
                    WarningKind::F2FF2FDifferentBuildings,
                    Day::Tue,
                    540,
                    555,
                    (3, 3),
                    (4, 4)
                ),
            ]
        );
    }

    // ---------- the plan-warning entry point ----------

    #[test]
    fn the_plan_warning_entry_point_reports_the_same_transitions_as_scoring() {
        let sections = vec![
            section(1, 1, vec![f2f(Day::Mon, 450, 540, "L226")]),
            section(2, 2, vec![online(Day::Mon, 555, 645)]),
        ];
        assert_eq!(
            transition_warnings(&sections),
            evaluate(&sections, Preset::FewestCampusDays).warnings
        );
    }
}
