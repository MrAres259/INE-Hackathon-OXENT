"use client";

import React from "react";

export interface IntelPageShellProps {
  children: React.ReactNode;
  className?: string;
}

export function IntelPageShell({ children, className = "" }: IntelPageShellProps) {
  return (
    <div className={`w-full flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-6 md:px-6 lg:px-8 ${className}`}>
      <div className="mx-auto w-full max-w-[1280px]">
        {children}
      </div>
    </div>
  );
}
