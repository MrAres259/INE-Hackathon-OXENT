"use client";

import React, { useState, useRef, useEffect, useId, useCallback } from "react";
import { createPortal } from "react-dom";
import { glossaryFor, type GlossaryKey } from "@/lib/glossary";
import { GUIDE_EVENTS, isGuideOpen } from "@/lib/tours";

export type DOMRectLike = {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
};

export type Side = "top" | "bottom" | "left" | "right";

export function computeTipPosition(
  anchor: DOMRectLike,
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
  side: Side = "top",
  margin = 8
): { top: number; left: number; side: Side } {
  let resolvedSide = side;

  if (side === "top") {
    if (anchor.top < tip.height + margin) {
      resolvedSide = "bottom";
    }
  } else if (side === "bottom") {
    if (viewport.height - anchor.bottom < tip.height + margin) {
      resolvedSide = "top";
    }
  } else if (side === "left") {
    if (anchor.left < tip.width + margin) {
      resolvedSide = "right";
    }
  } else if (side === "right") {
    if (viewport.width - anchor.right < tip.width + margin) {
      resolvedSide = "left";
    }
  }

  let top = 0;
  let left = 0;

  if (resolvedSide === "top") {
    top = anchor.top - tip.height - margin;
    left = anchor.left + (anchor.width - tip.width) / 2;
  } else if (resolvedSide === "bottom") {
    top = anchor.bottom + margin;
    left = anchor.left + (anchor.width - tip.width) / 2;
  } else if (resolvedSide === "left") {
    left = anchor.left - tip.width - margin;
    top = anchor.top + (anchor.height - tip.height) / 2;
  } else if (resolvedSide === "right") {
    left = anchor.right + margin;
    top = anchor.top + (anchor.height - tip.height) / 2;
  }

  const maxLeft = Math.max(margin, viewport.width - tip.width - margin);
  const maxTop = Math.max(margin, viewport.height - tip.height - margin);

  left = Math.min(Math.max(margin, left), maxLeft);
  top = Math.min(Math.max(margin, top), maxTop);

  return { top, left, side: resolvedSide };
}

export type InfoTipProps = {
  term?: GlossaryKey;
  title?: string;
  text?: string;
  side?: Side;
  size?: "xs" | "sm";
  className?: string;
};

export function InfoTip({
  term,
  title,
  text,
  side = "top",
  size = "sm",
  className,
}: InfoTipProps): React.JSX.Element | null {
  const entry = term ? glossaryFor(term) : undefined;
  const finalTitle = title ?? entry?.title;
  const finalBody = text ? (entry?.body ? `${entry.body}\n\n${text}` : text) : entry?.body;
  const hasContent = Boolean(finalTitle || finalBody || entry);

  const tooltipId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [hasPosition, setHasPosition] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTouchRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const updatePosition = useCallback(() => {
    if (!buttonRef.current || !popoverRef.current) return;
    const anchor = buttonRef.current.getBoundingClientRect();
    const tipRect = popoverRef.current.getBoundingClientRect();
    const vp = { width: window.innerWidth, height: window.innerHeight };
    const pos = computeTipPosition(anchor, { width: tipRect.width, height: tipRect.height }, vp, side);
    setCoords({ top: pos.top, left: pos.left });
    setHasPosition(true);
  }, [side]);

  useEffect(() => {
    if (!isOpen) {
      setHasPosition(false);
      return;
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    const handleOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (
        target &&
        buttonRef.current &&
        !buttonRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, [isOpen]);

  const cancelTimers = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  // Coordination with global interactive guide: close on open, stay closed while active
  useEffect(() => {
    const handleGuideOpened = () => {
      cancelTimers();
      setIsOpen(false);
    };
    window.addEventListener(GUIDE_EVENTS.opened, handleGuideOpened);
    return () => {
      window.removeEventListener(GUIDE_EVENTS.opened, handleGuideOpened);
    };
  }, [cancelTimers]);

  const handleMouseEnter = () => {
    if (isTouchRef.current || isGuideOpen()) return;
    cancelTimers();
    openTimerRef.current = setTimeout(() => {
      if (isGuideOpen()) return;
      setIsOpen(true);
    }, 120);
  };

  const handleMouseLeave = () => {
    cancelTimers();
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 150);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    cancelTimers();
    if (isGuideOpen()) {
      setIsOpen(false);
      return;
    }
    setIsOpen((prev) => !prev);
    setTimeout(() => {
      isTouchRef.current = false;
    }, 400);
  };

  const handleFocus = () => {
    if (isTouchRef.current || isGuideOpen()) return;
    cancelTimers();
    setIsOpen(true);
  };

  const handleBlur = (e: React.FocusEvent) => {
    if (popoverRef.current && popoverRef.current.contains(e.relatedTarget as Node)) {
      return;
    }
    cancelTimers();
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 150);
  };

  const handleTouchStart = () => {
    if (isGuideOpen()) return;
    isTouchRef.current = true;
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (isGuideOpen()) return;
    if (e.pointerType === "touch") {
      isTouchRef.current = true;
    }
  };

  if (!hasContent) {
    return null;
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={finalTitle ? `¿Qué es ${finalTitle}?` : "¿Qué es esto?"}
        aria-describedby={isOpen ? tooltipId : undefined}
        aria-expanded={isOpen}
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onPointerDown={handlePointerDown}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={`inline-flex items-center justify-center text-muted-foreground/70 hover:text-primary focus:text-primary focus:outline-none transition-colors cursor-pointer rounded-full [@media(pointer:coarse)]:min-w-[32px] [@media(pointer:coarse)]:min-h-[32px] ${
          size === "xs" ? "p-0.5" : "p-1"
        } ${className ?? ""}`}
      >
        <svg
          className={size === "xs" ? "w-3 h-3" : "w-3.5 h-3.5"}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {mounted &&
        isOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            id={tooltipId}
            role="tooltip"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              maxWidth: "min(18rem, calc(100vw - 24px))",
              zIndex: 70,
              visibility: hasPosition ? "visible" : "hidden",
            }}
            className="bg-popover text-popover-foreground border shadow-float rounded-lg p-3 text-xs pointer-events-auto select-text animate-in fade-in duration-100"
          >
            {finalTitle && (
              <h4 className="font-display font-bold text-foreground text-xs mb-1">
                {finalTitle}
              </h4>
            )}
            {finalBody && (
              <p className="text-muted-foreground text-xs leading-relaxed whitespace-pre-line">
                {finalBody}
              </p>
            )}
            {entry?.relation && (
              <div className="mt-2 pt-2 border-t border-border text-[11px] text-muted-foreground">
                <span className="font-semibold text-primary">Cómo se relaciona: </span>
                {entry.relation}
              </div>
            )}
            {entry?.example && (
              <div className="mt-1.5 text-[11px] text-muted-foreground font-mono">
                <span className="font-semibold text-primary font-sans">Ejemplo: </span>
                {entry.example}
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
