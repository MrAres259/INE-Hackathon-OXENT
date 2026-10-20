import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import {
  lonLatToTile,
  tileRangeForBounds,
  tilesetVersion,
  buildTiles,
  validateTileset
} from '../build_tiles.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesDir = path.resolve(__dirname, '../fixtures');
const entFixture = path.join(fixturesDir, 'ent.geojson');
const munFixture = path.join(fixturesDir, 'mun.geojson');

test('lonLatToTile and tileRangeForBounds compute expected Web Mercator coordinates', () => {
  // Known point (0, 0) at zoom 1 -> { x: 1, y: 1 }
  const origin = lonLatToTile(0, 0, 1);
  assert.deepEqual(origin, { x: 1, y: 1 }, 'Origin at zoom 1 should be tile 1, 1');

  // Known point CDMX (-99.13, 19.43) at zoom 9 -> { x: 115, y: 227 }
  const cdmx = lonLatToTile(-99.13, 19.43, 9);
  assert.deepEqual(cdmx, { x: 115, y: 227 }, 'CDMX at zoom 9 must map to tile 115, 227');

  // Latitude clamping within ±85.0511
  const northPole = lonLatToTile(0, 89.9, 2);
  const southPole = lonLatToTile(0, -89.9, 2);
  assert.equal(northPole.y, 0, 'North pole should be clamped to tile y=0');
  assert.equal(southPole.y, 3, 'South pole should be clamped to tile y=3 at z=2');

  // tileRangeForBounds around CDMX center
  const bounds = [-99.135, 19.425, -99.125, 19.435];
  const rangeZ9 = tileRangeForBounds(bounds, 9);
  assert.equal(rangeZ9.minX, 115);
  assert.equal(rangeZ9.maxX, 115);
  assert.equal(rangeZ9.minY, 227);
  assert.equal(rangeZ9.maxY, 227);

  // Broader bounds spanning multiple tiles
  const broadBounds = [-102.0, 16.0, -92.0, 20.0];
  const rangeZ4 = tileRangeForBounds(broadBounds, 4);
  assert.ok(rangeZ4.minX <= rangeZ4.maxX);
  assert.ok(rangeZ4.minY <= rangeZ4.maxY);
});

test('tilesetVersion produces a stable, 12-hex character hash', () => {
  const version1 = tilesetVersion([entFixture, munFixture], { minzoom: 3, maxzoom: 9, munKeep: '25%', stateKeep: '20%' });
  const version2 = tilesetVersion([entFixture, munFixture], { minzoom: 3, maxzoom: 9, munKeep: '25%', stateKeep: '20%' });

  assert.equal(version1, version2, 'tilesetVersion must be deterministic and stable');
  assert.equal(version1.length, 12, 'Version must be 12 hex characters');
  assert.match(version1, /^[0-9a-f]{12}$/, 'Version must be lowercase hexadecimal');

  // Changing options must change the version
  const version3 = tilesetVersion([entFixture, munFixture], { minzoom: 4, maxzoom: 9, munKeep: '25%', stateKeep: '20%' });
  assert.notEqual(version1, version3, 'Different options must result in different version hash');
});

