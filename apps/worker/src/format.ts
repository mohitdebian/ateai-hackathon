/**
 * Strip markdown the model still emits despite the prompt (#117) so replies
 * are plain text on every channel — Slack mrkdwn and AgentMail plaintext
 * both differ from Claude's default GitHub-flavored markdown, and neither
 * gets a converter (see #117 "Scope": stop emitting markdown, don't
 * translate it).
 *
 * Single `_italic_` is deliberately left alone: stripping it would mangle
 * `snake_case` tool/column names the employee legitimately sends.
 *
 * Dash style is enforced at generation time, not here (#190).
 */
export function plainText(text: string): string {
  return text
    .replace(/```(?:\w*\n)?([\s\S]*?)```/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^#{1,6}\s+(.+)$/gm, "$1")
    .replace(/\[([^\]]+)\]\(((?:[^()]|\([^()]*\))*)\)/g, "$1 ($2)")
    .trim();
}
