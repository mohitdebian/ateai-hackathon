import type { EmployeeConnectorRow } from "@ate/shared";
import { createAdminClient } from "../supabase/server";

/**
 * Route an inbound message to its employee (#250). One `(provider, address)`
 * lookup serves every connector; the pair is uniquely indexed, so this is the
 * entire routing rule. Its own service-role client: a webhook has no session.
 *
 * Kept apart from the handlers so a webhook route doesn't pull the whole
 * provisioning tree into its bundle.
 */
export async function resolveByAddress(
  provider: string,
  address: string | null | undefined,
): Promise<EmployeeConnectorRow | null> {
  if (!address) return null;
  const { data, error } = await createAdminClient()
    .from("employee_connectors")
    .select("*")
    .eq("provider", provider)
    .eq("address", address)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** One employee's row for one connector — the assistant behind a phone number. */
export async function connectorFor(
  employeeId: string,
  provider: string,
): Promise<EmployeeConnectorRow | null> {
  const { data, error } = await createAdminClient()
    .from("employee_connectors")
    .select("*")
    .eq("employee_id", employeeId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}
