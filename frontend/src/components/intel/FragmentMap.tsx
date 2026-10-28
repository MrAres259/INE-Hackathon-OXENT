"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";

export type FragmentMapScale =
  | { kind: "sequential"; max: number; unit: string }
  | { kind: "category" };

export interface FragmentMapProps {
  level: "state" | "mun";
  ent?: string;
  ids: string[];
  values: Record<string, number>;
  scale: FragmentMapScale;
  context?: boolean;
  onSelect?: (id: string) => void;
  height?: number | string;
  label?: string;
  className?: string;
}

interface GeoFeature {
  type: string;
  id?: string;
  properties: {
    id: string;
    name: string;
    ent?: string;
    [k: string]: any;
  };
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: any;
  };
}

interface GeoJsonCollection {
  type: string;
  features: GeoFeature[];
}

const geoCache: Record<string, GeoJsonCollection> = {};

// 5-class sequential palette from #fbe3ec to #8f1150
const SEQUENTIAL_PALETTE = [
  "#fbe3ec",
  "#f6b4cd",
  "#dc5f95",
  "#b5186b",
  "#8f1150",
];

const CATEGORY_COLORS: Record<string, string> = {
  rojo: "#b5186b",
  naranja: "#ea580c",
  amarillo: "#eab308",
  verde: "#16a34a",
  sin_dato: "#8a8290",
};

function getCategoryColor(val: number | undefined): string {
  if (val === undefined || val === null || isNaN(val)) return CATEGORY_COLORS.sin_dato;
  if (val >= 75) return CATEGORY_COLORS.rojo;
  if (val >= 55) return CATEGORY_COLORS.naranja;
  if (val >= 35) return CATEGORY_COLORS.amarillo;
  return CATEGORY_COLORS.verde;
}

function getSequentialColor(val: number | undefined, max: number): string {
  if (val === undefined || val === null || isNaN(val) || val <= 0) {
    return SEQUENTIAL_PALETTE[0];
  }
  const safeMax = max > 0 ? max : 1;
  const ratio = Math.min(1, Math.max(0, val / safeMax));
  const idx = Math.min(SEQUENTIAL_PALETTE.length - 1, Math.floor(ratio * SEQUENTIAL_PALETTE.length));
  return SEQUENTIAL_PALETTE[idx];
}

// Spherical Web Mercator projection [0, 1] x [0, 1]
function projectMercator(lng: number, lat: number): [number, number] {
  const rad = Math.PI / 180;
  const x = (lng + 180) / 360;
  const sinLat = Math.sin(lat * rad);
  const clamped = Math.max(-0.9999, Math.min(0.9999, sinLat));
  const y = 0.5 - Math.log((1 + clamped) / (1 - clamped)) / (4 * Math.PI);
  return [x, y];
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function computeFeatureBBox(feature: GeoFeature): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  function traverse(coords: any) {
    if (typeof coords[0] === "number") {
      const [x, y] = projectMercator(coords[0], coords[1]);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    } else {
      for (const sub of coords) {
        traverse(sub);
      }
    }
  }

  traverse(feature.geometry.coordinates);
  return { minX, minY, maxX, maxY };
}

function intersectsBBox(a: BBox, b: BBox): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

function expandBBox(b: BBox, fraction: number): BBox {
  const dx = (b.maxX - b.minX) * fraction;
  const dy = (b.maxY - b.minY) * fraction;
  return {
    minX: b.minX - dx,
    minY: b.minY - dy,
    maxX: b.maxX + dx,
    maxY: b.maxY + dy,
  };
}

