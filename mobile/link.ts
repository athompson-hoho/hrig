import { Capacitor, registerPlugin } from "@capacitor/core";

export interface Invitation {
  v: 1;
  hostId: string;
  name: string;
  urls: string[];
  fingerprint: string;
  code: string;
  expiresAt: number;
}
export interface HostProfile {
  hostId: string;
  name: string;
  urls: string[];
  fingerprint: string;
  credential: string;
  deviceId: string;
  expiresAt: number;
  activeURL: string;
}
const native = registerPlugin<{
  load(): Promise<{ value: string }>;
  save(value: { value: string }): Promise<void>;
  request(options: {
    url: string;
    fingerprint: string;
    credential?: string;
    pairing?: boolean;
    data: Record<string, unknown>;
  }): Promise<{ status: number; data: any }>;
}>("HrigLink");

function address(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/" &&
      url.origin === value.replace(/\/$/, "")
    );
  } catch {
    return false;
  }
}
export function parseInvitation(text: string): Invitation {
  if (text.length > 6000) throw new Error("This invitation is too large.");
  let value: any;
  try {
    const cleaned = text.trim();
    const decoded = cleaned.startsWith("hrig1:")
      ? new TextDecoder().decode(
          Uint8Array.from(
            atob(cleaned.slice(6).replace(/-/g, "+").replace(/_/g, "/")),
            (c) => c.charCodeAt(0),
          ),
        )
      : cleaned;
    value = JSON.parse(decoded);
  } catch {
    throw new Error(
      "Paste the complete invitation from desktop Settings > Mobile devices.",
    );
  }
  if (value.v !== 1)
    throw new Error(
      "This invitation needs a different hRig version. Update the phone and desktop.",
    );
  if (
    typeof value.hostId !== "string" ||
    value.hostId.length > 100 ||
    typeof value.name !== "string" ||
    value.name.length > 100 ||
    !Array.isArray(value.urls) ||
    !value.urls.length ||
    value.urls.length > 12 ||
    !value.urls.every(address) ||
    !/^[a-f0-9]{64}$/.test(value.fingerprint) ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.code) ||
    !Number.isFinite(value.expiresAt)
  )
    throw new Error("This is not a valid hRig invitation.");
  if (value.expiresAt <= Date.now())
    throw new Error("Invitation expired. Generate a new one on the desktop.");
  return value;
}
export async function loadProfiles(): Promise<HostProfile[]> {
  if (!Capacitor.isNativePlatform()) return [];
  const profiles = JSON.parse((await native.load()).value);
  if (
    !Array.isArray(profiles) ||
    profiles.some((p) => !p.hostId || !p.credential || !p.urls?.every(address))
  )
    throw new Error(
      "Saved computers could not be read. Pair this phone again.",
    );
  return profiles;
}
export async function saveProfiles(profiles: HostProfile[]) {
  if (!Capacitor.isNativePlatform())
    throw new Error("Remembered devices require the Android or iOS app.");
  await native.save({ value: JSON.stringify(profiles) });
}
export class LinkError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}
async function request(
  url: string,
  fingerprint: string,
  data: Record<string, unknown>,
  credential?: string,
) {
  if (!Capacitor.isNativePlatform())
    throw new LinkError(
      "QR invitations require the native hRig app so the computer's TLS identity can be verified. Browser clients can use the legacy connection form.",
    );
  const response = await native.request({
    url: new URL("/api", url).href,
    fingerprint,
    data,
    credential,
    pairing: !credential,
  });
  if (response.status !== 200)
    throw new LinkError(
      response.status === 401
        ? "Device approval expired or was revoked. Pair again from the desktop."
        : response.data.error || "The host refused this request.",
      response.status,
    );
  return response.data.result;
}
export async function startPairing(invitation: Invitation, name: string) {
  let error: Error = new Error(
    "No reachable host. Check gateway, firewall, LAN or Tailscale.",
  );
  // Invitation request is a mutation: try another address only for transport errors
  // before a pending response exists. An uncertain request can consume the invite;
  // never silently create an additional invitation or approve anything.
  for (const url of invitation.urls.slice(0, 4)) {
    try {
      const pending = await request(url, invitation.fingerprint, {
        op: "pair.request",
        code: invitation.code,
        name,
      });
      return { ...pending, url } as {
        id: string;
        pollSecret: string;
        phrase: string;
        expiresAt: number;
        url: string;
      };
    } catch (e) {
      error = e as Error;
      if (e instanceof LinkError && e.status) throw e;
    }
  }
  throw error;
}
export async function pollPairing(
  invitation: Invitation,
  pending: { id: string; pollSecret: string; url: string },
) {
  return request(pending.url, invitation.fingerprint, {
    op: "pair.poll",
    id: pending.id,
    pollSecret: pending.pollSecret,
  });
}
export function cancelPairing(
  invitation: Invitation,
  pending: { id: string; pollSecret: string; url: string },
) {
  return request(pending.url, invitation.fingerprint, {
    op: "pair.cancel",
    id: pending.id,
    pollSecret: pending.pollSecret,
  });
}
export async function reconnectProfile(
  profile: HostProfile,
): Promise<{ profile: HostProfile; hosts: { id: string; name: string }[] }> {
  if (profile.expiresAt <= Date.now())
    throw new LinkError(
      "Device approval expired. Pair again from the desktop.",
      401,
    );
  let error: Error = new Error(
    "Computer is offline. Start mobile access in desktop Settings.",
  );
  const urls = [...new Set([profile.activeURL, ...profile.urls])]
    .filter(Boolean)
    .slice(0, 4);
  for (const url of urls) {
    try {
      const hosts = await request(
        url,
        profile.fingerprint,
        { op: "connections" },
        profile.credential,
      );
      return { profile: { ...profile, activeURL: url }, hosts };
    } catch (e) {
      error = e as Error;
      if (e instanceof LinkError && e.status === 401) throw e;
    }
  }
  throw error;
}
export function hostRequest(
  profile: HostProfile,
  data: Record<string, unknown>,
) {
  // Mutations use the current confirmed address once, with no automatic retry.
  return request(
    profile.activeURL,
    profile.fingerprint,
    data,
    profile.credential,
  );
}
