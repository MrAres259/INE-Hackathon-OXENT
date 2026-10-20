let currentMap = null;
let tilesManifest = null;

async function loadManifest() {
  if (!tilesManifest) {
    const res = await fetch('/geo/tiles.json');
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching /geo/tiles.json`);
    }
    tilesManifest = await res.json();
  }
  return tilesManifest;
}

window.renderSpec = async function (spec) {
  try {
    const manifest = await loadManifest();
    const isMun = spec.level === 'mun';
    const k = spec.oversample || (isMun ? 4 : 2);
    const targetW = Math.round(spec.width * k);
    const targetH = Math.round(spec.height * k);

    const container = document.getElementById('map');
    if (!container) {
      return { ok: false, error: 'div#map not found' };
    }
    container.style.width = targetW + 'px';
    container.style.height = targetH + 'px';

    if (currentMap) {
      try {
        currentMap.remove();
      } catch (err) {
        console.warn('Map cleanup error:', err);
      }
      currentMap = null;
    }

    const sourceLayer = isMun ? 'mun' : 'states';
    const fillLayerId = isMun ? 'mun-fill' : 'states-fill';
    const nodataColor = spec.nodata_color || '#d1d5db';
    const bgColor = spec.background || '#ffffff';
    const stateLineColor = spec.state_line_color || '#4b5563';
    const munLineColor = spec.mun_line_color || '#ffffff';
    const padding = spec.padding !== undefined ? spec.padding : 6;
    const bounds = spec.bounds || [[-118.6, 14.3], [-86.5, 32.8]];

    const layers = [
      {
        id: 'bg',
        type: 'background',
        paint: {
          'background-color': bgColor
        }
      },
      {
        id: 'country-fill',
        type: 'fill',
        source: 'country',
        paint: {
          'fill-color': nodataColor,
          'fill-opacity': 1
        }
      },
      {
        id: fillLayerId,
        type: 'fill',
        source: 'vector',
        'source-layer': sourceLayer,
        paint: {
          'fill-color': ['coalesce', ['feature-state', 'fill'], nodataColor],
          'fill-opacity': 1
        }
      }
    ];

    if (isMun) {
      layers.push({
        id: 'mun-line',
        type: 'line',
        source: 'vector',
        'source-layer': 'mun',
        paint: {
          'line-color': munLineColor,
          'line-width': 0.3 * k
        }
      });
    }

    layers.push({
      id: 'states-line',
      type: 'line',
      source: 'vector',
      'source-layer': 'states',
      paint: {
        'line-color': stateLineColor,
        'line-width': 0.6 * k
      }
    });

    layers.push({
      id: 'country-line',
      type: 'line',
      source: 'country',
      paint: {
        'line-color': stateLineColor,
        'line-width': 0.8 * k
      }
    });

    const style = {
      version: 8,
      sources: {
        country: {
          type: 'geojson',
          data: location.origin + '/geo/country.json'
        },
        vector: {
          type: 'vector',
          tiles: [location.origin + '/geo/tiles/{z}/{x}/{y}.pbf'],
          minzoom: manifest.minzoom !== undefined ? manifest.minzoom : 3,
          maxzoom: manifest.maxzoom !== undefined ? manifest.maxzoom : 9,
          bounds: manifest.bounds || [-118.6, 14.3, -86.5, 32.8],
          promoteId: { states: 'id', mun: 'id' }
        }
      },
      layers: layers
    };

    return await new Promise((resolve) => {
      let resolved = false;
      let timer = null;

      const finish = (result) => {
        if (!resolved) {
          resolved = true;
          if (timer) clearTimeout(timer);
          resolve(result);
        }
      };

      timer = setTimeout(() => {
        finish({ ok: false, error: 'timeout after 30s' });
      }, 30000);

      const map = new maplibregl.Map({
        container: 'map',
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
        preserveDrawingBuffer: true,
        canvasContextAttributes: {
          preserveDrawingBuffer: true
        },
        style: style,
        bounds: bounds,
        fitBoundsOptions: {
          padding: padding,
          animate: false
        }
      });
      currentMap = map;

      map.on('error', (err) => {
        console.warn('MapLibre error event:', err);
      });

      map.once('load', () => {
        try {
          map.fitBounds(bounds, {
            padding: padding,
            animate: false
          });

          if (isMun && map.getZoom() < 5.0) {
            map.setZoom(5.0);
          } else if (!isMun && map.getZoom() < 3.0) {
            map.setZoom(3.0);
          }

          if (spec.fill_by_id) {
            for (const [id, fill] of Object.entries(spec.fill_by_id)) {
              map.setFeatureState(
                { source: 'vector', sourceLayer: sourceLayer, id: String(id) },
                { fill: fill }
              );
            }
          }

          const onIdle = () => {
            const zoom = map.getZoom();
            const minZoom = isMun ? 5 : 3;
            if (zoom < minZoom) {
              finish({
                ok: false,
                error: `zoom ${zoom.toFixed(2)} is below minimum ${minZoom}`,
                zoom: zoom
              });
              return;
            }

            const features = map.queryRenderedFeatures({ layers: [fillLayerId] });
            finish({
              ok: true,
              rendered: features.length,
              zoom: zoom
            });
          };

          map.once('idle', onIdle);
        } catch (innerErr) {
          finish({ ok: false, error: String(innerErr) });
        }
      });
    });
  } catch (err) {
    return { ok: false, error: String(err) };
  }
};
