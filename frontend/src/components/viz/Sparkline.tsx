"use client";

import React, { useState } from "react";
import type { SeriesPoint } from "@/lib/types";
import { formatPct, formatInt } from "@/lib/format";

interface SparklineProps {
  series: SeriesPoint[];
  predParticipation?: number | null;
  targetYear?: number;
  height?: number;
  width?: number;
}

export function Sparkline({
  series,
  predParticipation,
  targetYear = 2027,
  height = 145,
  width = 340,
}: SparklineProps) {
  const [hoveredPoint, setHoveredPoint] = useState<SeriesPoint | null>(null);

  if (!series || series.length === 0) {
    return <div className="text-xs text-slate-500 py-4 text-center">Sin serie histórica disponible</div>;
  }

  // Separate series types
  const pjfPoints = series
    .filter((p) => p.election === "PJF" || (p.year === 2025 && p.election === "PJF"))
    .sort((a, b) => a.year - b.year);

  const presPoints = series
    .filter((p) => p.election === "PRES")
    .sort((a, b) => a.year - b.year);

  const dipFedPoints = series
    .filter((p) => (!p.election || p.election === "DIP_FED") && p.election !== "PRES" && p.election !== "PJF")
    .sort((a, b) => a.year - b.year);

  const allPoints = [...series].sort((a, b) => a.year - b.year);
  const minYear = allPoints[0].year;
  const maxYear =
    predParticipation !== undefined && predParticipation !== null
      ? targetYear
      : allPoints[allPoints.length - 1].year;

  // Find min/max participation for dynamic range from valid values
  const validValues = allPoints
    .map((p) => p.participation)
    .filter((v): v is number => v !== null && v !== undefined && !isNaN(v));

  if (predParticipation !== undefined && predParticipation !== null) {
    validValues.push(predParticipation);
  }

  const minVal = validValues.length > 0 ? Math.max(0.05, Math.floor((Math.min(...validValues) - 0.05) * 10) / 10) : 0.1;
  const maxVal = validValues.length > 0 ? Math.min(1.0, Math.ceil((Math.max(...validValues) + 0.05) * 10) / 10) : 0.9;

  const padLeft = 36;
  const padRight = 20;
  const padTop = 15;
  const padBottom = 25;

  const chartWidth = width - padLeft - padRight;
  const chartHeight = height - padTop - padBottom;

  const getX = (year: number) => {
    if (maxYear === minYear) return padLeft + chartWidth / 2;
    return padLeft + ((year - minYear) / (maxYear - minYear)) * chartWidth;
  };

  const getY = (val: number) => {
    if (maxVal === minVal) return padTop + chartHeight / 2;
    return padTop + chartHeight - ((val - minVal) / (maxVal - minVal)) * chartHeight;
  };

  // Connected segments for DIP_FED (cuts on null participation)
  const dipFedSegments: SeriesPoint[][] = [];
  let currentSeg: SeriesPoint[] = [];
  for (const p of dipFedPoints) {
    if (p.participation !== null && p.participation !== undefined) {
      currentSeg.push(p);
    } else {
      if (currentSeg.length > 0) {
        dipFedSegments.push(currentSeg);
        currentSeg = [];
      }
    }
  }
  if (currentSeg.length > 0) {
    dipFedSegments.push(currentSeg);
  }

  // Projection segment to 2027 from last valid DIP_FED point
  const lastValidDip = [...dipFedPoints].reverse().find((p) => p.participation !== null && p.participation !== undefined);
  let projPathD = "";
  if (
    predParticipation !== undefined &&
    predParticipation !== null &&
    lastValidDip &&
    lastValidDip.participation !== null
  ) {
    projPathD = `M ${getX(lastValidDip.year)} ${getY(lastValidDip.participation)} L ${getX(targetYear)} ${getY(predParticipation)}`;
  }

  return (
    <div className="relative w-full overflow-hidden space-y-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible select-none font-sans"
      >
        {/* Horizontal grid lines & Y labels */}
        {[minVal, (minVal + maxVal) / 2, maxVal].map((val, idx) => {
          const y = getY(val);
          return (
            <g key={idx}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="#334155"
                strokeDasharray="2,2"
                strokeWidth="1"
              />
              <text
                x={padLeft - 4}
                y={y + 3}
                fill="#94a3b8"
                fontSize="9"
                textAnchor="end"
              >
                {Math.round(val * 100)}%
              </text>
            </g>
          );
        })}

        {/* DIP_FED contiguous line segments (breaks on null) */}
        {dipFedSegments.map((seg, sIdx) => {
          if (seg.length < 2) return null;
          const d = seg
            .map((p, i) => `${i === 0 ? "M" : "L"} ${getX(p.year)} ${getY(p.participation!)}`)
            .join(" ");
          return (
            <path
              key={`seg-${sIdx}`}
              d={d}
              fill="none"
              stroke="#0284c7"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}

        {/* Projection dashed line to 2027 */}
        {projPathD && (
          <path
            d={projPathD}
            fill="none"
            stroke="#10b981"
            strokeWidth="2"
            strokeDasharray="4,4"
            strokeLinecap="round"
          />
        )}

        {/* DIP_FED Data points */}
        {dipFedPoints.map((p, i) => {
          const cx = getX(p.year);
          const isNull = p.participation === null || p.participation === undefined;
          const cy = isNull ? padTop + chartHeight - 2 : getY(p.participation!);
          const isLowConf = Boolean(p.low_confidence);

          return (
            <g
              key={`dip-${i}`}
              className="cursor-pointer"
              onMouseEnter={() => setHoveredPoint(p)}
              onMouseLeave={() => setHoveredPoint(null)}
            >
              {isNull ? (
                // Hollow marker for null participation (unreliable data)
                <circle
                  cx={cx}
                  cy={cy}
                  r="4.5"
                  fill="#0f172a"
                  stroke="#ef4444"
                  strokeWidth="2"
                  strokeDasharray="2,2"
                />
              ) : (
                // Valid participation point (solid circle, dotted border if low_confidence)
                <circle
                  cx={cx}
                  cy={cy}
                  r="4.5"
                  fill="#0284c7"
                  stroke={isLowConf ? "#f59e0b" : "#ffffff"}
                  strokeWidth={isLowConf ? "2" : "1.5"}
                  strokeDasharray={isLowConf ? "2,2" : undefined}
                />
              )}
              <text
                x={cx}
                y={height - 6}
                fill={isNull ? "#f87171" : "#94a3b8"}
                fontSize="9"
                textAnchor="middle"
              >
                {p.year}
              </text>
            </g>
          );
        })}

        {/* PRES Data points (diamonds) */}
        {presPoints.map((p, i) => {
          if (p.participation === null || p.participation === undefined) return null;
          const cx = getX(p.year);
          const cy = getY(p.participation);
          const s = 5.5; // size of diamond half-diagonal
          const diamondPath = `M ${cx} ${cy - s} L ${cx + s} ${cy} L ${cx} ${cy + s} L ${cx - s} ${cy} Z`;

          return (
            <g
              key={`pres-${i}`}
              className="cursor-pointer"
              onMouseEnter={() => setHoveredPoint(p)}
              onMouseLeave={() => setHoveredPoint(null)}
            >
              <path
                d={diamondPath}
                fill="#a855f7"
                stroke="#ffffff"
                strokeWidth="1.5"
              />
            </g>
          );
        })}

        {/* PJF 2025 Data points (Judicial 2025 - separate amber point outside federal line) */}
        {pjfPoints.map((p, i) => {
          const cx = getX(p.year);
          const isNull = p.participation === null || p.participation === undefined;
          const cy = isNull ? padTop + chartHeight - 2 : getY(p.participation!);
          const s = 4.5;

          return (
            <g
              key={`pjf-${i}`}
              className="cursor-pointer"
              onMouseEnter={() => setHoveredPoint(p)}
              onMouseLeave={() => setHoveredPoint(null)}
            >
              {isNull ? (
                <rect
                  x={cx - s}
                  y={cy - s}
                  width={s * 2}
                  height={s * 2}
                  fill="#0f172a"
                  stroke="#f59e0b"
                  strokeWidth="1.5"
                  strokeDasharray="2,2"
                />
              ) : (
                <rect
                  x={cx - s}
                  y={cy - s}
                  width={s * 2}
                  height={s * 2}
                  fill="#f59e0b"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                />
              )}
              <text
                x={cx}
                y={height - 6}
                fill="#f59e0b"
                fontSize="9"
                fontWeight="bold"
                textAnchor="middle"
              >
                2025 PJ
              </text>
            </g>
          );
        })}

        {/* Target 2027 Point */}
        {predParticipation !== undefined && predParticipation !== null && (
          <g>
            <circle
              cx={getX(targetYear)}
              cy={getY(predParticipation)}
              r="4.5"
              fill="#10b981"
              stroke="#0f172a"
              strokeWidth="1.5"
            />
            <text
              x={getX(targetYear)}
              y={height - 6}
              fill="#10b981"
              fontWeight="bold"
              fontSize="9"
              textAnchor="middle"
            >
              2027*
            </text>
          </g>
        )}
      </svg>

      {/* Hover tooltip */}
      {hoveredPoint && (
        <div
          className="absolute z-10 bg-slate-950 text-white text-[11px] p-2.5 rounded-lg shadow-xl border border-slate-700 pointer-events-none min-w-[180px]"
          style={{
            left: `${Math.min(80, Math.max(20, (getX(hoveredPoint.year) / width) * 100))}%`,
            top: "0px",
            transform: "translateX(-50%)",
          }}
        >
          <div className="font-bold text-sky-400">
            {hoveredPoint.year} ·{" "}
            {hoveredPoint.election === "PRES"
              ? "Presidencial (PRES)"
              : hoveredPoint.election === "PJF" || hoveredPoint.year === 2025
              ? "Judicial 2025 (PJF)"
              : "Diputaciones Federales (DIP_FED)"}
          </div>

          {hoveredPoint.participation === null ? (
            <div className="mt-1 text-rose-400 font-semibold leading-tight">
              Sin información confiable
              {hoveredPoint.ns_rate !== null && hoveredPoint.ns_rate !== undefined && (
                <div className="text-[10px] text-slate-300 font-normal">
                  (registros no especificados: {(hoveredPoint.ns_rate * 100).toFixed(1)} %)
                </div>
              )}
            </div>
          ) : (
            <div className="mt-0.5">
              Participación:{" "}
              <span className="font-semibold text-white">
                {formatPct(hoveredPoint.participation)}
              </span>
            </div>
          )}

          {hoveredPoint.low_confidence && (
            <div className="text-amber-400 text-[10px] mt-0.5 flex items-center gap-1 font-medium">
              <span>⚠️</span>
              <span>
                Baja confianza
                {hoveredPoint.ns_rate !== null && hoveredPoint.ns_rate !== undefined
                  ? ` (${(hoveredPoint.ns_rate * 100).toFixed(1)}% no especificados)`
                  : ""}
              </span>
            </div>
          )}

          <div className="text-slate-400 text-[10px] mt-0.5">
            Lista nominal: {formatInt(hoveredPoint.lista_nominal)}
          </div>
        </div>
      )}

      {/* Complete Legend */}
      <div className="flex flex-wrap items-center justify-between text-[10px] text-slate-400 pt-1.5 border-t border-slate-800 gap-y-1">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-sky-500 inline-block"></span>
          <span className="w-2 h-2 rounded-full bg-sky-500 inline-block"></span>
          <span>DIP_FED</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rotate-45 bg-purple-500 inline-block"></span>
          <span>PRES</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 bg-amber-500 inline-block rounded-xs"></span>
          <span className="text-amber-300 font-medium">Judicial 2025</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 border-b border-dashed border-emerald-400 inline-block"></span>
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
          <span>2027*</span>
        </div>
      </div>
    </div>
  );
}
