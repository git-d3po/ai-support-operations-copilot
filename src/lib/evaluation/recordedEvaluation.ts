import recordedLive20260924 from "./recorded/live-2026-09-24.json";
import { parseRecordedEvaluation, type RecordedEvaluation } from "./recordedEvaluationContract";

export { RecordedEvaluationSchema, type RecordedEvaluation, type RecordedScenario } from "./recordedEvaluationContract";

/**
 * The recorded live evaluation the Evaluations page shows: one real `npm run
 * eval` run of every curated scenario, committed as a fixed JSON record and
 * validated here when the module loads, so a malformed record fails the build
 * and the tests rather than rendering. The application never reads the
 * evaluation database it came from (that file stays local); it reads only this
 * record. Generated and verified by scripts/exportEvaluationSnapshot.ts. A
 * future live run is a new record beside this one, never an edit to it. See
 * DECISIONS.md ("Recorded live evaluation shipped as a verified snapshot").
 */
export const RECORDED_LIVE_EVALUATION: RecordedEvaluation = deepFreeze(parseRecordedEvaluation(recordedLive20260924));

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
