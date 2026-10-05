"use client";

import React from "react";
import dynamic from "next/dynamic";

// Dynamic import with ssr: false to prevent leaflet window/document errors during SSR
const LeafletInnerMap = dynamic(
  () => import("./LeafletInnerMap").then((mod) => mod.LeafletInnerMap),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full min-h-[520px] bg-slate-950 rounded-2xl border border-slate-800 flex flex-col items-center justify-center text-slate-400 gap-3">
        <svg
          className="animate-spin h-8 w-8 text-emerald-500"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          ></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
          ></path>
        </svg>
        <span className="text-xs font-medium">Cargando mapa semáforo interactivo...</span>
      </div>
    ),
  }
);

export function RiskMap() {
  return <LeafletInnerMap />;
}
