import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWktPoint } from "../src/lib/geo/wkt.ts";
import { decodePolyline, encodePolyline } from "../src/lib/geo/polyline.ts";
import { haversineMetres, segmentPath, pathLengthMetres } from "../src/lib/geo/distance.ts";

test("WKT is POINT(lon lat) — longitude first", () => {
  const point = parseWktPoint("POINT(4.8936 52.3728)");
  assert.ok(point);
  assert.equal(point.lat, 52.3728);
  assert.equal(point.lng, 4.8936);
});

test("a reversed WKT point is not silently accepted as Amsterdam", () => {
  // POINT(52.3728 4.8936) is a real point — off Somalia. Parsing must report
  // what the string says, so the region check downstream can reject it.
  const point = parseWktPoint("POINT(52.3728 4.8936)");
  assert.ok(point);
  assert.equal(point.lat, 4.8936);
  assert.equal(point.lng, 52.3728);
});

test("WKT rejects rubbish and out-of-range values", () => {
  assert.equal(parseWktPoint("POINT(1 2 3)"), null);
  assert.equal(parseWktPoint("LINESTRING(1 2)"), null);
  assert.equal(parseWktPoint(null), null);
  assert.equal(parseWktPoint("POINT(4.89 91.0)"), null);
});

test("Valhalla polylines decode at precision 6, not 5", () => {
  const points = [
    { lat: 52.3728, lng: 4.8936 },
    { lat: 52.3741, lng: 4.8951 },
  ];
  const encoded6 = encodePolyline(points, 6);
  const decoded6 = decodePolyline(encoded6, 6);
  assert.equal(decoded6.length, 2);
  assert.ok(Math.abs(decoded6[0]!.lat - 52.3728) < 1e-6);
  assert.ok(Math.abs(decoded6[1]!.lng - 4.8951) < 1e-6);

  // Decoding the same string at 1e5 is the Gulf of Guinea bug: the numbers
  // come out ten times too large, off the map entirely.
  const wrong = decodePolyline(encoded6, 5);
  assert.ok(Math.abs(wrong[0]!.lat) > 90 || Math.abs(wrong[0]!.lat - 52.3728) > 1);
});

test("re-encoding at precision 5 round-trips within a metre", () => {
  const points = [
    { lat: 52.3728, lng: 4.8936 },
    { lat: 52.3741, lng: 4.8951 },
  ];
  const decoded = decodePolyline(encodePolyline(points, 5), 5);
  assert.ok(haversineMetres(points[0]!, decoded[0]!) < 1.5);
});

test("haversine gives metres", () => {
  const metres = haversineMetres({ lat: 52.3728, lng: 4.8936 }, { lat: 52.3828, lng: 4.8936 });
  assert.ok(metres > 1080 && metres < 1140, `got ${metres}`);
});

test("segmentPath splits a walk into scorable pieces", () => {
  const points = Array.from({ length: 40 }, (_, index) => ({ lat: 52.37 + index * 0.0005, lng: 4.89 }));
  const segments = segmentPath(points, 250);
  assert.ok(segments.length >= 3);
  const total = pathLengthMetres(points);
  const summed = segments.reduce((sum, segment) => sum + pathLengthMetres(segment), 0);
  assert.ok(Math.abs(total - summed) < 1, `${total} vs ${summed}`);
});
