"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { FeatureCollection, Geometry } from "geojson";
import { useAtalaya } from "@/lib/state";
import {
  fetchStatesGeoJson,
  fetchMunGeoJson,
  fetchGeoIndex,
  colorForFeature,
  type StateProperties,
  type MunProperties,
} from "@/lib/geo";
import { formatPct, getCategoryLabel } from "@/lib/format";
import type { RiskItem } from "@/lib/types";
import { Legend } from "./Legend";
import { Breadcrumb } from "./Breadcrumb";
import { RegionSearch } from "./RegionSearch";

// Bounds for Mexico [south-west, north-east]
const MEXICO_BOUNDS: [[number, number], [number, number]] = [
  [14.0, -118.5],
  [33.0, -86.0],
];
const MEXICO_CENTER: [number, number] = [23.6, -102.5];
const MEXICO_ZOOM = 5;

// Helper component to handle programmatic map pan/zoom and zoom-out event
function MapController() {
  const map = useMap();
  const { level, selectedEnt, selectedRegionId, resetToNational } = useAtalaya();
  const prevEntRef = useRef<string | null>(null);

  // Monitor zoom level; if user zooms out below 6 while in municipal view, return to national
  useMapEvents({
    zoomend: () => {
      const z = map.getZoom();
      if (z < 6 && level === "mun") {
        resetToNational();
      }
    },
  });

  // Zoom to state or reset to national
  useEffect(() => {
    if (level === "state") {
      map.flyTo(MEXICO_CENTER, MEXICO_ZOOM, { duration: 1.0 });
      prevEntRef.current = null;
    } else if (selectedEnt && selectedEnt !== prevEntRef.current) {
      prevEntRef.current = selectedEnt;
      // Fetch bbox from index or compute from center
      fetchGeoIndex().then((idx) => {
        const item = idx.find((i) => i.id === selectedEnt && i.level === "state");
        if (item?.bbox) {
          const [minLon, minLat, maxLon, maxLat] = item.bbox;
          map.flyToBounds(
            [
              [minLat, minLon],
              [maxLat, maxLon],
            ],
            { padding: [30, 30], duration: 1.2 }
          );
        }
      });
    }
  }, [level, selectedEnt, map]);

  return null;
}

