"use client";

import React from "react";
import { TopBar } from "@/components/layout/TopBar";

export interface IntelPageShellProps {
  children: React.ReactNode;
  className?: string;
}

export function IntelPageShell({ children, className = "" }: IntelPageShellProps) {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <TopBar />
      <main className={`flex-1 overflow-y-auto px-4 py-6 md:px-6 lg:px-8 ${className}`}>
        <div className="mx-auto w-full max-w-[1280px]">
          {children}
        </div>
      </main>
    </div>
  );
}
