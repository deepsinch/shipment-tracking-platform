"use client";

import { EraserIcon, Undo2Icon } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { signatureDescription, SIGNATURE_VIEWBOX_WIDTH } from "@/domain/signature";
import {
  beginStroke,
  EMPTY_RECORDER,
  endStroke,
  extendStroke,
  isEmpty,
  isFull,
  toSignature,
  undoStroke,
  type RecorderState,
} from "@/lib/signature-recorder";

/** The pad's shape: wide, like a signature line. Fixed so strokes mean the same on every screen. */
const PAD_ASPECT = 2.2;
const INK = "#111111";
/** Ink width as a fraction of the pad's width (the stored viewBox is 1000 wide, with 5 units). */
const INK_WIDTH = 5 / SIGNATURE_VIEWBOX_WIDTH;

type Props = {
  /** The form field that carries the strokes as JSON. */
  name: string;
  label: string;
  /** Shown under the pad; says what the signature is for and that the name suffices. */
  description: string;
  /** Shown instead of nothing when the server refused the signature. */
  error?: string;
};

/**
 * A signature pad: draw with a finger, a stylus or a mouse (pointer events cover all three), undo
 * the last stroke, clear it. The strokes travel in a hidden field as compact JSON of normalised
 * points; nothing is sent as an image.
 *
 * Accessibility: the signature is optional and the printed name (a text field) is the proof, so a
 * keyboard or screen reader user completes a delivery without the pad. The pad has a text
 * alternative that is kept up to date ("No signature drawn" / "A hand-drawn signature of 2
 * strokes"), a live region announces changes, and Undo and Clear are ordinary buttons.
 */
export function SignaturePad({ name, label, description, error }: Props) {
  const id = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<RecorderState>(EMPTY_RECORDER);
  // The pointer events run outside React's render, so they read the latest state from a ref.
  const stateRef = useRef(state);
  const activePointer = useRef<number | null>(null);

  const update = useCallback((next: RecorderState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const signature = useMemo(() => toSignature(state, PAD_ASPECT), [state]);
  const summary = signatureDescription(signature);

  // Redraw whenever the strokes or the canvas size change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const redraw = () => {
      const ratio = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      paint(canvas, stateRef.current);
    };
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (canvasRef.current) paint(canvasRef.current, state);
  }, [state]);

  function positionOf(event: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = event.currentTarget.getBoundingClientRect();
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    // The first finger or the primary mouse button; a second finger (a palm) does not draw.
    if (activePointer.current !== null || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }
    activePointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    const [x, y] = positionOf(event);
    update(beginStroke(stateRef.current, x, y));
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (activePointer.current !== event.pointerId) return;
    // Fast strokes arrive as several samples per event; use them all for a smooth line.
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
    const rect = event.currentTarget.getBoundingClientRect();
    let next = stateRef.current;
    for (const sample of samples.length > 0 ? samples : [event.nativeEvent]) {
      next = extendStroke(
        next,
        (sample.clientX - rect.left) / rect.width,
        (sample.clientY - rect.top) / rect.height,
      );
    }
    if (next !== stateRef.current) update(next);
  }

  function onPointerEnd(event: React.PointerEvent<HTMLCanvasElement>) {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    update(endStroke(stateRef.current));
  }

  const empty = isEmpty(state);
  const full = isFull(state);

  return (
    <div role="group" aria-labelledby={`${id}-label`} className="flex flex-col gap-2">
      <span id={`${id}-label`} className="text-sm leading-snug font-medium">
        {label}
      </span>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Signature pad. ${summary}`}
        aria-describedby={`${id}-hint`}
        data-testid="signature-pad"
        data-strokes={state.strokes.length}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        // `touch-none` stops the page scrolling while the finger draws.
        className="w-full touch-none rounded-md border border-input bg-white shadow-xs"
        style={{ aspectRatio: String(PAD_ASPECT) }}
      />
      <input type="hidden" name={name} value={signature ? JSON.stringify(signature) : ""} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 flex-1 text-base sm:h-9 sm:flex-none sm:text-sm"
          onClick={() => update(undoStroke(stateRef.current))}
          disabled={empty}
        >
          <Undo2Icon aria-hidden="true" />
          Undo
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 flex-1 text-base sm:h-9 sm:flex-none sm:text-sm"
          onClick={() => update(EMPTY_RECORDER)}
          disabled={empty}
        >
          <EraserIcon aria-hidden="true" />
          Clear
        </Button>
      </div>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {description}
      </p>
      <p role="status" className="text-sm text-muted-foreground" data-testid="signature-summary">
        {full ? "The signature is full. Undo or clear to change it." : summary}
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** Draws the strokes (and the one in progress) on a canvas of any size. */
function paint(canvas: HTMLCanvasElement, state: RecorderState): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = INK;
  context.fillStyle = INK;
  context.lineWidth = Math.max(1.5, width * INK_WIDTH * 1.2);
  context.lineCap = "round";
  context.lineJoin = "round";
  const strokes = state.drawing ? [...state.strokes, state.drawing] : state.strokes;
  for (const stroke of strokes) {
    if (stroke.length === 1) {
      context.beginPath();
      context.arc(
        stroke[0]![0] * width,
        stroke[0]![1] * height,
        context.lineWidth / 2,
        0,
        2 * Math.PI,
      );
      context.fill();
      continue;
    }
    context.beginPath();
    stroke.forEach(([x, y], index) => {
      if (index === 0) context.moveTo(x * width, y * height);
      else context.lineTo(x * width, y * height);
    });
    context.stroke();
  }
}
