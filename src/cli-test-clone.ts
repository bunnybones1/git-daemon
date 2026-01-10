import http from "http";
import https from "https";
import type { IncomingMessage } from "http";

const getEnv = (key: string, fallback: string) => process.env[key] || fallback;

const ORIGIN = getEnv("ORIGIN", "https://app.example.com");
const HTTP_PORT = Number(getEnv("PORT", "8790"));
const HTTPS_PORT = Number(getEnv("HTTPS_PORT", "8791"));
const HTTP_BASE = `http://127.0.0.1:${HTTP_PORT}`;
const HTTPS_BASE = `https://127.0.0.1:${HTTPS_PORT}`;
const HTTP_REPO = getEnv(
  "HTTP_REPO_URL",
  "git@github.com:bunnybones1/git-daemon.git",
);
const HTTP_DEST = getEnv("HTTP_DEST_RELATIVE", "bunnybones1/git-daemon");
const HTTPS_REPO = getEnv(
  "HTTPS_REPO_URL",
  "git@github.com:bunnybones1/github-thing.git",
);
const HTTPS_DEST = getEnv("HTTPS_DEST_RELATIVE", "bunnybones1/github-thing");
const HTTPS_INSECURE = getEnv("HTTPS_INSECURE", "0") === "1";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;

const getString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const readJson = (res: IncomingMessage) =>
  new Promise<{ status: number; data: unknown }>((resolve, reject) => {
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
  });

const requestJson = (
  client: typeof http,
  baseUrl: string,
  path: string,
  body: unknown,
  token?: string,
) =>
  new Promise<{ status: number; data: unknown }>((resolve, reject) => {
    const payload = JSON.stringify(body);
    const headers: Record<string, string | number> = {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const req = client.request(
      `${baseUrl}${path}`,
      {
        method: "POST",
        headers,
      },
      (res) => {
        readJson(res).then(resolve).catch(reject);
      },
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });

const requestJsonHttps = (path: string, body: unknown, token?: string) =>
  new Promise<{ status: number; data: unknown }>((resolve, reject) => {
    const payload = JSON.stringify(body);
    const headers: Record<string, string | number> = {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const req = https.request(
      `${HTTPS_BASE}${path}`,
      {
        method: "POST",
        headers,
        rejectUnauthorized: !HTTPS_INSECURE,
      },
      (res) => {
        readJson(res).then(resolve).catch(reject);
      },
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });

const streamEvents = (
  client: typeof http,
  baseUrl: string,
  jobId: string,
  token: string,
) =>
  new Promise<void>((resolve, reject) => {
    const req = client.request(
      `${baseUrl}/v1/jobs/${jobId}/stream`,
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

const streamEventsHttps = (jobId: string, token: string) =>
  new Promise<void>((resolve, reject) => {
    const req = https.request(
      `${HTTPS_BASE}/v1/jobs/${jobId}/stream`,
      {
        method: "GET",
        headers: {
          Origin: ORIGIN,
          Authorization: `Bearer ${token}`,
          Accept: "text/event-stream",
        },
        rejectUnauthorized: !HTTPS_INSECURE,
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
  const start = await requestJson(http, HTTP_BASE, "/v1/pair", {
    step: "start",
  });
  const startData = asRecord(start.data);
  const code = startData ? getString(startData.code) : null;
  if (start.status !== 200 || !code) {
    console.error("Pairing start failed", start.data);
    process.exit(1);
  }

  const confirm = await requestJson(http, HTTP_BASE, "/v1/pair", {
    step: "confirm",
    code,
  });
  const confirmData = asRecord(confirm.data);
  const token = confirmData ? getString(confirmData.accessToken) : null;
  if (confirm.status !== 200 || !token) {
    console.error("Pairing confirm failed", confirm.data);
    process.exit(1);
  }

  let hadError = false;

  const httpClone = await requestJson(
    http,
    HTTP_BASE,
    "/v1/git/clone",
    {
      repoUrl: HTTP_REPO,
      destRelative: HTTP_DEST,
    },
    token,
  );
  const httpCloneData = asRecord(httpClone.data);
  const httpJobId = httpCloneData ? getString(httpCloneData.jobId) : null;
  if (httpClone.status !== 202 || !httpJobId) {
    console.error("HTTP clone request failed", httpClone.data);
    hadError = true;
  } else {
    console.log(`http jobId=${httpJobId}`);
    await streamEvents(http, HTTP_BASE, httpJobId, token);
  }

  const httpsClone = await requestJsonHttps(
    "/v1/git/clone",
    {
      repoUrl: HTTPS_REPO,
      destRelative: HTTPS_DEST,
    },
    token,
  );
  const httpsCloneData = asRecord(httpsClone.data);
  const httpsJobId = httpsCloneData ? getString(httpsCloneData.jobId) : null;
  if (httpsClone.status !== 202 || !httpsJobId) {
    console.error("HTTPS clone request failed", httpsClone.data);
    hadError = true;
  } else {
    console.log(`https jobId=${httpsJobId}`);
    await streamEventsHttps(httpsJobId, token);
  }

  if (hadError) {
    process.exit(1);
  }
};

main().catch((err) => {
  console.error("Test clone failed", err);
  process.exit(1);
});
