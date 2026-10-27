"use client";

import React, { useState, useEffect, useRef } from "react";
import { fetchGeoIndex } from "@/lib/geo";
import type { GeoIndexItem } from "@/lib/types";
import { useAtalaya } from "@/lib/state";

export interface RegionSearchProps {
  autoFocus?: boolean;
  onSelect?: () => void;
  className?: string;
  showKbd?: boolean;
}

export function RegionSearch({
  autoFocus = false,
  onSelect,
  className = "",
  showKbd = true,
}: RegionSearchProps) {
  const { selectRegion, meta } = useAtalaya();
  const [indexItems, setIndexItems] = useState<GeoIndexItem[]>([]);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchGeoIndex().then((items) => setIndexItems(items));
  }, []);

  // Keyboard shortcut '/' focuses search when not already in an input/textarea
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
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

  const normalize = (text: string) =>
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  const trimmed = query.trim();
  const normalizedQuery = normalize(trimmed);

  const matches = normalizedQuery
    ? indexItems
        .filter(
          (item) =>
            normalize(item.name).includes(normalizedQuery) ||
            item.id.toLowerCase().includes(normalizedQuery)
        )
        .slice(0, 8)
    : [];

  const handleSelect = (item: GeoIndexItem) => {
    selectRegion(item.id);
    setQuery("");
    setIsOpen(false);
    onSelect?.();
  };

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      data-tour="buscar"
    >
      <svg
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
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

      <input
        ref={inputRef}
        type="text"
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        placeholder="Buscar estado o municipio"
        className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-8 text-xs text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
      />

      {query ? (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            setIsOpen(false);
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs p-0.5 rounded cursor-pointer"
          aria-label="Limpiar búsqueda"
        >
          ✕
        </button>
      ) : (
        showKbd && (
          <kbd className="hidden sm:inline-flex absolute right-2 top-1/2 -translate-y-1/2 items-center justify-center rounded border border-border bg-muted px-1 text-[10px] font-mono text-muted-foreground select-none pointer-events-none">
            /
          </kbd>
        )
      )}

      {/* Autocomplete Dropdown */}
      {isOpen && matches.length > 0 && (
        <div className="absolute left-0 right-0 top-9 z-50 overflow-hidden rounded-md border border-border bg-popover shadow-float max-h-64 overflow-y-auto divide-y divide-border">
          {matches.map((item) => {
            const stateName =
              meta?.states.find((s) => s.id === item.ent)?.name ?? `Estado ${item.ent}`;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item)}
                className="w-full text-left px-3 py-2.5 min-h-[40px] hover:bg-accent text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer"
              >
                <div className="min-w-0">
                  <div className="font-medium text-foreground truncate">{item.name}</div>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {item.level === "state" ? "Estado" : stateName}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
