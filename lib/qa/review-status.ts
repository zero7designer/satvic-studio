export type QaReportStatusInput = { reviewComplete?: boolean; findings: unknown[] };
export type QaProjectStatus = 'Ready' | 'Needs review' | 'Failed' | 'In progress';

export function isQaReviewComplete(report?: Pick<QaReportStatusInput, 'reviewComplete'> | null) {
  return report?.reviewComplete === true;
}

export function qaProjectStatus(report: QaReportStatusInput): QaProjectStatus {
  return isQaReviewComplete(report) && report.findings.length === 0 ? 'Ready' : 'Needs review';
}

export function qaJobProjectStatus(job: { status: string; issueCount?: number | null; errorMessage?: string | null }): QaProjectStatus {
  if (job.status === 'failed') return 'Failed';
  if (job.status !== 'completed') return 'In progress';
  return job.issueCount || job.errorMessage?.trim() ? 'Needs review' : 'Ready';
}
