import mapbox from 'mapbox-gl';
import * as h3 from 'h3-js';
import { s2 } from 's2js';

function hashObject(obj: any) {
	return JSON.stringify(obj, Object.keys(obj).sort());
}

type GridSystemId = 'h3' | 's2';

type GridImpl = {
	latLngToCell(lat: number, lng: number, level: number): string;
	cellToLatLng(id: string): [number, number];
	neighbors(id: string): string[];
	getResolution: (zoom: number) => number;
};

const h3Grid: GridImpl = {
	latLngToCell(lat, lng, level) {
		return h3.latLngToCell(lat, lng, level);
	},
	cellToLatLng(id) {
		return h3.cellToLatLng(id) as [number, number];
	},
	neighbors(id) {
		// h3-js gridRing gives neighbors at ring distance 1
		return h3.gridRing(id, 1);
	},
	getResolution: (zoom: number) => {
		if (zoom <= 3.0) return 0;
		if (zoom <= 4.4) return 1;
		if (zoom <= 5.7) return 2;
		if (zoom <= 7.1) return 3;
		if (zoom <= 8.4) return 4;
		if (zoom <= 9.8) return 5;
		if (zoom <= 11.4) return 6;
		if (zoom <= 12.7) return 7;
		if (zoom <= 14.1) return 8;
		if (zoom <= 15.5) return 9;
		if (zoom <= 16.8) return 10;
		if (zoom <= 18.2) return 11;
		if (zoom <= 19.5) return 12;
		if (zoom <= 21.1) return 13;
		if (zoom <= 21.9) return 14;
		return 15;
	}
};

const s2Grid: GridImpl = {
	latLngToCell(lat, lng, level) {
		const ll = s2.LatLng.fromDegrees(lat, lng);
		const id = s2.cellid.parent(s2.cellid.fromLatLng(ll), level);
		return id.toString();
	},
	cellToLatLng(id: string) {
		const latlng = s2.cellid.latLng(BigInt(id));
		return [latlng.lat, latlng.lng];
	},
	neighbors(id: string) {
		return s2.cellid.edgeNeighbors(BigInt(id)).map(String);
	},
	getResolution: (zoom: number) => {
		if (zoom <= 3.0) return 10;
		if (zoom <= 4.4) return 11;
		if (zoom <= 5.7) return 12;
		if (zoom <= 7.1) return 13;
		if (zoom <= 8.4) return 14;
		if (zoom <= 9.8) return 15;
		if (zoom <= 11.4) return 16;
		if (zoom <= 12.7) return 17;
		if (zoom <= 14.1) return 18;
		if (zoom <= 15.5) return 19;
		if (zoom <= 16.8) return 20;
		if (zoom <= 18.2) return 21;
		if (zoom <= 19.5) return 22;
		if (zoom <= 21.1) return 23;
		if (zoom <= 21.9) return 24;
		return 25;
	}
};

const getGridImpl = (system: GridSystemId): GridImpl => (system === 's2' ? s2Grid : h3Grid);

const throttle = (fn: (...args: any[]) => void, minInterval: number) => {
	let lastTime = 0;
	return function (...args: any[]) {
		const now = Date.now();
		if (now - lastTime >= minInterval) {
			lastTime = now;
			fn(...args);
		}
	};
};

const debounce = (fn: (...args: any[]) => void, timeout: number) => {
	let timer: number;
	return (...args: any[]) => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			fn(...args);
		}, timeout);
	};
};

/**
 * @param {string} html - HTML representing a single element.
 * @return {HTMLElement} - The parsed HTML element.
 */
const htmlToElement = (html: string): HTMLElement => {
	const template = document.createElement('template');
	template.innerHTML = html.trim();
	const node = template.content.firstChild;

	if (!node || node.nodeType !== Node.ELEMENT_NODE) {
		throw new Error('Provided HTML must represent a single HTML element.');
	}

	return node as HTMLElement;
};

const centroid = (...points: LatLng[]): LatLng => {
	const latlng = { lat: 0, lng: 0 };
	let total = 0;
	for (const point of points) {
		const weight = point.weight || 1;
		latlng.lat += point.lat * weight;
		latlng.lng += point.lng * weight;
		total += weight || 1;
	}
	latlng.lat /= total;
	latlng.lng /= total;

	return latlng;
};

export type LatLng = { lat: number; lng: number; weight?: number };
export type Cluster<T extends LatLng> = {
	id: string;
	center: LatLng;
	points: T[];
};

export type AddClusteredLayerOptions<T extends LatLng> = {
	/**
	 * Min number of milliseconds in between computation executions
	 * @default 200
	 */
	throttle?: number;
	/**
	 * Will create all clusters of 1 point
	 * @default false
	 */
	omitClustering?: boolean;
	/**
	 * The HTML to be rendered on each cluster.
	 */
	createMarker?: (cluster: Cluster<T>) =>
		| {
				content?: string;
				zIndex?: number;
				anchor?: mapboxgl.Anchor;
				class?: string;
				offsetY?: number;
				offsetX?: number;
		  }
		| undefined;
	/**
	 * It's called when the marker is clicked
	 * @param cluster
	 */
	onClick?: (params: {
		cluster: Cluster<T>;
		zoomCluster: (options: { padding: number | mapboxgl.PaddingOptions }) => void;
		zoom: number;
	}) => void;
	onMouseOver?: (params: { cluster: Cluster<T> }) => void;
	onMouseOut?: (params: { cluster: Cluster<T> }) => void;
	/**
	 * Defines how the center of multi-points clustera are calculated
	 * (1 point clusters will center to the lat-lng of that point)
	 * @default cell-center
	 */
	centeringStrategy?: 'centroid' | 'cell-center' | 'smart';
	// /**
	//  * Which spatial index to use
	//  * @default 'h3'
	//  */
	// gridSystem?: GridSystemId;
};

