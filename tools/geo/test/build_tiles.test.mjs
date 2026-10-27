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
  validateTileset,
  OFFSHORE_KM,
  separateOffshoreFeatures,
  polygonArea,
  minDistanceToPolygon,
  getLargestPolygon
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
    assert.deepEqual(manifest.offshore_parts, { states: 0, mun: 0 });
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

test('separateOffshoreFeatures correctly isolates offshore islands > 50km and preserves mainland & island-only features', () => {
  // Synthetic mainland continent: 2x2 degree square from [-100, 20] to [-98, 22]
  const continentPoly = [
    [
      [-100, 20],
      [-98, 20],
      [-98, 22],
      [-100, 22],
      [-100, 20]
    ]
  ];

  // Mainland part for multi-polygon features: 1x1 degree square inside continent
  const mainlandPart = [
    [
      [-99.5, 20.5],
      [-98.5, 20.5],
      [-98.5, 21.5],
      [-99.5, 21.5],
      [-99.5, 20.5]
    ]
  ];

  // 1. Island at ~222 km north (latitude 24.0 vs continent top 22.0: 2.0 degrees * 111 km/deg = ~222 km > 50 km)
  const farIslandPart = [
    [
      [-99.2, 24.0],
      [-99.0, 24.0],
      [-99.0, 24.2],
      [-99.2, 24.2],
      [-99.2, 24.0]
    ]
  ];

  // 2. Island at ~10 km north (latitude 22.09 vs continent top 22.0: 0.09 degrees * 111 km/deg = ~10 km < 50 km)
  const nearIslandPart = [
    [
      [-99.2, 22.09],
      [-99.0, 22.09],
      [-99.0, 22.10],
      [-99.2, 22.10],
      [-99.2, 22.09]
    ]
  ];

  // Test Case A: Feature with island at 200 km -> generates main feature + offshore: 1
  const featWithFarIsland = {
    type: 'Feature',
    id: 1,
    properties: { id: '01', name: 'Estado Con Isla Lejana' },
    geometry: {
      type: 'MultiPolygon',
      coordinates: [mainlandPart, farIslandPart]
    }
  };

  const resFar = separateOffshoreFeatures([featWithFarIsland], continentPoly, OFFSHORE_KM);
  assert.equal(resFar.offshoreCount, 1, 'Must detect 1 offshore feature');
  assert.equal(resFar.features.length, 2, 'Must emit main feature + extra offshore feature');

  const mainFeat = resFar.features[0];
  const extraFeat = resFar.features[1];

  assert.equal(mainFeat.id, 1);
  assert.equal(mainFeat.properties.id, '01');
  assert.equal(mainFeat.properties.name, 'Estado Con Isla Lejana');
  assert.equal(mainFeat.properties.offshore, undefined, 'Main feature must not have offshore property');
  assert.equal(mainFeat.geometry.type, 'Polygon');
  assert.deepEqual(mainFeat.geometry.coordinates, mainlandPart);

  assert.equal(extraFeat.id, 1, 'Extra feature must keep the same numeric id for feature-state');
  assert.equal(extraFeat.properties.id, '01');
  assert.equal(extraFeat.properties.name, 'Estado Con Isla Lejana');
  assert.equal(extraFeat.properties.offshore, 1, 'Extra feature must have offshore: 1');
  assert.equal(extraFeat.geometry.type, 'Polygon');
  assert.deepEqual(extraFeat.geometry.coordinates, farIslandPart);

  // Test Case B: Feature with island at 10 km -> does NOT generate extra feature
  const featWithNearIsland = {
    type: 'Feature',
    id: 2,
    properties: { id: '02', name: 'Estado Con Isla Cercana' },
    geometry: {
      type: 'MultiPolygon',
      coordinates: [mainlandPart, nearIslandPart]
    }
  };

  const resNear = separateOffshoreFeatures([featWithNearIsland], continentPoly, OFFSHORE_KM);
  assert.equal(resNear.offshoreCount, 0, 'Must NOT mark island at 10km as offshore');
  assert.equal(resNear.features.length, 1, 'Must emit only 1 feature');
  assert.equal(resNear.features[0].properties.offshore, undefined);
  assert.equal(resNear.features[0].geometry.coordinates.length, 2);

  // Test Case C: Feature that is entirely an offshore island (e.g. Cozumel) -> stays without mark
  const featEntirelyIslandPoly = {
    type: 'Feature',
    id: 3,
    properties: { id: '03', name: 'Municipio Todo Isla Polygon' },
    geometry: {
      type: 'Polygon',
      coordinates: farIslandPart
    }
  };

  const featEntirelyIslandMulti = {
    type: 'Feature',
    id: 4,
    properties: { id: '04', name: 'Municipio Todo Isla MultiPolygon' },
    geometry: {
      type: 'MultiPolygon',
      coordinates: [farIslandPart]
    }
  };

  const resAllIsland = separateOffshoreFeatures(
    [featEntirelyIslandPoly, featEntirelyIslandMulti],
    continentPoly,
    OFFSHORE_KM
  );
  assert.equal(resAllIsland.offshoreCount, 0, 'Feature that is all island must not be separated or marked');
  assert.equal(resAllIsland.features.length, 2);
  assert.equal(resAllIsland.features[0].properties.offshore, undefined);
  assert.equal(resAllIsland.features[1].properties.offshore, undefined);

  // Test Case D: feature_counts counts unique IDs
  const allTestFeatures = [
    featWithFarIsland,
    featWithNearIsland,
    featEntirelyIslandPoly,
    featEntirelyIslandMulti
  ];
  const combined = separateOffshoreFeatures(allTestFeatures, continentPoly, OFFSHORE_KM);
  // featWithFarIsland splits into 2, total features = 5
  assert.equal(combined.features.length, 5);
  // Unique IDs should be exactly 4 ('01', '02', '03', '04')
  const uniqueIdsCount = new Set(combined.features.map(f => f.properties.id)).size;
  assert.equal(uniqueIdsCount, 4, 'feature_counts must count unique IDs');
  assert.equal(combined.offshoreCount, 1);
});

