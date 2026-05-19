export function WindowControlIcon({ type }: { type: "minimize" | "maximize" | "close" }) {
  if (type === "minimize") {
    return (
      <svg className="window-control-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <path d="M2.25 6.5h7.5" />
      </svg>
    );
  }

  if (type === "maximize") {
    return (
      <svg className="window-control-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <rect x="2.75" y="2.75" width="6.5" height="6.5" rx="0.5" />
      </svg>
    );
  }

  return (
    <svg className="window-control-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M3 3l6 6M9 3L3 9" />
    </svg>
  );
}

export function ActivityIcon({ type }: { type: "logo" | "analysis" | "result" | "login" | "settings" | "help" }) {
  if (type === "logo") {
    return (
      <svg className="activity-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
        <path d="M3.25 9.5a5.75 5.75 0 1 1 2.18 4.5" />
        <path d="M3.25 12.5h4.5a3 3 0 0 0 0-6H6.5" />
      </svg>
    );
  }

  if (type === "analysis") {
    return (
      <svg className="activity-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
        <path d="M3.25 14.25h11.5" />
        <path d="M5 11.5V7.75" />
        <path d="M9 11.5V4" />
        <path d="M13 11.5V6" />
      </svg>
    );
  }

  if (type === "result") {
    return (
      <svg className="activity-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
        <path d="M4 3.5h7.25L14 6.25v8.25H4z" />
        <path d="M11.25 3.5v2.75H14" />
        <path d="M6.25 8.25h5.5" />
        <path d="M6.25 10.75h5.5" />
        <path d="M6.25 13.25h3.25" />
      </svg>
    );
  }

  if (type === "settings") {
    return (
      <svg className="activity-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
        <circle cx="9" cy="9" r="2.1" />
        <path d="M9 2.75v2" />
        <path d="M9 13.25v2" />
        <path d="M3.59 5.88l1.73 1" />
        <path d="M12.68 11.13l1.73 1" />
        <path d="M3.59 12.12l1.73-1" />
        <path d="M12.68 6.87l1.73-1" />
      </svg>
    );
  }

  if (type === "login") {
    return (
      <svg className="activity-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
        <path d="M4 8.25V6a5 5 0 0 1 10 0v2.25" />
        <rect x="3.25" y="7.75" width="11.5" height="7" rx="1.25" />
        <path d="M9 10.25v2" />
      </svg>
    );
  }

  return (
    <svg className="activity-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <circle cx="9" cy="9" r="6.25" />
      <path d="M7.35 7.2a1.8 1.8 0 1 1 2.7 1.56c-.7.42-1.05.84-1.05 1.74" />
      <path d="M9 13.05h.01" />
    </svg>
  );
}

export function HelpIcon() {
  return (
    <svg className="field-help-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6" />
      <path d="M6.55 6.55a1.55 1.55 0 1 1 2.3 1.36c-.58.36-.85.72-.85 1.49" />
      <path d="M8 11.75h.01" />
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg className="more-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="4" cy="8" r="1.15" />
      <circle cx="8" cy="8" r="1.15" />
      <circle cx="12" cy="8" r="1.15" />
    </svg>
  );
}

export function PosterControlIcon({ type }: { type: "minus" | "plus" | "close" }) {
  if (type === "minus") {
    return (
      <svg className="poster-control-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M4 8h8" />
      </svg>
    );
  }

  if (type === "plus") {
    return (
      <svg className="poster-control-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M8 4v8" />
        <path d="M4 8h8" />
      </svg>
    );
  }

  return (
    <svg className="poster-control-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4.5 4.5l7 7" />
      <path d="M11.5 4.5l-7 7" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg className="history-delete-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3.25 4.25h9.5" />
      <path d="M6.25 4.25V3h3.5v1.25" />
      <path d="M5 6.25l.35 6.25h5.3L11 6.25" />
      <path d="M7.1 7.25v3.9" />
      <path d="M8.9 7.25v3.9" />
    </svg>
  );
}

export function CacheActionIcon({ type }: { type: "open" | "change" | "reset" | "configReset" | "clear" }) {
  if (type === "open") {
    return (
      <svg className="cache-action-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M2.75 5.25h3.55l1.05 1.25h5.9v6.25H2.75z" />
        <path d="M2.75 5.25V3.75h3.1l1.05 1.5" />
        <path d="M9.75 9.6h2.25" />
        <path d="M10.9 8.45l1.1 1.15-1.1 1.15" />
      </svg>
    );
  }

  if (type === "change") {
    return (
      <svg className="cache-action-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M3 12.65l2.05-.45 6.65-6.65-1.6-1.6-6.65 6.65z" />
        <path d="M9.15 4.9l1.6 1.6" />
        <path d="M2.75 13.25h10.5" />
      </svg>
    );
  }

  if (type === "reset") {
    return (
      <svg className="cache-action-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M4.1 6.25a4.35 4.35 0 1 1 .8 4.95" />
        <path d="M4.1 3.65v2.6h2.6" />
        <path d="M8 5.9v2.55l1.7 1" />
      </svg>
    );
  }

  if (type === "configReset") {
    return (
      <svg className="cache-action-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M4.25 2.75h5.25l2.25 2.25v8.25h-7.5z" />
        <path d="M9.5 2.75V5h2.25" />
        <path d="M6.1 8a2.1 2.1 0 1 1 .45 2.3" />
        <path d="M6.1 6.75V8h1.25" />
      </svg>
    );
  }

  return (
    <svg className="cache-action-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3.25 4.25h9.5" />
      <path d="M6.25 4.25V3h3.5v1.25" />
      <path d="M5 6.25l.35 6.25h5.3L11 6.25" />
      <path d="M7.1 7.25v3.9" />
      <path d="M8.9 7.25v3.9" />
    </svg>
  );
}

export function ValidateCredentialIcon() {
  return (
    <svg className="credential-action-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 2.75l4.75 1.8v3.2c0 2.9-1.78 4.8-4.75 5.95-2.97-1.15-4.75-3.05-4.75-5.95v-3.2z" />
      <path d="M5.85 8.05l1.35 1.35 2.95-3.05" />
    </svg>
  );
}
