import { useState, useCallback, useEffect, useRef } from "react";
import * as client from "../adapters/ipc/client";
import type {
  CapturedCourse,
  CaptureSummary,
  ForgetCourseOutcome,
  Plan,
  Section,
} from "../adapters/ipc/types";
import { formatErrorMessage } from "../core/error";

export interface SectionPickerOptions {
  campusId: number;
  sessionId: number;
  planId: string;
  onPlanUpdated?: (plan: Plan) => void;
  onCaptureUpdated?: (summary: CaptureSummary) => void;
}

export interface SectionPickerState {
  courses: CapturedCourse[];
  selectedCourseId: number | null;
  sections: Section[];
  isLoadingCourses: boolean;
  isLoadingSections: boolean;
  isMutating: boolean;
  error: string | null;
  hoveredSection: Section | null;
  fetchCourses: () => Promise<void>;
  /// Reloads the captured course list, keeping the current selection when
  /// that course still exists. Unlike `fetchCourses`, which always jumps
  /// back to the first course, this is safe to call while the student is
  /// browsing.
  syncCourses: () => Promise<void>;
  selectCourse: (courseId: number) => Promise<void>;
  addSection: (section: Section) => Promise<Plan>;
  removeSection: (section: Section) => Promise<Plan>;
  togglePin: (section: Section, pinned: boolean) => Promise<Plan>;
  forgetCourse: (courseId: number) => Promise<ForgetCourseOutcome>;
  setHoveredSection: (section: Section | null) => void;
}

export function useSectionPickerState(options: SectionPickerOptions): SectionPickerState {
  let courses: CapturedCourse[] = [];
  let selectedCourseId: number | null = null;
  let sections: Section[] = [];
  let isLoadingCourses = false;
  let isLoadingSections = false;
  let isMutating = false;
  let error: string | null = null;
  let hoveredSection: Section | null = null;

  const selectCourse = async (courseId: number): Promise<void> => {
    selectedCourseId = courseId;
    isLoadingSections = true;
    error = null;
    try {
      sections = await client.listCapturedSections({
        campusId: options.campusId,
        sessionId: options.sessionId,
        courseId,
      });
    } catch (err) {
      error = formatErrorMessage(err);
      sections = [];
    } finally {
      isLoadingSections = false;
    }
  };

  const fetchCourses = async (): Promise<void> => {
    isLoadingCourses = true;
    error = null;
    try {
      courses = await client.listCapturedCourses({
        campusId: options.campusId,
        sessionId: options.sessionId,
      });
      if (courses.length > 0) {
        await selectCourse(courses[0].courseId);
      } else {
        selectedCourseId = null;
        sections = [];
      }
    } catch (err) {
      error = formatErrorMessage(err);
      courses = [];
      sections = [];
    } finally {
      isLoadingCourses = false;
    }
  };

  const syncCourses = async (): Promise<void> => {
    error = null;
    try {
      courses = await client.listCapturedCourses({
        campusId: options.campusId,
        sessionId: options.sessionId,
      });
      const keepsSelection =
        selectedCourseId !== null &&
        courses.some((course) => course.courseId === selectedCourseId);
      const target = keepsSelection ? selectedCourseId : courses[0]?.courseId ?? null;
      if (target === null) {
        selectedCourseId = null;
        sections = [];
        return;
      }
      await selectCourse(target);
    } catch (err) {
      error = formatErrorMessage(err);
    }
  };

  const addSection = async (section: Section): Promise<Plan> => {
    isMutating = true;
    error = null;
    try {
      const updatedPlan = await client.addSectionToPlan({
        planId: options.planId,
        courseId: section.courseId,
        sectionId: section.sectionId,
      });
      options.onPlanUpdated?.(updatedPlan);
      return updatedPlan;
    } catch (err) {
      const msg = formatErrorMessage(err);
      error = msg;
      throw err;
    } finally {
      isMutating = false;
    }
  };

  const removeSection = async (section: Section): Promise<Plan> => {
    isMutating = true;
    error = null;
    try {
      const updatedPlan = await client.removeSectionFromPlan({
        planId: options.planId,
        courseId: section.courseId,
        sectionId: section.sectionId,
      });
      options.onPlanUpdated?.(updatedPlan);
      return updatedPlan;
    } catch (err) {
      const msg = formatErrorMessage(err);
      error = msg;
      throw err;
    } finally {
      isMutating = false;
    }
  };

  const togglePin = async (section: Section, pinned: boolean): Promise<Plan> => {
    isMutating = true;
    error = null;
    try {
      const updatedPlan = await client.setSectionPinned({
        planId: options.planId,
        courseId: section.courseId,
        sectionId: section.sectionId,
        pinned,
      });
      options.onPlanUpdated?.(updatedPlan);
      return updatedPlan;
    } catch (err) {
      const msg = formatErrorMessage(err);
      error = msg;
      throw err;
    } finally {
      isMutating = false;
    }
  };

  const forgetCourse = async (courseId: number): Promise<ForgetCourseOutcome> => {
    isMutating = true;
    error = null;
    try {
      const outcome = await client.forgetCapturedCourse({
        campusId: options.campusId,
        sessionId: options.sessionId,
        courseId,
      });
      courses = courses.filter((c) => c.courseId !== courseId);
      if (selectedCourseId === courseId) {
        if (courses.length > 0) {
          await selectCourse(courses[0].courseId);
        } else {
          selectedCourseId = null;
          sections = [];
        }
      }
      options.onCaptureUpdated?.(outcome.summary);
      return outcome;
    } catch (err) {
      const msg = formatErrorMessage(err);
      error = msg;
      throw err;
    } finally {
      isMutating = false;
    }
  };

  const setHoveredSection = (section: Section | null) => {
    hoveredSection = section;
  };

  return {
    get courses() {
      return courses;
    },
    get selectedCourseId() {
      return selectedCourseId;
    },
    get sections() {
      return sections;
    },
    get isLoadingCourses() {
      return isLoadingCourses;
    },
    get isLoadingSections() {
      return isLoadingSections;
    },
    get isMutating() {
      return isMutating;
    },
    get error() {
      return error;
    },
    get hoveredSection() {
      return hoveredSection;
    },
    fetchCourses,
    syncCourses,
    selectCourse,
    addSection,
    removeSection,
    togglePin,
    forgetCourse,
    setHoveredSection,
  };
}

