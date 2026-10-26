/**
 * One marked place, as a popup shows it: where it came from, every reason
 * given, when it feels that way, how the respondent adapts, and the story when
 * they consented to share one. Plain markup — it renders inside a Leaflet
 * popup and in the boards' lists alike.
 */

import { ADJUSTMENT_LABEL } from "@/lib/pointer";
import { REPORT_TYPES, SOURCE_LABEL, WHEN_OPTIONS, type Report } from "@/lib/reports";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const TYPE_LABEL = new Map(REPORT_TYPES.map((type) => [type.id, type.label]));
const WHEN_LABEL = new Map(WHEN_OPTIONS.map((option) => [option.id, option.label]));

export default function ReportCard({ report }: { report: Report }) {
  const reasons = report.reasons?.length ? report.reasons : [report.category];
  return (
    <div className="report-card">
      <b>{SOURCE_LABEL[report.source]}{report.place ? ` · ${report.place}` : ""}</b>
      <ul className="report-reasons">
        {reasons.map((reason) => <li key={reason}>{TYPE_LABEL.get(reason) ?? reason}</li>)}
      </ul>
      {report.when && <span>{WHEN_LABEL.get(report.when)}</span>}
      {report.adjustments?.length ? (
        <span className="muted">Adapts: {report.adjustments.map((id) => ADJUSTMENT_LABEL.get(id) ?? id).join("; ")}</span>
      ) : null}
      {report.note && <q>{report.note}</q>}
      <span className="muted">
        {report.atUntil
          ? `Marked between ${DATE.format(new Date(report.at))} and ${DATE.format(new Date(report.atUntil))}`
          : `Marked ${DATE.format(new Date(report.at))}`}
        {report.age ? ` · respondent aged ${report.age}` : ""}
        {report.upvotes ? ` · ${report.upvotes} other${report.upvotes === 1 ? "" : "s"} marked it too` : ""}
      </span>
    </div>
  );
}
