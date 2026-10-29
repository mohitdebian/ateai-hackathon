import * as React from "react";

export interface CardProps extends React.ComponentPropsWithoutRef<"div"> {}

/**
 * Filled panel on the dark canvas. Styling is a class, not inline style, so a
 * caller passing `className` can override it — inline style could not be.
 */
export function Card({ className = "", ...rest }: CardProps) {
  return <div className={`card ${className}`.trim()} {...rest} />;
}

export default Card;