export function useSectionPicker(options: SectionPickerOptions) {
  const [courses, setCourses] = useState<CapturedCourse[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [isLoadingCourses, setIsLoadingCourses] = useState<boolean>(false);
  const [isLoadingSections, setIsLoadingSections] = useState<boolean>(false);
  const [isMutating, setIsMutating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredSection, setHoveredSection] = useState<Section | null>(null);

  const selectCourse = useCallback(
    async (courseId: number) => {
      setSelectedCourseId(courseId);
      setIsLoadingSections(true);
      setError(null);
      try {
        const result = await client.listCapturedSections({
          campusId: options.campusId,
          sessionId: options.sessionId,
          courseId,
        });
        setSections(result);
      } catch (err) {
        setError(formatErrorMessage(err));
        setSections([]);
      } finally {
        setIsLoadingSections(false);
      }
    },
    [options.campusId, options.sessionId]
  );

  const fetchCourses = useCallback(async () => {
    setIsLoadingCourses(true);
    setError(null);
    try {
      const result = await client.listCapturedCourses({
        campusId: options.campusId,
        sessionId: options.sessionId,
      });
      setCourses(result);
      if (result.length > 0) {
        const firstId = result[0].courseId;
        setSelectedCourseId(firstId);
        setIsLoadingSections(true);
        try {
          const secs = await client.listCapturedSections({
            campusId: options.campusId,
            sessionId: options.sessionId,
            courseId: firstId,
          });
          setSections(secs);
        } catch (err) {
          setError(formatErrorMessage(err));
          setSections([]);
        } finally {
          setIsLoadingSections(false);
        }
      } else {
        setSelectedCourseId(null);
        setSections([]);
      }
    } catch (err) {
      setError(formatErrorMessage(err));
      setCourses([]);
      setSections([]);
    } finally {
      setIsLoadingCourses(false);
    }
  }, [options.campusId, options.sessionId]);

  useEffect(() => {
    fetchCourses();
  }, [fetchCourses]);

  // Read inside `syncCourses` without making it depend on the selection,
  // so the subscription below is established once rather than resubscribing
  // every time the student picks a different course.
  const selectedCourseIdRef = useRef<number | null>(null);
  useEffect(() => {
    selectedCourseIdRef.current = selectedCourseId;
  }, [selectedCourseId]);

  const syncCourses = useCallback(async (): Promise<void> => {
    try {
      const result = await client.listCapturedCourses({
        campusId: options.campusId,
        sessionId: options.sessionId,
      });
      setCourses(result);

      const current = selectedCourseIdRef.current;
      const keepsSelection =
        current !== null && result.some((course) => course.courseId === current);
      const target = keepsSelection ? current : result[0]?.courseId ?? null;

      if (target === null) {
        setSelectedCourseId(null);
        setSections([]);
        return;
      }

      // Reloaded even when the selection is unchanged: the capture that
      // triggered this may have been a re-search of the course on screen.
      setSelectedCourseId(target);
      setIsLoadingSections(true);
      try {
        const secs = await client.listCapturedSections({
          campusId: options.campusId,
          sessionId: options.sessionId,
          courseId: target,
        });
        setSections(secs);
      } finally {
        setIsLoadingSections(false);
      }
    } catch (err) {
      setError(formatErrorMessage(err));
    }
  }, [options.campusId, options.sessionId]);

  // A capture landing from the popup must reach the dropdown. Without this
  // the list is loaded once on mount and never again, so a course searched
  // in Course Finder stays invisible until the picker is remounted.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    client
      .onCaptureUpdated((summary) => {
        if (
          summary.campusId === options.campusId &&
          summary.sessionId === options.sessionId
        ) {
          void syncCourses();
        }
      })
      .then((off) => {
        if (cancelled) {
          off();
          return;
        }
        unlisten = off;
      })
      .catch(() => {
        // Outside Tauri (unit tests, browser dev) there is no event bridge.
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [options.campusId, options.sessionId, syncCourses]);

  const addSection = useCallback(
    async (section: Section): Promise<Plan> => {
      setIsMutating(true);
      setError(null);
      try {
        const updatedPlan = await client.addSectionToPlan({
          planId: options.planId,
          courseId: section.courseId,
          sectionId: section.sectionId,
        });
        options.onPlanUpdated?.(updatedPlan);
        return updatedPlan;
      } catch (err) {
        const msg = formatErrorMessage(err);
        setError(msg);
        throw err;
      } finally {
        setIsMutating(false);
      }
    },
    [options]
  );

  const removeSection = useCallback(
    async (section: Section): Promise<Plan> => {
      setIsMutating(true);
      setError(null);
      try {
        const updatedPlan = await client.removeSectionFromPlan({
          planId: options.planId,
          courseId: section.courseId,
          sectionId: section.sectionId,
        });
        options.onPlanUpdated?.(updatedPlan);
        return updatedPlan;
      } catch (err) {
        const msg = formatErrorMessage(err);
        setError(msg);
        throw err;
      } finally {
        setIsMutating(false);
      }
    },
    [options]
  );

  const togglePin = useCallback(
    async (section: Section, pinned: boolean): Promise<Plan> => {
      setIsMutating(true);
      setError(null);
      try {
        const updatedPlan = await client.setSectionPinned({
          planId: options.planId,
          courseId: section.courseId,
          sectionId: section.sectionId,
          pinned,
        });
        options.onPlanUpdated?.(updatedPlan);
        return updatedPlan;
      } catch (err) {
        const msg = formatErrorMessage(err);
        setError(msg);
        throw err;
      } finally {
        setIsMutating(false);
      }
    },
    [options]
  );

  const forgetCourse = useCallback(
    async (courseId: number): Promise<ForgetCourseOutcome> => {
      setIsMutating(true);
      setError(null);
      try {
        const outcome = await client.forgetCapturedCourse({
          campusId: options.campusId,
          sessionId: options.sessionId,
          courseId,
        });
        // Reloaded through the same path a capture takes, so the course
        // list has one source of truth instead of a fetch on mount and a
        // local patch here.
        await syncCourses();
        options.onCaptureUpdated?.(outcome.summary);
        return outcome;
      } catch (err) {
        const msg = formatErrorMessage(err);
        setError(msg);
        throw err;
      } finally {
        setIsMutating(false);
      }
    },
    [options, syncCourses]
  );

  return {
    courses,
    selectedCourseId,
    sections,
    isLoadingCourses,
    isLoadingSections,
    isMutating,
    error,
    hoveredSection,
    fetchCourses,
    syncCourses,
    selectCourse,
    addSection,
    removeSection,
    togglePin,
    forgetCourse,
    setHoveredSection,
  };
}
