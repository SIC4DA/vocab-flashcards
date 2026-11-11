"use client";

import { CheckIcon } from "./icons";

export type Week = { day: string; done: boolean }[];

const weekday = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "narrow", timeZone: "UTC" });

/** The last 7 days: a stamp for each day the daily review was finished. */
export function WeekStrip({ week }: { week: Week }) {
  return (
    <ol className="flex gap-1.5" aria-label="Daily reviews this week" data-testid="week-strip">
      {week.map((d, i) => {
        const today = i === week.length - 1;
        return (
          <li key={d.day} className="flex flex-col items-center gap-1">
            <span
              className={`grid h-8 w-8 place-items-center rounded-full border-2 ${
                d.done ? "border-margin bg-margin text-white" : today ? "border-dashed border-margin/60" : "border-line"
              }`}
              data-done={String(d.done)}
              title={`${d.day}${d.done ? ": done" : ""}`}
            >
              {d.done && <CheckIcon size={14} />}
              <span className="sr-only">
                {d.day}: {d.done ? "done" : today ? "not yet" : "missed"}
              </span>
            </span>
            <span className={`text-[0.7rem] ${today ? "font-semibold" : "text-muted"}`} aria-hidden>
              {weekday(d.day)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
