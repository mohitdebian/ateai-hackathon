"use client";

import { useState } from "react";
import { Button } from "@ate/design/components/Button";

import type { IdentityFile } from "@ate/shared";

interface SoulModalProps {
  isOpen: boolean;
  onClose: () => void;
  employeeName: string;
  identity?: Partial<IdentityFile> | null;
}

function formatList(val: unknown): string {
  if (Array.isArray(val)) return val.map((v) => `• ${v}`).join("\n");
  if (typeof val === "string") return val;
  return "";
}

export function SoulModal({
  isOpen,
  onClose,
  employeeName,
  identity,
}: SoulModalProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const soulContent = identity
    ? `# Soul File for ${employeeName}
Role: ${identity.role || "Digital Employee"}

## Scope of Work
${formatList(identity.scope_of_work) || "No specific scope of work defined."}

## Daily Responsibilities
${formatList(identity.daily_responsibilities) || "No daily responsibilities specified."}

## Operating Rules
${formatList(identity.operating_rules) || "Follow standard organization policies and guidelines."}
`
    : `No soul file or prompt configured for ${employeeName}.`;

  const handleCopy = () => {
    navigator.clipboard.writeText(soulContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="soul-modal-content"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="soul-modal-title"
      >
        <div className="soul-modal-header">
          <div>
            <h2 id="soul-modal-title" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
              {employeeName}&rsquo;s Soul File
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--fg-soft)" }}>
              The system prompt, operating boundary, and core behavior definition.
            </p>
          </div>
          <button
            type="button"
            className="soul-modal-close"
            onClick={onClose}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        <div className="soul-modal-body">
          <pre className="soul-modal-code">{soulContent}</pre>
        </div>

        <div className="soul-modal-footer">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="blue" onClick={handleCopy}>
            {copied ? "Copied!" : "Copy soul file"}
          </Button>
        </div>
      </div>
    </div>
  );
}
