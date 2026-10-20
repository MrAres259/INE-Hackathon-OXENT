import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { fileURLToPath } from 'url';
import mapshaper from 'mapshaper';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { getInputConfig } from './build_geo.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  let x = Math.floor(((lon + 180) / 360) * n);
  x = Math.max(0, Math.min(n - 1, x));

  const maxLat = 85.0511287798066;
  const clampedLat = Math.max(-maxLat, Math.min(maxLat, lat));
  const rad = (clampedLat * Math.PI) / 180;
  let y = Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n);
  y = Math.max(0, Math.min(n - 1, y));

  return { x, y };
}

export function tileRangeForBounds(bounds, z) {
  let minLon, minLat, maxLon, maxLat;
  if (Array.isArray(bounds)) {
    [minLon, minLat, maxLon, maxLat] = bounds;
  } else {
    minLon = bounds.minLon ?? bounds.minx ?? bounds.left;
    minLat = bounds.minLat ?? bounds.miny ?? bounds.bottom;
    maxLon = bounds.maxLon ?? bounds.maxx ?? bounds.right;
    maxLat = bounds.maxLat ?? bounds.maxy ?? bounds.top;
  }

  const nw = lonLatToTile(minLon, maxLat, z);
  const se = lonLatToTile(maxLon, minLat, z);

  return {
    minX: Math.min(nw.x, se.x),
    maxX: Math.max(nw.x, se.x),
    minY: Math.min(nw.y, se.y),
    maxY: Math.max(nw.y, se.y)
  };
}

export function tilesetVersion(inputPaths, options = {}) {
  const hash = crypto.createHash('sha1');
  const paths = Array.isArray(inputPaths) ? inputPaths : [inputPaths];

  for (const p of paths) {
    if (typeof p === 'string' && fs.existsSync(p)) {
      const stat = fs.statSync(p);
      if (stat.isFile()) {
        hash.update(fs.readFileSync(p));
        if (p.toLowerCase().endsWith('.shp')) {
          const basePath = p.slice(0, -4);
          for (const ext of ['.dbf', '.cpg', '.shx', '.prj']) {
            const sibling = basePath + ext;
            if (fs.existsSync(sibling)) {
              hash.update(fs.readFileSync(sibling));
            }
          }
        }
      }
    } else if (Buffer.isBuffer(p)) {
      hash.update(p);
    } else if (typeof p === 'string') {
      hash.update(p);
    }
  }

  const sortedOptions = {};
  for (const k of Object.keys(options).sort()) {
    sortedOptions[k] = options[k];
  }
  hash.update(JSON.stringify(sortedOptions));

  return hash.digest('hex').slice(0, 12);
}

