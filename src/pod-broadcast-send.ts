import {
  confirmed,
  previewRecipients,
  validateBroadcastText,
  type Recipient,
} from "./pod-broadcast";

export type BroadcastResult = {
  id: string;
  address: string;
  status: "accepted" | "uncertain" | "skipped";
  reason: string;
};
export type BroadcastRun = {
  sent: boolean;
  error?: string;
  results: BroadcastResult[];
};

/** Send only the recipients represented by the confirmed preview, sequentially and without retries. */
export async function runPodBroadcast({
  seats,
  selectedIds,
  text,
  confirmation,
  readInventory,
  sendMessage,
  pause = () => new Promise<void>((resolve) => setTimeout(resolve, 200)),
}: {
  seats: unknown;
  selectedIds: string[];
  text: unknown;
  confirmation: unknown;
  readInventory: () => Promise<{ seats: unknown }>;
  sendMessage: (address: string, text: string) => Promise<unknown>;
  pause?: () => Promise<void>;
}): Promise<BroadcastRun> {
  const checked = validateBroadcastText(text);
  if (!checked.ok)
    return { sent: false, error: `Message is not valid: ${checked.reason}.`, results: [] };
  const preview = previewRecipients(seats, selectedIds);
  if (!preview.recipients.length)
    return { sent: false, error: "Select at least one eligible recipient.", results: [] };
  if (!confirmed(confirmation, preview.recipients.length))
    return { sent: false, error: "Type the exact recipient count to confirm.", results: [] };

  const results: BroadcastResult[] = [];
  for (let index = 0; index < preview.recipients.length; index++) {
    const recipient = preview.recipients[index];
    let current: Recipient | undefined;
    try {
      const latest = await readInventory();
      const checkedLatest = previewRecipients(latest?.seats, [recipient.id]);
      current = checkedLatest.recipients[0];
      if (!current) {
        results.push({
          id: recipient.id,
          address: recipient.address,
          status: "skipped",
          reason: checkedLatest.excluded[0]?.reason || "unknown seat",
        });
        continue;
      }
      if (current.address !== recipient.address || current.runtime !== recipient.runtime) {
        results.push({
          id: recipient.id,
          address: recipient.address,
          status: "skipped",
          reason: "recipient identity changed after preview",
        });
        continue;
      }
    } catch (error) {
      results.push({
        id: recipient.id,
        address: recipient.address,
        status: "skipped",
        reason: `latest inventory unavailable: ${message(error)}`,
      });
      continue;
    }

    try {
      await sendMessage(current.address, checked.text);
      results.push({ id: recipient.id, address: current.address, status: "accepted", reason: "Accepted by OpenRig; this does not confirm the agent read it." });
    } catch (error) {
      results.push({
        id: recipient.id,
        address: current.address,
        status: "uncertain",
        reason: `Delivery is uncertain. Nothing was retried. ${message(error)}`,
      });
    }
    if (index + 1 < preview.recipients.length) {
      try { await pause(); } catch { /* pacing must not create a second send failure */ }
    }
  }
  return { sent: true, results };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "unknown error");
}
