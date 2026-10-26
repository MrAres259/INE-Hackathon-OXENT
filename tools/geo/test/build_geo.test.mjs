import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { buildGeo, buildIndexOnly, generateCatalogs, parseArgs, polylabel, geodesicAreaKm2 } from '../build_geo.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesDir = path.resolve(__dirname, '../fixtures');
const entFixture = path.join(fixturesDir, 'ent.geojson');
const munFixture = path.join(fixturesDir, 'mun.geojson');
const buildGeoScript = path.resolve(__dirname, '../build_geo.mjs');

test('build_geo runs on fixtures and produces correct GeoJSON and index.json', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-geo-test-'));

  try {
    const result = await buildGeo({
      ent: entFixture,
      mun: munFixture,
      out: tempDir,
      catalogDir: tempDir,
      statePercentage: '50%',
      munPercentage: '50%'
    });

    assert.equal(result.status, 'ok');

    // 1. Verify generated files exist
    const statesPath = path.join(tempDir, 'states.json');
    const countryPath = path.join(tempDir, 'country.json');
    const indexPath = path.join(tempDir, 'index.json');
    const munAllPath = path.join(tempDir, 'mun_all.json');
    const munDir = path.join(tempDir, 'mun');
    const mun07Path = path.join(munDir, '07.json');
    const mun16Path = path.join(munDir, '16.json');

    assert.ok(fs.existsSync(statesPath), 'states.json should exist');
    assert.ok(fs.existsSync(countryPath), 'country.json should exist');
    assert.ok(fs.existsSync(indexPath), 'index.json should exist');
    assert.ok(fs.existsSync(munAllPath), 'mun_all.json should exist');
    assert.ok(fs.existsSync(mun07Path), 'mun/07.json should exist');
    assert.ok(fs.existsSync(mun16Path), 'mun/16.json should exist');

    // 2. Verify states.json content and properties
    const statesGeo = JSON.parse(fs.readFileSync(statesPath, 'utf8'));
    assert.equal(statesGeo.type, 'FeatureCollection');
    assert.equal(statesGeo.features.length, 2);

    for (const feat of statesGeo.features) {
      assert.equal(feat.type, 'Feature');
      const keys = Object.keys(feat.properties).sort();
      assert.deepEqual(keys, ['id', 'name'], 'State feature properties must ONLY contain id and name');
      assert.equal(feat.properties.id.length, 2, 'State id must have 2 digits (zero-padded)');
    }

    const state07 = statesGeo.features.find(f => f.properties.id === '07');
    const state16 = statesGeo.features.find(f => f.properties.id === '16');
    assert.ok(state07, 'State 07 must be present');
    assert.ok(state16, 'State 16 must be present');
    assert.equal(state07.properties.name, 'Chiapas');
    assert.equal(state16.properties.name, 'Michoacán de Ocampo', 'Accents must be intact in state name');

    // 3. Verify mun files content and properties
    const mun07Geo = JSON.parse(fs.readFileSync(mun07Path, 'utf8'));
    assert.equal(mun07Geo.type, 'FeatureCollection');
    assert.equal(mun07Geo.features.length, 2);

    for (const feat of mun07Geo.features) {
      assert.equal(feat.type, 'Feature');
      const keys = Object.keys(feat.properties).sort();
      assert.deepEqual(keys, ['ent', 'id', 'name'], 'Mun feature properties must ONLY contain id, ent, and name');
      assert.equal(feat.properties.id.length, 5, 'Mun id must have 5 digits (zero-padded)');
      assert.equal(feat.properties.ent.length, 2, 'Mun ent must have 2 digits (zero-padded)');
      assert.equal(feat.properties.ent, '07');
    }

    const tuxtla = mun07Geo.features.find(f => f.properties.id === '07101');
    const sanCris = mun07Geo.features.find(f => f.properties.id === '07102');
    assert.ok(tuxtla, 'Tuxtla 07101 must exist');
    assert.ok(sanCris, 'San Cristobal 07102 must exist');
    assert.equal(tuxtla.properties.name, 'Tuxtla Gutiérrez', 'Accents must be intact for Tuxtla Gutiérrez');
    assert.equal(sanCris.properties.name, 'San Cristóbal de las Casas', 'Accents must be intact for San Cristóbal');

    const mun16Geo = JSON.parse(fs.readFileSync(mun16Path, 'utf8'));
    assert.equal(mun16Geo.features.length, 1);
    const morelia = mun16Geo.features[0];
    assert.equal(morelia.properties.id, '16053');
    assert.equal(morelia.properties.ent, '16');
    assert.equal(morelia.properties.name, 'Morelia');

    // 3b. Verify country.json content and properties
    const countryGeo = JSON.parse(fs.readFileSync(countryPath, 'utf8'));
    assert.equal(countryGeo.type, 'FeatureCollection');
    assert.ok(countryGeo.features.length >= 1, 'country.json must have at least 1 feature');
    for (const feat of countryGeo.features) {
      assert.equal(feat.type, 'Feature');
      assert.deepEqual(feat.properties, { id: 'MX' }, 'Country properties must be exactly { id: "MX" }');
    }
    assert.ok(fs.statSync(countryPath).size <= 300 * 1024, 'country.json size must be <= 300 KB');

    // 3c. Verify mun_all.json content and properties
    const munAllGeo = JSON.parse(fs.readFileSync(munAllPath, 'utf8'));
    assert.equal(munAllGeo.type, 'FeatureCollection');
    assert.equal(munAllGeo.features.length, 3, 'mun_all.json must contain 3 features on fixture');
    const seenMunIds = new Set();
    for (const feat of munAllGeo.features) {
      assert.equal(feat.type, 'Feature');
      const keys = Object.keys(feat.properties).sort();
      assert.deepEqual(keys, ['ent', 'id', 'name'], 'mun_all feature properties must ONLY contain ent, id, name');
      assert.equal(feat.properties.id.length, 5, 'Mun id must have 5 digits');
      assert.equal(feat.properties.ent.length, 2, 'Mun ent must have 2 digits');
      assert.equal(feat.properties.ent, feat.properties.id.slice(0, 2), 'Mun ent must match first 2 digits of id');
      seenMunIds.add(feat.properties.id);
    }
    assert.equal(seenMunIds.size, 3, 'All mun ids in mun_all.json must be unique');
    assert.ok(fs.statSync(munAllPath).size <= 4.5 * 1024 * 1024, 'mun_all.json size must be <= 4.5 MB');

    // 4. Verify index.json structure, bbox, and centroid
    const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    assert.ok(indexData.states, 'index.json must have states object');
    assert.ok(indexData.mun, 'index.json must have mun object');

    // State 07 in index
    const st07Idx = indexData.states['07'];
    assert.ok(st07Idx, 'State 07 in index');
    assert.equal(st07Idx.name, 'Chiapas');
    assert.equal(st07Idx.bbox.length, 4, 'Bbox must be [minx, miny, maxx, maxy]');
    assert.equal(st07Idx.centroid.length, 2, 'Centroid must be [lon, lat]');
    assert.equal(st07Idx.anchor.length, 2, 'Anchor must be [lon, lat]');
    assert.ok(typeof st07Idx.area_km2 === 'number' && st07Idx.area_km2 > 0, 'Area must be positive number');
    assert.ok(st07Idx.bbox[0] < st07Idx.bbox[2], 'minx < maxx');
    assert.ok(st07Idx.bbox[1] < st07Idx.bbox[3], 'miny < maxy');
    assert.ok(st07Idx.centroid[0] >= st07Idx.bbox[0] && st07Idx.centroid[0] <= st07Idx.bbox[2], 'centroid lon within bbox');
    assert.ok(st07Idx.centroid[1] >= st07Idx.bbox[1] && st07Idx.centroid[1] <= st07Idx.bbox[3], 'centroid lat within bbox');
    assert.ok(st07Idx.anchor[0] >= st07Idx.bbox[0] && st07Idx.anchor[0] <= st07Idx.bbox[2], 'anchor lon within bbox');
    assert.ok(st07Idx.anchor[1] >= st07Idx.bbox[1] && st07Idx.anchor[1] <= st07Idx.bbox[3], 'anchor lat within bbox');

    // State 16 in index
    const st16Idx = indexData.states['16'];
    assert.ok(st16Idx, 'State 16 in index');
    assert.equal(st16Idx.name, 'Michoacán de Ocampo');
    assert.equal(st16Idx.anchor.length, 2);
    assert.ok(typeof st16Idx.area_km2 === 'number' && st16Idx.area_km2 > 0);

    // Mun in index
    assert.ok(indexData.mun['07101'], 'Mun 07101 in index');
    assert.equal(indexData.mun['07101'].name, 'Tuxtla Gutiérrez');
    assert.equal(indexData.mun['07101'].ent, '07');
    assert.equal(indexData.mun['07101'].centroid.length, 2);
    assert.equal(indexData.mun['07101'].anchor.length, 2);
    assert.ok(typeof indexData.mun['07101'].area_km2 === 'number' && indexData.mun['07101'].area_km2 > 0);

    assert.ok(indexData.mun['07102'], 'Mun 07102 in index');
    assert.equal(indexData.mun['07102'].name, 'San Cristóbal de las Casas');
    assert.equal(indexData.mun['07102'].anchor.length, 2);
    assert.ok(typeof indexData.mun['07102'].area_km2 === 'number');

    assert.ok(indexData.mun['16053'], 'Mun 16053 in index');
    assert.equal(indexData.mun['16053'].name, 'Morelia');
    assert.equal(indexData.mun['16053'].ent, '16');
    assert.equal(indexData.mun['16053'].anchor.length, 2);
    assert.ok(typeof indexData.mun['16053'].area_km2 === 'number');

    // 5. Verify catalogs generated by buildGeo
    const entCatalogPath = path.join(tempDir, 'geo_ent_catalog.csv');
    const munCatalogPath = path.join(tempDir, 'geo_mun_catalog.csv');

    assert.ok(fs.existsSync(entCatalogPath), 'geo_ent_catalog.csv should exist');
    assert.ok(fs.existsSync(munCatalogPath), 'geo_mun_catalog.csv should exist');

    const entCsv = fs.readFileSync(entCatalogPath, 'utf8');
    const entLines = entCsv.trim().split('\n');
    assert.equal(entLines[0], 'cve_ent,name');
    assert.equal(entLines.length, 3, '1 header + 2 states');
    assert.ok(entCsv.includes('07,Chiapas'));
    assert.ok(entCsv.includes('16,Michoacán de Ocampo'), 'Accents intact in ent catalog');

    const munCsv = fs.readFileSync(munCatalogPath, 'utf8');
    const munLines = munCsv.trim().split('\n');
    assert.equal(munLines[0], 'cvegeo,cve_ent,cve_mun,name');
    assert.equal(munLines.length, 4, '1 header + 3 municipalities');
    assert.ok(munCsv.includes('07101,07,101,Tuxtla Gutiérrez'), 'Accents intact in mun catalog for Tuxtla');
    assert.ok(munCsv.includes('07102,07,102,San Cristóbal de las Casas'));
    assert.ok(munCsv.includes('16053,16,053,Morelia'));

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('generateCatalogs standalone generates valid CSVs and parseArgs parses --catalog-dir', async (t) => {
  const parsed = parseArgs(['--catalog-dir', 'some/custom/dir']);
  assert.ok(parsed.catalogDir.endsWith(path.normalize('some/custom/dir')));

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-catalogs-'));
  try {
    const res = await generateCatalogs({
      ent: entFixture,
      mun: munFixture,
      catalogDir: tempDir
    });
    assert.equal(res.status, 'ok');
    assert.equal(res.entCount, 2);
    assert.equal(res.munCount, 3);

    const entCsv = fs.readFileSync(path.join(tempDir, 'geo_ent_catalog.csv'), 'utf8');
    // Ensure UTF-8 without BOM
    const entBuffer = fs.readFileSync(path.join(tempDir, 'geo_ent_catalog.csv'));
    assert.ok(entBuffer[0] !== 0xef || entBuffer[1] !== 0xbb || entBuffer[2] !== 0xbf, 'Must not have UTF-8 BOM');
    assert.ok(entCsv.includes('Michoacán de Ocampo'));

    const munCsv = fs.readFileSync(path.join(tempDir, 'geo_mun_catalog.csv'), 'utf8');
    assert.ok(munCsv.includes('Tuxtla Gutiérrez'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('build_geo exits cleanly without error when input files are missing without touching output dir', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-geo-missing-'));
  const canaryFile = path.join(tempDir, 'canary.txt');
  fs.writeFileSync(canaryFile, 'do-not-delete', 'utf8');

  try {
    const result = await buildGeo({
      ent: path.join(tempDir, 'nonexistent_ent.shp'),
      mun: path.join(tempDir, 'nonexistent_mun.shp'),
      out: tempDir
    });

    assert.equal(result.status, 'skipped', 'Must report skipped status when inputs are missing');
    assert.equal(result.reason, 'missing_inputs');
    assert.ok(fs.existsSync(canaryFile), 'Previous files in out dir must not be deleted');
    assert.ok(!fs.existsSync(path.join(tempDir, 'states.json')), 'states.json must not be created');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('production build validation covers mun_all.json and country.json if present', () => {
  const prodGeoDir = path.resolve(__dirname, '../../../frontend/public/geo');
  const munAllPath = path.join(prodGeoDir, 'mun_all.json');
  const countryPath = path.join(prodGeoDir, 'country.json');

  if (!fs.existsSync(munAllPath) || !fs.existsSync(countryPath)) {
    return;
  }

  // 1. Validate country.json
  const countryStat = fs.statSync(countryPath);
  assert.ok(countryStat.size <= 300 * 1024, `country.json size (${countryStat.size} bytes) exceeds 300 KB limit`);
  const countryGeo = JSON.parse(fs.readFileSync(countryPath, 'utf8'));
  assert.equal(countryGeo.type, 'FeatureCollection');
  assert.ok(countryGeo.features.length >= 1, 'country.json must have at least 1 feature');
  for (const feat of countryGeo.features) {
    assert.deepEqual(feat.properties, { id: 'MX' }, 'Country properties must be { id: "MX" }');
  }

  // 2. Validate mun_all.json
  const munAllStat = fs.statSync(munAllPath);
  assert.ok(munAllStat.size <= 4.5 * 1024 * 1024, `mun_all.json size (${munAllStat.size} bytes) exceeds 4.5 MB limit`);
  const munAllGeo = JSON.parse(fs.readFileSync(munAllPath, 'utf8'));
  assert.equal(munAllGeo.type, 'FeatureCollection');
  assert.equal(munAllGeo.features.length, 2478, 'mun_all.json must contain all 2,478 municipalities');

  const seenIds = new Set();
  for (const feat of munAllGeo.features) {
    assert.equal(feat.type, 'Feature');
    const p = feat.properties;
    const keys = Object.keys(p).sort();
    assert.deepEqual(keys, ['ent', 'id', 'name'], 'Feature properties must be exactly { ent, id, name }');
    assert.equal(p.id.length, 5, `Mun id '${p.id}' must be 5 digits`);
    assert.equal(p.ent.length, 2, `Mun ent '${p.ent}' must be 2 digits`);
    assert.equal(p.ent, p.id.slice(0, 2), `ent '${p.ent}' must match first 2 digits of id '${p.id}'`);
    assert.ok(typeof p.name === 'string' && p.name.length > 0, 'Name must be a non-empty string');
    seenIds.add(p.id);
  }
  assert.equal(seenIds.size, 2478, 'All 2,478 municipality ids in mun_all.json must be unique');
});

test('polylabel on square returns center', () => {
  const square = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
  const center = polylabel(square, 0.01);
  assert.equal(center[0], 5);
  assert.equal(center[1], 5);
});

test('polylabel on concave C-shape produces inside point while centroid is outside', () => {
  // C-shape polygon
  const cPolygon = [
    [[0, 0], [10, 0], [10, 2], [2, 2], [2, 8], [10, 8], [10, 10], [0, 10], [0, 0]]
  ];

  // Centroid of C-shape falls in empty gap (x > 2, 2 < y < 8)
  const anchor = polylabel(cPolygon, 0.01);
  assert.equal(anchor.length, 2);

  // Check that anchor is strictly inside one of the bars:
  // e.g. either in bottom bar (0<=x<=10, 0<=y<=2), top bar (0<=x<=10, 8<=y<=10), or spine (0<=x<=2, 2<=y<=8)
  const inBottom = anchor[0] >= 0 && anchor[0] <= 10 && anchor[1] >= 0 && anchor[1] <= 2;
  const inTop = anchor[0] >= 0 && anchor[0] <= 10 && anchor[1] >= 8 && anchor[1] <= 10;
  const inSpine = anchor[0] >= 0 && anchor[0] <= 2 && anchor[1] >= 2 && anchor[1] <= 8;
  assert.ok(inBottom || inTop || inSpine, `Anchor [${anchor}] must be inside C-shape polygon`);
});

test('polylabel on MultiPolygon uses the part with largest area', () => {
  const smallSquare = [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]];
  const bigSquare = [[[10, 10], [20, 10], [20, 20], [10, 20], [10, 10]]];
  const multi = {
    type: 'MultiPolygon',
    coordinates: [smallSquare, bigSquare]
  };

  const anchor = polylabel(multi, 0.01);
  // Center of big square is [15, 15]
  assert.equal(anchor[0], 15);
  assert.equal(anchor[1], 15);
});

test('geodesicAreaKm2 of 1x1 degree square at equator is approximately 12,364 km2 (+-0.5%)', () => {
  const square = {
    type: 'Polygon',
    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]
  };
  const area = geodesicAreaKm2(square);
  const diffPct = Math.abs(area - 12364) / 12364 * 100;
  assert.ok(diffPct <= 0.5, `Area ${area} km2 differs by ${diffPct.toFixed(3)}%, expected <= 0.5%`);
});

test('parseArgs recognizes --index-only flag', () => {
  const args = parseArgs(['--index-only']);
  assert.equal(args.indexOnly, true, 'parseArgs must set indexOnly=true');
});

test('buildIndexOnly generates index.json from existing GeoJSON files', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-index-only-test-'));
  try {
    // Generate initial geo fixtures using buildGeo
    await buildGeo({
      ent: entFixture,
      mun: munFixture,
      out: tempDir,
      catalogDir: tempDir,
      statePercentage: '50%',
      munPercentage: '50%'
    });

    // Delete index.json to verify buildIndexOnly recreates it
    const indexPath = path.join(tempDir, 'index.json');
    fs.unlinkSync(indexPath);
    assert.ok(!fs.existsSync(indexPath));

    // Run buildIndexOnly
    const res = await buildIndexOnly({ out: tempDir });
    assert.equal(res.status, 'ok');
    assert.equal(res.indexOnly, true);
    assert.ok(fs.existsSync(indexPath));

    const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    assert.equal(Object.keys(indexData.states).length, 2);
    assert.equal(Object.keys(indexData.mun).length, 3);

    const st07 = indexData.states['07'];
    assert.ok(st07.anchor);
    assert.ok(st07.area_km2);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});


