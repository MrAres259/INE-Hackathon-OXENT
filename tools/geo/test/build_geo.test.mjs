import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { buildGeo, generateCatalogs, parseArgs } from '../build_geo.mjs';

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
    const indexPath = path.join(tempDir, 'index.json');
    const munDir = path.join(tempDir, 'mun');
    const mun07Path = path.join(munDir, '07.json');
    const mun16Path = path.join(munDir, '16.json');

    assert.ok(fs.existsSync(statesPath), 'states.json should exist');
    assert.ok(fs.existsSync(indexPath), 'index.json should exist');
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
    assert.ok(st07Idx.bbox[0] < st07Idx.bbox[2], 'minx < maxx');
    assert.ok(st07Idx.bbox[1] < st07Idx.bbox[3], 'miny < maxy');
    assert.ok(st07Idx.centroid[0] >= st07Idx.bbox[0] && st07Idx.centroid[0] <= st07Idx.bbox[2], 'centroid lon within bbox');
    assert.ok(st07Idx.centroid[1] >= st07Idx.bbox[1] && st07Idx.centroid[1] <= st07Idx.bbox[3], 'centroid lat within bbox');

    // State 16 in index
    const st16Idx = indexData.states['16'];
    assert.ok(st16Idx, 'State 16 in index');
    assert.equal(st16Idx.name, 'Michoacán de Ocampo');

    // Mun in index
    assert.ok(indexData.mun['07101'], 'Mun 07101 in index');
    assert.equal(indexData.mun['07101'].name, 'Tuxtla Gutiérrez');
    assert.equal(indexData.mun['07101'].ent, '07');
    assert.equal(indexData.mun['07101'].centroid.length, 2);

    assert.ok(indexData.mun['07102'], 'Mun 07102 in index');
    assert.equal(indexData.mun['07102'].name, 'San Cristóbal de las Casas');

    assert.ok(indexData.mun['16053'], 'Mun 16053 in index');
    assert.equal(indexData.mun['16053'].name, 'Morelia');
    assert.equal(indexData.mun['16053'].ent, '16');

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
