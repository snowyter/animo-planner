import { describe, expect, it } from "vitest";
import {
  DAYS,
  LATTICE_START_MINUTES,
  formatMinutesToTime12,
  formatMinutesToTime24,
  formatMinutesRange,
  computeBlockPosition,
  getGridTimeBounds,
  DEFAULT_GRID_START_MIN,
  DEFAULT_GRID_END_MIN,
} from "./grid";
import type { ScheduleBlock } from "../adapters/ipc/types";

describe("grid core calculations", () => {
  it("defines exactly six days from Monday through Saturday (Mon–Sat)", () => {
    expect(DAYS).toEqual(["MON", "TUE", "WED", "THU", "FRI", "SAT"]);
    expect(DAYS).not.toContain("SUN");
  });

  it("defines the seven time-lattice start minutes", () => {
    expect(LATTICE_START_MINUTES).toEqual([
      450, // 07:30
      555, // 09:15
      660, // 11:00
      765, // 12:45
      870, // 14:30
      975, // 16:15
      1080, // 18:00
    ]);
  });

  it("formats minutes to 12-hour and 24-hour time strings", () => {
    expect(formatMinutesToTime24(450)).toBe("07:30");
    expect(formatMinutesToTime24(555)).toBe("09:15");
    expect(formatMinutesToTime24(1080)).toBe("18:00");
    expect(formatMinutesToTime24(1170)).toBe("19:30");

    expect(formatMinutesToTime12(450)).toBe("7:30 AM");
    expect(formatMinutesToTime12(765)).toBe("12:45 PM");
    expect(formatMinutesToTime12(1080)).toBe("6:00 PM");

    expect(formatMinutesRange(450, 540)).toBe("7:30 AM – 9:00 AM");
  });

  it("computes block percentage positions by actual start and end times", () => {
    // Default grid: 450 (07:30) to 1170 (19:30) = 720 minutes span
    const posFirstSlot = computeBlockPosition(450, 540); // 07:30 - 09:00 (90 min)
    expect(posFirstSlot.topPercent).toBeCloseTo(0, 2);
    expect(posFirstSlot.heightPercent).toBeCloseTo((90 / 720) * 100, 2); // 12.5%

    const posSecondSlot = computeBlockPosition(555, 645); // 09:15 - 10:45
    expect(posSecondSlot.topPercent).toBeCloseTo(((555 - 450) / 720) * 100, 2);
    expect(posSecondSlot.heightPercent).toBeCloseTo((90 / 720) * 100, 2);

    // Off-lattice block (e.g. 08:00 - 10:00 = 480 to 600)
    const posOffLattice = computeBlockPosition(480, 600);
    expect(posOffLattice.topPercent).toBeCloseTo(((480 - 450) / 720) * 100, 2);
    expect(posOffLattice.heightPercent).toBeCloseTo((120 / 720) * 100, 2);
  });

  it("dynamically adjusts grid bounds if sections fall outside standard 07:30 - 19:30 lattice", () => {
    const normalBlocks: ScheduleBlock[] = [
      { day: "MON", startMin: 450, endMin: 540, modality: "F2F", location: "L226" },
    ];
    const normalBounds = getGridTimeBounds(normalBlocks);
    expect(normalBounds.startMin).toBe(DEFAULT_GRID_START_MIN);
    expect(normalBounds.endMin).toBe(DEFAULT_GRID_END_MIN);

    const earlyBlock: ScheduleBlock[] = [
      { day: "TUE", startMin: 420, endMin: 510, modality: "F2F", location: "L226" }, // 07:00 start
    ];
    const earlyBounds = getGridTimeBounds(earlyBlock);
    expect(earlyBounds.startMin).toBe(420);
    expect(earlyBounds.endMin).toBe(DEFAULT_GRID_END_MIN);

    const lateBlock: ScheduleBlock[] = [
      { day: "WED", startMin: 1140, endMin: 1230, modality: "F2F", location: "L226" }, // ends 20:30
    ];
    const lateBounds = getGridTimeBounds(lateBlock);
    expect(lateBounds.startMin).toBe(DEFAULT_GRID_START_MIN);
    expect(lateBounds.endMin).toBe(1230);
  });
});
