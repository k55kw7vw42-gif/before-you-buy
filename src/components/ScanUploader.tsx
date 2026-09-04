"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ALLOWED_IMAGE_EXTENSIONS,
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  formatBytes,
  isAllowedImageType,
} from "@/lib/validation";

export function ScanUploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [context, setContext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

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
      const data = (await response.json()) as { id?: string; error?: string };
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

      <p className="small muted" style={{ margin: "0.85rem 0 0" }}>
        Your screenshot is analysed on our server and is not saved. Only the extracted findings are
        kept so you can look at the result again.
      </p>
    </form>
  );
}
