"use client";

import React, { useState, useEffect, useRef } from "react";
import { useAtalaya } from "@/lib/state";
import { RegionDetailPanel } from "./RegionDetailPanel";
import { RankingTable } from "./RankingTable";
import { ChatPanel } from "./ChatPanel";

export type PanelTabId = "detail" | "ranking" | "chat";

interface TabDef {
  id: PanelTabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabDef[] = [
  {
    id: "detail",
    label: "Diagnóstico",
    icon: (
      <svg className="size-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
        />
      </svg>
    ),
  },
  {
    id: "ranking",
    label: "Ranking",
    icon: (
      <svg className="size-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"
        />
      </svg>
    ),
  },
  {
    id: "chat",
    label: "Asistente",
    icon: (
      <svg className="size-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
        />
      </svg>
    ),
  },
];

export interface SidePanelTabsProps {
  onTabChange?: (tab: PanelTabId) => void;
  activeTab?: PanelTabId;
  onSelectTab?: (tab: PanelTabId) => void;
  headerAction?: React.ReactNode;
}

export function useSidePanelTabs(
  selectedRegionId: string | null | undefined,
  onTabChange?: (tab: PanelTabId) => void
) {
  const [activeTab, setActiveTab] = useState<PanelTabId>("detail");

  const onTabChangeRef = useRef(onTabChange);
  onTabChangeRef.current = onTabChange;

  const prevRegionIdRef = useRef<string | null>(selectedRegionId ?? null);

  // Automatically activate Diagnóstico only when selectedRegionId changes to a non-null value
  useEffect(() => {
    if (selectedRegionId && selectedRegionId !== prevRegionIdRef.current) {
      setActiveTab("detail");
      onTabChangeRef.current?.("detail");
    }
    prevRegionIdRef.current = selectedRegionId ?? null;
  }, [selectedRegionId]);

  const selectTab = (tabId: PanelTabId) => {
    setActiveTab(tabId);
    onTabChangeRef.current?.(tabId);
  };

  return { activeTab, selectTab, setActiveTab };
}

export function SidePanelTabs({
  onTabChange,
  activeTab: controlledActiveTab,
  onSelectTab: controlledSelectTab,
  headerAction,
}: SidePanelTabsProps) {
  const { selectedRegionId } = useAtalaya();
  const internalHook = useSidePanelTabs(selectedRegionId, onTabChange);

  const activeTab = controlledActiveTab !== undefined ? controlledActiveTab : internalHook.activeTab;
  const selectTab = controlledSelectTab !== undefined ? controlledSelectTab : internalHook.selectTab;

  return (
    <div className="flex flex-col h-full min-h-0 bg-card overflow-hidden">
      {/* Tab Navigation Bar */}
      <div data-tour="panel" className="flex items-center border-b border-border bg-card px-2 shrink-0">
        <div className="flex flex-1 min-w-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTab(t.id)}
              data-tab={t.id}
              className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 sm:py-3 text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        {headerAction}
      </div>

      {/* Tab Content: Keep mounted with hidden to preserve chat and state */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-4">
        <div className={activeTab === "detail" ? "block" : "hidden"}>
          <RegionDetailPanel />
        </div>
        <div className={activeTab === "ranking" ? "block" : "hidden"}>
          <RankingTable />
        </div>
        <div className={activeTab === "chat" ? "h-full flex flex-col" : "hidden"}>
          <ChatPanel />
        </div>
      </div>
    </div>
  );
}
