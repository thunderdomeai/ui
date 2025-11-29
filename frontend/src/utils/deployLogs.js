import { getAccessTokenFromServiceAccount, GOOGLE_CLOUD_SCOPES } from "./deployGoogleAuth.js";

const LOGGING_API_URL = "https://logging.googleapis.com/v2/entries:list";

function ensureString(value) {
  return typeof value === "string" ? value : value != null ? String(value) : "";
}

function combineLabels(entry) {
  const labels = {};
  if (entry && typeof entry === "object") {
    if (entry.labels && typeof entry.labels === "object") {
      Object.assign(labels, entry.labels);
    }
    if (entry.resource && typeof entry.resource === "object" && entry.resource.labels) {
      Object.assign(labels, entry.resource.labels);
    }
  }
  return labels;
}

function parseLogEntryToLines(entry) {
  if (entry == null) {
    return [];
  }
  if (typeof entry === "string") {
    return [entry];
  }
  if (typeof entry !== "object") {
    return [ensureString(entry)];
  }

  const timestamp = entry.timestamp || entry.receiveTimestamp;
  const prefix = timestamp ? `[${timestamp}] ` : "";
  const seen = new Set();
  const append = (value) => {
    if (typeof value !== "string") {
      return;
    }
    const text = value.trim();
    if (!text) {
      return;
    }
    const withPrefix = `${prefix}${text}`;
    if (!seen.has(withPrefix)) {
      seen.add(withPrefix);
    }
  };

  append(entry.textPayload);

  const jsonPayload = entry.jsonPayload;
  if (typeof jsonPayload === "string") {
    append(jsonPayload);
  } else if (jsonPayload && typeof jsonPayload === "object") {
    if (typeof jsonPayload.message === "string") {
      append(jsonPayload.message);
    } else {
      try {
        append(JSON.stringify(jsonPayload));
      } catch (error) {
        append(String(jsonPayload));
      }
    }
  }

  const protoPayload = entry.protoPayload;
  if (protoPayload && typeof protoPayload === "object") {
    if (protoPayload.status && typeof protoPayload.status.message === "string") {
      append(protoPayload.status.message);
    }
    const lineItems = protoPayload.line;
    if (Array.isArray(lineItems)) {
      for (const item of lineItems) {
        if (item && typeof item === "object") {
          if (typeof item.logMessage === "string") {
            append(item.logMessage);
          }
          if (typeof item.message === "string") {
            append(item.message);
          }
        }
      }
    }
  }

  append(entry.message);
  append(entry.Message);

  if (seen.size === 0) {
    try {
      append(JSON.stringify(entry));
    } catch (error) {
      append(String(entry));
    }
  }

  return Array.from(seen);
}

function normaliseLogEntry(entry) {
  const lineMessages = parseLogEntryToLines(entry);
  return {
    timestamp: entry?.timestamp || entry?.receiveTimestamp || null,
    severity: entry?.severity || entry?.jsonPayload?.severity || entry?.protoPayload?.severity || "DEFAULT",
    text: lineMessages.join("\n"),
    labels: combineLabels(entry),
    resource: entry?.resource || null,
    raw: entry,
    lineMessages,
  };
}

async function requestLogEntries({ token, projectId, filter, limit = 100, orderBy = "timestamp asc" }) {
  const response = await fetch(LOGGING_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      resourceNames: [`projects/${projectId}`],
      filter,
      orderBy,
      pageSize: limit,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Logging API error (${response.status}): ${detail || response.statusText}`);
  }

  const payload = await response.json();
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  return { entries, raw: payload };
}

function buildJobLogFilters({ executionName, jobName, region }) {
  if (!executionName) {
    return [];
  }
  const filters = [];
  const executionFragment = `labels.\"run.googleapis.com/execution_name\"=\"${executionName}\"`;
  const locationFragment = region ? ` AND resource.labels.location=\"${region}\"` : "";

  if (jobName) {
    filters.push(
      `resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"${jobName}\"${locationFragment} AND ${executionFragment}`
    );
    filters.push(
      `resource.type=\"cloud_run_revision\" AND resource.labels.job_name=\"${jobName}\"${locationFragment} AND ${executionFragment}`
    );
  }

  if (region) {
    filters.push(`resource.labels.location=\"${region}\" AND ${executionFragment}`);
  }

  filters.push(executionFragment);

  return Array.from(new Set(filters));
}

function deriveDeploymentOutcomeFromLogs(logLines, { executionName, jobSucceeded }) {
  if (!Array.isArray(logLines) || logLines.length === 0) {
    return {
      deploymentOutcome: jobSucceeded ? "success_job_no_logs" : "error_job_no_logs",
      errorDetails: null,
      deployedServiceUrl: null,
      instanceId: null,
    };
  }

  let deploymentOutcome = jobSucceeded ? "success_job_no_markers" : "error_job_no_markers";
  let errorDetails = null;
  let deployedServiceUrl = null;
  let instanceId = null;

  for (const line of logLines) {
    if (typeof line !== "string") {
      continue;
    }
    if (!instanceId && line.includes("FINAL_INSTANCE_ID:")) {
      instanceId = line.split("FINAL_INSTANCE_ID:", 2)[1]?.trim() || null;
    }
    if (line.includes("FINAL_DEPLOYMENT_STATUS_ERROR:")) {
      const raw = line.split("FINAL_DEPLOYMENT_STATUS_ERROR:", 2)[1] || "";
      errorDetails = raw.replace(" \n ", "\n").trim();
      deploymentOutcome = "error_job_internal";
    }
    if (!errorDetails && line.includes("FINAL_DEPLOYMENT_STATUS_SUCCESS_URL:")) {
      const raw = line.split("FINAL_DEPLOYMENT_STATUS_SUCCESS_URL:", 2)[1] || "";
      deployedServiceUrl = raw.trim() || null;
      if (deployedServiceUrl) {
        deploymentOutcome = "success_deployed";
      }
    }
    if (!errorDetails && line.toLowerCase().includes("error")) {
      errorDetails = line.trim();
      deploymentOutcome = "error_job_detected";
    }
  }

  return {
    deploymentOutcome,
    errorDetails,
    deployedServiceUrl,
    instanceId,
  };
}

export async function fetchJobExecutionLogs({ serviceAccount, projectId, executionName, jobName, region, jobSucceeded }) {
  const token = await getAccessTokenFromServiceAccount(serviceAccount, GOOGLE_CLOUD_SCOPES.LOGGING_READ);
  const filters = buildJobLogFilters({ executionName, jobName, region });

  const allEntries = [];
  for (const filter of filters) {
    try {
      const { entries } = await requestLogEntries({
        token,
        projectId,
        filter,
        orderBy: "timestamp asc",
        limit: 400,
      });
      allEntries.push(...entries.map(normaliseLogEntry));
    } catch (error) {
      console.error("Logging API query failed with filter:", filter, error);
    }
  }

  const sortedEntries = allEntries.sort((a, b) => {
    const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return aTime - bTime;
  });

  const logLines = sortedEntries.flatMap((entry) => entry.lineMessages || []);
  const derived = deriveDeploymentOutcomeFromLogs(logLines, { executionName, jobSucceeded });

  return {
    lines: logLines,
    logs: sortedEntries,
    raw: sortedEntries,
    ...derived,
  };
}
