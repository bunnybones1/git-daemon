export type Capability = "open-terminal" | "open-vscode" | "deps/install";

export type ApprovalEntry = {
  origin: string;
  repoPath: string | null;
  capabilities: Capability[];
  approvedAt: string;
};

export type AppConfig = {
  configVersion: number;
  server: {
    host: string;
    port: number;
    https?: {
      enabled?: boolean;
      port?: number;
      keyPath?: string;
      certPath?: string;
    };
  };
  originAllowlist: string[];
  workspaceRoot: string | null;
  pairing: {
    tokenTtlDays: number;
  };
  jobs: {
    maxConcurrent: number;
    timeoutSeconds: number;
  };
  deps: {
    defaultSafer: boolean;
  };
  logging: {
    directory: string;
    maxFiles: number;
    maxBytes: number;
  };
  approvals: {
    entries: ApprovalEntry[];
  };
};

export type ToolInfo = {
  installed: boolean;
  version?: string;
};

export type Capabilities = {
  tools: {
    git?: ToolInfo;
    node?: ToolInfo;
    npm?: ToolInfo;
    pnpm?: ToolInfo;
    yarn?: ToolInfo;
    code?: ToolInfo;
  };
};

export type TokenEntry = {
  origin: string;
  tokenHash: string;
  salt: string;
  createdAt: string;
  expiresAt: string;
};

export type TokenStoreData = {
  entries: TokenEntry[];
};

export type JobState = "queued" | "running" | "done" | "error" | "cancelled";

export type JobLogEvent = {
  type: "log";
  stream: "stdout" | "stderr";
  line: string;
};

export type JobProgressEvent = {
  type: "progress";
  kind: "git" | "deps";
  percent?: number;
  detail?: string;
};

export type JobStateEvent = {
  type: "state";
  state: JobState;
  message?: string;
};

export type JobEvent = JobLogEvent | JobProgressEvent | JobStateEvent;

export type JobStatus = {
  id: string;
  state: JobState;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: ApiErrorBody;
};

export type ApiErrorBody = {
  errorCode:
    | "auth_required"
    | "auth_invalid"
    | "origin_not_allowed"
    | "rate_limited"
    | "request_too_large"
    | "workspace_required"
    | "path_outside_workspace"
    | "invalid_repo_url"
    | "capability_not_granted"
    | "job_not_found"
    | "timeout"
    | "internal_error";
  message: string;
  details?: Record<string, unknown>;
};