export function FragmentMap({
  level,
  ent,
  ids,
  values,
  scale,
  context = true,
  onSelect,
  height = 360,
  label,
  className = "",
}: FragmentMapProps) {
  const [geoData, setGeoData] = useState<GeoJsonCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredInfo, setHoveredInfo] = useState<{ id: string; name: string; valStr: string } | null>(null);

  const cacheKey = level === "state" ? "/geo/states.json" : `/geo/mun/${ent || "01"}.json`;

  useEffect(() => {
    let active = true;
    if (geoCache[cacheKey]) {
      setGeoData(geoCache[cacheKey]);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetch(cacheKey)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: GeoJsonCollection) => {
        geoCache[cacheKey] = data;
        if (active) {
          setGeoData(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [cacheKey]);

  // Project features and compute bounds
  const mapLayout = useMemo(() => {
    if (!geoData || !geoData.features) return null;

    const idSet = new Set(ids);
    const targetFeatures = geoData.features.filter((f) => idSet.has(f.properties.id));

    if (targetFeatures.length === 0) {
      // Fallback: render all features in collection
      const fullBBox: BBox = {
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity,
      };
      const featureBoxes = geoData.features.map((f) => {
        const b = computeFeatureBBox(f);
        if (b.minX < fullBBox.minX) fullBBox.minX = b.minX;
        if (b.minY < fullBBox.minY) fullBBox.minY = b.minY;
        if (b.maxX > fullBBox.maxX) fullBBox.maxX = b.maxX;
        if (b.maxY > fullBBox.maxY) fullBBox.maxY = b.maxY;
        return { feature: f, bbox: b, isTarget: false };
      });
      return { bounds: fullBBox, features: featureBoxes };
    }

    // Compute target bbox
    const targetBBox: BBox = {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    };
    for (const tf of targetFeatures) {
      const b = computeFeatureBBox(tf);
      if (b.minX < targetBBox.minX) targetBBox.minX = b.minX;
      if (b.minY < targetBBox.minY) targetBBox.minY = b.minY;
      if (b.maxX > targetBBox.maxX) targetBBox.maxX = b.maxX;
      if (b.maxY > targetBBox.maxY) targetBBox.maxY = b.maxY;
    }

    // 15% expanded context bbox for neighboring units
    const contextBBox = expandBBox(targetBBox, 0.15);

    const featureBoxes: Array<{ feature: GeoFeature; bbox: BBox; isTarget: boolean }> = [];
    for (const f of geoData.features) {
      const isTarget = idSet.has(f.properties.id);
      const b = computeFeatureBBox(f);
      if (isTarget) {
        featureBoxes.push({ feature: f, bbox: b, isTarget: true });
      } else if (context && intersectsBBox(b, contextBBox)) {
        featureBoxes.push({ feature: f, bbox: b, isTarget: false });
      }
    }

    // View bounds: padded target bbox
    const paddedTarget = expandBBox(targetBBox, 0.08);
    return { bounds: paddedTarget, features: featureBoxes };
  }, [geoData, ids, context]);

  const svgDimensions = useMemo(() => {
    if (!mapLayout) return { width: 800, height: 500, viewBox: "0 0 800 500" };
    const { bounds } = mapLayout;
    const dx = bounds.maxX - bounds.minX;
    const dy = bounds.maxY - bounds.minY;
    const aspect = dx > 0 && dy > 0 ? dx / dy : 1.6;
    const w = 800;
    const h = Math.max(300, Math.min(700, Math.round(w / aspect)));
    return { width: w, height: h, viewBox: `0 0 ${w} ${h}` };
  }, [mapLayout]);

  // Coordinate mapper from [0, 1] mercator to SVG pixels
  const toSvgCoords = (lng: number, lat: number): [number, number] => {
    if (!mapLayout) return [0, 0];
    const [x, y] = projectMercator(lng, lat);
    const { bounds } = mapLayout;
    const px = ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * svgDimensions.width;
    const py = ((y - bounds.minY) / (bounds.maxY - bounds.minY)) * svgDimensions.height;
    return [px, py];
  };

  // Convert geometry coordinates to SVG path d string
  const renderGeometryPath = (geometry: GeoFeature["geometry"]): string => {
    function ringToPath(ring: [number, number][]): string {
      if (!ring || ring.length === 0) return "";
      let d = "";
      for (let i = 0; i < ring.length; i++) {
        const [px, py] = toSvgCoords(ring[i][0], ring[i][1]);
        d += i === 0 ? `M ${px.toFixed(1)} ${py.toFixed(1)}` : ` L ${px.toFixed(1)} ${py.toFixed(1)}`;
      }
      return d + " Z";
    }

    if (geometry.type === "Polygon") {
      return geometry.coordinates.map(ringToPath).join(" ");
    } else if (geometry.type === "MultiPolygon") {
      return geometry.coordinates
        .map((poly: [number, number][][]) => poly.map(ringToPath).join(" "))
        .join(" ");
    }
    return "";
  };

  const mapAriaLabel = label || `Fragmento de mapa con ${ids.length} zonas electorales`;

  return (
    <div
      className={`relative flex flex-col rounded-xl border border-border bg-card p-3 shadow-xs ${className}`}
      style={{ minHeight: typeof height === "number" ? `${height}px` : height }}
    >
      {/* Accessible header / floating info tip */}
      <div className="flex items-center justify-between text-xs mb-2">
        <span className="font-semibold text-foreground truncate">
          {hoveredInfo ? (
            <span>
              <strong>{hoveredInfo.name}</strong> · {hoveredInfo.valStr}
            </span>
          ) : (
            <span className="text-muted-foreground">{mapAriaLabel}</span>
          )}
        </span>
        {hoveredInfo && (
          <span className="text-[11px] font-mono text-muted-foreground ml-2 shrink-0">
            Clave {hoveredInfo.id}
          </span>
        )}
      </div>

      {/* SVG Canvas */}
      <div className="relative flex-1 w-full overflow-hidden rounded-lg bg-muted/20 flex items-center justify-center">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <svg className="animate-spin size-4 text-primary" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span>Cargando geometría...</span>
          </div>
        ) : mapLayout ? (
          <svg
            role="img"
            aria-label={mapAriaLabel}
            viewBox={svgDimensions.viewBox}
            className="w-full h-full max-h-[500px] object-contain select-none"
          >
            {/* 1. Context Neighbors (rendered first in background) */}
            {mapLayout.features
              .filter((f) => !f.isTarget)
              .map(({ feature }) => (
                <path
                  key={`bg-${feature.properties.id}`}
                  d={renderGeometryPath(feature.geometry)}
                  fill="#ece8eb"
                  stroke="#dcd6da"
                  strokeWidth="0.75"
                  className="pointer-events-none"
                />
              ))}

            {/* 2. Target Features with Values and Interactive Handlers */}
            {mapLayout.features
              .filter((f) => f.isTarget)
              .map(({ feature }) => {
                const fid = feature.properties.id;
                const val = values[fid];
                const fillColor =
                  scale.kind === "sequential"
                    ? getSequentialColor(val, scale.max)
                    : getCategoryColor(val);

                const unitStr = scale.kind === "sequential" ? scale.unit : "pts";
                const valStr = val !== undefined ? `${val.toFixed(2)} ${unitStr}` : "Sin dato";

                return (
                  <path
                    key={fid}
                    d={renderGeometryPath(feature.geometry)}
                    fill={fillColor}
                    stroke="#ffffff"
                    strokeWidth="1.2"
                    tabIndex={0}
                    role="button"
                    aria-label={`${feature.properties.name}: ${valStr}`}
                    className="cursor-pointer transition-colors outline-none hover:stroke-foreground hover:stroke-2 focus:stroke-foreground focus:stroke-2"
                    onMouseEnter={() =>
                      setHoveredInfo({
                        id: fid,
                        name: feature.properties.name,
                        valStr,
                      })
                    }
                    onMouseLeave={() => setHoveredInfo(null)}
                    onFocus={() =>
                      setHoveredInfo({
                        id: fid,
                        name: feature.properties.name,
                        valStr,
                      })
                    }
                    onBlur={() => setHoveredInfo(null)}
                    onClick={() => onSelect?.(fid)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect?.(fid);
                      }
                    }}
                  />
                );
              })}
          </svg>
        ) : (
          <div className="text-xs text-muted-foreground">Geometría no disponible para esta selección.</div>
        )}
      </div>

      {/* Legend Footer */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2 text-[11px]">
        {scale.kind === "sequential" ? (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">0</span>
            <div className="flex h-2.5 w-32 rounded-full overflow-hidden border border-border/50">
              {SEQUENTIAL_PALETTE.map((color, idx) => (
                <div key={idx} className="flex-1 h-full" style={{ backgroundColor: color }} />
              ))}
            </div>
            <span className="font-semibold text-foreground">
              {scale.max} {scale.unit}
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-[#b5186b]" />
              <span className="text-muted-foreground">Rojo</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-[#ea580c]" />
              <span className="text-muted-foreground">Naranja</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-[#eab308]" />
              <span className="text-muted-foreground">Amarillo</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-[#16a34a]" />
              <span className="text-muted-foreground">Verde</span>
            </span>
          </div>
        )}

        {context && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="size-2 rounded-sm bg-[#ece8eb] border border-[#dcd6da]" />
            <span>Zonas limítrofes (contexto)</span>
          </div>
        )}
      </div>
    </div>
  );
}
