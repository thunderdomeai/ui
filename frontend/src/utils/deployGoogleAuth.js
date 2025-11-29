import { KJUR } from "jsrsasign";

export async function getAccessTokenFromServiceAccount(serviceAccount, scope) {
  if (!serviceAccount || typeof serviceAccount !== "object") {
    throw new Error("A service account JSON object is required to request an access token.");
  }
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("Service account must include client_email and private_key fields.");
  }
  const header = { alg: "RS256", typ: "JWT" };
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const payload = {
    iss: serviceAccount.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    exp,
    iat,
  };
  const sHeader = JSON.stringify(header);
  const sPayload = JSON.stringify(payload);
  const jwt = KJUR.jws.JWS.sign("RS256", sHeader, sPayload, serviceAccount.private_key);

  const formData = new URLSearchParams();
  formData.append("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  formData.append("assertion", jwt);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  });

  const data = await response.json();
  if (!data.access_token) {
    throw new Error(`Failed to obtain token: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

export const GOOGLE_CLOUD_SCOPES = Object.freeze({
  CLOUD_PLATFORM: "https://www.googleapis.com/auth/cloud-platform",
  STORAGE_READ_ONLY: "https://www.googleapis.com/auth/devstorage.read_only",
  LOGGING_READ: "https://www.googleapis.com/auth/logging.read",
});
