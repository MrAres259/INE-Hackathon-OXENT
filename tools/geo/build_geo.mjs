import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mapshaper from 'mapshaper';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Size limits (in bytes)
const MAX_STATES_BYTES = 1.5 * 1024 * 1024;    // 1.5 MB
const MAX_MUN_FILE_BYTES = 800 * 1024;         // 800 KB per mun file
const MAX_MUN_TOTAL_BYTES = 15 * 1024 * 1024;  // 15 MB total

export function parseArgs(rawArgs = process.argv.slice(2)) {
  let ent = path.resolve(__dirname, '../../data/raw/geo/00ent.shp');
  let mun = path.resolve(__dirname, '../../data/raw/geo/00mun.shp');
  let out = path.resolve(__dirname, '../../frontend/public/geo');

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--ent' && rawArgs[i + 1]) {
      ent = path.resolve(process.cwd(), rawArgs[++i]);
    } else if (arg === '--mun' && rawArgs[i + 1]) {
      mun = path.resolve(process.cwd(), rawArgs[++i]);
    } else if (arg === '--out' && rawArgs[i + 1]) {
      out = path.resolve(process.cwd(), rawArgs[++i]);
    }
  }

  return { ent, mun, out };
}

function getCoordinates(geometry) {
  const coords = [];
  function extract(node) {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === 'number' && typeof node[1] === 'number') {
      coords.push(node);
    } else {
      for (const child of node) extract(child);
    }
  }
  if (geometry && geometry.coordinates) {
    extract(geometry.coordinates);
  }
  return coords;
}

export function computeBBox(geometry) {
  const coords = getCoordinates(geometry);
  if (coords.length === 0) return [0, 0, 0, 0];
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const [x, y] of coords) {
    if (x < minx) minx = x;
    if (x > maxx) maxx = x;
    if (y < miny) miny = y;
    if (y > maxy) maxy = y;
  }
  return [
    Number(minx.toFixed(5)),
    Number(miny.toFixed(5)),
    Number(maxx.toFixed(5)),
    Number(maxy.toFixed(5))
  ];
}

function ringAreaAndCentroid(ring) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [x0, y0] = ring[j];
    const [x1, y1] = ring[i];
    const cross = (x0 * y1 - x1 * y0);
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area = area / 2;
  if (Math.abs(area) < 1e-12) {
    let sx = 0, sy = 0;
    for (const [x, y] of ring) { sx += x; sy += y; }
    return { area: 0, cx: sx / n, cy: sy / n };
  }
  cx = cx / (6 * area);
  cy = cy / (6 * area);
  return { area: Math.abs(area), cx, cy };
}

export function computeCentroid(geometry) {
  if (!geometry) return [0, 0];
  if (geometry.type === 'Point') {
    return [Number(geometry.coordinates[0].toFixed(5)), Number(geometry.coordinates[1].toFixed(5))];
  }
  if (geometry.type === 'Polygon' && geometry.coordinates.length > 0) {
    const { cx, cy } = ringAreaAndCentroid(geometry.coordinates[0]);
    return [Number(cx.toFixed(5)), Number(cy.toFixed(5))];
  }
  if (geometry.type === 'MultiPolygon' && geometry.coordinates.length > 0) {
    let totalArea = 0;
    let wx = 0;
    let wy = 0;
    for (const poly of geometry.coordinates) {
      if (poly.length > 0) {
        const { area, cx, cy } = ringAreaAndCentroid(poly[0]);
        totalArea += area;
        wx += cx * area;
        wy += cy * area;
      }
    }
    if (totalArea > 0) {
      return [Number((wx / totalArea).toFixed(5)), Number((wy / totalArea).toFixed(5))];
    }
  }
  const bbox = computeBBox(geometry);
  return [Number(((bbox[0] + bbox[2]) / 2).toFixed(5)), Number(((bbox[1] + bbox[3]) / 2).toFixed(5))];
}

