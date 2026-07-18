"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SAMPLES } from "@/lib/samples";
import type { SampleCase } from "@/lib/samples";
import type { ResolveResponse } from "@/lib/types";
import styles from "./page.module.css";

/**
 * Single-page claim console.
 *
 * The layout is built around the pipeline, because the pipeline is the
 * argument: a reviewer should be able to see, without reading the README,
 * that a deterministic engine sits between the model's eyes and its mouth.
 */

type Stage = "intake" | "perceive" | "adjudicate" | "compose";
type StageState = "idle" | "running" | "done";

const STAGE_META: { id: Stage; n: string; title: string; sub: string }[] = [
  { id: "intake", n: "01", title: "Intake", sub: "Photo + order record" },
  { id: "perceive", n: "02", title: "Perceive", sub: "Gemini vision → structured evidence" },
  { id: "adjudicate", n: "03", title: "Adjudicate", sub: "Deterministic policy engine · no AI" },
  { id: "compose", n: "04", title: "Compose", sub: "Gemini writes, decision is fixed" },
];

const ACTION_COLOR: Record<string, string> = {
  refund: "var(--refund)",
  replace: "var(--replace)",
  escalate: "var(--escalate)",
  reject: "var(--reject)",
};

const ACTION_VERB: Record<string, string> = {
  refund: "Refund issued",
  replace: "Replacement sent",
  escalate: "Sent to a specialist",
  reject: "Claim declined",
};