const DEFAULT_OPTIONS: AddClusteredLayerOptions<LatLng> = {
	throttle: 200,
	createMarker: (d: Cluster<LatLng>) => ({
		content: d.points.length === 1 ? undefined : `<div class="cluster">${d.points.length}</div>`
	}),
	centeringStrategy: 'smart' as const
	// gridSystem: 's2'
};

export const addClusteredLayer = <T extends { lat: number; lng: number }>(
	map: mapboxgl.Map,
	data: T[],
	options: AddClusteredLayerOptions<T> = DEFAULT_OPTIONS
) => {
	options.createMarker ||= DEFAULT_OPTIONS.createMarker;
	options.throttle ||= DEFAULT_OPTIONS.throttle;
	options.centeringStrategy ||= DEFAULT_OPTIONS.centeringStrategy;
	// options.gridSystem ||= DEFAULT_OPTIONS.gridSystem;
	const _options = options;

	let markers = new Map<string, mapboxgl.Marker>();

	const compute = (e?: { type: 'zoom' | 'zoomend'; originalEvent?: MouseEvent }) => {
		if (e && e.type === 'zoom' && !e.originalEvent) {
			// if there is no original event, it was a programatic zoom thus we don't recompute on zoom, only on zoomend
			return;
		}
		const options = _options as Required<typeof _options>;

		if (!map) return;
		const padding = map.getPadding();
		map.setPadding({ bottom: 0, top: 0, left: 0, right: 0 });
		const bounds = map.getBounds();
		map.setPadding(padding);
		if (!bounds) return;
		const filtered = data.filter((p) => bounds.contains(p));

		const zoom = map.getZoom();

		const grid = getGridImpl('h3');

		let resolution = grid.getResolution(zoom);

		const buckets = {} as Record<string, T[]>;
		if (options.omitClustering) {
			for (const [i, point] of filtered.entries()) {
				buckets[`${i}`] = [point];
			}
		} else {
			for (const point of filtered) {
				const cell = grid.latLngToCell(point.lat, point.lng, resolution);
				buckets[cell] ||= [];
				buckets[cell].push(point);
			}
		}

		const clusters = Object.entries(buckets).map(([id, points]) => {
			let center = { lat: 0, lng: 0 };

			if (options.centeringStrategy === 'centroid') {
				center = centroid(...points);
			} else if (options.centeringStrategy === 'cell-center') {
				const [lat, lng] = grid.cellToLatLng(id);
				center.lat = lat;
				center.lng = lng;
			} else {
				// smart is a mix of strategies to make the centers as accurate as possible while trying to avoid collissions
				if (points.length === 1) {
					center.lat = points[0].lat;
					center.lng = points[0].lng;
				} else {
					center = centroid(...points);

					const [lat, lng] = grid.cellToLatLng(id);

					const ids = grid.neighbors(id);
					const someNeighborHasClusters = ids.some((id) => buckets[id]);
					if (someNeighborHasClusters) {
						center = centroid(
							{ lat: center.lat, lng: center.lng, weight: 3 },
							{ lat, lng, weight: 1 }
						);
					}
				}
			}

			return {
				id,
				center,
				points
			};
		});

		const newMarkers = new Map<string, mapboxgl.Marker>();
		for (const cluster of clusters) {
			const markerOptions = options.createMarker?.(cluster);

			let element: HTMLElement | undefined = markerOptions?.content
				? htmlToElement(markerOptions.content)
				: undefined;
			if (element) {
				if (markerOptions?.zIndex) {
					element.style.zIndex = markerOptions.zIndex.toString();
				}
				if (markerOptions?.class) {
					element.classList.add(markerOptions?.class);
				}

				element.onclick = (e) => {
					e.stopPropagation();

					const zoomCluster = (options: { padding: number | mapboxgl.PaddingOptions }) => {
						const bounds = new mapbox.LngLatBounds();
						for (const point of cluster.points) {
							bounds.extend(point);
						}
						map.fitBounds(bounds, {
							padding: options.padding,
							maxZoom: 14.5,
							duration: 500,
							linear: true
						});
					};

					options.onClick?.({ cluster, zoomCluster, zoom });
				};
				if (options.onMouseOver) {
					element.onmouseover = () => options.onMouseOver({ cluster });
				}
				if (options.onMouseOut) {
					element.onmouseout = () => options.onMouseOut({ cluster });
				}
			}

			const marker = new mapbox.Marker({
				element,
				anchor: markerOptions?.anchor,
				offset: [markerOptions?.offsetX || 0, markerOptions?.offsetY || 0]
			});

			marker.setLngLat(cluster.center);
			newMarkers.set(hashObject({ ...markerOptions, ...cluster.center }), marker);
		}

		for (const [key, oldMarker] of markers) {
			if (!newMarkers.has(key)) {
				oldMarker.remove();
			}
		}

		for (const [key, nextMarker] of newMarkers) {
			const oldMarker = markers.get(key);
			if (!oldMarker) {
				nextMarker.addTo(map);
			} else {
				newMarkers.set(key, oldMarker);
			}
		}

		markers = newMarkers;
	};

	const handleZoom = throttle(compute, 200);
	map.on('zoom', handleZoom);
	const handleZoomEnd = debounce(compute, 100);
	map.on('zoomend', handleZoomEnd);
	compute();

	return () => {
		map.off('zoom', handleZoom);
		map.off('zoomend', handleZoomEnd);
	};
};
