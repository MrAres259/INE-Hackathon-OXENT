"use client";

import React from "react";

export interface IntelPageShellProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function IntelPageShell({ children, className = "", style }: IntelPageShellProps) {
  return (
    <div
      className={`w-full flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 pt-6 [@media(orientation:landscape)_and_(max-height:540px)]:px-3 [@media(orientation:landscape)_and_(max-height:540px)]:pt-3 md:px-6 lg:px-8 ${className}`}
      style={{
        scrollPaddingBottom: "var(--page-inset-bottom, 0px)",
        paddingBottom: "calc(var(--page-inset-bottom, 0px) + 24px)",
        ...style,
      }}
    >
      <div className="mx-auto w-full max-w-[1280px]">
        {children}
      </div>
    </div>
  );
}
