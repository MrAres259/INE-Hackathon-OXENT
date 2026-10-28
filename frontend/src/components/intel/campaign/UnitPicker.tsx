"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { fetchGeoIndex } from "@/lib/geo";
import type { GeoIndexItem } from "@/lib/types";
import { useAtalaya } from "@/lib/state";

export interface UnitPickerProps {
  selectedUnitId: string | null;
  focus: string;
  onUnitSelect: (unitId: string) => void;
  onFocusChange: (focus: string) => void;
  className?: string;
}

const QUICK_SUGGESTIONS = [
  "Jóvenes 18–24",
  "Comunidades indígenas",
  "Zonas rurales",
  "Mujeres",
];

const MAX_FOCUS_LENGTH = 300;

export function UnitPicker({
  selectedUnitId,
  focus,
  onUnitSelect,
  onFocusChange,
  className = "",
}: UnitPickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { meta } = useAtalaya();

  const [indexItems, setIndexItems] = useState<GeoIndexItem[]>([]);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load geo index items
  useEffect(() => {
    fetchGeoIndex().then((items) => setIndexItems(items));
  }, []);

  // Sync state from URL params on mount / URL change
  useEffect(() => {
    if (!searchParams) return;
    const urlZona = searchParams.get("zona");
    const urlEnfoque = searchParams.get("enfoque");

    if (urlZona && urlZona !== selectedUnitId) {
      onUnitSelect(urlZona);
    }
    if (urlEnfoque !== null && urlEnfoque !== undefined && urlEnfoque !== focus) {
      onFocusChange(urlEnfoque.slice(0, MAX_FOCUS_LENGTH));
    }
  }, [searchParams, selectedUnitId, focus, onUnitSelect, onFocusChange]);

  // Sync changes to URL query
  const updateUrlParams = (newUnitId: string | null, newFocus: string) => {
    const sp = new URLSearchParams(searchParams ? searchParams.toString() : "");
    if (newUnitId) {
      sp.set("zona", newUnitId);
    } else {
      sp.delete("zona");
    }

    if (newFocus && newFocus.trim().length > 0) {
      sp.set("enfoque", newFocus.trim().slice(0, MAX_FOCUS_LENGTH));
    } else {
      sp.delete("enfoque");
    }

    const nextUrl = sp.toString() ? `${pathname}?${sp.toString()}` : pathname;
    router.replace(nextUrl);
  };

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

  const handleSelectUnit = (item: GeoIndexItem) => {
    onUnitSelect(item.id);
    setQuery("");
    setIsOpen(false);
    updateUrlParams(item.id, focus);
  };

  const handleClearUnit = () => {
    onUnitSelect("");
    setQuery("");
    updateUrlParams(null, focus);
    inputRef.current?.focus();
  };

  const handleFocusChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVal = e.target.value.slice(0, MAX_FOCUS_LENGTH);
    onFocusChange(nextVal);
    updateUrlParams(selectedUnitId, nextVal);
  };

  const handleSuggestionClick = (suggestion: string) => {
    const nextVal = suggestion.slice(0, MAX_FOCUS_LENGTH);
    onFocusChange(nextVal);
    updateUrlParams(selectedUnitId, nextVal);
  };

  // Find selected item metadata
  const selectedItem = selectedUnitId
    ? indexItems.find((i) => i.id === selectedUnitId)
    : null;

  const stateName = selectedItem?.ent
    ? meta?.states.find((s) => s.id === selectedItem.ent)?.name ?? `Estado ${selectedItem.ent}`
    : null;

  return (
    <div className={`space-y-4 rounded-xl border border-border bg-card p-4 shadow-xs ${className}`}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 1. Zone Search & Selection */}
        <div className="space-y-1.5" ref={containerRef}>
          <label htmlFor="unit-search-input" className="block text-xs font-semibold text-foreground">
            1. Entidad o municipio a intervenir <span className="text-primary">*</span>
          </label>

          {selectedItem ? (
            <div className="flex items-center justify-between rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-primary text-base">📍</span>
                <div className="min-w-0 truncate">
                  <span className="font-bold text-foreground">{selectedItem.name}</span>
                  <span className="text-muted-foreground ml-1.5">
                    ({selectedItem.level === "state" ? "Entidad federativa" : `Municipio, ${stateName}`})
                  </span>
                  <span className="text-[11px] font-mono text-muted-foreground ml-1.5">
                    [{selectedItem.id}]
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleClearUnit}
                className="shrink-0 h-6 px-2 text-[11px] font-medium rounded hover:bg-primary/10 text-primary transition-colors cursor-pointer"
                aria-label="Cambiar zona seleccionada"
              >
                Cambiar
              </button>
            </div>
          ) : (
            <div className="relative">
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
                id="unit-search-input"
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setIsOpen(true);
                }}
                onFocus={() => setIsOpen(true)}
                placeholder="Buscar estado o municipio (ej. Chiapas, 07000...)"
                className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-8 text-xs text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
                autoComplete="off"
              />

              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setIsOpen(false);
                    inputRef.current?.focus();
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs p-1 rounded cursor-pointer"
                  aria-label="Limpiar búsqueda"
                >
                  ✕
                </button>
              )}

              {/* Autocomplete Dropdown */}
              {isOpen && matches.length > 0 && (
                <div className="absolute left-0 right-0 top-10 z-50 overflow-hidden rounded-md border border-border bg-popover shadow-float max-h-60 overflow-y-auto divide-y divide-border/60">
                  {matches.map((item) => {
                    const parentState =
                      meta?.states.find((s) => s.id === item.ent)?.name ?? `Estado ${item.ent}`;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectUnit(item)}
                        className="w-full text-left px-3 py-2.5 hover:bg-accent text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-foreground truncate">{item.name}</div>
                          <div className="text-[11px] text-muted-foreground font-mono">
                            Clave {item.id}
                          </div>
                        </div>
                        <span className="shrink-0 text-[11px] px-2 py-0.5 rounded bg-muted text-muted-foreground">
                          {item.level === "state" ? "Estado" : parentState}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 2. Optional Campaign Focus */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="campaign-focus-input" className="block text-xs font-semibold text-foreground">
              2. Enfoque prioritario <span className="text-muted-foreground font-normal">(opcional)</span>
            </label>
            <span
              className={`text-[11px] font-mono ${
                focus.length >= MAX_FOCUS_LENGTH ? "text-destructive font-bold" : "text-muted-foreground"
              }`}
            >
              {focus.length}/{MAX_FOCUS_LENGTH}
            </span>
          </div>

          <input
            id="campaign-focus-input"
            type="text"
            value={focus}
            onChange={handleFocusChange}
            placeholder="Ej. Jóvenes universitarios, comunidades rurales alejadas..."
            maxLength={MAX_FOCUS_LENGTH}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
          />

          {/* Quick Suggestions */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] text-muted-foreground">Sugerencias:</span>
            {QUICK_SUGGESTIONS.map((sug) => (
              <button
                key={sug}
                type="button"
                onClick={() => handleSuggestionClick(sug)}
                className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                  focus === sug
                    ? "bg-primary text-white border-primary"
                    : "bg-muted/60 text-muted-foreground border-border hover:bg-accent hover:text-foreground"
                }`}
              >
                {sug}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
