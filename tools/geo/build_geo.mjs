import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mapshaper from 'mapshaper';
import { buildTiles } from './build_tiles.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Size limits (in bytes)
const MAX_STATES_BYTES = 1.5 * 1024 * 1024;    // 1.5 MB
const MAX_MUN_FILE_BYTES = 800 * 1024;         // 800 KB per mun file
const MAX_MUN_TOTAL_BYTES = 15 * 1024 * 1024;  // 15 MB total
const MAX_MUN_ALL_BYTES = 4.5 * 1024 * 1024;   // 4.5 MB
const MAX_COUNTRY_BYTES = 300 * 1024;          // 300 KB

export function roundCoordinates(coords, decimals = 4) {
  const factor = 10 ** decimals;
  function recurse(node) {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === 'number') {
      for (let i = 0; i < node.length; i++) {
        node[i] = Math.round(node[i] * factor) / factor;
      }
    } else {
      for (let i = 0; i < node.length; i++) {
        recurse(node[i]);
      }
    }
  }
  recurse(coords);
}

export function parseArgs(rawArgs = process.argv.slice(2)) {
  let ent = path.resolve(__dirname, '../../data/raw/geo/00ent.shp');
  let mun = path.resolve(__dirname, '../../data/raw/geo/00mun.shp');
  let out = path.resolve(__dirname, '../../frontend/public/geo');
  let catalogDir = path.resolve(__dirname, '../../data/build');
  let tilesOnly = false;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--tiles-only') {
      tilesOnly = true;
    } else if (arg === '--ent' && rawArgs[i + 1]) {
      ent = path.resolve(process.cwd(), rawArgs[++i]);
    } else if (arg === '--mun' && rawArgs[i + 1]) {
      mun = path.resolve(process.cwd(), rawArgs[++i]);
    } else if (arg === '--out' && rawArgs[i + 1]) {
      out = path.resolve(process.cwd(), rawArgs[++i]);
    } else if (arg === '--catalog-dir' && rawArgs[i + 1]) {
      catalogDir = path.resolve(process.cwd(), rawArgs[++i]);
    }
  }

  return { ent, mun, out, catalogDir, tilesOnly };
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

export function getInputConfig(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const isShp = ext === '.shp';
  let encodingOpt = '';

  if (isShp) {
    const cpgPath = filePath.replace(/\.shp$/i, '.cpg');
    let cpgContent = '';
    if (fs.existsSync(cpgPath)) {
      try {
        cpgContent = fs.readFileSync(cpgPath, 'utf8').trim().toLowerCase();
      } catch {}
    }
    // INEGI Marco Geoestadistico uses 88591 (ISO-8859-1 / latin1).
    // iconv-lite does not recognize raw string '88591', so map it to latin1.
    if (!cpgContent || cpgContent === '88591' || cpgContent === 'iso-8859-1' || cpgContent === 'latin1') {
      encodingOpt = ' encoding=latin1';
    } else if (cpgContent === 'utf-8' || cpgContent === 'utf8') {
      encodingOpt = ' encoding=utf8';
    } else {
      encodingOpt = ` encoding=${cpgContent}`;
    }
  } else {
    encodingOpt = ' encoding=utf8';
  }

  return { isShp, encodingOpt };
}

