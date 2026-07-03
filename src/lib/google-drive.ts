import crypto from "crypto";

export async function getGoogleAccessToken(serviceAccountJson: string): Promise<string> {
  const creds = JSON.parse(serviceAccountJson);
  const privateKey = creds.private_key;
  const clientEmail = creds.client_email;
  const tokenUrl = creds.token_uri || "https://oauth2.googleapis.com/token";

  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: tokenUrl,
    exp: now + 3600,
    iat: now,
  };

  const base64UrlEncode = (str: string) => {
    return Buffer.from(str)
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const claimB64 = base64UrlEncode(JSON.stringify(claim));
  const signatureInput = `${headerB64}.${claimB64}`;

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signatureInput);
  const signature = sign.sign(privateKey, "base64");
  const signatureB64 = signature
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const jwt = `${signatureInput}.${signatureB64}`;

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google Authentication failed: ${response.statusText} - ${errorBody}`);
  }

  const data = await response.json();
  return data.access_token;
}

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
};

export async function listFilesInFolder(
  folderId: string,
  accessToken: string
): Promise<DriveFile[]> {
  const query = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType,modifiedTime)&orderBy=modifiedTime%20desc`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const errTxt = await response.text();
    throw new Error(`Cannot list Drive folder: ${response.statusText}. ${errTxt}`);
  }

  const data = await response.json();
  return (data.files || []) as DriveFile[];
}

export async function getFileContent(fileId: string, accessToken: string): Promise<ArrayBuffer> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const errTxt = await response.text();
    throw new Error(`Cannot download Drive file: ${response.statusText}. ${errTxt}`);
  }

  return response.arrayBuffer();
}
