"use client";

import React, { useId } from "react";
import Link from "next/link";

export interface BrandMarkProps {
  size?: number;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
  ariaHidden?: boolean;
}

export function BrandMark({
  size = 32,
  className = "",
  "aria-hidden": ariaHiddenAttr,
  ariaHidden,
}: BrandMarkProps) {
  const generatedId = useId();
  const gradId = `ae-bg-${generatedId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const isHidden = ariaHiddenAttr === true || ariaHiddenAttr === "true" || ariaHidden === true;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role={isHidden ? undefined : "img"}
      aria-label={isHidden ? undefined : "Atalaya Electoral"}
      aria-hidden={isHidden ? "true" : undefined}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c21f77" />
          <stop offset="1" stopColor="#8e1456" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill={`url(#${gradId})`} />
      <path
        d="M15.5 25.5a17 17 0 0 1 5.5-9.5M48.5 25.5a17 17 0 0 0-5.5-9.5"
        fill="none"
        stroke="#ffffff"
        strokeOpacity=".6"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M21 23.5 32 12.5l11 11z" fill="#ffffff" />
      <rect x="23.5" y="25" width="17" height="9.5" rx="2" fill="#ffffff" />
      <circle cx="32" cy="29.75" r="2.9" fill="#f2bf3a" />
      <path d="M25.5 36.5h13l3.6 15h-20.2z" fill="#ffffff" />
      <path
        d="M27.4 39.5l9.2 8M36.6 39.5l-9.2 8"
        stroke="#a8186a"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <rect x="16.5" y="51.5" width="31" height="3.6" rx="1.8" fill="#ffffff" />
    </svg>
  );
}

export interface BrandLockupProps {
  compact?: boolean;
  className?: string;
}

export function BrandLockup({ compact = false, className = "" }: BrandLockupProps) {
  return (
    <Link
      href="/"
      aria-label="Atalaya Electoral, inicio"
      className={`inline-flex items-center gap-2.5 text-left group select-none shrink-0 ${className}`}
    >
      <BrandMark size={32} aria-hidden="true" className="shrink-0" />
      <div className="min-w-0 leading-tight">
        <div className="font-display font-extrabold text-sm sm:text-base tracking-tight text-ink flex items-baseline gap-1">
          <span>Atalaya</span>
          <span className="text-primary font-bold">Electoral</span>
        </div>
        {!compact && (
          <div className="hidden lg:block text-[11px] text-muted-foreground truncate font-sans">
            Riesgo de abstención · Elección federal 2027
          </div>
        )}
      </div>
    </Link>
  );
}