export async function generateCatalogs(options = {}) {
  const {
    ent = path.resolve(__dirname, '../../data/raw/geo/00ent.shp'),
    mun = path.resolve(__dirname, '../../data/raw/geo/00mun.shp'),
    catalogDir = path.resolve(__dirname, '../../data/build')
  } = options;

  if (!fs.existsSync(ent) || !fs.existsSync(mun)) {
    return { status: 'skipped', reason: 'missing_inputs' };
  }

  fs.mkdirSync(catalogDir, { recursive: true });

  const entCfg = getInputConfig(ent);
  const munCfg = getInputConfig(mun);

  const escapeCsv = val => {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  // 1. Entities catalog (geo_ent_catalog.csv: cve_ent,name)
  const tempEntJson = path.join(catalogDir, '_temp_ent_catalog.json');
  await mapshaper.runCommands(`-i "${ent}"${entCfg.encodingOpt} -drop geometry -o "${tempEntJson}" format=json`);
  const rawEntRecords = JSON.parse(fs.readFileSync(tempEntJson, 'utf8'));
  try { fs.unlinkSync(tempEntJson); } catch {}

  const entCatalog = rawEntRecords.map(p => {
    const cve_ent = String(p.CVE_ENT || p.cve_ent || p.id || '').padStart(2, '0');
    const name = String(p.NOMGEO || p.nomgeo || p.name || '').trim();
    return { cve_ent, name };
  }).sort((a, b) => a.cve_ent.localeCompare(b.cve_ent));

  const entCsvLines = ['cve_ent,name'];
  for (const row of entCatalog) {
    entCsvLines.push(`${escapeCsv(row.cve_ent)},${escapeCsv(row.name)}`);
  }
  const entCatalogPath = path.join(catalogDir, 'geo_ent_catalog.csv');
  fs.writeFileSync(entCatalogPath, entCsvLines.join('\n') + '\n', 'utf8');

  // 2. Municipalities catalog (geo_mun_catalog.csv: cvegeo,cve_ent,cve_mun,name)
  const tempMunJson = path.join(catalogDir, '_temp_mun_catalog.json');
  await mapshaper.runCommands(`-i "${mun}"${munCfg.encodingOpt} -drop geometry -o "${tempMunJson}" format=json`);
  const rawMunRecords = JSON.parse(fs.readFileSync(tempMunJson, 'utf8'));
  try { fs.unlinkSync(tempMunJson); } catch {}

  const munCatalog = rawMunRecords.map(p => {
    let cve_ent = String(p.CVE_ENT || p.cve_ent || p.ent || '').padStart(2, '0');
    let rawMun = String(p.CVE_MUN || p.cve_mun || '');
    let rawGeo = String(p.CVEGEO || p.cvegeo || p.id || '');

    if (!cve_ent && rawGeo.length >= 2) {
      cve_ent = rawGeo.slice(0, 2);
    }
    if (!rawMun && rawGeo.length >= 5) {
      rawMun = rawGeo.slice(2, 5);
    }
    const cve_mun = rawMun.padStart(3, '0');

    let cvegeo = rawGeo;
    if (cvegeo.length < 5 && cve_ent) {
      cvegeo = cve_ent + cve_mun;
    }
    cvegeo = cvegeo.padStart(5, '0');

    const name = String(p.NOMGEO || p.nomgeo || p.name || '').trim();
    return { cvegeo, cve_ent, cve_mun, name };
  }).sort((a, b) => a.cvegeo.localeCompare(b.cvegeo));

  const munCsvLines = ['cvegeo,cve_ent,cve_mun,name'];
  for (const row of munCatalog) {
    munCsvLines.push(`${escapeCsv(row.cvegeo)},${escapeCsv(row.cve_ent)},${escapeCsv(row.cve_mun)},${escapeCsv(row.name)}`);
  }
  const munCatalogPath = path.join(catalogDir, 'geo_mun_catalog.csv');
  fs.writeFileSync(munCatalogPath, munCsvLines.join('\n') + '\n', 'utf8');

  console.log(`[build_geo] Wrote catalogs:`);
  console.log(`  geo_ent_catalog.csv: ${entCatalog.length} entities -> ${entCatalogPath}`);
  console.log(`  geo_mun_catalog.csv: ${munCatalog.length} municipalities -> ${munCatalogPath}`);

  return {
    status: 'ok',
    entCatalogPath,
    munCatalogPath,
    entCount: entCatalog.length,
    munCount: munCatalog.length
  };
}

export async function buildGeo(options = {}) {
  const {
    ent = path.resolve(__dirname, '../../data/raw/geo/00ent.shp'),
    mun = path.resolve(__dirname, '../../data/raw/geo/00mun.shp'),
    out = path.resolve(__dirname, '../../frontend/public/geo'),
    catalogDir = path.resolve(__dirname, '../../data/build'),
    tilesOnly = false
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

  if (tilesOnly) {
    console.log('[build_geo] Running in --tiles-only mode...');
    const tileManifest = await buildTiles({
      ent,
      mun,
      outDir: out,
      stateKeep: options.statePercentage || '20%',
      munKeep: options.munPercentage || '25%'
    });
    return { status: 'ok', tilesOnly: true, manifest: tileManifest };
  }

  // 2. Generate CSV catalogs from original attributes (unsimplified)
  const catalogResult = await generateCatalogs({ ent, mun, catalogDir });

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
      '-clean',
      `-simplify visvalingam weighted keep-shapes ${statePercentage}`,
      `-each "id = String(this.properties.CVE_ENT || this.properties.cve_ent || this.properties.id || '').padStart(2, '0'); name = String(this.properties.NOMGEO || this.properties.nomgeo || this.properties.name || '').trim()"`,
      '-filter-fields id,name',
      `-o force "${statesOutPath}" format=geojson precision=0.00001`
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

    // 2b. Process dissolved country
    const countryOutPath = path.join(out, 'country.json');
    const countryCmd = [
      `-i "${statesOutPath}"`,
      '-dissolve',
      '-simplify visvalingam weighted keep-shapes 15%',
      `-each "id = 'MX'"`,
      '-filter-fields id',
      `-o force "${countryOutPath}" format=geojson precision=0.0001`
    ].filter(Boolean).join(' ');

    await mapshaper.runCommands(countryCmd);

    const countryRaw = JSON.parse(fs.readFileSync(countryOutPath, 'utf8'));
    for (const feat of countryRaw.features) {
      feat.properties = { id: 'MX' };
    }
    fs.writeFileSync(countryOutPath, JSON.stringify(countryRaw), 'utf8');

    let countrySize = fs.statSync(countryOutPath).size;
    if (countrySize > MAX_COUNTRY_BYTES) {
      console.warn(`[build_geo WARN] country.json size ${(countrySize / 1024).toFixed(1)} KB exceeds 300 KB limit. Re-simplifying...`);
      await mapshaper.runCommands(`-i "${countryOutPath}" -simplify visvalingam weighted keep-shapes 50% -o force "${countryOutPath}" format=geojson precision=0.0001`);
      countrySize = fs.statSync(countryOutPath).size;
    }

    // 3. Process municipalities
    const munCmd = [
      `-i "${mun}"${munCfg.encodingOpt}`,
      munCfg.isShp ? '-proj wgs84' : '',
      '-clean',
      `-simplify visvalingam weighted keep-shapes ${munPercentage}`,
      `-each "var e = String(this.properties.CVE_ENT || this.properties.cve_ent || this.properties.ent || '').padStart(2, '0'); var rawId = String(this.properties.CVEGEO || this.properties.cvegeo || this.properties.id || ''); if (rawId.length < 5 && e) rawId = e + rawId.padStart(3, '0'); id = rawId.padStart(5, '0'); ent = e || id.slice(0, 2); name = String(this.properties.NOMGEO || this.properties.nomgeo || this.properties.name || '').trim()"`,
      '-filter-fields id,ent,name',
      '-split ent',
      `-o force "${munDir}/" format=geojson precision=0.00001`
    ].filter(Boolean).join(' ');

    await mapshaper.runCommands(munCmd);

    // Read all generated mun files, enforce exact properties and calculate municipal index
    const munFiles = fs.readdirSync(munDir).filter(f => f.endsWith('.json'));
    munFiles.sort();
    const indexMun = {};
    let totalMunSize = 0;
    let maxSingleMunSize = 0;
    let largestMunFile = '';
    const allMunFeatures = [];

    for (const f of munFiles) {
      const filePath = path.join(munDir, f);
      let stat = fs.statSync(filePath);

      // If a specific state exceeds 800 KB (e.g. Oaxaca 20 with 570 municipalities),
      // re-simplify ONLY that state to satisfy the 800 KB limit without degrading other states.
      if (stat.size > MAX_MUN_FILE_BYTES) {
        console.warn(`[build_geo WARN] Mun file ${f} size ${(stat.size / 1024).toFixed(1)} KB exceeds 800 KB limit. Re-simplifying state ${f}...`);
        // State-specific simplification: reduce detail only for this state to stay <= 800 KB (e.g. 70% retention)
        await mapshaper.runCommands(`-i "${filePath}" -simplify visvalingam weighted keep-shapes 70% -o force "${filePath}" format=geojson precision=0.00001`);
        stat = fs.statSync(filePath);
        if (stat.size > MAX_MUN_FILE_BYTES) {
          // If still over 800 KB, reduce to 50%
          await mapshaper.runCommands(`-i "${filePath}" -simplify visvalingam weighted keep-shapes 50% -o force "${filePath}" format=geojson precision=0.00001`);
          stat = fs.statSync(filePath);
        }
        console.log(`[build_geo] Re-simplified ${f} to ${(stat.size / 1024).toFixed(1)} KB`);
      }

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

        // Clone feature for mun_all.json with precision=0.0001
        const featClone = {
          type: 'Feature',
          properties: { id, ent, name },
          geometry: JSON.parse(JSON.stringify(feat.geometry))
        };
        roundCoordinates(featClone.geometry.coordinates, 4);
        allMunFeatures.push(featClone);
      }
      fs.writeFileSync(filePath, JSON.stringify(munRaw), 'utf8');
    }

    // 3b. Generate mun_all.json (all municipalities in one FeatureCollection, <= 4.5 MB)
    allMunFeatures.sort((a, b) => a.properties.id.localeCompare(b.properties.id));
    const munAllGeo = {
      type: 'FeatureCollection',
      features: allMunFeatures
    };
    const munAllOutPath = path.join(out, 'mun_all.json');
    fs.writeFileSync(munAllOutPath, JSON.stringify(munAllGeo), 'utf8');
    let munAllSize = fs.statSync(munAllOutPath).size;

    if (munAllSize > MAX_MUN_ALL_BYTES) {
      console.warn(`[build_geo WARN] mun_all.json size ${(munAllSize / 1024 / 1024).toFixed(2)} MB exceeds 4.5 MB limit. Re-simplifying...`);
      await mapshaper.runCommands(`-i "${munAllOutPath}" -simplify visvalingam weighted keep-shapes 70% -o force "${munAllOutPath}" format=geojson precision=0.0001`);
      munAllSize = fs.statSync(munAllOutPath).size;
      console.log(`[build_geo] Re-simplified mun_all.json to ${(munAllSize / 1024 / 1024).toFixed(2)} MB`);
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
    console.log(`  states.json:  ${(statesSize / 1024).toFixed(1)} KB (limit: 1536 KB)`);
    console.log(`  country.json: ${(countrySize / 1024).toFixed(1)} KB (limit: 300 KB)`);
    console.log(`  index.json:   ${(indexSize / 1024).toFixed(1)} KB`);
    console.log(`  mun_all.json: ${(munAllSize / 1024 / 1024).toFixed(2)} MB (limit: 4.5 MB)`);
    console.log(`  mun/:         ${munFiles.length} files, total ${(totalMunSize / 1024 / 1024).toFixed(2)} MB (limit: 15 MB)`);
    if (largestMunFile) {
      console.log(`  largest mun:  mun/${largestMunFile} ${(maxSingleMunSize / 1024).toFixed(1)} KB (limit: 800 KB)`);
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

    console.log('[build_geo] Building vector tiles...');
    const tileManifest = await buildTiles({
      ent,
      mun,
      outDir: out,
      stateKeep: options.statePercentage || '20%',
      munKeep: options.munPercentage || '25%'
    });

    console.log('[build_geo] Build completed successfully.');
    return {
      status: 'ok',
      statesCount: statesRaw.features.length,
      munFilesCount: munFiles.length,
      totalMunCount: Object.keys(indexMun).length,
      munAllCount: allMunFeatures.length,
      statesSize,
      countrySize,
      totalMunSize,
      munAllSize,
      indexSize,
      catalogs: catalogResult,
      tiles: tileManifest
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