const money = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export default function Page() {
  const [selected, setSelected] = useState<SampleCase>(SAMPLES[0]);
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
  const fileRef = useRef<HTMLInputElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

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

  const run = useCallback(
    async (sample: SampleCase, uploaded: { dataUrl: string; mime: string } | null) => {
      clearTimers();
      setBusy(true);
      setError(null);
      setResult(null);
      setStages({ intake: "done", perceive: "running", adjudicate: "idle", compose: "idle" });

      try {
        const res = await fetch("/api/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sample_id: uploaded ? undefined : sample.id,
            description: sample.description,
            order: sample.order,
            image_base64: uploaded ? uploaded.dataUrl.split(",")[1] : undefined,
            image_mime_type: uploaded?.mime,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          setError(data.message ?? data.error ?? "Something went wrong.");
          setStages({ intake: "done", perceive: "idle", adjudicate: "idle", compose: "idle" });
          return;
        }

        // Reveal the stages in order so the flow is readable. The timings
        // shown are the real server-side measurements from `timings_ms`.
        setResult(data as ResolveResponse);
        setStages((s) => ({ ...s, perceive: "done", adjudicate: "running" }));
        timers.current.push(
          setTimeout(
            () => setStages((s) => ({ ...s, adjudicate: "done", compose: "running" })),
            260
          ),
          setTimeout(() => setStages((s) => ({ ...s, compose: "done" })), 520)
        );
      } catch {
        setError("Could not reach the server. Check your connection and try again.");
        setStages({ intake: "done", perceive: "idle", adjudicate: "idle", compose: "idle" });
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const pickSample = (s: SampleCase) => {
    clearTimers();
    setSelected(s);
    setUpload(null);
    setResult(null);
    setError(null);
    setStages({ intake: "idle", perceive: "idle", adjudicate: "idle", compose: "idle" });
    if (fileRef.current) fileRef.current.value = "";
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError("Please choose an image under 4 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setUpload({ dataUrl: String(reader.result), mime: file.type });
      setResult(null);
      setError(null);
      setStages({ intake: "idle", perceive: "idle", adjudicate: "idle", compose: "idle" });
    };
    reader.readAsDataURL(file);
  };

  const decision = result?.decision;
  const imageSrc = upload?.dataUrl ?? selected.image;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brandRow}>
          <div className={styles.mark} aria-hidden="true">
            <span />
          </div>
          <div>
            <h1 className={styles.brand}>ClaimLens</h1>
            <p className={styles.tagline}>
              The AI sees. The policy engine decides. <strong>The model never controls the money.</strong>
            </p>
          </div>
        </div>

        {liveMode !== null && (
          <div className={`${styles.modeBadge} ${liveMode ? styles.modeLive : styles.modeDemo}`}>
            <span className={styles.dot} />
            {liveMode ? "Live analysis enabled" : "Demo mode — cached analysis"}
          </div>
        )}
      </header>

      <div className={styles.layout}>
        {/* ---------------- left: claim selection ---------------- */}
        <aside className={styles.sidebar}>
          <h2 className={styles.sectionTitle}>Sample claims</h2>
          <p className={styles.sectionHint}>
            Each one triggers a different policy rule.
          </p>

          <div className={styles.sampleList}>
            {SAMPLES.map((s) => (
              <button
                key={s.id}
                onClick={() => pickSample(s)}
                className={`${styles.sampleCard} ${
                  selected.id === s.id && !upload ? styles.sampleActive : ""
                }`}
                aria-pressed={selected.id === s.id && !upload}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.image} alt="" className={styles.sampleThumb} />
                <span className={styles.sampleText}>
                  <span className={styles.sampleLabel}>{s.label}</span>
                  <span className={styles.sampleTeaser}>{s.teaser}</span>
                </span>
              </button>
            ))}
          </div>

          <div className={styles.uploadBlock}>
            <label className={styles.uploadLabel} htmlFor="claim-photo">
              Or analyse your own photo
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
                ? "Needs a GEMINI_API_KEY on the server. Samples work without one."
                : "Uses the order record from the selected sample."}
            </p>
          </div>

          <div className={styles.orderCard}>
            <h3 className={styles.orderTitle}>Order record</h3>
            <dl className={styles.orderList}>
              <div><dt>Order</dt><dd className="mono">{selected.order.order_id}</dd></div>
              <div><dt>Item</dt><dd>{selected.order.item_name}</dd></div>
              <div><dt>Value</dt><dd>{money(selected.order.item_value)}</dd></div>
              <div><dt>Delivered</dt><dd>{selected.order.days_since_delivery} days ago</dd></div>
              <div><dt>Category</dt><dd>{selected.order.category}</dd></div>
              <div><dt>Prior claims</dt><dd>{selected.order.prior_claims_count}</dd></div>
            </dl>
            <p className={styles.orderNote}>
              Trusted facts from the order system — never from the customer, never from the model.
            </p>
          </div>
        </aside>

        {/* ---------------- right: pipeline + result ---------------- */}
        <section className={styles.main}>
          <div className={styles.claimCard}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageSrc} alt="Submitted claim evidence" className={styles.claimImage} />
            <div className={styles.claimBody}>
              <span className={styles.quoteMark} aria-hidden="true">“</span>
              <p className={styles.claimQuote}>{selected.description}</p>
              <button
                className={styles.runButton}
                onClick={() => run(selected, upload)}
                disabled={busy}
              >
                {busy ? "Assessing…" : "Resolve this claim"}
              </button>
            </div>
          </div>

          {error && (
            <div className={styles.error} role="alert">
              <strong>Couldn’t assess that claim.</strong>
              <span>{error}</span>
            </div>
          )}

          <ol className={styles.pipeline}>
            {STAGE_META.map((meta, i) => {
              const state = stages[meta.id];
              const isEngine = meta.id === "adjudicate";
              return (
                <li
                  key={meta.id}
                  className={`${styles.stage} ${styles[`stage_${state}`]} ${
                    isEngine ? styles.stageEngine : ""
                  }`}
                >
                  <div className={styles.stageHead}>
                    <span className={styles.stageNum}>{meta.n}</span>
                    <div className={styles.stageTitles}>
                      <span className={styles.stageTitle}>
                        {meta.title}
                        {isEngine && <span className={styles.pureTag}>pure function</span>}
                      </span>
                      <span className={styles.stageSub}>{meta.sub}</span>
                    </div>
                    <span className={styles.stageStatus}>
                      {state === "running" && <span className={styles.spinner} aria-label="running" />}
                      {state === "done" && result && (
                        <span className={styles.timing}>
                          {meta.id === "intake"
                            ? "—"
                            : `${result.timings_ms[meta.id as keyof typeof result.timings_ms]}ms`}
                        </span>
                      )}
                    </span>
                  </div>

                  {/* stage payloads */}
                  {state === "done" && result && meta.id === "perceive" && (
                    <div className={styles.stageBody}>
                      <div className={styles.chips}>
                        <span className={styles.chip}>{result.perception.item_type}</span>
                        <span className={styles.chip}>
                          {result.perception.damage_type.replace(/_/g, " ")}
                        </span>
                        <span className={styles.chip}>severity {result.perception.severity}/5</span>
                        <span
                          className={`${styles.chip} ${
                            result.perception.confidence < 0.7 ? styles.chipWarn : ""
                          }`}
                        >
                          {Math.round(result.perception.confidence * 100)}% confident
                        </span>
                      </div>
                      <ul className={styles.evidence}>
                        {result.perception.visible_evidence.map((e, k) => (
                          <li key={k}>{e}</li>
                        ))}
                      </ul>
                      <p className={styles.stageNote}>
                        No remedy in this output — the schema has no field for one.
                      </p>
                    </div>
                  )}

                  {state === "done" && decision && meta.id === "adjudicate" && (
                    <div className={styles.stageBody}>
                      <div
                        className={styles.verdict}
                        style={{ ["--verdict" as string]: ACTION_COLOR[decision.action] }}
                      >
                        <span className={styles.verdictAction}>{ACTION_VERB[decision.action]}</span>
                        {decision.amount > 0 && (
                          <span className={styles.verdictAmount}>{money(decision.amount)}</span>
                        )}
                        {decision.requires_human && (
                          <span className={styles.humanTag}>human review required</span>
                        )}
                      </div>
                      <p className={styles.verdictReason}>{decision.reason}</p>

                      <details className={styles.audit}>
                        <summary>
                          Audit trail — {decision.rules_fired.length} rule
                          {decision.rules_fired.length === 1 ? "" : "s"} evaluated
                        </summary>
                        <ul className={styles.ruleList}>
                          {decision.rules_fired.map((r) => {
                            const fired = r.outcome !== "not applicable";
                            return (
                              <li key={r.id} className={fired ? styles.ruleFired : styles.rulePassed}>
                                <code>{r.id}</code>
                                <span className={styles.ruleDesc}>{r.description}</span>
                                <span className={styles.ruleOutcome}>{r.outcome}</span>
                              </li>
                            );
                          })}
                        </ul>
                        <p className={styles.stageNote}>
                          Policy version {decision.policy_version} · every threshold lives in{" "}
                          <code>lib/policy.json</code>
                        </p>
                      </details>
                    </div>
                  )}

                  {state === "done" && result && meta.id === "compose" && (
                    <div className={styles.stageBody}>
                      <div className={styles.message}>
                        {result.composed.customer_message.split("\n\n").map((p, k) => (
                          <p key={k}>{p}</p>
                        ))}
                      </div>
                      <div className={styles.ticket}>
                        <span className={styles.ticketLabel}>CRM ticket</span>
                        <code className={styles.ticketSubject}>{result.composed.ticket_subject}</code>
                        <p className={styles.ticketSummary}>{result.composed.internal_summary}</p>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          {result?.fallback_reason && (
            <p className={styles.fallbackNote}>
              <strong>Demo mode:</strong> {result.fallback_reason} The decision above was still
              computed live by the policy engine.
            </p>
          )}
        </section>
      </div>

      <footer className={styles.footer}>
        <p>
          Built for the FlowZint AI Hackathon 2026 · Open Innovation · Vision by Gemini, decisions by
          a deterministic policy engine.
        </p>
      </footer>
    </main>
  );
}
