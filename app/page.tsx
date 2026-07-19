"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SAMPLES } from "@/lib/samples";
import type { SampleCase } from "@/lib/samples";
import type { ResolveResponse } from "@/lib/types";
import styles from "./page.module.css";

/**
 * The case docket.
 *
 * Layout follows the document it represents: a docket header, a rail of open
 * cases, the exhibit under review, and the chain of custody that evidence
 * passes through. The decision is stamped onto the record; the letter that
 * results is rendered on paper, because it is the one artifact here that
 * leaves the machine and reaches a person.
 */

type Stage = "intake" | "perceive" | "adjudicate" | "compose";
type StageState = "idle" | "running" | "done";

const STATIONS: { id: Stage; n: string; name: string; sub: string }[] = [
  { id: "intake", n: "01", name: "Intake", sub: "Photograph filed against the order record" },
  { id: "perceive", n: "02", name: "Observation", sub: "Vision model reports only what it can see" },
  { id: "adjudicate", n: "03", name: "Adjudication", sub: "Deterministic policy engine — no model involved" },
  { id: "compose", n: "04", name: "Correspondence", sub: "Letter written to a decision already made" },
];

const VERDICT_COLOR: Record<string, string> = {
  refund: "var(--v-refund)",
  replace: "var(--v-replace)",
  escalate: "var(--v-escalate)",
  reject: "var(--v-reject)",
};

const VERDICT_LABEL: Record<string, string> = {
  refund: "Refund issued",
  replace: "Replacement sent",
  escalate: "Referred to specialist",
  reject: "Claim declined",
};

const VERDICT_GLYPH: Record<string, React.ReactNode> = {
  refund: <path d="M20 6 9 17l-5-5" />,
  replace: (
    <>
      <path d="M17 2.1 21 6l-4 3.9" />
      <path d="M3 12.6V11a4 4 0 0 1 4-4h14" />
      <path d="m7 21.9-4-3.9 4-3.9" />
      <path d="M21 11.4V13a4 4 0 0 1-4 4H3" />
    </>
  ),
  escalate: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
    </>
  ),
  reject: <path d="M18 6 6 18M6 6l12 12" />,
};

/** Cycled during the live vision call so a multi-second wait reads as work. */
const OBSERVING = [
  "Reading the photograph…",
  "Isolating visible damage…",
  "Scoring confidence…",
];

const money = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function Glyph({ action, className }: { action: string; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {VERDICT_GLYPH[action]}
    </svg>
  );
}

