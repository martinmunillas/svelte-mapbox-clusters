import { grid } from './grid';
import mapbox from 'mapbox-gl';

let markers: mapboxgl.Marker[] = [];

const clearMarkers = () => {
	for (const marker of markers) {
		marker.remove();
	}
	markers = [];
};

const throttle = (fn: VoidFunction, minInterval: number) => {
	let lastTime = 0;
	return function () {
		const now = Date.now();
		if (now - lastTime >= minInterval) {
			lastTime = now;
			fn();
		}
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

const DEFAULT_THROTTLE = 200;
const DEFAULT_CLUSTER_HTML = (d: Cluster<LatLng>) =>
	d.points.length === 1 ? undefined : `<div class="cluster">${d.points.length}</div>`;

const DEFAULT_OPTIONS = { throttle: DEFAULT_THROTTLE, clusterHTML: DEFAULT_CLUSTER_HTML };

type LatLng = { lat: number; lng: number };
type Cluster<T extends LatLng> = {
	id: string;
	center: LatLng;
	points: T[];
};

export const addClusteredLayer = <T extends { lat: number; lng: number }>(
	map: mapboxgl.Map,
	data: T[],
	options: {
		/**
		 * Min number of milliseconds in between computation executions
		 * @default 200
		 */
		throttle?: number;
		/**
		 * The HTML to be rendered on each cluster.
		 */
		clusterHTML?: (cluster: Cluster<T>) => string | undefined;
		/**
		 * It's called when the marker is clicked
		 * @param cluster
		 */
		onClick?: (cluster: Cluster<T>) => void;
	} = DEFAULT_OPTIONS
) => {
	options = { ...DEFAULT_OPTIONS, ...options };
	const compute = throttle(() => {
		if (!map) return;
		clearMarkers();
		const bounds = map.getBounds();
		if (!bounds) return;
		const filtered = data.filter((p, i) => bounds.contains(p));

		const vectorFunc = (p: (typeof data)[number]) => {
			if (!map) return [0, 0];
			const point = map.project(p);
			return [point.x, point.y];
		};

		const clusters = grid(filtered, {
			cellSize: 150,
			vector: vectorFunc
		});

		for (const cluster of clusters) {
			const html = options.clusterHTML?.(cluster);

			let element: HTMLElement | undefined = html ? htmlToElement(html) : undefined;
			if (element) {
				element.onclick = () => options.onClick?.(cluster);
			}
			const marker = new mapbox.Marker({
				element
			});

			marker.setLngLat(cluster.center);
			marker.addTo(map);
			markers.push(marker);
		}
	}, options.throttle || 0);

	map.on('zoom', compute);
	compute();

	return () => {
		map.off('zoom', compute);
	};
};
