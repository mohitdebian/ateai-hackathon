import * as React from "react";

export type AteMarkProps = {
  size?: number | string;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
};

/**
 * ate.ai Brand Mark: Modern geometric 'A' emblem representing
 * autonomous digital workforce intelligence and human synergy.
 */
export function AteMark({
  size = "1em",
  className,
  style,
  title = "ate.ai",
}: AteMarkProps) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
      style={style}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      {/* Outer Architectural 'A' Silhouette */}
      <path
        className="ate-2 pmk-2"
        d="M52.5 15.2C56 9.6 64 9.6 67.5 15.2L105.8 77.2C109.5 83.2 105.2 91 98.1 91H79.6C75.8 91 72.3 88.9 70.5 85.5L60 65.2L49.5 85.5C47.7 88.9 44.2 91 40.4 91H21.9C14.8 91 10.5 83.2 14.2 77.2L52.5 15.2Z"
      />
      {/* Central Intelligence Spark (Sky-Blue) */}
      <path
        className="ate-1 pmk-1"
        d="M60 34L74.5 61H45.5L60 34Z"
      />
      {/* Digital Workforce Cross-Bridge (Sky-Blue) */}
      <rect
        className="ate-1 pmk-1"
        x="37"
        y="69"
        width="46"
        height="9"
        rx="4.5"
      />
    </svg>
  );
}

export default AteMark;