export async function buildTiles(options = {}) {
  const rawDir = options.rawDir || path.resolve(__dirname, '../../data/raw/geo');
  const ent = options.ent || path.join(rawDir, '00ent.shp');
  const mun = options.mun || path.join(rawDir, '00mun.shp');
  const outDir = options.outDir || options.out || path.resolve(__dirname, '../../frontend/public/geo');
  const tmpDir = options.tmpDir || path.resolve(__dirname, '../../data/cache/geo_tiles_tmp');
  const minzoom = options.minzoom ?? 3;
  const maxzoom = options.maxzoom ?? 9;
  const munKeep = options.munKeep || '25%';
  const stateKeep = options.stateKeep || '20%';

  if (!fs.existsSync(ent) || !fs.existsSync(mun)) {
    console.warn(`[build_tiles] Input files not found: ent="${ent}", mun="${mun}"`);
    return null;
  }

  const resolvedOutDir = path.resolve(outDir);
  const resolvedTilesDir = path.resolve(resolvedOutDir, 'tiles');
  const normalizedTilesDir = resolvedTilesDir.replace(/\\/g, '/').toLowerCase();

  const isProdTilesDir = normalizedTilesDir.endsWith('frontend/public/geo/tiles');
  const isTempTestDir =
    normalizedTilesDir.includes('/temp/') ||
    normalizedTilesDir.includes('/tmp/') ||
    normalizedTilesDir.includes('tmpdir') ||
    normalizedTilesDir.startsWith(os.tmpdir().replace(/\\/g, '/').toLowerCase());

  if (!isProdTilesDir && !isTempTestDir) {
    throw new Error(`Refusing to clean tiles directory: path is neither frontend/public/geo/tiles nor a temp test directory: ${resolvedTilesDir}`);
  }

  fs.mkdirSync(tmpDir, { recursive: true });
  const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tmpStatesJson = path.join(tmpDir, `tmp_states_${uniqueId}.json`);
  const tmpMunJson = path.join(tmpDir, `tmp_mun_${uniqueId}.json`);

  let statesRaw;
  let munRaw;

  try {
    const entCfg = getInputConfig(ent);
    const munCfg = getInputConfig(mun);

    const stateCmd = [
      `-i "${ent}"${entCfg.encodingOpt}`,
      entCfg.isShp ? '-proj wgs84' : '',
      '-clean',
      `-simplify visvalingam weighted keep-shapes ${stateKeep}`,
      `-each "id = String(this.properties.CVE_ENT || this.properties.cve_ent || this.properties.id || '').padStart(2, '0'); name = String(this.properties.NOMGEO || this.properties.nomgeo || this.properties.name || '').trim()"`,
      '-filter-fields id,name',
      `-o force "${tmpStatesJson}" format=geojson precision=0.00001`
    ].filter(Boolean).join(' ');

    console.log(`[build_tiles] Simplifying states with keep-shapes ${stateKeep}...`);
    await mapshaper.runCommands(stateCmd);

    const munCmd = [
      `-i "${mun}"${munCfg.encodingOpt}`,
      munCfg.isShp ? '-proj wgs84' : '',
      '-clean',
      `-simplify visvalingam weighted keep-shapes ${munKeep}`,
      `-each "var e = String(this.properties.CVE_ENT || this.properties.cve_ent || this.properties.ent || '').padStart(2, '0'); var rawId = String(this.properties.CVEGEO || this.properties.cvegeo || this.properties.id || ''); if (rawId.length < 5 && e) rawId = e + rawId.padStart(3, '0'); id = rawId.padStart(5, '0'); ent = e || id.slice(0, 2); name = String(this.properties.NOMGEO || this.properties.nomgeo || this.properties.name || '').trim()"`,
      '-filter-fields id,ent,name',
      `-o force "${tmpMunJson}" format=geojson precision=0.00001`
    ].filter(Boolean).join(' ');

    console.log(`[build_tiles] Simplifying municipalities with keep-shapes ${munKeep}...`);
    await mapshaper.runCommands(munCmd);

    statesRaw = JSON.parse(fs.readFileSync(tmpStatesJson, 'utf8'));
    munRaw = JSON.parse(fs.readFileSync(tmpMunJson, 'utf8'));
  } finally {
    try { fs.unlinkSync(tmpStatesJson); } catch {}
    try { fs.unlinkSync(tmpMunJson); } catch {}
    try {
      const remaining = fs.readdirSync(tmpDir);
      if (remaining.length === 0) {
        fs.rmdirSync(tmpDir);
      }
    } catch {}
  }

  // Normalization and numeric feature.id assignment
  for (const feat of statesRaw.features) {
    const p = feat.properties || {};
    const id = String(p.id || '').padStart(2, '0');
    const name = String(p.name || '').trim();
    feat.id = parseInt(id, 10);
    feat.properties = { id, name };
  }

  for (const feat of munRaw.features) {
    const p = feat.properties || {};
    let ent = String(p.ent || '').padStart(2, '0');
    let id = String(p.id || '');
    if (id.length < 5 && ent) id = ent + id.padStart(3, '0');
    id = id.padStart(5, '0');
    if (!ent) ent = id.slice(0, 2);
    const name = String(p.name || '').trim();
    feat.id = parseInt(id, 10);
    feat.properties = { id, ent, name };
  }

  // Bounds & center calculation
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  function updateBounds(geometry) {
    if (!geometry || !geometry.coordinates) return;
    function recurse(c) {
      if (typeof c[0] === 'number' && typeof c[1] === 'number') {
        if (c[0] < minLon) minLon = c[0];
        if (c[0] > maxLon) maxLon = c[0];
        if (c[1] < minLat) minLat = c[1];
        if (c[1] > maxLat) maxLat = c[1];
      } else if (Array.isArray(c)) {
        for (const item of c) recurse(item);
      }
    }
    recurse(geometry.coordinates);
  }

  for (const feat of statesRaw.features) updateBounds(feat.geometry);
  for (const feat of munRaw.features) updateBounds(feat.geometry);

  minLon = Number(minLon.toFixed(5));
  minLat = Number(minLat.toFixed(5));
  maxLon = Number(maxLon.toFixed(5));
  maxLat = Number(maxLat.toFixed(5));
  const bounds = [minLon, minLat, maxLon, maxLat];
  const centerLon = Number(((minLon + maxLon) / 2).toFixed(5));
  const centerLat = Number(((minLat + maxLat) / 2).toFixed(5));
  const center = [centerLon, centerLat, 4];

  // Index with geojson-vt
  const vtOptions = {
    maxZoom: maxzoom,
    indexMaxZoom: 5,
    indexMaxPoints: 100000,
    tolerance: 3,
    extent: 4096,
    buffer: 64
  };

  console.log(`[build_tiles] Indexing GeoJSON layers into geojson-vt...`);
  const statesIndex = geojsonvt(statesRaw, vtOptions);
  const munIndex = geojsonvt(munRaw, vtOptions);

  // Clean tiles directory
  if (fs.existsSync(resolvedTilesDir)) {
    fs.rmSync(resolvedTilesDir, { recursive: true, force: true });
  }
  fs.mkdirSync(resolvedTilesDir, { recursive: true });

  console.log(`[build_tiles] Generating vector tiles z=${minzoom}..${maxzoom} within bounds [${bounds.join(', ')}]...`);
  let tileCount = 0;
  let totalBytes = 0;

  for (let z = minzoom; z <= maxzoom; z++) {
    const range = tileRangeForBounds(bounds, z);
    for (let x = range.minX; x <= range.maxX; x++) {
      const zxDir = path.join(resolvedTilesDir, String(z), String(x));
      fs.mkdirSync(zxDir, { recursive: true });

      for (let y = range.minY; y <= range.maxY; y++) {
        const tilePath = path.join(zxDir, `${y}.pbf`);
        const statesTile = statesIndex.getTile(z, x, y);
        const munTile = (z >= 5) ? munIndex.getTile(z, x, y) : null;

        const layers = {};
        if (statesTile && statesTile.features && statesTile.features.length > 0) {
          layers.states = statesTile;
        }
        if (munTile && munTile.features && munTile.features.length > 0) {
          layers.mun = munTile;
        }

        if (Object.keys(layers).length > 0) {
          const pbfData = vtpbf.fromGeojsonVt(layers, { version: 2 });
          fs.writeFileSync(tilePath, Buffer.from(pbfData));
          tileCount++;
          totalBytes += pbfData.length;
        } else {
          fs.writeFileSync(tilePath, Buffer.alloc(0));
          tileCount++;
        }
      }
    }
  }

  const version = tilesetVersion([ent, mun], { minzoom, maxzoom, munKeep, stateKeep });

  const manifest = {
    tilejson: '3.0.0',
    name: 'atalaya-mg2024',
    version,
    scheme: 'xyz',
    tiles: ['/geo/tiles/{z}/{x}/{y}.pbf'],
    minzoom,
    maxzoom,
    bounds,
    center,
    vector_layers: [
      {
        id: 'states',
        minzoom,
        maxzoom,
        fields: {
          id: 'String',
          name: 'String'
        }
      },
      {
        id: 'mun',
        minzoom: Math.max(minzoom, 5),
        maxzoom,
        fields: {
          id: 'String',
          ent: 'String',
          name: 'String'
        }
      }
    ],
    feature_counts: {
      states: statesRaw.features.length,
      mun: munRaw.features.length
    },
    tile_count: tileCount,
    bytes: totalBytes,
    generated_at: new Date().toISOString()
  };

  const manifestPath = path.join(resolvedOutDir, 'tiles.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`[build_tiles] Wrote manifest: ${manifestPath} (${tileCount} tiles, ${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);

  const expectedIds = {
    states: statesRaw.features.map(f => f.properties.id),
    mun: munRaw.features.map(f => f.properties.id)
  };
  const valResult = validateTileset(resolvedOutDir, manifest, expectedIds);
  if (!valResult.ok) {
    throw new Error(`Tileset validation failed: missing states=[${valResult.missing.states.join(', ')}], missing mun=[${valResult.missing.mun.join(', ')}]`);
  }

  return manifest;
}

export function validateTileset(dir, manifest, expectedIds) {
  let resolvedDir = path.resolve(dir);
  let tilesDir = resolvedDir;
  if (fs.existsSync(path.join(resolvedDir, 'tiles'))) {
    tilesDir = path.join(resolvedDir, 'tiles');
  }

  if (!manifest) {
    let manifestPath = path.join(resolvedDir, 'tiles.json');
    if (!fs.existsSync(manifestPath) && fs.existsSync(path.join(resolvedDir, '../tiles.json'))) {
      manifestPath = path.join(resolvedDir, '../tiles.json');
    }
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }
  }

  let expectedStates = [];
  let expectedMun = [];

  if (expectedIds) {
    if (Array.isArray(expectedIds.states)) expectedStates = expectedIds.states;
    if (Array.isArray(expectedIds.mun)) expectedMun = expectedIds.mun;
  } else {
    const entCatalogPath = path.resolve(__dirname, '../../data/build/geo_ent_catalog.csv');
    const munCatalogPath = path.resolve(__dirname, '../../data/build/geo_mun_catalog.csv');
    if (fs.existsSync(entCatalogPath)) {
      const lines = fs.readFileSync(entCatalogPath, 'utf8').trim().split('\n').slice(1);
      expectedStates = lines.map(l => l.split(',')[0].replace(/"/g, '').trim());
    } else {
      expectedStates = Array.from({ length: 32 }, (_, i) => String(i + 1).padStart(2, '0'));
    }
    if (fs.existsSync(munCatalogPath)) {
      const lines = fs.readFileSync(munCatalogPath, 'utf8').trim().split('\n').slice(1);
      expectedMun = lines.map(l => l.split(',')[0].replace(/"/g, '').trim());
    }
  }

  let maxzoom = 9;
  if (manifest && manifest.maxzoom != null) {
    maxzoom = manifest.maxzoom;
  } else if (fs.existsSync(tilesDir)) {
    const entries = fs.readdirSync(tilesDir).filter(n => !isNaN(Number(n))).map(Number);
    if (entries.length > 0) {
      maxzoom = Math.max(...entries);
    }
  }

  const maxzoomDir = path.join(tilesDir, String(maxzoom));
  if (!fs.existsSync(maxzoomDir)) {
    throw new Error(`Tiles directory for maxzoom ${maxzoom} not found at ${tilesDir}`);
  }

  let totalBytes = 0;
  let maxTileBytes = 0;
  const foundStateIds = new Set();
  const foundMunIds = new Set();

  function scanTiles(currentDir, currentZ) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const ent of entries) {
      const fullPath = path.join(currentDir, ent.name);
      if (ent.isDirectory()) {
        const nextZ = (currentZ === null && !isNaN(Number(ent.name))) ? Number(ent.name) : currentZ;
        scanTiles(fullPath, nextZ);
      } else if (ent.isFile() && ent.name.endsWith('.pbf')) {
        const size = fs.statSync(fullPath).size;
        totalBytes += size;
        if (size > maxTileBytes) maxTileBytes = size;

        if (size > 512 * 1024) {
          console.warn(`[validateTileset WARN] Tile ${fullPath} size ${(size / 1024).toFixed(1)} KB exceeds 512 KB`);
        }

        if (currentZ === maxzoom && size > 0) {
          const buf = fs.readFileSync(fullPath);
          const pbf = new PbfReader(buf);
          const vt = new VectorTile(pbf);

          if (vt.layers.states) {
            const layer = vt.layers.states;
            for (let i = 0; i < layer.length; i++) {
              const feat = layer.feature(i);
              if (feat.properties && feat.properties.id != null) {
                foundStateIds.add(String(feat.properties.id).padStart(2, '0'));
              }
            }
          }

          if (vt.layers.mun) {
            const layer = vt.layers.mun;
            for (let i = 0; i < layer.length; i++) {
              const feat = layer.feature(i);
              if (feat.properties && feat.properties.id != null) {
                foundMunIds.add(String(feat.properties.id).padStart(5, '0'));
              }
            }
          }
        }
      }
    }
  }

  scanTiles(tilesDir, null);

  if (totalBytes > 80 * 1024 * 1024) {
    throw new Error(`Total tileset size ${(totalBytes / 1024 / 1024).toFixed(2)} MB exceeds 80 MB limit`);
  }

  const missingStates = expectedStates.filter(id => !foundStateIds.has(String(id)));
  const missingMun = expectedMun.filter(id => !foundMunIds.has(String(id)));
  const ok = missingStates.length === 0 && missingMun.length === 0;

  return {
    ok,
    missing: {
      states: missingStates,
      mun: missingMun
    },
    maxTileBytes
  };
}

const isMain = process.argv[1] && (
  path.resolve(process.argv[1]) === path.resolve(__filename) ||
  process.argv[1].endsWith('build_tiles.mjs')
);

if (isMain) {
  buildTiles()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[build_tiles ERROR]', err);
      process.exit(1);
    });
}
