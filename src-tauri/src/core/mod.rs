pub mod capture_report;
pub mod conflicts;
pub mod hub_pages;
pub mod ics;
pub mod ipc_types;
pub mod options;
pub mod parser;
pub mod refresh;
// The bundled Course Finder fixtures, parsed through the real parser. The
// sample-plan feature that shipped them to students is gone; the solver's
// tests still want realistic input, so this stays as a test-only fixture
// helper and no longer rides along in the binary.
#[cfg(test)]
pub mod sample_data;
pub mod scoring;
pub mod scrub;
pub mod selector_config;
pub mod solver;
pub mod teachers;
pub mod update_check;
