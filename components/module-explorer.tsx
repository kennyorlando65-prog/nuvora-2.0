"use client";

import { useMemo, useState } from "react";

type Line = {
  id: string;
  name: string;
  summary: string;
  fulfilment: string;
  note: string;
};

const LINES: Line[] = [
  {
    id: "esim",
    name: "eSIM data plans",
    summary: "Local and regional data bundles installed by QR code, no physical SIM.",
    fulfilment: "Supplier issuance, then QR delivery",
    note: "Availability depends on the destination network the supplier can reach.",
  },
  {
    id: "topups",
    name: "Airtime & data top-ups",
    summary: "Mobile credit and data bundles sent to a number you specify.",
    fulfilment: "Supplier top-up, then confirmation",
    note: "The recipient number is validated before payment is captured.",
  },
  {
    id: "giftcards",
    name: "Gift cards",
    summary: "Digital gift card codes for the brands we are authorised to resell.",
    fulfilment: "Code issuance, then redemption",
    note: "Region-locked cards are filtered out for your billing country.",
  },
  {
    id: "gamecredits",
    name: "Game credits",
    summary: "In-game currency and top-up codes for supported platforms.",
    fulfilment: "Code issuance, then redemption",
    note: "Platform terms govern redemption and are shown before purchase.",
  },
  {
    id: "subscriptions",
    name: "Subscriptions",
    summary: "Prepaid subscription codes and periods for supported services.",
    fulfilment: "Code issuance or activation",
    note: "Recurring supplier billing is never passed on to your card.",
  },
];

export function ModuleExplorer() {
  const [activeId, setActiveId] = useState<string>(LINES[0]!.id);

  const active = useMemo(
    () => LINES.find((line) => line.id === activeId) ?? LINES[0]!,
    [activeId],
  );

  return (
    <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <ul
        className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0"
        role="tablist"
        aria-label="Product lines"
      >
        {LINES.map((line) => {
          const isActive = line.id === active.id;
          return (
            <li key={line.id} className="shrink-0 lg:shrink">
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveId(line.id)}
                className={[
                  "w-full whitespace-nowrap rounded-lg border px-4 py-3 text-left text-sm transition-colors lg:whitespace-normal",
                  isActive
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-line bg-panel text-muted hover:border-dim hover:text-ink",
                ].join(" ")}
              >
                <span className="font-medium">{line.name}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div
        role="tabpanel"
        aria-live="polite"
        className="nuvora-card flex flex-col justify-between gap-6 p-6 sm:p-7"
      >
        <div>
          <p className="nuvora-label">{active.id}</p>
          <h3 className="mt-2 text-xl font-semibold text-ink">{active.name}</h3>
          <p className="mt-3 text-sm leading-relaxed text-muted">{active.summary}</p>
        </div>

        <dl className="grid gap-4 border-t border-line-soft pt-5 sm:grid-cols-2">
          <div>
            <dt className="nuvora-label">Fulfilment</dt>
            <dd className="mt-1.5 text-sm text-ink">{active.fulfilment}</dd>
          </div>
          <div>
            <dt className="nuvora-label">Before you pay</dt>
            <dd className="mt-1.5 text-sm text-ink">{active.note}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
