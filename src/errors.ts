import type { ApiErrorBody } from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

export const errorBody = (
  errorCode: ApiErrorBody["errorCode"],
  message: string,
  details?: Record<string, unknown>,
): ApiErrorBody => ({
  errorCode,
  message,
  ...(details ? { details } : {}),
});

export const authRequired = () =>
  new ApiError(401, errorBody("auth_required", "Bearer token required."));

export const authInvalid = () =>
  new ApiError(
    401,
    errorBody("auth_invalid", "Bearer token invalid or expired."),
  );

export const originNotAllowed = () =>
  new ApiError(403, errorBody("origin_not_allowed", "Origin not allowed."));

export const rateLimited = () =>
  new ApiError(429, errorBody("rate_limited", "Too many requests."));

export const workspaceRequired = () =>
  new ApiError(
    409,
    errorBody("workspace_required", "Workspace root not configured."),
  );

export const pathOutsideWorkspace = () =>
  new ApiError(
    409,
    errorBody("path_outside_workspace", "Path is outside the workspace root."),
  );

export const invalidRepoUrl = () =>
  new ApiError(
    422,
    errorBody("invalid_repo_url", "Repository URL is invalid."),
  );

export const capabilityNotGranted = () =>
  new ApiError(
    409,
    errorBody("capability_not_granted", "Capability approval required."),
  );

export const jobNotFound = () =>
  new ApiError(404, errorBody("job_not_found", "Job not found."));

export const repoNotFound = () =>
  new ApiError(404, errorBody("internal_error", "Repository not found."));

export const pathNotFound = () =>
  new ApiError(404, errorBody("internal_error", "Path not found."));

export const timeoutError = () =>
  new ApiError(500, errorBody("timeout", "Job timed out."));

export const internalError = (message = "Unexpected error.") =>
  new ApiError(500, errorBody("internal_error", message));
