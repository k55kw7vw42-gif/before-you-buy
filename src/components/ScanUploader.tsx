"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ALLOWED_IMAGE_EXTENSIONS,
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  formatBytes,
  isAllowedImageType,
} from "@/lib/validation";

function CloudIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 15V7M9 10l3-3 3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M7 17.5a4 4 0 0 1-1-7.87A5 5 0 0 1 15.9 8.3 3.5 3.5 0 0 1 17 15v0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M17 15H7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function ScanUploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [context, setContext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quotaHit, setQuotaHit] = useState(false);

  // The preview is a local object URL: the image is never uploaded until the
  // user submits, and the URL is revoked as soon as it is replaced.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function accept(candidate: File | undefined | null) {
    if (!candidate) return;
    if (!isAllowedImageType(candidate.type)) {
      setError("Unsupported file type. Choose a PNG, JPEG, WebP or GIF image.");
      return;
    }
    if (candidate.size > MAX_IMAGE_BYTES) {
      setError(
        `That image is ${formatBytes(candidate.size)}. The limit is ${formatBytes(MAX_IMAGE_BYTES)}.`,
      );
      return;
    }
    setError(null);
    setFile(candidate);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file || busy) return;

    setBusy(true);
    setError(null);

    const body = new FormData();
    body.append("image", file);
    if (context.trim()) body.append("context", context.trim());

    try {
      const response = await fetch("/api/analyze/image", { method: "POST", body });
      const data = (await response.json()) as { id?: string; error?: string; code?: string };
      if (response.status === 401 || data.code === "auth_required") {
        // The session expired while the page was open; reload into the sign-in panel.
        setError(data.error ?? "Sign in to scan a screenshot.");
        setBusy(false);
        router.refresh();
        return;
      }
      if (response.status === 402 || data.code === "quota_exceeded") {
        // The allowance ran out - refresh so the page swaps in the upgrade panel.
        setQuotaHit(true);
        setError(data.error ?? "You have used your analyses for this month.");
        setBusy(false);
        router.refresh();
        return;
      }
      if (!response.ok || !data.id) {
        setError(data.error ?? "We could not analyse that screenshot. Please try again.");
        setBusy(false);
        return;
      }
      router.push(`/results/${data.id}`);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      {error && (
        <p className="alert" role="alert" style={{ marginBottom: "1rem" }}>
          {error}
          {quotaHit && (
            <>
              {" "}
              <Link href="/pricing">See plans</Link>.
            </>
          )}
        </p>
      )}

      <div
        className={`dropzone${dragging ? " dragging" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          accept(e.dataTransfer.files?.[0]);
        }}
      >
        <div className="dz-icon">
          <CloudIcon />
        </div>
        <div className="dz-title">
          {file ? "Choose a different screenshot" : "Tap to choose a screenshot"}
        </div>
        <div className="dz-hint">
          or drag one here · PNG, JPEG, WebP or GIF · up to {formatBytes(MAX_IMAGE_BYTES)}
        </div>
        <input
          ref={inputRef}
          type="file"
          name="image"
          accept={`${ALLOWED_IMAGE_TYPES.join(",")},${ALLOWED_IMAGE_EXTENSIONS}`}
          hidden
          onChange={(e) => accept(e.target.files?.[0])}
        />
      </div>

      {file && previewUrl && (
        <div className="preview">
          {/* Local blob preview; next/image would try to optimise a URL that only exists in this tab. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Preview of the screenshot you selected" />
          <div className="preview-bar">
            <span className="filename">{file.name}</span>
            <span>{formatBytes(file.size)}</span>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginLeft: "auto" }}
              onClick={() => {
                setFile(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
            >
              Remove
            </button>
          </div>
        </div>
      )}

      <div className="field" style={{ marginTop: "1.25rem" }}>
        <label htmlFor="context">
          Anything we should know? <span className="hint">(optional)</span>
        </label>
        <textarea
          id="context"
          value={context}
          maxLength={1000}
          placeholder="For example: they contacted me first on Facebook Marketplace and want a deposit today."
          onChange={(e) => setContext(e.target.value)}
        />
      </div>

      <button className="btn btn-primary btn-block" type="submit" disabled={!file || busy}>
        {busy ? (
          <>
            <span className="spinner" aria-hidden="true" /> Analysing...
          </>
        ) : (
          "Analyse screenshot"
        )}
      </button>

      {busy && (
        <div className="skeleton-block" aria-hidden="true">
          <div className="skeleton-line w-60" />
          <div className="skeleton-line w-80" />
          <div className="skeleton-line w-40" />
        </div>
      )}

      <p className="small muted" style={{ margin: "0.85rem 0 0" }}>
        Your screenshot is analysed on our server and is not saved. Only the extracted findings are
        kept so you can look at the result again.
      </p>
    </form>
  );
}
