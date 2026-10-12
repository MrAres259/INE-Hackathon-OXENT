"use client";

import React, { useState, useEffect, useRef } from "react";
import { fetchGeoIndex } from "@/lib/geo";
import type { GeoIndexItem } from "@/lib/types";
import { useAtalaya } from "@/lib/state";

export function RegionSearch() {
  const { selectRegion, meta } = useAtalaya();
  const [indexItems, setIndexItems] = useState<GeoIndexItem[]>([]);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchGeoIndex().then((items) => setIndexItems(items));
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const trimmed = query.trim().toLowerCase();
  const matches = trimmed
    ? indexItems
        .filter((item) => item.name.toLowerCase().includes(trimmed) || item.id.includes(trimmed))
        .slice(0, 7)
    : [];

  const handleSelect = (item: GeoIndexItem) => {
    selectRegion(item.id);
    setQuery("");
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative w-64 md:w-72 pointer-events-auto">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="Buscar estado o municipio..."
          className="w-full bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-xl"
        />
        <svg
          className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setIsOpen(false);
            }}
            className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white text-xs"
          >
            ✕
          </button>
        )}
      </div>

      {/* Autocomplete Dropdown */}
      {isOpen && matches.length > 0 && (
        <div className="absolute top-full mt-1.5 left-0 right-0 bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-xl shadow-2xl z-50 overflow-hidden divide-y divide-slate-800/80 max-h-64 overflow-y-auto">
          {matches.map((item) => {
            const stateName =
              meta?.states.find((s) => s.id === item.ent)?.name ?? `Estado ${item.ent}`;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item)}
                className="w-full text-left px-3.5 py-2.5 hover:bg-slate-800/90 transition-colors flex items-center justify-between text-xs"
              >
                <div>
                  <div className="font-semibold text-white">{item.name}</div>
                  <div className="text-[10px] text-slate-400">
                    {item.level === "state" ? "Entidad Federativa" : stateName}
                  </div>
                </div>
                <span className="text-[10px] bg-slate-850 text-slate-300 px-1.5 py-0.5 rounded border border-slate-750">
                  {item.level === "state" ? "Estado" : "Municipio"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
