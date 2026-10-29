import { AteMark } from "@ate/design/components/brand/AteMark";

export function AteLogo({
  size = 34,
  className = "ate-logo",
}: {
  size?: number;
  className?: string;
} = {}) {
  return (
    <div className={className}>
      <AteMark size={size} title="ate.ai" />
      <span>ate.ai</span>
    </div>
  );
}

export default AteLogo;
