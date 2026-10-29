export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "employee"
  );
}

/** The inbox username hire falls back to; id-suffixed because addresses are global. */
export function defaultEmailUsername(name: string, employeeId: string): string {
  return `${slugify(name)}-${employeeId.slice(0, 6)}`;
}
