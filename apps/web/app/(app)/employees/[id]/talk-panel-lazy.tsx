"use client";

import dynamic from "next/dynamic";

// @vapi-ai/web is ~79 kB of client JS. Deferred out of the initial bundle —
// it only loads once this component mounts, not on every employee-page visit.
const TalkPanel = dynamic(() => import("./talk-panel").then((m) => m.TalkPanel), {
  ssr: false,
  loading: () => null,
});

export { TalkPanel as TalkPanelLazy };
