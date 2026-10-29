import * as React from "react";

export type ButtonVariant = "solid" | "blue" | "ghost" | "dark";

export interface ButtonProps extends React.ComponentPropsWithoutRef<"button"> {
  variant?: ButtonVariant;
  /** Shows the trailing arrow that slides right on hover. */
  showArrow?: boolean;
}

const variantClass: Record<ButtonVariant, string> = {
  solid: "btn-solid",
  blue: "btn-blue",
  ghost: "btn-ghost",
  dark: "btn-dark",
};

export function Button({
  variant = "solid",
  showArrow,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`btn ${variantClass[variant]} ${className}`.trim()}
      {...rest}
    >
      {children}
      {showArrow ? <span className="btn-arrow">→</span> : null}
    </button>
  );
}

export default Button;
