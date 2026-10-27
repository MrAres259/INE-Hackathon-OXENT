"use client";

import React, { useState } from "react";
import type { SeriesPoint } from "@/lib/types";
import { formatPct, formatInt } from "@/lib/format";

export const DEFAULT_NATIONAL_SERIES: { year: number; participation: number }[] = [
  { year: 2009, participation: 0.4406 },
  { year: 2012, participation: 0.6208 },
  { year: 2015, participation: 0.4707 },
  { year: 2018, participation: 0.6237 },
  { year: 2021, participation: 0.5184 },
  { year: 2024, participation: 0.5967 },
];

interface SparklineProps {
  series: SeriesPoint[];
  predParticipation?: number | null;
  targetYear?: number;
  height?: number;
  width?: number;
  nationalSeries?: { year: number; participation: number }[];
}

export function Sparkline({
  series,
  predParticipation,
  targetYear = 2027,
  height = 145,
  width = 340,
  nationalSeries = DEFAULT_NATIONAL_SERIES,
}: SparklineProps) {
  const [hoveredPoint, setHoveredPoint] = useState<SeriesPoint | null>(null);

  if (!series || series.length === 0) {
    return <div className="text-xs text-muted-foreground py-4 text-center">Sin serie histórica disponible</div>;
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

  // Also include national points that are in range
  const relevantNational = nationalSeries.filter((n) => n.year >= minYear && n.year <= maxYear);
  for (const n of relevantNational) {
    validValues.push(n.participation);
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

  // National reference line path
  let nationalPathD = "";
  if (relevantNational.length > 1) {
    nationalPathD = relevantNational
      .map((n, i) => `${i === 0 ? "M" : "L"} ${getX(n.year)} ${getY(n.participation)}`)
      .join(" ");
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

  // Descriptive summary for aria-label and SVG <title>
  const summaryPoints = allPoints.map((p) => {
    const valStr =
      p.participation !== null && p.participation !== undefined
        ? formatPct(p.participation)
        : "sin dato confiable";
    const label = p.election === "PJF" || p.year === 2025 ? `${p.year} (Judicial)` : `${p.year}`;
    return `${label}: ${valStr}`;
  });
  if (predParticipation !== undefined && predParticipation !== null) {
    summaryPoints.push(`${targetYear} (pronóstico): ${formatPct(predParticipation)}`);
  }
  const descriptiveLabel = `Serie histórica de participación: ${summaryPoints.join(", ")}`;

  // Collision-free axis labels (min distance 30px)
  // Priority order: 2027* (3) > DIP_FED federal years (2) > 2025 PJ (1)
  interface AxisLabelCandidate {
    key: string;
    x: number;
    priority: number;
    color: string;
    fontWeight?: string;
    fontSize?: string;
    line1: string;
    line2?: string;
  }

  const labelCandidates: AxisLabelCandidate[] = [];

  if (predParticipation !== undefined && predParticipation !== null) {
    labelCandidates.push({
      key: "target-2027",
      x: getX(targetYear),
      priority: 3,
      color: "#b5186b",
      fontWeight: "bold",
      fontSize: "10",
      line1: `${targetYear}*`,
    });
  }

  for (const p of dipFedPoints) {
    const isNull = p.participation === null || p.participation === undefined;
    labelCandidates.push({
      key: `dip-${p.year}`,
      x: getX(p.year),
      priority: 2,
      color: isNull ? "#c8352f" : "#6f6270",
      fontSize: "10",
      line1: String(p.year),
    });
  }

  for (const p of pjfPoints) {
    labelCandidates.push({
      key: `pjf-${p.year}`,
      x: getX(p.year),
      priority: 1,
      color: "#6f6270",
      fontWeight: "bold",
      fontSize: "9",
      line1: String(p.year),
      line2: "PJ",
    });
  }

  const sortedCandidates = [...labelCandidates].sort((a, b) => b.priority - a.priority);
  const acceptedLabels: AxisLabelCandidate[] = [];

  for (const cand of sortedCandidates) {
    const collides = acceptedLabels.some((acc) => Math.abs(acc.x - cand.x) < 30);
    if (!collides) {
      acceptedLabels.push(cand);
    }
  }

  return (
    <div className="relative w-full overflow-hidden space-y-2">
      <svg
        role="img"
        aria-label={descriptiveLabel}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible select-none font-sans"
      >
        <title>{descriptiveLabel}</title>
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
                stroke="#e7e1e5"
                strokeDasharray="2,2"
                strokeWidth="1"
              />
              <text
                x={padLeft - 6}
                y={y + 3.5}
                fill="#6f6270"
                fontSize="10"
                fontFamily="inherit"
                textAnchor="end"
              >
                {Math.round(val * 100)}%
              </text>
            </g>
          );
        })}

        {/* National reference dashed line (#8a7f89) */}
        {nationalPathD && (
          <path
            d={nationalPathD}
            fill="none"
            stroke="#8a7f89"
            strokeWidth="1.5"
            strokeDasharray="4,3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* DIP_FED contiguous line segments (breaks on null, stroke #b5186b, 2.2px) */}
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
              stroke="#b5186b"
              strokeWidth="2.2"
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
            stroke="#b5186b"
            strokeWidth="1.8"
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
                <g>
                  <circle
                    cx={cx}
                    cy={cy}
                    r="3.5"
                    fill="#ffffff"
                    stroke="#c8352f"
                    strokeWidth="1.5"
                    strokeDasharray="2,2"
                  />
                  <text
                    x={cx}
                    y={cy - 6}
                    fill="#c8352f"
                    fontSize="8"
                    fontWeight="600"
                    textAnchor="middle"
                    className="select-none pointer-events-none"
                  >
                    sin dato
                  </text>
                </g>
              ) : (
                // Valid participation point (points r 2.5)
                <circle
                  cx={cx}
                  cy={cy}
                  r="2.5"
                  fill="#b5186b"
                  stroke={isLowConf ? "#f2bf3a" : "#ffffff"}
                  strokeWidth="1"
                />
              )}
            </g>
          );
        })}

        {/* PRES Data points (diamonds, #4a2a48) */}
        {presPoints.map((p, i) => {
          if (p.participation === null || p.participation === undefined) return null;
          const cx = getX(p.year);
          const cy = getY(p.participation);
          const s = 4.5; // size of diamond half-diagonal
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
                fill="#4a2a48"
                stroke="#ffffff"
                strokeWidth="1"
              />
            </g>
          );
        })}

        {/* PJF 2025 Data points (Judicial 2025 - separate square point #f2bf3a) */}
        {pjfPoints.map((p, i) => {
          const cx = getX(p.year);
          const isNull = p.participation === null || p.participation === undefined;
          const cy = isNull ? padTop + chartHeight - 2 : getY(p.participation!);
          const s = 3.5;

          return (
            <g
              key={`pjf-${i}`}
              className="cursor-pointer"
              onMouseEnter={() => setHoveredPoint(p)}
              onMouseLeave={() => setHoveredPoint(null)}
            >
              {isNull ? (
                <g>
                  <rect
                    x={cx - s}
                    y={cy - s}
                    width={s * 2}
                    height={s * 2}
                    fill="#ffffff"
                    stroke="#f2bf3a"
                    strokeWidth="1.5"
                    strokeDasharray="2,2"
                  />
                  <text
                    x={cx}
                    y={cy - 6}
                    fill="#f2bf3a"
                    fontSize="8"
                    fontWeight="600"
                    textAnchor="middle"
                    className="select-none pointer-events-none"
                  >
                    sin dato
                  </text>
                </g>
              ) : (
                <rect
                  x={cx - s}
                  y={cy - s}
                  width={s * 2}
                  height={s * 2}
                  fill="#f2bf3a"
                  stroke="#ffffff"
                  strokeWidth="1"
                />
              )}
            </g>
          );
        })}

        {/* Target 2027 Point */}
        {predParticipation !== undefined && predParticipation !== null && (
          <g>
            <circle
              cx={getX(targetYear)}
              cy={getY(predParticipation)}
              r="2.5"
              fill="#b5186b"
              stroke="#ffffff"
              strokeWidth="1"
            />
          </g>
        )}

        {/* Collision-free X-axis labels */}
        {acceptedLabels.map((lbl) => {
          if (lbl.line2) {
            return (
              <g key={lbl.key} className="select-none pointer-events-none">
                <text
                  x={lbl.x}
                  y={height - 12}
                  fill={lbl.color}
                  fontSize={lbl.fontSize || "9"}
                  fontWeight={lbl.fontWeight}
                  fontFamily="inherit"
                  textAnchor="middle"
                >
                  {lbl.line1}
                </text>
                <text
                  x={lbl.x}
                  y={height - 3}
                  fill={lbl.color}
                  fontSize="8"
                  fontWeight={lbl.fontWeight}
                  fontFamily="inherit"
                  textAnchor="middle"
                >
                  {lbl.line2}
                </text>
              </g>
            );
          }
          return (
            <text
              key={lbl.key}
              x={lbl.x}
              y={height - 6}
              fill={lbl.color}
              fontSize={lbl.fontSize || "10"}
              fontWeight={lbl.fontWeight}
              fontFamily="inherit"
              textAnchor="middle"
              className="select-none pointer-events-none"
            >
              {lbl.line1}
            </text>
          );
        })}
      </svg>

      {/* Hover tooltip in clear theme */}
      {hoveredPoint && (
        <div
          className="absolute z-10 bg-card text-foreground text-[11px] p-2.5 rounded-lg shadow-float border border-border pointer-events-none min-w-[180px]"
          style={{
            left: `${Math.min(80, Math.max(20, (getX(hoveredPoint.year) / width) * 100))}%`,
            top: "0px",
            transform: "translateX(-50%)",
          }}
        >
          <div className="font-bold text-primary font-display">
            {hoveredPoint.year} ·{" "}
            {hoveredPoint.election === "PRES"
              ? "Presidencial (PRES)"
              : hoveredPoint.election === "PJF" || hoveredPoint.year === 2025
              ? "Judicial 2025 (PJF)"
              : "Diputaciones Federales (DIP_FED)"}
          </div>

          {hoveredPoint.participation === null ? (
            <div className="mt-1 text-risk-crit font-semibold leading-tight">
              Sin información confiable
              {hoveredPoint.ns_rate !== null && hoveredPoint.ns_rate !== undefined && (
                <div className="text-[10px] text-muted-foreground font-normal">
                  (registros no especificados: {(hoveredPoint.ns_rate * 100).toFixed(1)} %)
                </div>
              )}
            </div>
          ) : (
            <div className="mt-0.5">
              Participación:{" "}
              <span className="font-semibold text-foreground tnum">
                {formatPct(hoveredPoint.participation)}
              </span>
            </div>
          )}

          {hoveredPoint.low_confidence && (
            <div className="text-risk-high text-[10px] mt-0.5 flex items-center gap-1 font-medium">
              <span>⚠️</span>
              <span>
                Baja confianza
                {hoveredPoint.ns_rate !== null && hoveredPoint.ns_rate !== undefined
                  ? ` (${(hoveredPoint.ns_rate * 100).toFixed(1)}% no especificados)`
                  : ""}
              </span>
            </div>
          )}

          <div className="text-muted-foreground text-[10px] mt-0.5 tnum">
            Lista nominal: {formatInt(hoveredPoint.lista_nominal)}
          </div>
        </div>
      )}

      {/* Complete Legend in light theme */}
      <div className="flex flex-wrap items-center justify-between text-[10px] text-muted-foreground pt-1.5 border-t border-border gap-y-1">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-[#b5186b] inline-block"></span>
          <span className="w-2 h-2 rounded-full bg-[#b5186b] inline-block"></span>
          <span>DIP_FED</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 border-b border-dashed border-[#8a7f89] inline-block"></span>
          <span>Nacional</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rotate-45 bg-[#4a2a48] inline-block"></span>
          <span>PRES</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 bg-[#f2bf3a] inline-block rounded-xs"></span>
          <span className="font-medium text-foreground">Judicial 2025</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 border-b border-dashed border-[#b5186b] inline-block"></span>
          <span className="w-2 h-2 rounded-full bg-[#b5186b] inline-block"></span>
          <span>2027*</span>
        </div>
        {allPoints.some((p) => p.participation === null || p.participation === undefined) && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full border border-dashed border-[#c8352f] bg-card inline-block"></span>
            <span className="text-risk-crit">Sin dato</span>
          </div>
        )}
      </div>
    </div>
  );
}
