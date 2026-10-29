import Link from "next/link";
import { AteMark } from "@ate/design/components/brand/AteMark";
import { avatarTint, initials } from "../../lib/avatar";

/**
 * App chrome, identical on every route inside (app).
 *
 * The mark and the organization name are deliberately NOT a lockup: a
 * separator sits between them, the mark is larger than the name, and only the
 * mark is a link. Without those, a vendor mark directly left of a tenant name
 * reads as that tenant's own logo.
 */
export function AppHeader({
  organizationName,
  userName,
}: {
  organizationName: string;
  userName: string;
}) {
  return (
    <header className="app-header">
      <div className="app-brand">
        <Link href="/dashboard" className="app-mark" aria-label="ate.ai home">
          <AteMark size={24} title="ate.ai" />
        </Link>
        <span className="app-sep" aria-hidden="true">
          /
        </span>
        <span className="app-org">{organizationName}</span>
      </div>
      <Link
        href="/account"
        className="app-avatar avatar-tint"
        style={avatarTint(userName)}
        aria-label="Open account"
      >
        {initials(userName)}
      </Link>
    </header>
  );
}