test('buildTiles produces valid tiles, manifest, and structure from fixtures', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-tiles-test-'));

  try {
    const manifest = await buildTiles({
      ent: entFixture,
      mun: munFixture,
      outDir: tempDir,
      minzoom: 3,
      maxzoom: 6,
      stateKeep: '100%',
      munKeep: '100%'
    });

    assert.ok(manifest, 'buildTiles must return a manifest object');

    // 1. Validate manifest structure according to §7 contract
    assert.equal(manifest.tilejson, '3.0.0');
    assert.equal(manifest.name, 'atalaya-mg2024');
    assert.equal(manifest.scheme, 'xyz');
    assert.deepEqual(manifest.tiles, ['/geo/tiles/{z}/{x}/{y}.pbf']);
    assert.equal(manifest.minzoom, 3);
    assert.equal(manifest.maxzoom, 6);
    assert.equal(manifest.version.length, 12);
    assert.deepEqual(manifest.feature_counts, { states: 2, mun: 3 });
    assert.ok(manifest.tile_count > 0, 'Tile count must be > 0');
    assert.ok(manifest.bytes > 0, 'Bytes must be > 0');
    assert.equal(manifest.bounds.length, 4);
    assert.equal(manifest.center.length, 3);
    assert.equal(manifest.center[2], 4);

    assert.equal(manifest.vector_layers.length, 2);
    const statesLayerMeta = manifest.vector_layers.find(l => l.id === 'states');
    const munLayerMeta = manifest.vector_layers.find(l => l.id === 'mun');
    assert.ok(statesLayerMeta, 'states vector layer must be defined in manifest');
    assert.ok(munLayerMeta, 'mun vector layer must be defined in manifest');
    assert.equal(statesLayerMeta.minzoom, 3);
    assert.equal(munLayerMeta.minzoom, 5);

    // 2. Validate manifest file written to outDir
    const manifestPath = path.join(tempDir, 'tiles.json');
    assert.ok(fs.existsSync(manifestPath), 'tiles.json must exist in outDir');
    const writtenManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.deepEqual(writtenManifest, manifest);

    // 3. Verify empty tiles written as 0-byte files
    const tilesDir = path.join(tempDir, 'tiles');
    let foundEmptyTile = false;
    let foundNonEmptyTileZ4 = null;
    let foundNonEmptyTileZ5 = null;

    function searchTiles(dir, z) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          const nextZ = (z === null && !isNaN(Number(ent.name))) ? Number(ent.name) : z;
          searchTiles(full, nextZ);
        } else if (ent.isFile() && ent.name.endsWith('.pbf')) {
          const size = fs.statSync(full).size;
          if (size === 0) {
            foundEmptyTile = true;
          } else {
            if (z === 4 && !foundNonEmptyTileZ4) foundNonEmptyTileZ4 = full;
            if (z === 5 && !foundNonEmptyTileZ5) foundNonEmptyTileZ5 = full;
          }
        }
      }
    }
    searchTiles(tilesDir, null);

    assert.ok(foundEmptyTile, 'Empty tiles must be written as 0-byte files');
    assert.ok(foundNonEmptyTileZ4, 'Must have at least one non-empty tile at z=4');
    assert.ok(foundNonEmptyTileZ5, 'Must have at least one non-empty tile at z=5');

    // 4. Verify mun layer is strictly absent in z < 5
    const z4Buf = fs.readFileSync(foundNonEmptyTileZ4);
    const z4Vt = new VectorTile(new PbfReader(z4Buf));
    assert.ok(z4Vt.layers.states, 'z=4 tile must have states layer');
    assert.equal(z4Vt.layers.mun, undefined, 'z=4 tile must NOT have mun layer');

    // 5. Verify layers, numeric ids, and properties in z >= 5 tile
    const z5Buf = fs.readFileSync(foundNonEmptyTileZ5);
    const z5Vt = new VectorTile(new PbfReader(z5Buf));
    assert.ok(z5Vt.layers.states || z5Vt.layers.mun, 'z=5 tile must contain states or mun layer');

    if (z5Vt.layers.states) {
      const feat = z5Vt.layers.states.feature(0);
      assert.equal(typeof feat.id, 'number', 'Feature id in states layer must be a numeric integer');
      assert.ok(typeof feat.properties.id === 'string', 'Property id must be string');
      assert.ok(typeof feat.properties.name === 'string', 'Property name must be string');
    }

    if (z5Vt.layers.mun) {
      const feat = z5Vt.layers.mun.feature(0);
      assert.equal(typeof feat.id, 'number', 'Feature id in mun layer must be a numeric integer');
      assert.ok(typeof feat.properties.id === 'string', 'Property id must be string');
      assert.ok(typeof feat.properties.ent === 'string', 'Property ent must be string');
      assert.ok(typeof feat.properties.name === 'string', 'Property name must be string');
    }

    // 6. validateTileset passes with expected fixture IDs
    const validation = validateTileset(tempDir, manifest, {
      states: ['07', '16'],
      mun: ['07101', '07102', '16053']
    });
    assert.equal(validation.ok, true, 'validateTileset should report ok: true');
    assert.deepEqual(validation.missing.states, []);
    assert.deepEqual(validation.missing.mun, []);
    assert.ok(validation.maxTileBytes > 0);

    // 7. validateTileset reports missing IDs when expected IDs are not present
    const badValidation = validateTileset(tempDir, manifest, {
      states: ['07', '16', '99'],
      mun: ['07101', '99999']
    });
    assert.equal(badValidation.ok, false);
    assert.deepEqual(badValidation.missing.states, ['99']);
    assert.deepEqual(badValidation.missing.mun, ['99999']);

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildTiles safety check rejects invalid outDir paths', async () => {
  const unsafeDir = path.resolve(__dirname, 'some_random_unsafe_directory');
  await assert.rejects(
    async () => {
      await buildTiles({
        ent: entFixture,
        mun: munFixture,
        outDir: unsafeDir
      });
    },
    /Refusing to clean tiles directory/
  );
});
