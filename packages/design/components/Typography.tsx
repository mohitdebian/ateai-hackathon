import * as React from "react";

export interface EyebrowProps extends React.ComponentPropsWithoutRef<"span"> {}
/** Small uppercase label used above headings. */
export function Eyebrow({ className = "", ...rest }: EyebrowProps) {
  return <span className={`eyebrow ${className}`.trim()} {...rest} />;
}

export interface DisplayHeadingProps
  extends React.ComponentPropsWithoutRef<"h1"> {
  /** Fluid heading size. */
  size?: "lg" | "md";
}
export function DisplayHeading({
  size = "lg",
  className = "",
  ...rest
}: DisplayHeadingProps) {
  return <h1 className={`h-${size} ${className}`.trim()} {...rest} />;
}

export interface LedeProps extends React.ComponentPropsWithoutRef<"p"> {}
/** Larger intro paragraph, dimmed against the dark canvas. */
export function Lede({ className = "", ...rest }: LedeProps) {
  return <p className={`lede ${className}`.trim()} {...rest} />;
}
