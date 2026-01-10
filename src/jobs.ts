import { EventEmitter } from "events";
import crypto from "crypto";
import type {
  ApiErrorBody,
  JobEvent,
  JobProgressEvent,
  JobState,
  JobStatus,
} from "./types";
import { timeoutError } from "./errors";

const MAX_EVENTS = 2000;

export type JobContext = {
  logStdout: (line: string) => void;
  logStderr: (line: string) => void;
  progress: (event: Omit<JobProgressEvent, "type">) => void;
  setCancel: (cancel: () => Promise<void>) => void;
  isCancelled: () => boolean;
};

export type JobRunner = (ctx: JobContext) => Promise<void>;

export class Job {
  readonly id: string;
  state: JobState = "queued";
  createdAt = new Date().toISOString();
  startedAt?: string;
  finishedAt?: string;
  error?: ApiErrorBody;
  events: JobEvent[] = [];
  readonly emitter = new EventEmitter();
  cancelRequested = false;
  private cancelFn?: () => Promise<void>;

  constructor() {
    this.id = crypto.randomUUID();
  }

  setCancel(fn: () => Promise<void>) {
    this.cancelFn = fn;
  }

  async cancel() {
    this.cancelRequested = true;
    if (this.cancelFn) {
      await this.cancelFn();
    }
  }

  emit(event: JobEvent) {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.shift();
    }
    this.emitter.emit("event", event);
  }

  snapshot(): JobStatus {
    return {
      id: this.id,
      state: this.state,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      error: this.error,
    };
  }
}

export class JobManager {
  private readonly maxConcurrent: number;
  private readonly timeoutMs: number;
  private running = 0;
  private readonly queue: { job: Job; run: JobRunner }[] = [];
  private readonly jobs = new Map<string, Job>();
  private readonly history: Job[] = [];

  constructor(maxConcurrent: number, timeoutSeconds: number) {
    this.maxConcurrent = maxConcurrent;
    this.timeoutMs = timeoutSeconds * 1000;
  }

  enqueue(run: JobRunner): Job {
    const job = new Job();
    this.jobs.set(job.id, job);
    this.queue.push({ job, run });
    this.track(job);
    this.drain();
    return job;
  }

  get(id: string) {
    return this.jobs.get(id);
  }

  cancel(id: string) {
    const queuedIndex = this.queue.findIndex((entry) => entry.job.id === id);
    if (queuedIndex >= 0) {
      const [entry] = this.queue.splice(queuedIndex, 1);
      entry.job.state = "cancelled";
      entry.job.finishedAt = new Date().toISOString();
      entry.job.emit({ type: "state", state: "cancelled" });
      return true;
    }

    const runningJob = this.jobs.get(id);
    if (!runningJob) {
      return false;
    }
    if (runningJob.state !== "running") {
      return false;
    }
    void runningJob.cancel();
    runningJob.state = "cancelled";
    runningJob.finishedAt = new Date().toISOString();
    runningJob.emit({ type: "state", state: "cancelled" });
    return true;
  }

  listRecent() {
    return this.history.map((job) => job.snapshot());
  }

  private track(job: Job) {
    this.history.push(job);
    if (this.history.length > 100) {
      this.history.shift();
    }
  }

  private drain() {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const entry = this.queue.shift();
      if (!entry) {
        return;
      }
      this.runJob(entry.job, entry.run);
    }
  }

  private runJob(job: Job, run: JobRunner) {
    this.running += 1;
    job.state = "running";
    job.startedAt = new Date().toISOString();
    job.emit({ type: "state", state: "running" });

    let timeoutHandle: NodeJS.Timeout | undefined;

    if (this.timeoutMs > 0) {
      timeoutHandle = setTimeout(async () => {
        if (job.state !== "running") {
          return;
        }
        job.error = timeoutError().body;
        await job.cancel();
        job.state = "error";
        job.finishedAt = new Date().toISOString();
        job.emit({ type: "state", state: "error", message: "Timed out" });
      }, this.timeoutMs);
    }

    const ctx: JobContext = {
      logStdout: (line) => job.emit({ type: "log", stream: "stdout", line }),
      logStderr: (line) => job.emit({ type: "log", stream: "stderr", line }),
      progress: (event) => job.emit({ type: "progress", ...event }),
      setCancel: (fn) => job.setCancel(fn),
      isCancelled: () => job.cancelRequested,
    };

    run(ctx)
      .then(() => {
        if (job.state !== "running") {
          return;
        }
        job.state = "done";
        job.finishedAt = new Date().toISOString();
        job.emit({ type: "state", state: "done" });
      })
      .catch((err: unknown) => {
        if (job.state !== "running") {
          return;
        }
        job.state = "error";
        job.finishedAt = new Date().toISOString();
        job.error = {
          errorCode: "internal_error",
          message: err instanceof Error ? err.message : "Job failed.",
        };
        job.emit({ type: "state", state: "error", message: job.error.message });
      })
      .finally(() => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        this.running -= 1;
        this.drain();
      });
  }
}
