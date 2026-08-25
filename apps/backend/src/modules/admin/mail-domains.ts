/**
 * MAIL DOMAINS — the admin's spare-domain pool for agent email.
 *
 * The founder's rule: the main domain never carries agent mail. One spammy
 * agent could get triven.ai blacklisted, and that kills everything — login
 * mails, invoices, the brand. So the admin adds domains they bought, pastes
 * three DNS lines, and once the mail engine confirms them, the proxy
 * addresses live there. Damage, if it ever comes, burns a spare.
 *
 * Extremely simple on purpose: type a domain → get exactly three lines to
 * paste at the domain provider → a chip flips from "Waiting for DNS" to
 * "Verified". Nothing else to know.
 *
 * The list lives in one PlatformApiSetting row; the STATUS is never stored —
 * it is asked of the mail engine live, because a stored status is a lie
 * waiting for a DNS change nobody told us about.
 */

import {
  SESv2Client,
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  DeleteEmailIdentityCommand
} from "@aws-sdk/client-sesv2";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";

const STORE_KEY = "mailSendingDomains";

export type MailDomain = {
  domain: string;
  /** The three DNS lines: CNAME name → value, straight from the mail engine. */
  dnsRecords: Array<{ type: "CNAME"; name: string; value: string }>;
  isDefault: boolean;
  addedAt: string;
};

export type MailDomainWithStatus = MailDomain & {
  /** verified | waiting | failed — asked live, never stored. */
  status: "verified" | "waiting" | "failed";
};

let client: SESv2Client | null = null;
function ses(): SESv2Client {
  if (!client) {
    client = new SESv2Client({
      region: env.SES_REGION ?? env.AWS_REGION,
      credentials:
        env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
          ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
          : undefined
    });
  }
  return client;
}

const HOSTNAME = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

export function isValidDomainName(domain: string): boolean {
  return HOSTNAME.test(domain.trim().toLowerCase());
}

async function readStored(): Promise<MailDomain[]> {
  const row = await prisma.platformApiSetting.findUnique({
    where: { key: STORE_KEY },
    select: { valueEncrypted: true }
  });
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.valueEncrypted) as MailDomain[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeStored(domains: MailDomain[], updatedByUserId: string): Promise<void> {
  await prisma.platformApiSetting.upsert({
    where: { key: STORE_KEY },
    update: { valueEncrypted: JSON.stringify(domains), secret: false, updatedByUserId },
    create: { key: STORE_KEY, valueEncrypted: JSON.stringify(domains), secret: false, updatedByUserId }
  });
  defaultCache = undefined;
}

function dkimToRecords(domain: string, tokens: string[]): MailDomain["dnsRecords"] {
  return tokens.map((token) => ({
    type: "CNAME" as const,
    name: `${token}._domainkey.${domain}`,
    value: `${token}.dkim.amazonses.com`
  }));
}

/** Live verification status from the mail engine. */
async function liveStatus(domain: string): Promise<MailDomainWithStatus["status"]> {
  try {
    const identity = await ses().send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
    const dkim = identity.DkimAttributes?.Status;
    if (dkim === "SUCCESS" && identity.VerifiedForSendingStatus) return "verified";
    if (dkim === "FAILED") return "failed";
    return "waiting";
  } catch {
    return "waiting";
  }
}

export async function listMailDomains(): Promise<MailDomainWithStatus[]> {
  const stored = await readStored();
  return Promise.all(
    stored.map(async (entry) => ({ ...entry, status: await liveStatus(entry.domain) }))
  );
}

export async function addMailDomain(rawDomain: string, updatedByUserId: string): Promise<MailDomainWithStatus> {
  const domain = rawDomain.trim().toLowerCase();
  if (!isValidDomainName(domain)) throw new Error("That doesn't look like a domain — e.g. trivenmail.com");

  const stored = await readStored();
  if (stored.some((entry) => entry.domain === domain)) throw new Error("That domain is already added.");

  let tokens: string[] = [];
  try {
    const created = await ses().send(new CreateEmailIdentityCommand({ EmailIdentity: domain }));
    tokens = created.DkimAttributes?.Tokens ?? [];
  } catch (error) {
    /* Already known to the mail engine (added once before) — fetch its lines
       rather than failing the admin for our own history. */
    if ((error as { name?: string })?.name === "AlreadyExistsException") {
      const existing = await ses().send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
      tokens = existing.DkimAttributes?.Tokens ?? [];
    } else {
      throw new Error("The mail engine could not register that domain. Try once more.");
    }
  }

  const entry: MailDomain = {
    domain,
    dnsRecords: dkimToRecords(domain, tokens),
    isDefault: stored.length === 0,
    addedAt: new Date().toISOString()
  };
  await writeStored([...stored, entry], updatedByUserId);
  return { ...entry, status: await liveStatus(domain) };
}

export async function setDefaultMailDomain(domain: string, updatedByUserId: string): Promise<void> {
  const stored = await readStored();
  if (!stored.some((entry) => entry.domain === domain)) throw new Error("That domain is not in the list.");
  await writeStored(
    stored.map((entry) => ({ ...entry, isDefault: entry.domain === domain })),
    updatedByUserId
  );
}

export async function removeMailDomain(domain: string, updatedByUserId: string): Promise<void> {
  const stored = await readStored();
  await writeStored(stored.filter((entry) => entry.domain !== domain), updatedByUserId);
  try {
    await ses().send(new DeleteEmailIdentityCommand({ EmailIdentity: domain }));
  } catch {
    /* Already gone from the engine — the list is what the admin sees. */
  }
}

/* Cached one minute: the sender asks on every platform mail. */
let defaultCache: { domain: string | null; at: number } | undefined;

export function invalidateMailDomainCache(): void {
  defaultCache = undefined;
}

/**
 * The domain agent mail should leave from — the default AND verified one.
 * Null when none is ready, and the shipped sender carries on: a missing spare
 * domain must never stop a mail.
 */
export async function getDefaultSendingDomain(): Promise<string | null> {
  if (defaultCache && Date.now() - defaultCache.at < 60_000) return defaultCache.domain;
  try {
    const stored = await readStored();
    const preferred = stored.find((entry) => entry.isDefault) ?? stored[0];
    if (!preferred) {
      defaultCache = { domain: null, at: Date.now() };
      return null;
    }
    const status = await liveStatus(preferred.domain);
    defaultCache = { domain: status === "verified" ? preferred.domain : null, at: Date.now() };
    return defaultCache.domain;
  } catch {
    return defaultCache?.domain ?? null;
  }
}