function getInputConfig(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const isShp = ext === '.shp';
  let encodingOpt = '';

  if (isShp) {
    const cpgPath = filePath.replace(/\.shp$/i, '.cpg');
    if (!fs.existsSync(cpgPath)) {
      encodingOpt = ' encoding=latin1';
    }
  } else {
    encodingOpt = ' encoding=utf8';
  }

  return { isShp, encodingOpt };
}

export async function buildGeo(options = {}) {
  const {
    ent = path.resolve(__dirname, '../../data/raw/geo/00ent.shp'),
    mun = path.resolve(__dirname, '../../data/raw/geo/00mun.shp'),
    out = path.resolve(__dirname, '../../frontend/public/geo')
  } = options;

  let statePercentage = options.statePercentage || '2%';
  let munPercentage = options.munPercentage || '4%';
  let retryCount = 0;

  // 1. Check existence of input files
  if (!fs.existsSync(ent) || !fs.existsSync(mun)) {
    console.log('[build_geo] Input geo file(s) not found:');
    console.log(`  State shapefile/geojson: "${ent}" -> ${fs.existsSync(ent) ? 'FOUND' : 'MISSING'}`);
    console.log(`  Mun shapefile/geojson:   "${mun}" -> ${fs.existsSync(mun) ? 'FOUND' : 'MISSING'}`);
    console.log('[build_geo] Exiting cleanly with code 0 without modifying output directory.');
    return { status: 'skipped', reason: 'missing_inputs' };
  }

  const munDir = path.join(out, 'mun');
  fs.mkdirSync(munDir, { recursive: true });

  while (true) {
    console.log(`[build_geo] Processing layers (state: ${statePercentage}, mun: ${munPercentage})...`);

    const entCfg = getInputConfig(ent);
    const munCfg = getInputConfig(mun);

    const statesOutPath = path.join(out, 'states.json');

    // 2. Process states
    const stateCmd = [
      `-i "${ent}"${entCfg.encodingOpt}`,
      entCfg.isShp ? '-proj wgs84' : '',
      `-simplify visvalingam weighted keep-shapes ${statePercentage}`,
      '-clean',
      `-each "id = String(this.properties.CVE_ENT || this.properties.cve_ent || this.properties.id || '').padStart(2, '0'); name = String(this.properties.NOMGEO || this.properties.nomgeo || this.properties.name || '').trim()"`,
      '-filter-fields id,name',
      `-o "${statesOutPath}" format=geojson precision=0.00001`
    ].filter(Boolean).join(' ');

    await mapshaper.runCommands(stateCmd);

    // Read and enforce exact properties on states.json
    const statesRaw = JSON.parse(fs.readFileSync(statesOutPath, 'utf8'));
    for (const feat of statesRaw.features) {
      const p = feat.properties || {};
      const id = String(p.id || '').padStart(2, '0');
      const name = String(p.name || '').trim();
      feat.properties = { id, name };
    }
    fs.writeFileSync(statesOutPath, JSON.stringify(statesRaw), 'utf8');

    // 3. Process municipalities
    const munCmd = [
      `-i "${mun}"${munCfg.encodingOpt}`,
      munCfg.isShp ? '-proj wgs84' : '',
      `-simplify visvalingam weighted keep-shapes ${munPercentage}`,
      '-clean',
      `-each "var e = String(this.properties.CVE_ENT || this.properties.cve_ent || this.properties.ent || '').padStart(2, '0'); var rawId = String(this.properties.CVEGEO || this.properties.cvegeo || this.properties.id || ''); if (rawId.length < 5 && e) rawId = e + rawId.padStart(3, '0'); id = rawId.padStart(5, '0'); ent = e || id.slice(0, 2); name = String(this.properties.NOMGEO || this.properties.nomgeo || this.properties.name || '').trim()"`,
      '-filter-fields id,ent,name',
      '-split ent',
      `-o "${munDir}/" format=geojson precision=0.00001`
    ].filter(Boolean).join(' ');

    await mapshaper.runCommands(munCmd);

    // Read all generated mun files, enforce exact properties and calculate municipal index
    const munFiles = fs.readdirSync(munDir).filter(f => f.endsWith('.json'));
    const indexMun = {};
    let totalMunSize = 0;
    let maxSingleMunSize = 0;
    let largestMunFile = '';

    for (const f of munFiles) {
      const filePath = path.join(munDir, f);
      const stat = fs.statSync(filePath);
      totalMunSize += stat.size;
      if (stat.size > maxSingleMunSize) {
        maxSingleMunSize = stat.size;
        largestMunFile = f;
      }

      const munRaw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      for (const feat of munRaw.features) {
        const p = feat.properties || {};
        const ent = String(p.ent || '').padStart(2, '0');
        let id = String(p.id || '');
        if (id.length < 5 && ent) id = ent + id.padStart(3, '0');
        id = id.padStart(5, '0');
        const name = String(p.name || '').trim();
        feat.properties = { id, ent, name };

        indexMun[id] = {
          name,
          ent,
          centroid: computeCentroid(feat.geometry)
        };
      }
      fs.writeFileSync(filePath, JSON.stringify(munRaw), 'utf8');
    }

    // 4. Build index.json
    const indexStates = {};
    for (const feat of statesRaw.features) {
      const id = feat.properties.id;
      indexStates[id] = {
        name: feat.properties.name,
        bbox: computeBBox(feat.geometry),
        centroid: computeCentroid(feat.geometry)
      };
    }

    const indexData = {
      states: indexStates,
      mun: indexMun
    };

    const indexPath = path.join(out, 'index.json');
    fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf8');

    // 5. Size inspection & limits check
    const statesSize = fs.statSync(statesOutPath).size;
    const indexSize = fs.statSync(indexPath).size;

    console.log('[build_geo] Output sizes:');
    console.log(`  states.json: ${(statesSize / 1024).toFixed(1)} KB (limit: 1536 KB)`);
    console.log(`  index.json:  ${(indexSize / 1024).toFixed(1)} KB`);
    console.log(`  mun/:        ${munFiles.length} files, total ${(totalMunSize / 1024 / 1024).toFixed(2)} MB (limit: 15 MB)`);
    if (largestMunFile) {
      console.log(`  largest mun: mun/${largestMunFile} ${(maxSingleMunSize / 1024).toFixed(1)} KB (limit: 800 KB)`);
    }

    let needsRetry = false;

    if (statesSize > MAX_STATES_BYTES) {
      console.warn(`[build_geo WARN] states.json size ${(statesSize / 1024).toFixed(1)} KB exceeds 1.5 MB limit.`);
      if (retryCount === 0) {
        statePercentage = '1%';
        needsRetry = true;
      }
    }

    if (maxSingleMunSize > MAX_MUN_FILE_BYTES || totalMunSize > MAX_MUN_TOTAL_BYTES) {
      console.warn(`[build_geo WARN] Mun files exceed size limit (max single: ${(maxSingleMunSize / 1024).toFixed(1)} KB, total: ${(totalMunSize / 1024 / 1024).toFixed(2)} MB).`);
      if (retryCount === 0) {
        munPercentage = '2%';
        needsRetry = true;
      }
    }

    if (needsRetry && retryCount === 0) {
      retryCount++;
      console.log(`[build_geo] Automatically reducing simplification percentages and retrying once...`);
      continue;
    }

    console.log('[build_geo] Build completed successfully.');
    return {
      status: 'ok',
      statesCount: statesRaw.features.length,
      munFilesCount: munFiles.length,
      totalMunCount: Object.keys(indexMun).length,
      statesSize,
      totalMunSize,
      indexSize
    };
  }
}

// Execute when run directly as CLI
const isMain = process.argv[1] && (
  path.resolve(process.argv[1]) === path.resolve(__filename) ||
  process.argv[1].endsWith('build_geo.mjs')
);

if (isMain) {
  const args = parseArgs();
  buildGeo(args)
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[build_geo ERROR]', err);
      process.exit(1);
    });
}
