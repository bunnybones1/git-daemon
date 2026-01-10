import http from "http";

const getEnv = (key: string, fallback: string) => process.env[key] || fallback;

const ORIGIN = getEnv("ORIGIN", "https://app.example.com");
const PORT = Number(getEnv("PORT", "8790"));
const BASE = `http://127.0.0.1:${PORT}`;
const REPO = getEnv("REPO_URL", "git@github.com:bunnybones1/git-daemon.git");
const DEST = getEnv("DEST_RELATIVE", "bunnybones1/git-daemon");

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;

const getString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const requestJson = (path: string, body: unknown) =>
  new Promise<{ status: number; data: unknown }>((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      `${BASE}${path}`,
      {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            const data = raw ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode || 0, data });
          } catch (err) {
            reject(err);
          }
        });
      },
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });

const requestJsonAuth = (path: string, token: string, body: unknown) =>
  new Promise<{ status: number; data: unknown }>((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      `${BASE}${path}`,
      {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            const data = raw ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode || 0, data });
          } catch (err) {
            reject(err);
          }
        });
      },
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });

const streamEvents = (jobId: string, token: string) =>
  new Promise<void>((resolve, reject) => {
    const req = http.request(
      `${BASE}/v1/jobs/${jobId}/stream`,
      {
        method: "GET",
        headers: {
          Origin: ORIGIN,
          Authorization: `Bearer ${token}`,
          Accept: "text/event-stream",
        },
      },
      (res) => {
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          process.stdout.write(chunk);
        });
        res.on("end", () => {
          resolve();
        });
      },
    );
    req.on("error", reject);
    req.end();
  });

const main = async () => {
  const start = await requestJson("/v1/pair", { step: "start" });
  const startData = asRecord(start.data);
  const code = startData ? getString(startData.code) : null;
  if (start.status !== 200 || !code) {
    console.error("Pairing start failed", start.data);
    process.exit(1);
  }

  const confirm = await requestJson("/v1/pair", {
    step: "confirm",
    code,
  });
  const confirmData = asRecord(confirm.data);
  const token = confirmData ? getString(confirmData.accessToken) : null;
  if (confirm.status !== 200 || !token) {
    console.error("Pairing confirm failed", confirm.data);
    process.exit(1);
  }

  const clone = await requestJsonAuth("/v1/git/clone", token, {
    repoUrl: REPO,
    destRelative: DEST,
  });
  const cloneData = asRecord(clone.data);
  const jobId = cloneData ? getString(cloneData.jobId) : null;
  if (clone.status !== 202 || !jobId) {
    console.error("Clone request failed", clone.data);
    process.exit(1);
  }

  console.log(`jobId=${jobId}`);
  await streamEvents(jobId, token);
};

main().catch((err) => {
  console.error("Test clone failed", err);
  process.exit(1);
});
