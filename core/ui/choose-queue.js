/**
 * The first sign-in on a device where both this device and the account
 * already hold a queue. Either answer discards the other side with no undo,
 * so it is asked, and the question names both counts.
 *
 * Shared by the side panel and Settings, the two places a sign-in starts, so
 * the one irreversible question reads the same wherever it is asked.
 *
 * @param {{device: number, cloud: number}} counts
 * @returns {Promise<"cloud"|"device">}
 */
export async function chooseQueue({ device, cloud }) {
  const keepCloud = window.confirm(
    `Your account already has a queue of ${cloud} contest${cloud === 1 ? "" : "s"} in the cloud, ` +
      `and this device has ${device}.\n\n` +
      `OK — use the cloud queue and replace this device's.\n` +
      `Cancel — keep this device's queue and replace the cloud's.`,
  );
  return keepCloud ? "cloud" : "device";
}
