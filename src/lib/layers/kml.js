/**
 * KML/KMZ → GeoJSON. Roda na thread principal porque precisa do DOMParser
 * (indisponível no Web Worker). KML é sempre WGS 84 (EPSG:4326).
 */
import { kml } from '@tmcw/togeojson';
import { unzipSync, strFromU8 } from 'fflate';

export function kmlTextToGeoJSON(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('O KML não é um XML válido.');
  const gj = kml(doc);
  // Propriedades de estilo do KML não interessam como atributos.
  gj.features = gj.features.map((f) => ({
    ...f,
    properties: Object.fromEntries(Object.entries(f.properties ?? {}).filter(([k]) => !/^(styleUrl|styleHash|styleMapHash|stroke|fill|icon)/.test(k))),
  }));
  return gj;
}

export function kmzToGeoJSON(bytes) {
  let zip;
  try {
    zip = unzipSync(new Uint8Array(bytes));
  } catch {
    throw new Error('O KMZ está corrompido ou não pôde ser aberto.');
  }
  const name = Object.keys(zip).find((k) => k.toLowerCase() === 'doc.kml') ?? Object.keys(zip).find((k) => k.toLowerCase().endsWith('.kml'));
  if (!name) throw new Error('O KMZ não contém um arquivo .kml.');
  return kmlTextToGeoJSON(strFromU8(zip[name]));
}