export function LeafletInnerMap() {
  const {
    level,
    selectedEnt,
    selectedRegionId,
    riskItems,
    selectState,
    selectMunicipality,
  } = useAtalaya();

  const [statesGeo, setStatesGeo] = useState<FeatureCollection<Geometry, StateProperties> | null>(null);
  const [munGeo, setMunGeo] = useState<FeatureCollection<Geometry, MunProperties> | null>(null);

  // Load states geo on mount
  useEffect(() => {
    fetchStatesGeoJson().then((geo) => setStatesGeo(geo));
  }, []);

  // Load municipal geo when state selected
  useEffect(() => {
    if (selectedEnt && level === "mun") {
      fetchMunGeoJson(selectedEnt).then((geo) => setMunGeo(geo));
    } else {
      setMunGeo(null);
    }
  }, [selectedEnt, level]);

  // Index riskItems by ID for quick O(1) styling lookup
  const riskById = useMemo(() => {
    const map = new Map<string, RiskItem>();
    riskItems.forEach((item) => map.set(item.id, item));
    return map;
  }, [riskItems]);

  // Style state polygons
  const getStateStyle = (feature: any) => {
    const entId = feature?.properties?.id ?? feature?.id;
    const color = colorForFeature(feature, riskById);
    const isSelected = selectedEnt === entId;
    const isDimmed = level === "mun" && selectedEnt && !isSelected;

    return {
      fillColor: color,
      weight: isSelected ? 2.5 : 1,
      opacity: 1,
      color: isSelected ? "#ffffff" : "#475569",
      fillOpacity: isDimmed ? 0.2 : isSelected ? 0.65 : 0.55,
    };
  };

  // State feature interaction handlers
  const onEachStateFeature = (feature: any, layer: L.Layer) => {
    const entId = feature?.properties?.id ?? feature?.id;
    const name = feature?.properties?.name ?? `Estado ${entId}`;
    const item = riskById.get(entId);
    const part = item?.last_participation !== null ? formatPct(item?.last_participation) : "—";
    const predAbs = item?.pred_abstention !== null ? formatPct(item?.pred_abstention) : "—";
    const catLabel = item ? getCategoryLabel(item.category) : "Sin dato";

    // Bind tooltip
    layer.bindTooltip(
      `<div class="font-sans text-xs">
        <div class="font-bold text-slate-900">${name}</div>
        <div class="text-slate-600">Abstención 2027: <span class="font-semibold text-slate-900">${predAbs}</span></div>
        <div class="text-slate-600">Semáforo: <span class="font-semibold">${catLabel}</span></div>
        <div class="text-[10px] text-slate-400 mt-0.5">Clic para explorar municipios</div>
      </div>`,
      { sticky: true, className: "atalaya-map-tooltip" }
    );

    layer.on({
      mouseover: (e) => {
        const l = e.target;
        l.setStyle({
          weight: 2.5,
          color: "#ffffff",
          fillOpacity: 0.8,
        });
        l.bringToFront();
      },
      mouseout: (e) => {
        const l = e.target;
        l.setStyle(getStateStyle(feature));
      },
      click: () => {
        selectState(entId);
      },
    });
  };

  // Municipal polygon style
  const getMunStyle = (feature: any) => {
    const cvegeo = feature?.properties?.id ?? feature?.id;
    const color = colorForFeature(feature, riskById);
    const isSelected = selectedRegionId === cvegeo;

    return {
      fillColor: color,
      weight: isSelected ? 2.5 : 1,
      opacity: 1,
      color: isSelected ? "#ffffff" : "#1e293b",
      fillOpacity: isSelected ? 0.85 : 0.6,
    };
  };

  // Municipal feature interaction handlers
  const onEachMunFeature = (feature: any, layer: L.Layer) => {
    const cvegeo = feature?.properties?.id ?? feature?.id;
    const name = feature?.properties?.name ?? `Municipio ${cvegeo}`;
    const item = riskById.get(cvegeo);
    const predAbs = item?.pred_abstention !== null ? formatPct(item?.pred_abstention) : "—";
    const catLabel = item ? getCategoryLabel(item.category) : "Sin dato";

    layer.bindTooltip(
      `<div class="font-sans text-xs">
        <div class="font-bold text-slate-900">${name}</div>
        <div class="text-slate-600">Abstención 2027: <span class="font-semibold text-slate-900">${predAbs}</span></div>
        <div class="text-slate-600">Semáforo: <span class="font-semibold">${catLabel}</span></div>
      </div>`,
      { sticky: true, className: "atalaya-map-tooltip" }
    );

    layer.on({
      mouseover: (e) => {
        const l = e.target;
        l.setStyle({
          weight: 2.5,
          color: "#ffffff",
          fillOpacity: 0.9,
        });
        l.bringToFront();
      },
      mouseout: (e) => {
        const l = e.target;
        l.setStyle(getMunStyle(feature));
      },
      click: (e) => {
        L.DomEvent.stopPropagation(e);
        selectMunicipality(cvegeo);
      },
    });
  };

  return (
    <div className="relative w-full h-full min-h-[520px] bg-slate-950 overflow-hidden rounded-2xl border border-slate-800 shadow-inner">
      {/* Top Map Overlays: Search & Breadcrumbs */}
      <div className="absolute top-4 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-2">
          <Breadcrumb />
        </div>
        <div className="pointer-events-auto">
          <RegionSearch />
        </div>
      </div>

      {/* Bottom Map Overlay: Legend */}
      <div className="absolute bottom-4 left-4 z-20 pointer-events-auto">
        <Legend />
      </div>

      <MapContainer
        center={MEXICO_CENTER}
        zoom={MEXICO_ZOOM}
        minZoom={4}
        maxBounds={MEXICO_BOUNDS}
        maxBoundsViscosity={0.8}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%", background: "#0b1329" }}
        attributionControl={false}
      >
        <MapController />

        {/* CARTO Positron Light Tiles */}
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>'
          opacity={0.75}
        />

        {/* States GeoJSON Layer */}
        {statesGeo && (
          <GeoJSON
            key={`states-${riskItems.length}-${selectedEnt ?? "all"}`}
            data={statesGeo}
            style={getStateStyle}
            onEachFeature={onEachStateFeature}
          />
        )}

        {/* Municipalities GeoJSON Layer (drawn on top when state selected) */}
        {level === "mun" && munGeo && (
          <GeoJSON
            key={`mun-${selectedEnt}-${selectedRegionId ?? "none"}-${riskItems.length}`}
            data={munGeo}
            style={getMunStyle}
            onEachFeature={onEachMunFeature}
          />
        )}
      </MapContainer>
    </div>
  );
}