export default function Page() {
  const [selected, setSelected] = useState<SampleCase | null>(null);
  const [stages, setStages] = useState<Record<Stage, StageState>>({
    intake: "idle",
    perceive: "idle",
    adjudicate: "idle",
    compose: "idle",
  });
  const [result, setResult] = useState<ResolveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [liveMode, setLiveMode] = useState<boolean | null>(null);

  const [upload, setUpload] = useState<{ dataUrl: string; mime: string } | null>(null);
  // An upload is evidence filed against the order selected in the rail — never
  // a way to invent an order. The price comes from the server's record; the
  // request carries only an order_id.
  const [statement, setStatement] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const chainRef = useRef<HTMLOListElement>(null);

  const [announcement, setAnnouncement] = useState("");
  const [tick, setTick] = useState(0);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  useEffect(() => {
    fetch("/api/resolve")
      .then((r) => r.json())
      .then((d) => setLiveMode(Boolean(d.live)))
      .catch(() => setLiveMode(false));
    return clearTimers;
  }, []);

  const readResolveResponse = async (res: Response) => {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(
        res.status === 404
          ? "The claim API was not found. On Render, deploy this project as a Web Service, not a Static Site."
          : "The server returned a non-JSON response. Check the Render deploy logs for the API route."
      );
    }
  };

  useEffect(() => {
    if (stages.perceive !== "running") {
      setTick(0);
      return;
    }
    const id = setInterval(() => setTick((i) => (i + 1) % OBSERVING.length), 2200);
    return () => clearInterval(id);
  }, [stages.perceive]);

  const run = useCallback(
    async (
      sample: SampleCase,
      uploaded: { dataUrl: string; mime: string } | null,
      uploadedStatement: string
    ) => {
      clearTimers();
      setBusy(true);
      setError(null);
      setResult(null);
      setStages({ intake: "done", perceive: "running", adjudicate: "idle", compose: "idle" });
      setAnnouncement("Reading the photograph…");
      chainRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });

      try {
        const res = await fetch("/api/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sample_id: uploaded ? undefined : sample.id,
            description: uploaded ? uploadedStatement : sample.description,
            // Reference only. The server resolves this to the trusted record —
            // there is no field here through which a price could be sent.
            order_id: sample.order.order_id,
            image_base64: uploaded ? uploaded.dataUrl.split(",")[1] : undefined,
            image_mime_type: uploaded?.mime,
          }),
        });

        const data = await readResolveResponse(res);

        if (!res.ok) {
          const message = data.message ?? data.error ?? "Something went wrong.";
          setError(message);
          setAnnouncement(`Claim could not be assessed: ${message}`);
          setStages({ intake: "done", perceive: "idle", adjudicate: "idle", compose: "idle" });
          return;
        }

        const typed = data as ResolveResponse;
        setResult(typed);
        setStages((s) => ({ ...s, perceive: "done", adjudicate: "running" }));
        setAnnouncement("Evidence recorded. Applying policy…");
        timers.current.push(
          setTimeout(() => {
            setStages((s) => ({ ...s, adjudicate: "done", compose: "running" }));
            setAnnouncement("Decision stamped. Drafting correspondence…");
          }, 280),
          setTimeout(() => {
            setStages((s) => ({ ...s, compose: "done" }));
            setAnnouncement(
              `${VERDICT_LABEL[typed.decision.action]}${
                typed.decision.amount > 0 ? `, ${money(typed.decision.amount)}` : ""
              }.`
            );
          }, 560)
        );
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Could not reach the server. Check your connection and try again.";
        setError(message);
        setAnnouncement(`Claim could not be assessed: ${message}`);
        setStages({ intake: "done", perceive: "idle", adjudicate: "idle", compose: "idle" });
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const pickCase = (s: SampleCase) => {
    clearTimers();
    setSelected(s);
    setUpload(null);
    setStatement("");
    setResult(null);
    setError(null);
    setStages({ intake: "idle", perceive: "idle", adjudicate: "idle", compose: "idle" });
    if (fileRef.current) fileRef.current.value = "";
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Choose an image file — JPG, PNG, or WebP.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError("That image is over 4 MB. Choose a smaller one.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setUpload({ dataUrl: String(reader.result), mime: file.type });
      setStatement("");
      setResult(null);
      setError(null);
      setStages({ intake: "idle", perceive: "idle", adjudicate: "idle", compose: "idle" });
    };
    reader.readAsDataURL(file);
  };

  const decision = result?.decision;
  const decidingRule = decision?.rules_fired[decision.rules_fired.length - 1];
  const imageSrc = upload?.dataUrl ?? selected?.image;
  const ready = Boolean(selected) && (upload ? statement.trim().length > 0 : true);
  const activeOrder = selected?.order;

  return (
    <main className={styles.page}>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <header className={styles.docket}>
        <div className={styles.mark} aria-hidden="true" />
        <div>
          <h1 className={styles.brandName}>ClaimLens</h1>
          <p className={styles.brandLine}>Claims adjudication · policy v1.0.0</p>
        </div>

        <p className={styles.thesis}>
          The model reports what it sees. The policy engine decides.{" "}
          <strong>Nothing the model outputs can move money.</strong>
        </p>

        {liveMode !== null && (
          <div
            className={`${styles.statusPill} ${
              liveMode ? styles.statusLive : styles.statusDemo
            }`}
          >
            <span className={styles.dot} />
            {liveMode ? "Vision online" : "Replaying cached analysis"}
          </div>
        )}
      </header>

      <div className={styles.layout}>
        {/* ------------------------- case rail ------------------------- */}
        <aside className={styles.rail}>
          <h2 className={styles.railTitle}>Open cases</h2>
          <p className={styles.railHint}>Each one stops at a different rule.</p>

          <div className={styles.caseList} role="tablist" aria-label="Sample claim cases">
            {SAMPLES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                onClick={() => pickCase(s)}
                className={`${styles.caseRow} ${
                  selected?.id === s.id ? styles.caseRowActive : ""
                }`}
                aria-selected={selected?.id === s.id}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.image} alt="" className={styles.caseThumb} />
                <span className={styles.caseMeta}>
                  <span className={styles.caseLabel}>{s.label}</span>
                  <span className={styles.caseTeaser}>{s.teaser}</span>
                </span>
              </button>
            ))}
          </div>

          <div className={styles.uploadZone}>
            <label className={styles.uploadLabel} htmlFor="claim-photo">
              File your own photograph
            </label>
            <input
              id="claim-photo"
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onFile}
              className={styles.fileInput}
            />
            <p className={styles.uploadNote}>
              {liveMode === false
                ? "Live analysis needs a GEMINI_API_KEY on the server. The cases above run without one."
                : selected
                  ? "Your photograph is filed as evidence against the selected order. Select a different case first if this claim concerns another order."
                  : "Select a sample case first. Its order record stays server-held and supplies the trusted price."}
            </p>
          </div>

          <div className={styles.record}>
            <div className={styles.recordHead}>
              <h3 className={styles.recordTitle}>Order record</h3>
              <span className={styles.lockTag}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="4" y="11" width="16" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                Server-held
              </span>
            </div>

            {activeOrder ? (
              <dl className={styles.recordList}>
                <div>
                  <dt>Order</dt>
                  <dd>{activeOrder.order_id}</dd>
                </div>
                <div>
                  <dt>Item</dt>
                  <dd>{activeOrder.item_name}</dd>
                </div>
                <div>
                  <dt>Value</dt>
                  <dd className={styles.recordValue}>{money(activeOrder.item_value)}</dd>
                </div>
                <div>
                  <dt>Delivered</dt>
                  <dd>{activeOrder.days_since_delivery}d ago</dd>
                </div>
                <div>
                  <dt>Category</dt>
                  <dd>{activeOrder.category}</dd>
                </div>
                <div>
                  <dt>Prior claims</dt>
                  <dd>{activeOrder.prior_claims_count}</dd>
                </div>
              </dl>
            ) : (
              <div className={styles.emptyRecord}>
                Select a case to load its server-held order record.
              </div>
            )}

            <p className={styles.recordNote}>
              Read from the order system by ID. The request carries no price field, so
              neither the customer nor the model can alter what an item is worth.
            </p>
          </div>
        </aside>

        {/* --------------------- exhibit + chain ---------------------- */}
        <section className={styles.main}>
          <div className={styles.exhibit}>
            <div className={styles.exhibitFrame}>
              {imageSrc ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageSrc} alt="Claim evidence" className={styles.exhibitImage} />
                  <span className={styles.exhibitTag}>
                    Exhibit A · {activeOrder?.order_id}
                  </span>
                </>
              ) : (
                <div className={styles.emptyExhibit}>No exhibit selected</div>
              )}
            </div>

            <div className={styles.exhibitBody}>
              <div>
                <span className={styles.statementLabel}>Customer statement</span>
                {upload ? (
                  <textarea
                    className={styles.statementInput}
                    aria-label="Describe what happened"
                    aria-describedby={!ready ? "statement-hint" : undefined}
                    value={statement}
                    onChange={(e) => setStatement(e.target.value)}
                    placeholder="Describe what happened, in your own words…"
                    rows={3}
                    maxLength={1000}
                  />
                ) : selected ? (
                  <p className={styles.statement}>{selected.description}</p>
                ) : (
                  <p className={styles.statementMuted}>Choose one of the sample cases to begin.</p>
                )}
              </div>

              <div className={styles.actionRow}>
                <button
                  className={styles.runButton}
                  onClick={() => selected && run(selected, upload, statement)}
                  disabled={busy || !ready}
                  aria-describedby={upload && !ready ? "statement-hint" : undefined}
                >
                  {busy && <span className={styles.runSpinner} aria-hidden="true" />}
                  {busy ? "Assessing" : "Adjudicate claim"}
                </button>
                {upload && !ready && (
                  <p id="statement-hint" className={styles.hint}>
                    Add a statement to continue.
                  </p>
                )}
              </div>
            </div>
          </div>

          {error && (
            <div className={styles.alert} role="alert">
              <strong>Not assessed</strong>
              <span>{error}</span>
            </div>
          )}

          <ol className={styles.chain} ref={chainRef}>
            {STATIONS.map((st) => {
              const state = stages[st.id];
              const isEngine = st.id === "adjudicate";

              return (
                <li
                  key={st.id}
                  className={`${styles.station} ${
                    state === "running"
                      ? styles.stationRunning
                      : state === "done"
                        ? styles.stationDone
                        : ""
                  } ${isEngine ? styles.stationEngine : ""}`}
                >
                  <span className={styles.stationIndex}>{st.n}</span>

                  <div className={styles.stationHead}>
                    <span className={styles.stationName}>{st.name}</span>
                    {isEngine && <span className={styles.engineTag}>Pure function</span>}
                    {state === "running" && (
                      <span className={styles.spinner} aria-label="Working" />
                    )}
                    {state === "done" && result && st.id !== "intake" && (
                      <span className={styles.stationTime}>
                        {result.timings_ms[st.id as keyof typeof result.timings_ms]}ms
                      </span>
                    )}
                  </div>

                  <p className={styles.stationSub}>
                    {st.sub}
                    {st.id === "perceive" && state === "running" && (
                      <span className={styles.liveHint}>{OBSERVING[tick]}</span>
                    )}
                  </p>

                  {/* --- observation --- */}
                  {state === "done" && result && st.id === "perceive" && (
                    <div className={styles.stationBody}>
                      <div className={styles.factRow}>
                        <span className={styles.fact}>{result.perception.item_type}</span>
                        <span className={styles.fact}>
                          {result.perception.damage_type.replace(/_/g, " ")}
                        </span>
                        <span className={styles.fact}>
                          severity {result.perception.severity}/5
                        </span>
                        <span
                          className={`${styles.fact} ${
                            result.perception.confidence < 0.7 ? styles.factWarn : ""
                          }`}
                        >
                          {Math.round(result.perception.confidence * 100)}% confidence
                        </span>
                      </div>

                      <ul className={styles.evidenceList}>
                        {result.perception.visible_evidence.map((e, k) => (
                          <li key={k} data-n={String(k + 1).padStart(2, "0")}>
                            {e}
                          </li>
                        ))}
                      </ul>

                      <p className={styles.note}>
                        There is no remedy in this output. The schema has no field for
                        one — the model cannot recommend an outcome even if asked to.
                      </p>
                    </div>
                  )}

                  {/* --- adjudication --- */}
                  {state === "done" && decision && st.id === "adjudicate" && (
                    <div className={styles.stationBody}>
                      <div
                        className={styles.stamp}
                        style={{ ["--verdict" as string]: VERDICT_COLOR[decision.action] }}
                      >
                        <div className={styles.stampRow}>
                          <Glyph action={decision.action} className={styles.stampIcon} />
                          <span className={styles.stampAction}>
                            {VERDICT_LABEL[decision.action]}
                          </span>
                          {decision.amount > 0 && (
                            <span className={styles.stampAmount}>
                              {money(decision.amount)}
                            </span>
                          )}
                        </div>
                        <span className={styles.stampSerial}>
                          {decidingRule?.id} · policy {decision.policy_version}
                        </span>
                        {decision.requires_human && (
                          <span className={styles.stampHuman}>
                            Human sign-off required
                          </span>
                        )}
                      </div>

                      <p className={styles.reasonText}>{decision.reason}</p>

                      <details className={styles.ledger}>
                        <summary className={styles.ledgerSummary}>
                          Audit trail · {decision.rules_fired.length} rules evaluated
                        </summary>
                        <ul className={styles.ruleList}>
                          {decision.rules_fired.map((r) => {
                            const fired = r.outcome !== "not applicable";
                            return (
                              <li
                                key={r.id}
                                className={fired ? styles.ruleFired : styles.rulePassed}
                              >
                                <code className={styles.ruleId}>{r.id}</code>
                                <span className={styles.ruleDesc}>{r.description}</span>
                                <span className={styles.ruleOutcome}>{r.outcome}</span>
                              </li>
                            );
                          })}
                        </ul>
                        <p className={styles.note}>
                          Every threshold above lives in <code>lib/policy.json</code>.
                          Change that file and these outcomes change — no retraining,
                          no prompt edits.
                        </p>
                      </details>
                    </div>
                  )}

                  {/* --- correspondence: the artifact, on paper --- */}
                  {state === "done" && result && st.id === "compose" && (
                    <div className={styles.stationBody}>
                      <article className={styles.letter}>
                        <div className={styles.letterHead}>
                          <span>{activeOrder?.order_id}</span>
                          <span>Customer copy</span>
                        </div>
                        <div className={styles.letterBody}>
                          {result.composed.customer_message
                            .split("\n\n")
                            .map((p, k) => (
                              <p key={k}>{p}</p>
                            ))}
                        </div>
                        <div className={styles.letterSign}>
                          ClaimLens · resolved under policy {result.decision.policy_version}
                        </div>
                      </article>

                      <div className={styles.ticket}>
                        <span className={styles.ticketLabel}>CRM ticket</span>
                        <code className={styles.ticketSubject}>
                          {result.composed.ticket_subject}
                        </code>
                        <p className={styles.ticketSummary}>
                          {result.composed.internal_summary}
                        </p>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          {result?.fallback_reason && (
            <p className={styles.fallbackNote}>
              <strong>Cached</strong> {result.fallback_reason} The decision above was
              still computed live by the policy engine.
            </p>
          )}
        </section>
      </div>

      <footer className={styles.footer}>
        <p>FlowZint AI Hackathon 2026 · Open Innovation</p>
        <p>Vision by Gemini · decisions by a deterministic policy engine</p>
      </footer>
    </main>
  );
}
