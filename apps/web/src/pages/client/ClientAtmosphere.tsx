import { useState } from "react";
import { useMediaQuery } from "@mui/material";
import "./clientAtmosphere.css";

const SECTIONS = {
  home: {
    label: "Overview",
    title: "Your operations. In focus.",
    detail: "A clear view of your sites, tickets and next steps.",
  },
  report: {
    label: "Report an issue",
    title: "A direct line to your support team.",
    detail: "Share the details. We will help you get back on track.",
  },
  tickets: {
    label: "My tickets",
    title: "Every update. One place.",
    detail: "Follow progress and stay connected to your service desk.",
  },
  detail: {
    label: "Ticket workspace",
    title: "Move the conversation forward.",
    detail: "Review your report, share files and work toward a resolution.",
  },
};

export function ClientAtmosphere({ pathname }: { pathname: string }) {
  const compact = pathname === "/client/report" || pathname.startsWith("/client/tickets");
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [paused, setPaused] = useState(false);
  const section = pathname.startsWith("/client/tickets/")
    ? SECTIONS.detail
    : pathname === "/client/report"
      ? SECTIONS.report
      : pathname === "/client/tickets"
        ? SECTIONS.tickets
        : SECTIONS.home;
  return (
    <section
      className={`client-atmosphere${compact ? " client-atmosphere-compact" : ""}`}
      data-motion={paused || reduced ? "paused" : "running"}
      aria-label="Client workspace"
    >
      <div className="client-atmosphere-copy">
        <div className="client-eyebrow">
          <span /> CLIENT PORTAL <span className="client-eyebrow-divider">/</span> {section.label}
        </div>
        <h1>{section.title}</h1>
        <p>{section.detail}</p>
        {!reduced && (
          <button
            className="client-motion-control"
            type="button"
            aria-pressed={paused}
            onClick={() => setPaused(!paused)}
          >
            {paused ? "Resume animation" : "Pause animation"}
          </button>
        )}
      </div>
      <div className="client-scene" aria-hidden="true">
        <div className="client-orbit client-orbit-one" />
        <div className="client-orbit client-orbit-two" />
        <div className="client-cube">
          {["front", "back", "left", "right", "top", "bottom"].map((face) => (
            <div key={face} className={`client-cube-face client-cube-${face}`} />
          ))}
        </div>
        <div className="client-scene-shadow" />
        <span className="client-scene-node client-scene-node-one" />
        <span className="client-scene-node client-scene-node-two" />
      </div>
    </section>
  );
}
