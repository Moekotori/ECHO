type AnalysisJob = { status: string };
const maxPendingJobs = 8;
const maxFinishedJobs = 20;

export function pruneAnalysisJobs(jobs: Map<string, AnalysisJob>): void {
  const finished = [...jobs].filter(([, job]) => job.status !== 'queued' && job.status !== 'running');
  for (const [id] of finished.slice(0, Math.max(0, finished.length - maxFinishedJobs))) jobs.delete(id);
}

export function checkAnalysisJobCapacity(jobs: Map<string, AnalysisJob>): void {
  pruneAnalysisJobs(jobs);
  let pending = 0;
  for (const job of jobs.values()) {
    if (job.status === 'queued' || job.status === 'running') pending += 1;
  }
  if (pending >= maxPendingJobs) throw new Error('Too many queued analysis jobs; wait for an existing job to finish.');
}
