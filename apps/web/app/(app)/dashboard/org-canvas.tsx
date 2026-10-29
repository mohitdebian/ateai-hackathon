"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Avatar } from "../../../lib/avatar";

export interface Human {
  id: string;
  name: string;
}
export interface EmpChannels {
  email: boolean;
  slack: boolean;
  phone: boolean;
}

export interface Emp {
  id: string;
  name: string;
  manager_id: string | null;
  role: string;
  scope: string;
  channels?: EmpChannels;
}

/**
 * Dashboard main canvas (docs/product.md "Design vision"): the org chart is the hero view — humans and
 * AI employees in real reporting lines. Hiring starts from the dashboard CTA (#38).
 */
export function OrgCanvas({
  humans,
  employees,
}: {
  humans: Human[];
  employees: Emp[];
}) {
  return <OrgChart humans={humans} employees={employees} />;
}

function OrgChart({
  humans,
  employees,
}: {
  humans: Human[];
  employees: Emp[];
}) {
  const childrenOf = useMemo(() => {
    const map = new Map<string, Emp[]>();
    for (const e of employees) {
      if (!e.manager_id) continue;
      const list = map.get(e.manager_id) ?? [];
      list.push(e);
      map.set(e.manager_id, list);
    }
    return map;
  }, [employees]);

  const knownIds = useMemo(
    () =>
      new Set<string>([
        ...humans.map((h) => h.id),
        ...employees.map((e) => e.id),
      ]),
    [humans, employees],
  );
  // Employees whose manager isn't in the population render as their own roots.
  const orphanEmployees = employees.filter(
    (e) => !e.manager_id || !knownIds.has(e.manager_id),
  );

  if (humans.length === 0 && employees.length === 0) {
    return <Empty />;
  }

  return (
    <div className="org-chart" aria-label="Organization chart">
      <ul className="org-roots">
        {humans.map((h) => (
          <TreeNode
            key={h.id}
            label={h.name || "Admin"}
            sub="Manager"
            childrenOf={childrenOf}
            nodeId={h.id}
          />
        ))}
        {orphanEmployees.map((e) => (
          <EmployeeSubtree key={e.id} emp={e} childrenOf={childrenOf} />
        ))}
      </ul>
    </div>
  );
}

function EmployeeCardContent({
  name,
  role,
  channels,
}: {
  name: string;
  role: string;
  channels?: EmpChannels;
}) {
  return (
    <>
      <div className="org-card-header">
        <Avatar name={name} className="org-card-avatar" />
        <div className="org-card-info">
          <strong>{name}</strong>
          <span>{role}</span>
        </div>
      </div>
      {channels ? (
        <div className="org-card-channels">
          <span
            className={`org-chip ${channels.email ? "org-chip-active" : "org-chip-inactive"}`}
          >
            <img src="/icons/message.svg" alt="" className="org-chip-icon" />
            {channels.email ? "Email" : "Email, not set up"}
          </span>
          <span
            className={`org-chip ${channels.slack ? "org-chip-active" : "org-chip-inactive"}`}
          >
            <img src="/icons/slack.svg" alt="" className="org-chip-icon" />
            {channels.slack ? "Slack" : "Slack, not set up"}
          </span>
          <span
            className={`org-chip ${channels.phone ? "org-chip-active" : "org-chip-inactive"}`}
          >
            <img src="/icons/calling.svg" alt="" className="org-chip-icon" />
            {channels.phone ? "Phone" : "Phone, not set up"}
          </span>
        </div>
      ) : null}
    </>
  );
}

function ManagerCardContent({
  name,
  role,
}: {
  name: string;
  role: string;
}) {
  return (
    <div className="org-card-header">
      <Avatar name={name} className="org-card-avatar" />
      <div className="org-card-info">
        <strong>{name}</strong>
        <span>{role}</span>
      </div>
    </div>
  );
}

function TreeNode({
  label,
  sub,
  childrenOf,
  nodeId,
  href,
  channels,
}: {
  label: string;
  sub: string;
  childrenOf: Map<string, Emp[]>;
  nodeId: string;
  href?: string;
  channels?: EmpChannels;
}) {
  const reports = childrenOf.get(nodeId) ?? [];
  return (
    <li className="org-branch">
      {href ? (
        <Link href={href} className="org-card">
          <EmployeeCardContent name={label} role={sub} channels={channels} />
        </Link>
      ) : (
        <div className="org-card org-card-manager">
          <ManagerCardContent name={label} role={sub} />
        </div>
      )}
      {reports.length > 0 ? (
        <ul className="org-children">
          {reports.map((r) => (
            <EmployeeSubtree key={r.id} emp={r} childrenOf={childrenOf} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function EmployeeSubtree({
  emp,
  childrenOf,
}: {
  emp: Emp;
  childrenOf: Map<string, Emp[]>;
}) {
  return (
    <TreeNode
      label={emp.name}
      sub={emp.role || emp.scope || "AI employee"}
      href={`/employees/${emp.id}`}
      childrenOf={childrenOf}
      nodeId={emp.id}
      channels={emp.channels}
    />
  );
}

function Empty() {
  return (
    <div className="empty-org">
      <h1>Your team starts here</h1>
      <p className="muted">
        Hire your first digital employee to build the org chart.
      </p>
      <Link href="/employees/new" className="btn btn-blue">
        Hire an employee
      </Link>
    </div>
  );
}
