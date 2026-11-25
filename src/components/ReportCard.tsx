/**
 * One reported place, as a popup shows it — in plain language, and only what
 * the supervisor meeting asked for: WHY (the surroundings felt threatening…),
 * WHEN (mostly after dark…), what the respondent DOES about it ("I take other
 * transport", "I always go with a group", "I share my live location"), and
 * their story when they consented to share one. One quiet line credits where
 * it came from — Pointer's credit is a condition of showing its data.
 *
 * Plain markup: it renders inside a Leaflet popup and in the boards' lists alike.
 */

import Story from "@/components/Story";
import { ADJUSTMENT_LABEL } from "@/lib/pointer";
import { mentionsHarassment } from "@/lib/importance";
import { REPORT_TYPES, SOURCE_LABEL, WHEN_OPTIONS, type Report } from "@/lib/reports";

const DATE = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" });
const TYPE_LABEL = new Map(REPORT_TYPES.map((type) => [type.id, type.label]));
const WHEN_LABEL = new Map(WHEN_OPTIONS.map((option) => [option.id, option.label]));

export default function ReportCard({ report }: { report: Report }) {
  const reasons = report.reasons?.length ? report.reasons : [report.category];
  const adapts = (report.adjustments ?? []).filter((id) => id !== "none");
  return (
    <div className="report-card">
      <b>{reasons.map((reason) => TYPE_LABEL.get(reason) ?? reason).join(" · ")}</b>
      {report.when && <span>{WHEN_LABEL.get(report.when)}</span>}
      {adapts.length > 0 && (
        <span>
          What they do about it:
          <ul className="report-reasons">
            {adapts.map((id) => <li key={id}>{ADJUSTMENT_LABEL.get(id) ?? id}</li>)}
          </ul>
        </span>
      )}
      {report.note && (
        <>
          <Story text={report.note} />
          {mentionsHarassment(report.note) && <span className="muted">The story mentions harassment or catcalling (keyword check).</span>}
        </>
      )}
      <span className="muted">
        {SOURCE_LABEL[report.source]} · reported {report.atUntil ? "between " + DATE.format(new Date(report.at)) + " and " + DATE.format(new Date(report.atUntil)) : DATE.format(new Date(report.at))}
      </span>
    </div>
  );
}
