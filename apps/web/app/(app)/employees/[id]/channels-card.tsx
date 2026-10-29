"use client";

import { useState } from "react";
import { Card } from "@ate/design/components/Card";
import { PhoneButton } from "./phone-button";

export function ChannelsCard({
  employeeId,
  emailAddress,
  phoneNumber,
  phoneStatus,
  phoneConnectorActive,
  isHired,
  slackDmUrl,
  slackInstallUrl,
  slackHandle,
  onCallClick,
}: {
  employeeId: string;
  emailAddress: string | null;
  phoneNumber: string | null;
  phoneStatus: string | null;
  phoneConnectorActive: boolean;
  isHired: boolean;
  slackDmUrl: string | null;
  slackInstallUrl: string | null;
  slackHandle: string | null;
  onCallClick?: () => void;
}) {
  const [copiedEmail, setCopiedEmail] = useState(false);

  const handleCopyEmail = () => {
    if (!emailAddress) return;
    navigator.clipboard.writeText(emailAddress);
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  return (
    <Card className="profile-card channels-card">
      <h2 className="channels-card-title">Channels</h2>

      <div className="channels-card-list">
        {/* Email Row */}
        <div className="channels-card-row">
          <div className="channels-card-info">
            <span className="channels-card-label">Email</span>
            <span className="channels-card-value">
              {emailAddress || "Not connected"}
            </span>
          </div>
          {emailAddress && (
            <button
              type="button"
              className="channels-card-btn"
              onClick={handleCopyEmail}
            >
              {copiedEmail ? "Copied!" : "Copy"}
            </button>
          )}
        </div>

        {/* Phone Row */}
        {(phoneConnectorActive || phoneNumber) && (
          <div className="channels-card-row">
            <div className="channels-card-info">
              <span className="channels-card-label">Phone</span>
              <span className="channels-card-value">
                {phoneNumber || "Not connected"}
              </span>
            </div>
            <div>
              {phoneNumber ? (
                <button
                  type="button"
                  className="channels-card-btn"
                  onClick={onCallClick}
                >
                  Call
                </button>
              ) : isHired ? (
                <PhoneButton
                  employeeId={employeeId}
                  number={phoneNumber}
                  status={phoneStatus}
                />
              ) : null}
            </div>
          </div>
        )}

        {/* Slack Row */}
        <div className="channels-card-row">
          <div className="channels-card-info">
            <span className="channels-card-label">Slack</span>
            <span className="channels-card-value">
              {slackDmUrl ? "Connected" : slackHandle || "Not connected"}
            </span>
          </div>
          {slackDmUrl ? (
            <a
              href={slackDmUrl}
              target="_blank"
              rel="noreferrer"
              className="channels-card-btn"
            >
              Open
            </a>
          ) : slackInstallUrl ? (
            <a
              href={slackInstallUrl}
              className="channels-card-btn channels-card-btn-primary"
            >
              Connect
            </a>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
